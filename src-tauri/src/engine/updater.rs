use std::sync::{Arc, Mutex};

use tauri::{AppHandle, Runtime};
use tauri_plugin_updater::{Update, UpdaterExt};
use tokio::time::{sleep, Duration};

use crate::data::repositories::update_state;
use crate::data::sqlite_pool::wait_for_sqlite_pool;
use crate::domain::update::UpdateSnapshot;

const STARTUP_AUTO_CHECK_DELAYS_MS: [u64; 3] = [3_500, 15_000, 60_000];

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
                snapshot: UpdateSnapshot::idle(current_version),
                pending_update: None,
                downloaded_bytes: None,
            })),
        }
    }

    pub fn snapshot(&self) -> UpdateSnapshot {
        self.with_guard(|inner| inner.snapshot.clone())
    }

    fn set_checking(&self) {
        self.with_guard(|inner| {
            inner.snapshot = inner.snapshot.clone().checking();
        });
    }

    fn set_available(&self, update: Update) -> UpdateSnapshot {
        self.with_guard(|inner| {
            inner.snapshot = inner.snapshot.clone().available(
                update.version.clone(),
                update.body.clone(),
                update.date.map(|value| value.to_string()),
            );
            inner.pending_update = Some(update);
            inner.downloaded_bytes = None;
            inner.snapshot.clone()
        })
    }

    fn set_up_to_date(&self) -> UpdateSnapshot {
        self.with_guard(|inner| {
            inner.snapshot = inner.snapshot.clone().up_to_date();
            inner.pending_update = None;
            inner.downloaded_bytes = None;
            inner.snapshot.clone()
        })
    }

    fn set_error(&self, message: String) -> UpdateSnapshot {
        self.with_guard(|inner| {
            inner.snapshot = inner.snapshot.clone().error(message);
            inner.snapshot.clone()
        })
    }

    fn set_downloading(&self) {
        self.with_guard(|inner| {
            inner.snapshot = inner.snapshot.clone().downloading();
        });
    }

    fn set_downloaded(&self, bytes: Vec<u8>) -> UpdateSnapshot {
        self.with_guard(|inner| {
            inner.snapshot = inner.snapshot.clone().downloaded();
            inner.downloaded_bytes = Some(bytes);
            inner.snapshot.clone()
        })
    }

    fn set_installing(&self) {
        self.with_guard(|inner| {
            inner.snapshot = inner.snapshot.clone().installing();
        });
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

    state.set_checking();

    let update = app
        .updater()
        .map_err(|error| format!("failed to initialize updater: {error}"))?
        .check()
        .await
        .map_err(|error| format!("failed to check updates: {error}"))?;

    let snapshot = match update {
        Some(update) => state.set_available(update),
        None => state.set_up_to_date(),
    };

    if let Some((pool, today)) = silent_context {
        if let Err(error) = update_state::save_last_auto_check_day(&pool, &today).await {
            eprintln!("[updater] failed to persist auto update check state: {error}");
        }
    }

    Ok(snapshot)
}

pub async fn run_startup_auto_check<R: Runtime>(app: AppHandle<R>, state: UpdaterRuntimeState) {
    for (attempt, delay_ms) in STARTUP_AUTO_CHECK_DELAYS_MS.iter().enumerate() {
        sleep(Duration::from_millis(*delay_ms)).await;

        match check_for_updates(&app, &state, true).await {
            Ok(_) => return,
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
    _app: &AppHandle<R>,
    state: &UpdaterRuntimeState,
) -> Result<UpdateSnapshot, String> {
    let Some(update) = state.pending_update() else {
        return Ok(state.set_error("there is no pending update".to_string()));
    };

    state.set_downloading();

    let download_result = update
        .download(move |_chunk_length, _content_length| {}, move || {})
        .await;

    match download_result {
        Ok(bytes) => Ok(state.set_downloaded(bytes)),
        Err(error) => Ok(state.set_error(format!("failed to download update: {error}"))),
    }
}

pub async fn install_downloaded<R: Runtime>(
    _app: &AppHandle<R>,
    state: &UpdaterRuntimeState,
) -> Result<UpdateSnapshot, String> {
    let Some(update) = state.pending_update() else {
        return Ok(state.set_error("there is no pending update".to_string()));
    };
    let Some(downloaded_bytes) = state.take_downloaded_bytes() else {
        return Ok(state.set_error("update package has not been downloaded".to_string()));
    };

    state.set_installing();
    let install_result = update.install(&downloaded_bytes);

    match install_result {
        Ok(()) => {
            state.set_pending_update(update);
            Ok(state.snapshot())
        }
        Err(error) => {
            state.set_pending_update(update);
            state.set_downloaded_bytes(downloaded_bytes);
            Ok(state.set_error(format!("failed to install update: {error}")))
        }
    }
}
