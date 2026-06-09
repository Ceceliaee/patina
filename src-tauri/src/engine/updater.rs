use std::sync::{Arc, Mutex};

use tauri::{AppHandle, Emitter, Runtime};
use tauri_plugin_updater::{Update, UpdaterExt};
use tokio::time::{sleep, Duration};

use crate::data::repositories::update_state;
use crate::data::sqlite_pool::wait_for_sqlite_pool;
use crate::domain::update::{UpdateErrorStage, UpdateSnapshot, UpdateStatus};

const STARTUP_AUTO_CHECK_DELAYS_MS: [u64; 3] = [3_500, 15_000, 60_000];
const UPDATE_SNAPSHOT_CHANGED_EVENT: &str = "update-snapshot-changed";
const RELEASES_BASE_URL: &str = "https://github.com/Ceceliaee/patina/releases";
const LATEST_RELEASE_URL: &str = "https://github.com/Ceceliaee/patina/releases/latest";

#[derive(Clone)]
pub struct UpdaterRuntimeState {
    inner: Arc<Mutex<UpdaterStateInner>>,
}

struct UpdaterStateInner {
    snapshot: UpdateSnapshot,
    pending_update: Option<Update>,
    downloaded_bytes: Option<Vec<u8>>,
}

impl UpdaterRuntimeState {
    pub fn new(current_version: String) -> Self {
        Self {
            inner: Arc::new(Mutex::new(UpdaterStateInner {
                snapshot: UpdateSnapshot::idle(current_version)
                    .with_fallback_urls(Some(latest_release_page_url()), None),
                pending_update: None,
                downloaded_bytes: None,
            })),
        }
    }

    pub fn snapshot(&self) -> UpdateSnapshot {
        self.with_guard(|inner| inner.snapshot.clone())
    }

    fn set_checking(&self) -> UpdateSnapshot {
        self.with_guard(|inner| {
            inner.snapshot = inner.snapshot.clone().checking();
            inner.snapshot.clone()
        })
    }

    fn set_available(&self, update: Update) -> UpdateSnapshot {
        let release_page_url = release_page_url_for_version(&update.version);
        let asset_download_url = Some(update.download_url.to_string());
        self.with_guard(|inner| {
            inner.snapshot = inner
                .snapshot
                .clone()
                .available(
                    update.version.clone(),
                    update.body.clone(),
                    update.date.map(|value| value.to_string()),
                )
                .with_fallback_urls(release_page_url.clone(), asset_download_url.clone());
            inner.pending_update = Some(update);
            inner.downloaded_bytes = None;
            inner.snapshot.clone()
        })
    }

    fn set_up_to_date(&self) -> UpdateSnapshot {
        self.with_guard(|inner| {
            inner.snapshot = inner
                .snapshot
                .clone()
                .up_to_date()
                .with_fallback_urls(Some(latest_release_page_url()), None);
            inner.pending_update = None;
            inner.downloaded_bytes = None;
            inner.snapshot.clone()
        })
    }

    fn set_error(&self, stage: UpdateErrorStage, message: String) -> UpdateSnapshot {
        self.with_guard(|inner| {
            inner.snapshot = inner.snapshot.clone().error(stage, message);
            inner.snapshot.clone()
        })
    }

    fn set_downloading(&self) -> UpdateSnapshot {
        self.with_guard(|inner| {
            inner.snapshot = inner.snapshot.clone().downloading();
            inner.snapshot.clone()
        })
    }

    fn set_download_progress(
        &self,
        downloaded_bytes: u64,
        total_bytes: Option<u64>,
    ) -> UpdateSnapshot {
        self.with_guard(|inner| {
            inner.snapshot = inner
                .snapshot
                .clone()
                .download_progress(downloaded_bytes, total_bytes);
            inner.snapshot.clone()
        })
    }

    fn set_downloaded(&self, bytes: Vec<u8>) -> UpdateSnapshot {
        self.with_guard(|inner| {
            inner.snapshot = inner.snapshot.clone().downloaded(bytes.len() as u64);
            inner.downloaded_bytes = Some(bytes);
            inner.snapshot.clone()
        })
    }

