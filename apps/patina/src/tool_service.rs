use patina_desktop_protocol::{Reply, RequestError};
use patina_plugin_host::{Host, now_ms};
use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};
use std::{path::PathBuf, sync::mpsc, time::Duration};

use patina_desktop_protocol::tools::ToolRequest;

type ResultValue = Result<Reply, RequestError>;
type Job = (ToolRequest, String, async_channel::Sender<ResultValue>);
enum Message {
    Job(Box<Job>),
    Wake,
    Stop,
}

#[derive(Clone)]
pub(super) struct ToolService(mpsc::SyncSender<Message>, Arc<AtomicBool>);

pub(super) struct ToolWorker(mpsc::SyncSender<Message>, std::thread::JoinHandle<()>);
impl ToolWorker {
    pub fn stop(self) -> std::io::Result<()> {
        let _ = self.0.send(Message::Stop);
        self.1
            .join()
            .map_err(|_| std::io::Error::other("Tool worker terminated unexpectedly"))
    }
}

impl ToolService {
    pub fn start(
        root: PathBuf,
        storage: patina_activity::NativeToolData,
        mut language: String,
        actions: async_channel::Sender<crate::Action>,
        usage_active: Arc<AtomicBool>,
    ) -> std::io::Result<(Self, ToolWorker)> {
        let (jobs, queue) = mpsc::sync_channel::<Message>(16);
        let dirty = Arc::new(AtomicBool::new(true));
        let wake = dirty.clone();
        let worker = std::thread::Builder::new()
            .name("patina-tools".into())
            .spawn(move || {
                let mut pending = crate::bundled_tools::BUNDLES.iter().collect::<Vec<_>>();
                let mut bind_pending = |host: &mut Host, locale: &str| {
                    pending.retain(|bundle| {
                        if let Err(error) =
                            crate::bundled_tools::start(host, &storage, bundle, locale)
                        {
                            eprintln!("Bind bundled tool: {error}");
                            true
                        } else {
                            false
                        }
                    });
                };
                let open = || {
                    let mut host = Host::open(root.clone())?;
                    crate::bundled_tools::configure(&mut host, &storage)?;
                    Ok::<_, String>(host)
                };
                let mut host = open();
                if let Ok(h) = host.as_mut() {
                    bind_pending(h, &language);
                }
                let mut events = crate::tool_events::ToolEvents::default();
                let mut display_failures = 0u8;
                let mut retry_display_at = None;
                let notify = |events: &mut crate::tool_events::ToolEvents, h: &Host| match events
                    .delivery(h, &storage)
                {
                    Ok(Some(dialog)) => {
                        let _ = actions.try_send(crate::Action::ToolNotice { dialog });
                    }
                    Ok(None) => (),
                    Err(e) => eprintln!("Tool notification: {e}"),
                };
                if let Ok(h) = &host {
                    notify(&mut events, h);
                }
                loop {
                    if retry_display_at.is_some_and(|at| at <= now_ms()) {
                        retry_display_at = None;
                        if let Ok(h) = &host {
                            notify(&mut events, h);
                        }
                    }
                    if let Ok(h) = &host
                        && (dirty.swap(false, Ordering::AcqRel)
                            || events.next_usage.is_some_and(|at| at <= now_ms()))
                    {
                        match events.evaluate(h, &storage) {
                            Ok(changed) => {
                                usage_active.store(events.next_usage.is_some(), Ordering::Release);
                                if changed {
                                    notify(&mut events, h);
                                }
                            }
                            Err(e) => {
                                eprintln!("Usage reminder: {e}");
                                events.next_usage = Some(now_ms() + 5000);
                            }
                        }
                    }
                    let deadline = host
                        .as_ref()
                        .ok()
                        .and_then(Host::next_deadline)
                        .into_iter()
                        .chain(events.next_usage)
                        .chain(retry_display_at)
                        .min();
                    let next = match deadline {
                        Some(at) => {
                            let now = now_ms();
                            if at <= now {
                                let h = host.as_mut().unwrap();
                                let failures = h.fire_due(now, &language);
                                if !failures.is_empty() {
                                    for (id, error) in failures {
                                        eprintln!("Tool timer {id}: {error}");
                                    }
                                }
                                notify(&mut events, h);
                                let _ = actions
                                    .try_send(crate::Action::ToolChanged { background: true });
                                match queue.try_recv() {
                                    Ok(job) => Some(job),
                                    Err(mpsc::TryRecvError::Empty) => continue,
                                    Err(mpsc::TryRecvError::Disconnected) => None,
                                }
                            } else {
                                match queue.recv_timeout(Duration::from_millis(
                                    (at - now).min(60_000) as u64,
                                )) {
                                    Ok(job) => Some(job),
                                    Err(mpsc::RecvTimeoutError::Timeout) => continue,
                                    Err(mpsc::RecvTimeoutError::Disconnected) => None,
                                }
                            }
                        }
                        None => queue.recv().ok(),
                    };
                    let (request, locale, reply) = match next {
                        Some(Message::Job(job)) => *job,
                        Some(Message::Wake) => continue,
                        Some(Message::Stop) | None => break,
                    };
                    let background = matches!(&request, ToolRequest::Acknowledge(..));
                    let changed = matches!(
                        &request,
                        ToolRequest::Panel {
                            action: Some(_),
                            ..
                        } | ToolRequest::Submit { .. }
                            | ToolRequest::Install(..)
                            | ToolRequest::Restore(_)
                            | ToolRequest::Acknowledge(..)
                            | ToolRequest::Uninstall { .. }
                    );
                    language.clone_from(&locale);
                    let result = (|| {
                        if host.is_err() {
                            host = open();
                        }
                        let host = host.as_mut().map_err(|e| e.clone())?;
                        bind_pending(host, &locale);
                        let response = match request {
                            ToolRequest::List | ToolRequest::OpenHome => {
                                let tools = host.list();
                                let mut last = storage.last_section()?;
                                if let Some(id) = &last
                                    && (matches!(request, ToolRequest::OpenHome)
                                        || !tools.iter().any(|t| &t.manifest.id == id))
                                {
                                    storage.clear_section()?;
                                    last = None;
                                }
                                Reply::Tools((
                                    tools,
                                    display_failures > 0
                                        && !events.list(host, &storage)?.is_empty(),
                                    last,
                                ))
                            }
                            ToolRequest::DisplayFailed => {
                                display_failures = display_failures.saturating_add(1);
                                retry_display_at = (display_failures <= 3)
                                    .then(|| now_ms() + i64::from(display_failures) * 500);
                                Reply::Done
                            }
                            ToolRequest::RetryDisplay => {
                                display_failures = 0;
                                retry_display_at = None;
                                notify(&mut events, host);
                                Reply::Done
                            }
                            ToolRequest::Stopping(id, gen_id) => Reply::Stopping(
                                host.uninstall_impact_labels(&id, &gen_id, &locale)?,
                            ),
                            ToolRequest::Shortcuts => {
                                let mut items = Vec::new();
                                for (cap, kind) in [
                                    (
                                        patina_plugin_host::Capability::Focus,
                                        patina_activity::TaskKind::Focus,
                                    ),
                                    (
                                        patina_plugin_host::Capability::Reminders,
                                        patina_activity::TaskKind::Reminders,
                                    ),
                                ] {
                                    for tool in host.providers(cap) {
                                        let db = storage.plugin_tasks(&tool.manifest.id, kind)?;
                                        for mut item in db.shortcuts(
                                            kind == patina_activity::TaskKind::Focus,
                                            kind == patina_activity::TaskKind::Reminders,
                                            &locale,
                                            now_ms(),
                                        )? {
                                            item.target =
                                                item.target.for_installation(&tool.generation);
                                            items.push(item);
                                        }
                                    }
                                }
                                Reply::Shortcuts(items)
                            }
                            ToolRequest::Restore(id) => Reply::Installed(
                                host.restore_default(crate::bundled_tools::package(&id)?, &locale)?,
                            ),
                            ToolRequest::Notices(dialog) => Reply::Notices(
                                if events.delivery(host, &storage)? == Some(dialog) {
                                    events.for_display(host, &storage, &locale)?
                                } else {
                                    vec![]
                                },
                            ),
                            ToolRequest::Preferences => {
                                Reply::NoticePreferences(storage.preferences()?)
                            }
                            ToolRequest::SavePreferences(p) => {
                                Reply::NoticePreferences(storage.save_preferences(p)?)
                            }
                            ToolRequest::Presented(n) => {
                                events.present(&n, host, &storage)?;
                                display_failures = 0;
                                retry_display_at = None;
                                Reply::Done
                            }
                            ToolRequest::Submit {
                                id,
                                generation,
                                button,
                                fields,
                            } => Reply::Panel(host.submit(
                                &id,
                                &generation,
                                button,
                                fields,
                                &locale,
                            )?),
                            ToolRequest::Acknowledge(n, choice) => {
                                events.acknowledge(&n, &choice, host, &storage, &locale)?;
                                Reply::Done
                            }
                            ToolRequest::SelectTab {
                                id,
                                generation,
                                tab,
                            } => Reply::Panel(host.select_tab(&id, &generation, tab, &locale)?),
                            ToolRequest::Inspect(path) => Reply::Preview(host.inspect(&path)?),
                            ToolRequest::Install(path, preview) => {
                                Reply::Installed(host.install(&path, &preview, &locale).map_err(
                                    |error| match error {
                                        patina_plugin_host::InstallError::StalePreview => {
                                            RequestError::Conflict(error.to_string())
                                        }
                                        patina_plugin_host::InstallError::Rejected(message) => {
                                            RequestError::Rejected(message)
                                        }
                                    },
                                )?)
                            }
                            ToolRequest::Panel {
                                id,
                                generation,
                                action,
                                remember,
                            } => {
                                let panel =
                                    host.dispatch_panel_event(&id, &generation, action, &locale)?;
                                if remember && let Err(error) = storage.remember_section(&id) {
                                    eprintln!("Save selected tool: {error}");
                                }
                                Reply::Panel(panel)
                            }
                            ToolRequest::Uninstall { id, generation } => {
                                host.uninstall(&id, &generation)?;
                                Reply::Done
                            }
                        };
                        Ok(response)
                    })();
                    if changed && result.is_ok() {
                        dirty.store(true, Ordering::Release);
                        let _ = actions.try_send(crate::Action::ToolChanged { background });
                        if let Ok(h) = &host {
                            notify(&mut events, h);
                        }
                    }
                    let _ = reply.try_send(result);
                }
            })?;
        Ok((Self(jobs.clone(), wake), ToolWorker(jobs, worker)))
    }

