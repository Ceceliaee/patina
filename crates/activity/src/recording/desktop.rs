use crate::{data, engine::tracking, platform};
use data::repositories::app_settings::{commit_app_setting_mutations, AppSettingMutation};
use futures_util::FutureExt;
use sqlx::SqlitePool;
use std::{
    path::Path,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
};
pub(super) use tracking::host::TrackingHost;
use tracking::{
    pause_state::TrackingPauseRuntimeState, ports::SharedTrackingDataStore,
    runtime_snapshot::TrackingRuntimeSnapshotState, title_state::TitleRecordingRuntimeState,
    watchdog::RuntimeHealthState,
};

type RecordingTask = tokio::task::JoinHandle<Result<(), String>>;

#[derive(Default)]
struct PowerEvents {
    tasks: tokio::task::JoinSet<Result<(), String>>,
    failure: Option<String>,
}

impl PowerEvents {
    fn record(&mut self, result: Result<Result<(), String>, tokio::task::JoinError>) {
        if let Err(error) = result
            .map_err(|error| error.to_string())
            .and_then(|outcome| outcome)
        {
            eprintln!("recording power event: {error}");
            self.failure.get_or_insert(error);
        }
    }
}

struct State {
    snapshot_changed: tokio::sync::watch::Sender<u64>,
    pause: TrackingPauseRuntimeState,
    titles: TitleRecordingRuntimeState,
    projection: TrackingRuntimeSnapshotState,
    stopped: AtomicBool,
    changed: Box<dyn Fn() + Send + Sync>,
    power_tasks: std::sync::Mutex<Option<PowerEvents>>,
}

#[derive(Clone)]
pub struct RecordingSignals(Arc<State>);
impl RecordingSignals {
    pub fn new(changed: impl Fn() + Send + Sync + 'static) -> Self {
        Self(Arc::new(State {
            snapshot_changed: tokio::sync::watch::channel(0).0,
            pause: Default::default(),
            titles: Default::default(),
            projection: Default::default(),
            stopped: AtomicBool::new(false),
            changed: Box::new(changed),
            power_tasks: std::sync::Mutex::new(Some(PowerEvents::default())),
        }))
    }
    pub(super) fn notify(&self) {
        (self.0.changed)();
    }
    pub(super) fn snapshot_changes(&self) -> tokio::sync::watch::Receiver<u64> {
        self.0.snapshot_changed.subscribe()
    }
}
impl TrackingHost for RecordingSignals {
    fn pause(&self) -> &TrackingPauseRuntimeState {
        &self.0.pause
    }
    fn titles(&self) -> &TitleRecordingRuntimeState {
        &self.0.titles
    }
    fn projection(&self) -> &TrackingRuntimeSnapshotState {
        &self.0.projection
    }
    fn active_window_changed(&self, _: &platform::windows::foreground::WindowInfo) {
        self.0
            .snapshot_changed
            .send_modify(|revision| *revision = revision.wrapping_add(1));
        self.notify();
    }
    fn data_changed(&self, _: &str, _: u64) -> Result<(), String> {
        self.0
            .snapshot_changed
            .send_modify(|revision| *revision = revision.wrapping_add(1));
        self.notify();
        Ok(())
    }
}

pub use patina_activity_model::views::tracking::CurrentActivity;

#[derive(Clone)]
pub struct RecordingControl {
    host: RecordingSignals,
    runtime: tokio::runtime::Handle,
    pool: SqlitePool,
    data: SharedTrackingDataStore,
    health: Arc<RuntimeHealthState>,
}

pub struct Recorder<'runtime> {
    runtime: &'runtime tokio::runtime::Runtime,
    control: RecordingControl,
    tasks: std::cell::Cell<Vec<RecordingTask>>,
}

pub async fn open_database(path: &Path) -> Result<SqlitePool, String> {
    let pool = data::sqlite_pool::bootstrap::open_single_connection_sqlite_pool(path, true).await?;
    if let Err(error) = data::sqlite_pool::prepare_pool_schema(&pool, path).await {
        pool.close().await;
        return Err(error);
    }
    Ok(pool)
}