    fn set_installing(&self) -> UpdateSnapshot {
        self.with_guard(|inner| {
            inner.snapshot = inner.snapshot.clone().installing();
            inner.snapshot.clone()
        })
    }

    fn pending_update(&self) -> Option<Update> {
        self.with_guard(|inner| inner.pending_update.clone())
    }

    fn set_pending_update(&self, update: Update) {
        self.with_guard(|inner| {
            inner.pending_update = Some(update);
        });
    }

    fn take_downloaded_bytes(&self) -> Option<Vec<u8>> {
        self.with_guard(|inner| inner.downloaded_bytes.take())
    }

    fn set_downloaded_bytes(&self, bytes: Vec<u8>) {
        self.with_guard(|inner| {
            inner.downloaded_bytes = Some(bytes);
        });
    }

    fn with_guard<T>(&self, f: impl FnOnce(&mut UpdaterStateInner) -> T) -> T {
        match self.inner.lock() {
            Ok(mut guard) => f(&mut guard),
            Err(poisoned) => {
                let mut guard = poisoned.into_inner();
                f(&mut guard)
            }
        }
    }
}

fn latest_release_page_url() -> String {
    LATEST_RELEASE_URL.to_string()
}

fn release_page_url_for_version(version: &str) -> Option<String> {
    if version.trim().is_empty() {
        return Some(latest_release_page_url());
    }

    Some(format!("{RELEASES_BASE_URL}/tag/v{version}"))
}

fn emit_update_snapshot_changed<R: Runtime>(app: &AppHandle<R>, snapshot: &UpdateSnapshot) {
    if let Err(error) = app.emit(UPDATE_SNAPSHOT_CHANGED_EVENT, snapshot) {
        eprintln!("[updater] failed to emit update snapshot change: {error}");
    }
}

pub async fn check_for_updates<R: Runtime>(
    app: &AppHandle<R>,
    state: &UpdaterRuntimeState,
    silent: bool,
) -> Result<UpdateSnapshot, String> {
    let silent_context = if silent {
        let pool = wait_for_sqlite_pool(app).await?;
        let today = update_state::current_local_day();
        let last_day = update_state::load_last_auto_check_day(&pool)
            .await
            .map_err(|error| format!("failed to read auto update check state: {error}"))?;
        if last_day.as_deref() == Some(today.as_str()) {
            return Ok(state.snapshot());
        }
        Some((pool, today))
    } else {
        None
    };

    let checking_snapshot = state.set_checking();
    emit_update_snapshot_changed(app, &checking_snapshot);

    let updater = match app.updater() {
        Ok(updater) => updater,
        Err(error) => {
            let snapshot = state.set_error(
                UpdateErrorStage::Check,
                format!("failed to initialize updater: {error}"),
            );
            emit_update_snapshot_changed(app, &snapshot);
            return Ok(snapshot);
        }
    };

    let update = match updater.check().await {
        Ok(update) => update,
        Err(error) => {
            let snapshot = state.set_error(
                UpdateErrorStage::Check,
                format!("failed to check updates: {error}"),
            );
            emit_update_snapshot_changed(app, &snapshot);
            return Ok(snapshot);
        }
    };

    let snapshot = match update {
        Some(update) => state.set_available(update),
        None => state.set_up_to_date(),
    };

    if let Some((pool, today)) = silent_context {
        if let Err(error) = update_state::save_last_auto_check_day(&pool, &today).await {
            eprintln!("[updater] failed to persist auto update check state: {error}");
        }
    }

    emit_update_snapshot_changed(app, &snapshot);
    Ok(snapshot)
}

pub async fn run_startup_auto_check<R: Runtime>(app: AppHandle<R>, state: UpdaterRuntimeState) {
    for (attempt, delay_ms) in STARTUP_AUTO_CHECK_DELAYS_MS.iter().enumerate() {
        sleep(Duration::from_millis(*delay_ms)).await;

        match check_for_updates(&app, &state, true).await {
            Ok(snapshot) => {
                if snapshot.status != UpdateStatus::Error {
                    return;
                }
                eprintln!(
                    "[updater] startup auto-check attempt {} failed: {}",
                    attempt + 1,
                    snapshot
                        .error_message
                        .as_deref()
                        .unwrap_or("unknown updater error")
                );
            }
            Err(error) => {
                eprintln!(
                    "[updater] startup auto-check attempt {} failed: {error}",
                    attempt + 1
                );
            }
        }
    }

    eprintln!("[updater] startup auto-check exhausted retry budget");
}

