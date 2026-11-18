use patina_desktop_protocol::Reply;
use patina_tool_host::{Host, now_ms};
use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};
use std::{path::PathBuf, sync::mpsc, time::Duration};

use patina_desktop_protocol::tools::ToolRequest;

type ResultValue = Result<Reply, String>;
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
        storage: patina_recorder::NativeToolData,
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
                let open = || -> Result<Host, String> {
                    let mut host = Host::open(root.clone())?;
                    host.bind(Box::new(crate::bundled_tools::Storage(storage.clone())))?;
                    for id in crate::bundled_tools::IDS {
                        if let Err(error) = host.seed(crate::bundled_tools::package(id)?, "en-US") {
                            eprintln!("Install bundled tool {id}: {error}");
                        }
                    }
                    Ok(host)
                };
                let mut host = open();
                if let Ok(h) = host.as_mut() {
                    for installed in h.list() {
                        let id = &installed.manifest.id;
                        if storage.has_scheduled_work(id).unwrap_or(false)
                            && let Err(e) = h.panel(id, &installed.generation, None, &language)
                        {
                            eprintln!("Restore tool {id}: {e}");
                        }
                    }
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
                        let response = match request {
                            ToolRequest::List => Reply::Tools((
                                host.list(),
                                display_failures > 0 && !events.list(host, &storage)?.is_empty(),
                                storage.last_section()?,
                            )),
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
                            ToolRequest::Stopping(id, gen_id) => {
                                Reply::Stopping(host.stopping(&id, &gen_id, &locale)?)
                            }
                            ToolRequest::Shortcuts => {
                                let installed = host.list();
                                let has = |id: &str| installed.iter().any(|t| t.manifest.id == id);
                                Reply::Shortcuts(storage.shortcuts(
                                    has("patina.focus"),
                                    has("patina.reminders"),
                                    &locale,
                                    now_ms(),
                                )?)
                            }
                            ToolRequest::Restore(id) => Reply::Installed(
                                host.restore_bundled(crate::bundled_tools::package(&id)?, &locale)?,
                            ),
                            ToolRequest::Notices(dialog) => Reply::Notices(
                                if events.delivery(host, &storage)? == Some(dialog) {
                                    events.list(host, &storage)?
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
                            ToolRequest::Inspect(path) => Reply::Preview(host.inspect(&path)?),
                            ToolRequest::Install(path, preview) => {
                                Reply::Installed(host.install(&path, &preview, &locale)?)
                            }
                            ToolRequest::Panel {
                                id,
                                generation,
                                action,
                                remember,
                            } => {
                                let panel = host.panel(&id, &generation, action, &locale)?;
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
            .map_err(|_| "Tool host unavailable")?;
        receiver
            .recv()
            .await
            .map_err(|_| "Tool host disconnected")?
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn delivery_is_sticky_and_failed_presentation_can_retry()
    -> Result<(), Box<dyn std::error::Error>> {
        use patina_recorder::{
            NoticeDelivery as D, NoticePreferencesPatch as Patch, NoticeSound as S,
        };
        let tmp = tempfile::tempdir()?;
        let recorder = patina_recorder::Recorder::start(&tmp.path().join("patina.db"), || {})?;
        let storage = recorder.tools();
        storage.save_preferences(Patch {
            delivery: Some(D::Dialog),
            sound: Some(S::None),
        })?;
        let past = now_ms() - 120000;
        storage.apply("patina.reminders",serde_json::json!({"kind":"create","at":past+60000,"label":"Pending","recurrence":null}),past)?;
        let (sender, receiver) = async_channel::unbounded();
        let (tools, worker) = ToolService::start(
            tmp.path().join("tools"),
            storage,
            "en-US".into(),
            sender,
            Arc::new(AtomicBool::new(false)),
        )?;
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()?;
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
        let mut notices: Vec<patina_tool_host::Notice> =
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
        request(ToolRequest::Acknowledge(notice.clone(), "5".into()))?;
        assert!(request(ToolRequest::Acknowledge(notice, "5".into())).is_err());
        assert!(matches!(
            request(ToolRequest::List)?,
            Reply::Tools((_, false, _))
        ));
        worker.stop()?;
        recorder.shutdown()?;
        Ok(())
    }
}
