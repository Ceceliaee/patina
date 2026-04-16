use crate::engine::tracking::{runtime as tracking_runtime, watchdog as tracking_watchdog};
use crate::engine::updater::{self, UpdaterRuntimeState};
use std::sync::Arc;
use tauri::{AppHandle, Manager, Runtime};
use tokio::time::{sleep, Duration};

const RETRY_DELAY_SECS: u64 = 2;

pub(crate) fn spawn_updater_startup_auto_check<R: Runtime + 'static>(app: AppHandle<R>) {
    let updater_state: UpdaterRuntimeState = {
        let state = app.state::<UpdaterRuntimeState>();
        (*state).clone()
    };
    tauri::async_runtime::spawn(async move {
        updater::run_startup_auto_check(app, updater_state).await;
    });
}

pub(crate) fn spawn_tracking_runtime_restart_loop<R: Runtime + 'static>(
    app: AppHandle<R>,
    runtime_health: Arc<tracking_watchdog::RuntimeHealthState>,
) {
    tauri::async_runtime::spawn(async move {
        loop {
            if let Err(error) = tracking_runtime::run(app.clone(), runtime_health.clone()).await {
                eprintln!("[tracker] tracking runtime stopped: {error}");
                eprintln!("[tracker] restarting tracking runtime in 2 seconds...");
                sleep(Duration::from_secs(RETRY_DELAY_SECS)).await;
                continue;
            }

            break;
        }
    });
}

pub(crate) fn spawn_tracking_watchdog_restart_loop<R: Runtime + 'static>(
    app: AppHandle<R>,
    runtime_health: Arc<tracking_watchdog::RuntimeHealthState>,
) {
    tauri::async_runtime::spawn(async move {
        loop {
            if let Err(error) = tracking_watchdog::watch(app.clone(), runtime_health.clone()).await {
                eprintln!("[tracker] watchdog stopped: {error}");
                eprintln!("[tracker] restarting watchdog in 2 seconds...");
                sleep(Duration::from_secs(RETRY_DELAY_SECS)).await;
                continue;
            }

            break;
        }
    });
}
