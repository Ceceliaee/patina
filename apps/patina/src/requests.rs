mod settings;

use crate::{login::LoginEntry, tool_service::ToolService, tray::Tray};
use base64::{Engine as _, engine::general_purpose::STANDARD};
use patina_activity::{
    ActivityError, ActivityQueries, Classification, Preferences, RecordingControl,
    StorageOperations, StorageRequest,
};
use patina_desktop_protocol::{Reply, RequestError, WindowRequest};

pub(super) struct BackgroundQueries {
    runtime: tokio::runtime::Handle,
    queries: std::sync::Arc<ActivityQueries>,
}

impl BackgroundQueries {
    pub fn new(runtime: tokio::runtime::Handle, queries: ActivityQueries) -> Self {
        Self {
            runtime,
            queries: std::sync::Arc::new(queries),
        }
    }

    async fn read<T, F>(
        &self,
        query: impl FnOnce(std::sync::Arc<ActivityQueries>) -> F,
    ) -> Result<T, RequestError>
    where
        F: std::future::Future<Output = Result<T, String>> + Send + 'static,
        T: Send + 'static,
    {
        let result = self
            .runtime
            .spawn(query(self.queries.clone()))
            .await
            .map_err(|error| RequestError::Rejected(error.to_string()))?;
        result.map_err(RequestError::Rejected)
    }
}

