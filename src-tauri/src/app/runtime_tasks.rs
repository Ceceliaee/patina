use crate::app::tools as tools_runtime;
use crate::app::updater;
use crate::engine::tracking::watchdog::TrackingStage;
use crate::engine::tracking::{runtime as tracking_runtime, watchdog as tracking_watchdog};
use crate::engine::updater::UpdaterRuntimeState;
use futures_util::FutureExt;
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
            let outcome = observe_tracking_exit(
                &runtime_health,
                &mut retry_delay,
                tracking_runtime::run(app.clone(), runtime_health.clone(), data),
            )
            .await;
            let result = match outcome {
                Ok(result) => result,
                Err(_) => {
                    // Unwinding does not cancel SQL already dispatched to its
                    // worker. Preserve diagnostics without starting a second writer.
                    eprintln!(
                        "[tracker] tracking runtime panicked; restart requires reconciliation"
                    );
                    return;
                }
            };
            if let Err(error) = result {
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

async fn observe_tracking_exit(
    health: &tracking_watchdog::RuntimeHealthState,
    retry_delay: &mut RestartBackoff,
    run: impl std::future::Future<Output = Result<(), String>>,
) -> Result<Result<(), String>, ()> {
    let commits_before = health.progress.snapshot().committed_batches;
    let outcome = std::panic::AssertUnwindSafe(run).catch_unwind().await;
    health.progress.enter(TrackingStage::Stopped);
    if health.progress.snapshot().committed_batches > commits_before {
        *retry_delay = RestartBackoff::new();
    }
    outcome.map_err(|_| ())
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

pub(crate) fn spawn_scheduled_backup_runtime_restart_loop(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut retry_delay = RestartBackoff::new();
        loop {
            if let Err(error) = crate::app::scheduled_backup::run(app.clone()).await {
                eprintln!("[scheduled-backup] runtime stopped: {error}");
                let delay = retry_delay.next_delay();
                eprintln!(
                    "[scheduled-backup] restarting runtime in {} seconds...",
                    delay.as_secs()
                );
                sleep(delay).await;
                continue;
            }
            break;
        }
    });
}

pub(crate) fn spawn_scheduled_export_runtime_restart_loop(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut retry_delay = RestartBackoff::new();
        loop {
            if let Err(error) = crate::app::scheduled_export::run(app.clone()).await {
                eprintln!("[scheduled-export] runtime stopped: {error}");
                let delay = retry_delay.next_delay();
                eprintln!(
                    "[scheduled-export] restarting runtime in {} seconds...",
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

    #[tokio::test]
    async fn tracker_exit_is_observed_for_success_error_and_panic() {
        let health = crate::engine::tracking::watchdog::RuntimeHealthState::default();
        let mut backoff = RestartBackoff::new();
        health.progress.observed();
        health.progress.committed();
        assert!(
            super::observe_tracking_exit(&health, &mut backoff, async { Ok(()) })
                .await
                .unwrap()
                .is_ok()
        );
        assert!(health.progress.snapshot().stalled);
        assert_eq!(
            super::observe_tracking_exit(&health, &mut backoff, async {
                Err("failed commit".into())
            })
            .await
            .unwrap(),
            Err("failed commit".into())
        );
        assert!(super::observe_tracking_exit(&health, &mut backoff, async {
            panic!("controlled tracker panic")
        })
        .await
        .is_err());
        assert_eq!(health.progress.snapshot().stage, "stopped");
    }

    #[tokio::test]
    async fn failed_runs_only_reset_backoff_after_committing_new_facts() {
        let health = crate::engine::tracking::watchdog::RuntimeHealthState::default();
        let mut backoff = RestartBackoff::new();
        // A commit from an earlier run cannot make repeated startup failures healthy.
        health.progress.committed();
        for delay in [2, 4, 8, 16, 30, 30] {
            let result = super::observe_tracking_exit(&health, &mut backoff, async {
                health.progress.observed();
                Err("commit unavailable".into())
            })
            .await
            .unwrap();
            assert!(result.is_err());
            assert_eq!(backoff.next_delay().as_secs(), delay);
        }
        let result = super::observe_tracking_exit(&health, &mut backoff, async {
            health.progress.committed();
            Err("failure after recovery".into())
        })
        .await
        .unwrap();
        assert!(result.is_err());
        assert_eq!(backoff.next_delay().as_secs(), 2);
        assert_eq!(health.progress.snapshot().stage, "stopped");
    }

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