impl<'runtime> Recorder<'runtime> {
    pub fn start(
        runtime: &'runtime tokio::runtime::Runtime,
        pool: SqlitePool,
        host: RecordingSignals,
    ) -> Result<Self, String> {
        let data = runtime.block_on(async {
            let fixed = pool.clone();
            let data = data::tracking_runtime::shared_from_provider(
                Arc::new(move || {
                    let pool = fixed.clone();
                    Box::pin(async move { Ok(pool) })
                }),
                Arc::new(|_| {}),
            )
            .await
            .map_err(|e| e.to_string())?;
            tracking::startup::initialize_tracker(&host, data.as_ref())
                .await
                .map_err(|e| e.to_string())?;
            Ok::<_, String>(data)
        })?;
        platform::windows::audio::start_signal_source(runtime.handle(), host.pause().subscribe());
        platform::windows::media::start_signal_source(runtime.handle(), host.pause().subscribe());
        let health = Arc::new(RuntimeHealthState::default());
        let tasks = vec![
            runtime.spawn(observe_recorder_task(
                "tracking",
                host.clone(),
                tracking::runtime::run(host.clone(), health.clone(), data.clone()),
            )),
            runtime.spawn(observe_recorder_task(
                "watchdog",
                host.clone(),
                tracking::watchdog::watch(host.clone(), health.clone(), data.clone()),
            )),
        ];
        Ok(Self {
            runtime,
            control: RecordingControl {
                runtime: runtime.handle().clone(),
                pool,
                host,
                health,
                data,
            },
            tasks: std::cell::Cell::new(tasks),
        })
    }
    pub fn control(&self) -> RecordingControl {
        self.control.clone()
    }
}

impl RecordingControl {
    pub fn last_successful_sample_ms(&self) -> Option<i64> {
        self.health.snapshot().last_successful_sample_ms
    }
    pub fn paused(&self) -> bool {
        self.host
            .pause()
            .snapshot()
            .is_none_or(|s| s.tracking_paused)
    }

    pub fn current_activity(&self) -> CurrentActivity {
        if self.host.0.stopped.load(Ordering::Acquire) {
            return CurrentActivity::Unavailable;
        }
        if self.paused() {
            return CurrentActivity::Paused;
        }
        let Some(snapshot) = self.host.projection().snapshot() else {
            return CurrentActivity::Waiting;
        };
        if snapshot.probe_status != tracking::runtime_snapshot::TrackingRuntimeProbeStatus::Ok {
            return CurrentActivity::Unavailable;
        }
        if !snapshot.status.is_tracking_active {
            return CurrentActivity::Inactive;
        }
        if snapshot.anonymous {
            return CurrentActivity::Anonymous;
        }
        snapshot
            .active_session
            .map_or(CurrentActivity::Waiting, |s| {
                CurrentActivity::Application(if s.app_name.is_empty() {
                    s.exe_name
                } else {
                    s.app_name
                })
            })
    }

    pub fn set_paused(
        &self,
        paused: bool,
    ) -> impl std::future::Future<Output = Result<(), String>> + 'static {
        let host = self.host.clone();
        let pool = self.pool.clone();
        let write = self.runtime.spawn(async move {
            let _guard = host.projection().transition.lock().await;
            if host
                .0
                .power_tasks
                .lock()
                .unwrap_or_else(|p| p.into_inner())
                .is_none()
            {
                return Err("recorder has stopped".into());
            }
            commit_app_setting_mutations(
                &pool,
                &[AppSettingMutation {
                    key: "tracking_paused".into(),
                    value: if paused { "1" } else { "0" }.into(),
                }],
            )
            .await
            .map_err(|e| e.to_string())?;
            host.pause()
                .set_after_write(paused, platform::clock::unix_timestamp_millis_i64());
            host.titles().clear_browser_title();
            host.titles().clear_anonymous_web();
            host.projection().note_tracking_policy_change();
            host.notify();
            Ok(())
        });
        async move { write.await.map_err(|e| e.to_string())? }
    }

    pub fn power(&self, event: &str) {
        let mut pending = self
            .host
            .0
            .power_tasks
            .lock()
            .unwrap_or_else(|p| p.into_inner());
        let Some(tasks) = pending.as_mut() else {
            return;
        };
        self.host
            .projection()
            .note_power_event(event, platform::clock::unix_timestamp_millis_i64());
        let host = self.host.clone();
        let data = self.data.clone();
        while let Some(result) = tasks.tasks.try_join_next() {
            tasks.record(result);
        }
        tasks.tasks.spawn_on(async move {
            tracking::runtime::handle_power_lifecycle_event(host, data.as_ref()).await
        }, &self.runtime);
    }
}