pub async fn download_pending<R: Runtime>(
    app: &AppHandle<R>,
    state: &UpdaterRuntimeState,
) -> Result<UpdateSnapshot, String> {
    let Some(update) = state.pending_update() else {
        let snapshot = state.set_error(
            UpdateErrorStage::Download,
            "there is no pending update".to_string(),
        );
        emit_update_snapshot_changed(app, &snapshot);
        return Ok(snapshot);
    };

    let downloading_snapshot = state.set_downloading();
    emit_update_snapshot_changed(app, &downloading_snapshot);

    let progress_state = Arc::new(Mutex::new(0_u64));
    let progress_state_for_download = Arc::clone(&progress_state);
    let app_for_progress = app.clone();
    let state_for_progress = state.clone();

    let download_result = update
        .download(
            move |chunk_length, content_length| {
                let downloaded_bytes = match progress_state_for_download.lock() {
                    Ok(mut guard) => {
                        *guard += chunk_length as u64;
                        *guard
                    }
                    Err(poisoned) => {
                        let mut guard = poisoned.into_inner();
                        *guard += chunk_length as u64;
                        *guard
                    }
                };
                let snapshot =
                    state_for_progress.set_download_progress(downloaded_bytes, content_length);
                emit_update_snapshot_changed(&app_for_progress, &snapshot);
            },
            move || {},
        )
        .await;

    match download_result {
        Ok(bytes) => {
            let snapshot = state.set_downloaded(bytes);
            emit_update_snapshot_changed(app, &snapshot);
            Ok(snapshot)
        }
        Err(error) => {
            let snapshot = state.set_error(
                UpdateErrorStage::Download,
                format!("failed to download update: {error}"),
            );
            emit_update_snapshot_changed(app, &snapshot);
            Ok(snapshot)
        }
    }
}

pub async fn install_downloaded<R: Runtime>(
    app: &AppHandle<R>,
    state: &UpdaterRuntimeState,
) -> Result<UpdateSnapshot, String> {
    let Some(update) = state.pending_update() else {
        let snapshot = state.set_error(
            UpdateErrorStage::Install,
            "there is no pending update".to_string(),
        );
        emit_update_snapshot_changed(app, &snapshot);
        return Ok(snapshot);
    };
    let Some(downloaded_bytes) = state.take_downloaded_bytes() else {
        let snapshot = state.set_error(
            UpdateErrorStage::Install,
            "update package has not been downloaded".to_string(),
        );
        emit_update_snapshot_changed(app, &snapshot);
        return Ok(snapshot);
    };

    let post_install_reopen_pool = match wait_for_sqlite_pool(app).await {
        Ok(pool) => {
            if let Err(error) = update_state::request_post_install_reopen_main_window(&pool).await {
                eprintln!("[updater] failed to persist post-install reopen intent: {error}");
            }
            Some(pool)
        }
        Err(error) => {
            eprintln!("[updater] failed to load sqlite pool for reopen intent: {error}");
            None
        }
    };

    let installing_snapshot = state.set_installing();
    emit_update_snapshot_changed(app, &installing_snapshot);
    let install_result = update.install(&downloaded_bytes);

    match install_result {
        Ok(()) => {
            state.set_pending_update(update);
            let snapshot = state.snapshot();
            emit_update_snapshot_changed(app, &snapshot);
            Ok(snapshot)
        }
        Err(error) => {
            state.set_pending_update(update);
            state.set_downloaded_bytes(downloaded_bytes);
            if let Some(pool) = post_install_reopen_pool.as_ref() {
                if let Err(clear_error) =
                    update_state::clear_post_install_reopen_main_window(pool).await
                {
                    eprintln!(
                        "[updater] failed to clear post-install reopen intent after install error: {clear_error}"
                    );
                }
            }
            let snapshot = state.set_error(
                UpdateErrorStage::Install,
                format!("failed to install update: {error}"),
            );
            emit_update_snapshot_changed(app, &snapshot);
            Ok(snapshot)
        }
    }
}
