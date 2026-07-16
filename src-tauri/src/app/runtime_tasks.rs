use crate::app::tools as tools_runtime;
use crate::app::updater;
use crate::engine::tracking::{runtime as tracking_runtime, watchdog as tracking_watchdog};
use crate::engine::updater::UpdaterRuntimeState;
use std::sync::Arc;
use tauri::{AppHandle, Manager, Runtime};
use tokio::time::{sleep, Duration};

const RETRY_DELAY_SECS: u64 = 2;
const MAX_RETRY_DELAY_SECS: u64 = 30;

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
        let mut retry_delay = RestartBackoff::new();
        loop {
            let data = match crate::data::tracking_runtime::shared_from_app(&app).await {
                Ok(data) => data,
                Err(error) => {
                    eprintln!("[tracker] tracking data store unavailable: {error}");
                    sleep(retry_delay.next_delay()).await;
                    continue;
                }
            };
            if let Err(error) =
                tracking_runtime::run(app.clone(), runtime_health.clone(), data).await
            {
                eprintln!("[tracker] tracking runtime stopped: {error}");
                let delay = retry_delay.next_delay();
                eprintln!(
                    "[tracker] restarting tracking runtime in {} seconds...",
                    delay.as_secs()
                );
                sleep(delay).await;
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
        let mut retry_delay = RestartBackoff::new();
        loop {
            let data = match crate::data::tracking_runtime::shared_from_app(&app).await {
                Ok(data) => data,
                Err(error) => {
                    eprintln!("[tracker] watchdog data store unavailable: {error}");
                    sleep(retry_delay.next_delay()).await;
                    continue;
                }
            };
            if let Err(error) =
                tracking_watchdog::watch(app.clone(), runtime_health.clone(), data).await
            {
                eprintln!("[tracker] watchdog stopped: {error}");
                let delay = retry_delay.next_delay();
                eprintln!(
                    "[tracker] restarting watchdog in {} seconds...",
                    delay.as_secs()
                );
                sleep(delay).await;
                continue;
            }

            break;
        }
    });
}

pub(crate) fn spawn_tools_runtime_restart_loop<R: Runtime + 'static>(app: AppHandle<R>) {
    tauri::async_runtime::spawn(async move {
        let mut retry_delay = RestartBackoff::new();
        loop {
            if let Err(error) = tools_runtime::run(app.clone()).await {
                eprintln!("[tools] runtime stopped: {error}");
                let delay = retry_delay.next_delay();
                eprintln!(
                    "[tools] restarting tools runtime in {} seconds...",
                    delay.as_secs()
                );
                sleep(delay).await;
                continue;
            }

            break;
        }
    });
}

#[derive(Debug)]
struct RestartBackoff {
    current_delay_secs: u64,
}

impl RestartBackoff {
    fn new() -> Self {
        Self {
            current_delay_secs: RETRY_DELAY_SECS,
        }
    }

    fn next_delay(&mut self) -> Duration {
        let delay = self.current_delay_secs;
        self.current_delay_secs = self
            .current_delay_secs
            .saturating_mul(2)
            .min(MAX_RETRY_DELAY_SECS);
        Duration::from_secs(delay)
    }
}

#[cfg(test)]
mod tests {
    use super::{RestartBackoff, MAX_RETRY_DELAY_SECS, RETRY_DELAY_SECS};

    #[test]
    fn restart_backoff_grows_to_the_maximum_delay() {
        let mut backoff = RestartBackoff::new();

        assert_eq!(backoff.next_delay().as_secs(), RETRY_DELAY_SECS);
        assert_eq!(backoff.next_delay().as_secs(), RETRY_DELAY_SECS * 2);

        for _ in 0..10 {
            backoff.next_delay();
        }

        assert_eq!(backoff.next_delay().as_secs(), MAX_RETRY_DELAY_SECS);
    }
}