async fn observe_recorder_task(
    name: &str,
    host: RecordingSignals,
    run: impl std::future::Future<Output = Result<(), String>>,
) -> Result<(), String> {
    let result = std::panic::AssertUnwindSafe(run)
        .catch_unwind()
        .await
        .unwrap_or_else(|_| Err(format!("{name} panicked; restart requires reconciliation")));
    if let Err(error) = &result {
        eprintln!("{name}: {error}");
    }
    host.0.stopped.store(true, Ordering::Release);
    host.notify();
    result
}

impl Recorder<'_> {
    pub fn shutdown(&self) -> Result<(), String> {
        let tasks = self.tasks.take();
        if tasks.is_empty() {
            return Ok(());
        }
        let mut pending = self
            .control
            .host
            .0
            .power_tasks
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .take()
            .unwrap_or_default();
        let result = self.runtime.block_on(async {
            while let Some(result) = pending.tasks.join_next().await {
                pending.record(result);
            }
            let mut stopped = pending.failure.map_or(Ok(()), Err);
            let _guard = self.control.host.projection().transition.lock().await;
            for task in tasks {
                task.abort();
                match task.await {
                    Ok(outcome) => stopped = stopped.and(outcome),
                    Err(error) if !error.is_cancelled() => {
                        stopped = stopped.and(Err(error.to_string()))
                    }
                    Err(_) => {}
                }
            }
            self.control.host.pause().pause_until_verified();
            self.control.host.0.stopped.store(true, Ordering::Release);
            if let Some(t) = self.control.health.snapshot().last_successful_sample_ms {
                self.control
                    .data
                    .end_active_sessions(t)
                    .await
                    .map_err(|error| error.to_string())?;
                self.control
                    .data
                    .seal_anonymous_activity(t)
                    .await
                    .map_err(|error| error.to_string())?;
            }
            stopped
        });
        platform::windows::native_probe::shutdown();
        result
    }
}

impl Drop for Recorder<'_> {
    fn drop(&mut self) {
        if let Err(error) = self.shutdown() {
            eprintln!("stop recorder: {error}");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shutdown_seals_at_the_last_sample_and_rejects_later_pause_requests() {
        let root = tempfile::tempdir().unwrap();
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let pool = runtime
            .block_on(open_database(&root.path().join("patina.db")))
            .unwrap();
        runtime
            .block_on(
                sqlx::query(
                    "INSERT OR REPLACE INTO settings(key,value) VALUES('tracking_paused','1')",
                )
                .execute(&pool),
            )
            .unwrap();
        let recorder =
            Recorder::start(&runtime, pool.clone(), RecordingSignals::new(|| {})).unwrap();
        let control = recorder.control();
        let start_ms = platform::clock::unix_timestamp_millis_i64() - 30_000;
        let last_sample_ms = start_ms + 4000;
        runtime.block_on(async {
            let _guard = control.host.projection().transition.lock().await;
            sqlx::query("INSERT INTO sessions(exe_name,app_name,start_time) VALUES('shutdown.exe','Shutdown',?)")
                .bind(start_ms).execute(&pool).await.unwrap();
            control.health.note_successful_sample(last_sample_ms);
        });
        recorder.shutdown().unwrap();
        recorder.shutdown().unwrap();
        control.power("resume");
        assert!(runtime.block_on(control.set_paused(false)).is_err());
        assert!(matches!(
            control.current_activity(),
            CurrentActivity::Unavailable
        ));
        let row: (i64, i64) = runtime
            .block_on(
                sqlx::query_as(
                    "SELECT end_time,duration FROM sessions WHERE exe_name='shutdown.exe'",
                )
                .fetch_one(&pool),
            )
            .unwrap();
        assert_eq!(row, (last_sample_ms, 4000));
        runtime.block_on(pool.close());
    }
}