    pub fn wake(&self) {
        if !self.1.swap(true, Ordering::AcqRel) {
            let _ = self.0.try_send(Message::Wake);
        }
    }

    pub async fn request(&self, request: ToolRequest, locale: &str) -> ResultValue {
        let (reply, receiver) = async_channel::bounded(1);
        self.0
            .try_send(Message::Job(Box::new((request, locale.to_owned(), reply))))
            .map_err(|error| match error {
                mpsc::TrySendError::Full(_) => RequestError::Busy,
                mpsc::TrySendError::Disconnected(_) => RequestError::Disconnected,
            })?;
        receiver
            .recv()
            .await
            .map_err(|_| RequestError::Disconnected)?
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    #[ignore = "requires the two compiled Rust counter packages"]
    fn replaced_package_returns_a_desktop_conflict() -> Result<(), Box<dyn std::error::Error>> {
        let tmp = tempfile::tempdir()?;
        let runtime = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(1)
            .enable_all()
            .build()?;
        let pool = runtime.block_on(patina_activity::open_database(
            &tmp.path().join("patina.db"),
        ))?;
        let storage = patina_activity::NativeToolData::new(pool, runtime.handle().clone());
        let (sender, _receiver) = async_channel::unbounded();
        let (tools, worker) = ToolService::start(
            tmp.path().join("tools"),
            storage,
            "en-US".into(),
            sender,
            Arc::new(AtomicBool::new(false)),
        )?;
        let file = tmp.path().join("counter.zip");
        std::fs::copy(std::env::var("PATINA_COUNTER_PACKAGE")?, &file)?;
        let Reply::Preview(preview) =
            runtime.block_on(tools.request(ToolRequest::Inspect(file.clone()), "en-US"))?
        else {
            panic!("missing inspect response")
        };
        std::fs::copy(std::env::var("PATINA_COUNTER_UPDATE")?, &file)?;
        assert!(matches!(
            runtime.block_on(tools.request(ToolRequest::Install(file, preview), "en-US")),
            Err(RequestError::Conflict(_))
        ));
        worker.stop()?;
        Ok(())
    }

    #[test]
    fn delivery_is_sticky_and_failed_presentation_can_retry()
    -> Result<(), Box<dyn std::error::Error>> {
        use patina_activity::{
            NoticeDelivery as D, NoticePreferencesPatch as Patch, NoticeSound as S,
        };
        let tmp = tempfile::tempdir()?;
        let runtime = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(1)
            .enable_all()
            .build()?;
        let pool = runtime.block_on(patina_activity::open_database(
            &tmp.path().join("patina.db"),
        ))?;
        let storage = patina_activity::NativeToolData::new(pool, runtime.handle().clone());
        storage.save_preferences(Patch {
            delivery: Some(D::Dialog),
            sound: Some(S::None),
        })?;
        let past = now_ms() - 120000;
        storage.reminders().apply(serde_json::json!({"kind":"create","at":past+60000,"label":"Pending","recurrence":null}),past)?;
        let (sender, receiver) = async_channel::unbounded();
        let (tools, worker) = ToolService::start(
            tmp.path().join("tools"),
            storage,
            "en-US".into(),
            sender,
            Arc::new(AtomicBool::new(false)),
        )?;
        let request = |q| runtime.block_on(tools.request(q, "en-US"));
        let wait_dialog = || -> Result<(), Box<dyn std::error::Error>> {
            runtime.block_on(async {
                tokio::time::timeout(Duration::from_secs(10), async {
                    while !matches!(
                        receiver.recv().await?,
                        crate::Action::ToolNotice { dialog: true }
                    ) {}
                    Ok::<_, async_channel::RecvError>(())
                })
                .await??;
                Ok(())
            })
        };
        wait_dialog()?;
        request(ToolRequest::SavePreferences(Patch {
            delivery: Some(D::Notification),
            sound: None,
        }))?;
        assert!(matches!(request(ToolRequest::Notices(false))?, Reply::Notices(n) if n.is_empty()));
        let mut notices: Vec<patina_desktop_protocol::tools::Notice> =
            patina_desktop_protocol::FromReply::from_reply(request(ToolRequest::Notices(true))?)?;
        let notice = notices.pop().unwrap();
        for _ in 0..3 {
            request(ToolRequest::DisplayFailed)?;
            wait_dialog()?;
        }
        request(ToolRequest::DisplayFailed)?;
        assert!(matches!(
            request(ToolRequest::List)?,
            Reply::Tools((_, true, _))
        ));
        request(ToolRequest::RetryDisplay)?;
        wait_dialog()?;
        request(ToolRequest::Presented(notice.clone()))?;
        request(ToolRequest::Presented(notice.clone()))?;
        let content = notice.content.as_ref().unwrap();
        assert_eq!(content.title, "Pending");
        assert_eq!(content.choices.as_ref().unwrap().options[0].1, "In 5 min");
        assert!(request(ToolRequest::Acknowledge(notice.clone(), "start".into())).is_err());
        request(ToolRequest::Acknowledge(notice.clone(), "snooze-5".into()))?;
        assert!(request(ToolRequest::Acknowledge(notice, "snooze-5".into())).is_err());
        assert!(matches!(
            request(ToolRequest::List)?,
            Reply::Tools((_, false, _))
        ));
        worker.stop()?;
        Ok(())
    }
}