pub(super) struct DesktopRequests {
    pub queries: BackgroundQueries,
    pub classification: Classification,
    pub preferences: Preferences,
    pub storage: StorageOperations,
    pub recording: RecordingControl,
    pub tools: ToolService,
    pub tray: Tray,
    pub login: LoginEntry,
    pub updater: patina_updater::Service,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(super) enum ExitAction {
    Quit,
    Restart,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(super) enum Dispatch {
    Parallel,
    Serial,
    Install,
    ReplaceDatabase,
}

impl Dispatch {
    pub fn for_request(request: &WindowRequest) -> Self {
        match request {
            WindowRequest::InstallUpdate => Self::Install,
            WindowRequest::Storage(StorageRequest::Move(_) | StorageRequest::Restore { .. }) => {
                Self::ReplaceDatabase
            }
            WindowRequest::Update(_)
            | WindowRequest::DetailZoom(_)
            | WindowRequest::HistoryZoom(_)
            | WindowRequest::HistoryModes(_)
            | WindowRequest::SavePreferences(..) => Self::Serial,
            WindowRequest::OpenExternal(_)
            | WindowRequest::Storage(_)
            | WindowRequest::Tools(_)
            | WindowRequest::HistoryMinimum(..)
            | WindowRequest::Rules
            | WindowRequest::ClassificationMode(_)
            | WindowRequest::DeleteApplication(..)
            | WindowRequest::DeleteWebsite(..)
            | WindowRequest::SaveRules(..)
            | WindowRequest::Preferences
            | WindowRequest::Trends(..)
            | WindowRequest::History { .. }
            | WindowRequest::Today
            | WindowRequest::Recent
            | WindowRequest::Icons(_)
            | WindowRequest::ChartMode(_)
            | WindowRequest::Edit(..) => Self::Parallel,
        }
    }
    pub fn exit_after(self, result: &Result<Reply, RequestError>) -> Option<ExitAction> {
        if result.is_err() {
            return None;
        }
        match self {
            Self::Install => Some(ExitAction::Quit),
            Self::ReplaceDatabase => Some(ExitAction::Restart),
            _ => None,
        }
    }
}

pub(super) struct WindowCaller {
    pub main_hwnd: Option<usize>,
    pub pid: u32,
}

impl WindowCaller {
    pub fn authorize(&self, request: &WindowRequest) -> Result<(), RequestError> {
        if matches!(request, WindowRequest::InstallUpdate) && self.main_hwnd.is_none() {
            return Err("Open the main window to install an update".into());
        }
        if let WindowRequest::Storage(StorageRequest::DavReveal(hwnd)) = request {
            use windows::Win32::{
                Foundation::HWND,
                UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowThreadProcessId},
            };
            let handle = HWND(*hwnd as _);
            let mut pid = 0;
            let foreground = unsafe {
                GetWindowThreadProcessId(handle, Some(&mut pid));
                GetForegroundWindow()
            };
            if self.main_hwnd != Some(*hwnd) || pid != self.pid || foreground != handle {
                return Err("Open the main Settings window to reveal this password".into());
            }
        }
        Ok(())
    }
}

fn activity_error(error: ActivityError) -> RequestError {
    match error {
        ActivityError::Conflict(message) => RequestError::Conflict(message),
        ActivityError::Rejected(message) => RequestError::Rejected(message),
    }
}

impl DesktopRequests {
    pub async fn handle(&self, request: WindowRequest) -> Result<Reply, RequestError> {
        let prefs = &self.preferences;
        let locale = prefs.locale();
        Ok(match request {
            WindowRequest::OpenExternal(url) => {
                open_external(&url)?;
                Reply::Done
            }
            WindowRequest::Update(command) => Reply::Update(self.updater.request(command)?),
            WindowRequest::InstallUpdate => {
                let updater = self.updater.clone();
                blocking::unblock(move || {
                    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
                    updater.begin_install(&exe)
                })
                .await?;
                Reply::Done
            }
            WindowRequest::Storage(request) => Reply::Storage(
                self.storage
                    .request(request)
                    .await
                    .map_err(activity_error)?,
            ),
            WindowRequest::Tools(request) => {
                return self.tools.request(request, locale.tag()).await;
            }
            WindowRequest::DetailZoom(hours) => Reply::Zoom(prefs.detail_zoom(hours).await?),
            WindowRequest::HistoryModes(modes) => {
                Reply::HistoryModes(prefs.history_modes(modes).await?)
            }
            WindowRequest::HistoryZoom(hours) => Reply::Zoom(prefs.history_zoom(hours).await?),
            WindowRequest::HistoryMinimum(detail, seconds) => {
                prefs.set_history_minimum(detail, seconds).await?;
                Reply::Done
            }
            WindowRequest::Rules => Reply::Rules(
                self.classification
                    .load_classification_rules()
                    .await
                    .map_err(activity_error)?,
            ),
            WindowRequest::ClassificationMode(web) => {
                self.classification
                    .remember_classification_mode(web)
                    .await
                    .map_err(activity_error)?;
                Reply::Done
            }
            WindowRequest::SaveRules(apps, websites, links, categories) => {
                self.classification
                    .save_classification_rules(apps, websites, links, categories)
                    .await
                    .map_err(activity_error)?;
                Reply::Done
            }
            WindowRequest::DeleteApplication(exe, confirmed) => {
                let apply = confirmed.is_some();
                let impact = self
                    .classification
                    .delete_application(exe, confirmed)
                    .await
                    .map_err(activity_error)?;
                if apply {
                    self.tools.wake();
                }
                Reply::Deletion(impact)
            }
            WindowRequest::DeleteWebsite(identity, confirmed) => {
                let apply = confirmed.is_some();
                let impact = self
                    .classification
                    .delete_website(identity, confirmed)
                    .await
                    .map_err(activity_error)?;
                if apply {
                    self.tools.wake();
                }
                Reply::Deletion(impact)
            }
            WindowRequest::Preferences => {
                Reply::Preferences(prefs.preferences().await.map_err(activity_error)?)
            }
            WindowRequest::SavePreferences(old, next) => {
                let desired = settings::save(
                    self.tray.behavior.get(),
                    old.desktop,
                    next.desktop,
                    |enabled| self.login.apply(enabled),
                    |state| {
                        self.tray
                            .apply_visibility(state)
                            .map_err(std::io::Error::other)
                    },
                    prefs.save_preferences(old, next),
                )
                .await?;
                self.tray.behavior.set(desired);
                Reply::Done
            }
            WindowRequest::Trends(range, kind) => Reply::Trends(
                self.queries
                    .read(|queries| async move { queries.trends(range, kind, locale).await })
                    .await?,
            ),
            WindowRequest::History {
                day,
                app,
                titles,
                web,
            } => {
                let last_sample = self.recording.last_successful_sample_ms();
                Reply::History(
                    self.queries
                        .read(|queries| async move {
                            queries
                                .history_source(day, app, titles, web, locale, last_sample)
                                .await
                        })
                        .await?,
                )
            }
            WindowRequest::Today => Reply::Today(
                self.queries
                    .read(|queries| async move { queries.load_today_summary(locale).await })
                    .await?,
            ),
            WindowRequest::Recent => {
                let last_sample = self.recording.last_successful_sample_ms();
                Reply::Recent(
                    self.queries
                        .read(|queries| async move { queries.recent(locale, last_sample).await })
                        .await?,
                )
            }
            WindowRequest::Icons(keys) => Reply::Icons(
                self.queries
                    .read(|queries| async move {
                        Ok(queries
                            .icons(keys)
                            .await?
                            .into_iter()
                            .map(|(key, bytes)| (key, STANDARD.encode(bytes)))
                            .collect())
                    })
                    .await?,
            ),
            WindowRequest::ChartMode(mode) => {
                prefs.set_chart_mode(mode).await?;
                Reply::Done
            }
            WindowRequest::Edit(key, edit) => {
                self.classification
                    .edit_app(key, edit)
                    .await
                    .map_err(activity_error)?;
                Reply::Done
            }
        })
    }
}

fn open_external(url: &str) -> Result<(), RequestError> {
    if !url.starts_with("https://") || url.contains('\0') {
        return Err("Invalid external link".into());
    }
    use windows::{
        Win32::UI::{Shell::ShellExecuteW, WindowsAndMessaging::SW_SHOWNORMAL},
        core::{PCWSTR, w},
    };
    let wide: Vec<u16> = url.encode_utf16().chain(Some(0)).collect();
    let result = unsafe {
        ShellExecuteW(
            None,
            w!("open"),
            PCWSTR(wide.as_ptr()),
            None,
            None,
            SW_SHOWNORMAL,
        )
    };
    if result.0 as isize <= 32 {
        return Err("Could not open external link".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn activity_aggregation_runs_on_the_existing_runtime_worker() {
        let runtime = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(1)
            .enable_all()
            .build()
            .unwrap();
        let root = tempfile::tempdir().unwrap();
        let pool = runtime
            .block_on(patina_activity::open_database(
                &root.path().join("patina.db"),
            ))
            .unwrap();
        let queries =
            BackgroundQueries::new(runtime.handle().clone(), ActivityQueries::new(pool.clone()));
        let caller = std::thread::current().id();
        let (worker, total) = runtime
            .block_on(queries.read(|queries| async move {
                let summary = queries
                    .load_today_summary(patina_activity::Locale::EnUs)
                    .await?;
                Ok((std::thread::current().id(), summary.total_duration_ms))
            }))
            .unwrap();
        assert_ne!(worker, caller);
        assert_eq!(total, 0);
        runtime.block_on(pool.close());
    }

    #[test]
    fn only_database_replacement_drains_and_restarts() {
        let cases = [
            (WindowRequest::Today, Dispatch::Parallel, None),
            (WindowRequest::HistoryZoom(Some(6.)), Dispatch::Serial, None),
            (
                WindowRequest::InstallUpdate,
                Dispatch::Install,
                Some(ExitAction::Quit),
            ),
            (
                WindowRequest::Storage(StorageRequest::Restore {
                    hash: String::new(),
                    replace: true,
                }),
                Dispatch::ReplaceDatabase,
                Some(ExitAction::Restart),
            ),
        ];
        for (request, expected, exit) in cases {
            let dispatch = Dispatch::for_request(&request);
            assert_eq!(dispatch, expected);
            assert_eq!(dispatch.exit_after(&Ok(Reply::Done)), exit);
            assert_eq!(
                dispatch.exit_after(&Err(RequestError::Rejected("failed".into()))),
                None
            );
        }
    }

    #[test]
    fn main_window_privileges_require_a_live_window_identity() {
        let caller = WindowCaller {
            main_hwnd: None,
            pid: std::process::id(),
        };
        assert!(caller.authorize(&WindowRequest::Today).is_ok());
        assert!(matches!(
            caller.authorize(&WindowRequest::InstallUpdate),
            Err(RequestError::Rejected(_))
        ));
        assert!(matches!(
            caller.authorize(&WindowRequest::Storage(StorageRequest::DavReveal(0))),
            Err(RequestError::Rejected(_))
        ));
    }
}
