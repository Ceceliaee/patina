use super::{data, engine::tracking, platform};
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
use tracking::{
    host::TrackingHost, pause_state::TrackingPauseRuntimeState, ports::SharedTrackingDataStore,
    runtime_snapshot::TrackingRuntimeSnapshotState, title_state::TitleRecordingRuntimeState,
    watchdog::RuntimeHealthState,
};

struct State {
    pause: TrackingPauseRuntimeState,
    titles: TitleRecordingRuntimeState,
    projection: TrackingRuntimeSnapshotState,
    stopped: AtomicBool,
    changed: Box<dyn Fn() + Send + Sync>,
}

#[derive(Clone)]
struct Host(Arc<State>);
impl TrackingHost for Host {
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
        (self.0.changed)();
    }
    fn data_changed(&self, _: &str, _: u64) -> Result<(), String> {
        (self.0.changed)();
        Ok(())
    }
}

#[derive(serde::Serialize, serde::Deserialize, Clone)]
pub enum Activity {
    Waiting,
    Unavailable,
    Paused,
    Inactive,
    Anonymous,
    Application(String),
}

pub struct Recorder {
    pub locale: std::rc::Rc<std::cell::Cell<super::Locale>>,
    pub theme: std::rc::Rc<std::cell::Cell<super::Theme>>,
    runtime: tokio::runtime::Runtime,
    host: Host,
    pool: SqlitePool,
    data: SharedTrackingDataStore,
    health: Arc<RuntimeHealthState>,
    tasks: std::cell::Cell<Vec<tokio::task::JoinHandle<Result<(), String>>>>,
}

pub async fn open_database(path: &Path) -> Result<SqlitePool, String> {
    let pool = data::sqlite_pool::bootstrap::open_single_connection_sqlite_pool(path, true).await?;
    data::sqlite_pool::bootstrap::run_current_migrations(&pool).await?;
    Ok(pool)
}

impl Recorder {
    pub fn tools(&self) -> super::NativeToolData {
        super::NativeToolData::new(self.pool.clone(), self.runtime.handle().clone())
    }
    pub fn start(
        database: &Path,
        changed: impl Fn() + Send + Sync + 'static,
    ) -> Result<Self, String> {
        let runtime = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .enable_all()
            .build()
            .map_err(|e| e.to_string())?;
        let host = Host(Arc::new(State {
            pause: Default::default(),
            titles: Default::default(),
            projection: Default::default(),
            stopped: AtomicBool::new(false),
            changed: Box::new(changed),
        }));
        let (pool, data, prefs) = runtime.block_on(async {
            let pool = open_database(database).await?;
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
            let prefs = crate::manage::preferences(pool.clone()).await?;
            Ok::<_, String>((pool, data, prefs))
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
            host,
            pool,
            data,
            health,
            tasks: std::cell::Cell::new(tasks),
            locale: std::rc::Rc::new(std::cell::Cell::new(prefs.locale)),
            theme: std::rc::Rc::new(std::cell::Cell::new(prefs.theme)),
        })
    }

    pub fn paused(&self) -> bool {
        self.host
            .pause()
            .snapshot()
            .is_none_or(|s| s.tracking_paused)
    }

    pub fn activity(&self) -> Activity {
        if self.host.0.stopped.load(Ordering::Acquire) {
            return Activity::Unavailable;
        }
        if self.paused() {
            return Activity::Paused;
        }
        let Some(snapshot) = self.host.projection().snapshot() else {
            return Activity::Waiting;
        };
        if snapshot.probe_status != tracking::runtime_snapshot::TrackingRuntimeProbeStatus::Ok {
            return Activity::Unavailable;
        }
        if !snapshot.status.is_tracking_active {
            return Activity::Inactive;
        }
        if snapshot.anonymous {
            return Activity::Anonymous;
        }
        snapshot.active_session.map_or(Activity::Waiting, |s| {
            Activity::Application(if s.app_name.is_empty() {
                s.exe_name
            } else {
                s.app_name
            })
        })
    }

    pub fn today(
        &self,
    ) -> impl std::future::Future<Output = Result<super::DaySummary, String>> + 'static {
        let read = self.runtime.spawn(super::DaySummary::load(
            self.pool.clone(),
            platform::clock::unix_timestamp_millis_i64(),
            self.locale.get(),
        ));
        async move { read.await.map_err(|e| e.to_string())? }
    }

    pub fn icons(
        &self,
        keys: Vec<String>,
    ) -> impl std::future::Future<Output = Result<Vec<(String, Vec<u8>)>, String>> + 'static {
        let read = self
            .runtime
            .spawn(super::today::icons(self.pool.clone(), keys));
        async move { read.await.map_err(|e| e.to_string())? }
    }

    pub fn set_chart_mode(
        &self,
        category: bool,
    ) -> impl std::future::Future<Output = Result<(), String>> + 'static {
        let pool = self.pool.clone();
        let write = self.runtime.spawn(async move {
            commit_app_setting_mutations(
                &pool,
                &[AppSettingMutation {
                    key: "hourly_activity_chart_mode".into(),
                    value: if category { "category" } else { "total" }.into(),
                }],
            )
            .await
            .map_err(|e| e.to_string())
        });
        async move { write.await.map_err(|e| e.to_string())? }
    }

    pub fn edit_app(
        &self,
        exe: String,
        edit: super::AppEdit,
    ) -> impl std::future::Future<Output = Result<(), String>> + 'static {
        let write = self
            .runtime
            .spawn(super::today::edit_app(self.pool.clone(), exe, edit));
        async move { write.await.map_err(|e| e.to_string())? }
    }

    pub fn rules(
        &self,
    ) -> impl std::future::Future<Output = Result<crate::Rules, String>> + 'static {
        let task = self.runtime.spawn(crate::manage::rules(self.pool.clone()));
        async move { task.await.map_err(|e| e.to_string())? }
    }
    pub fn save_rules(
        &self,
        rules: Vec<crate::AppRule>,
        categories: Vec<crate::CategoryEdit>,
    ) -> impl std::future::Future<Output = Result<(), String>> + 'static {
        let pool = self.pool.clone();
        let host = self.host.clone();
        let task = self.runtime.spawn(async move {
            let _guard = host.projection().transition.lock().await;
            crate::manage::save_rules(&pool, &rules, &categories).await?;
            host.titles().invalidate_app_overrides();
            host.projection().note_tracking_policy_change();
            (host.0.changed)();
            Ok(())
        });
        async move { task.await.map_err(|e| e.to_string())? }
    }
    pub fn preferences(
        &self,
    ) -> impl std::future::Future<Output = Result<crate::TrackingPreferences, String>> + 'static
    {
        let task = self
            .runtime
            .spawn(crate::manage::preferences(self.pool.clone()));
        async move { task.await.map_err(|e| e.to_string())? }
    }
    pub fn save_preferences(
        &self,
        old: crate::TrackingPreferences,
        p: crate::TrackingPreferences,
    ) -> impl std::future::Future<Output = Result<(), String>> + 'static {
        let locale = self.locale.clone();
        let theme = self.theme.clone();
        let host = self.host.clone();
        let pool = self.pool.clone();
        let task = self.runtime.spawn(async move {
            let _guard = host.projection().transition.lock().await;
            crate::manage::save_preferences(pool.clone(), old, p).await?;
            let time = crate::platform::clock::unix_timestamp_millis_i64();
            if p.paused != old.paused {
                host.pause().set_after_write(p.paused, time);
                host.titles().clear_browser_title();
                host.titles().clear_anonymous_web();
            }
            if p.titles != old.titles {
                host.titles().set_enabled(p.titles);
            }
            host.projection().note_tracking_policy_change();
            (host.0.changed)();
            Ok::<(), String>(())
        });
        async move {
            task.await.map_err(|e| e.to_string())??;
            locale.set(p.locale);
            theme.set(p.theme);
            Ok(())
        }
    }
    pub fn trends(
        &self,
        range: Option<(i64, i64)>,
        kind: crate::SeriesKind,
    ) -> impl std::future::Future<Output = Result<crate::Trends, String>> + 'static {
        let read = self.runtime.spawn(crate::analysis::load(
            self.pool.clone(),
            range,
            kind,
            self.locale.get(),
        ));
        async move { read.await.map_err(|e| e.to_string())? }
    }
    pub fn set_history_minimum(
        &self,
        detail: bool,
        secs: i64,
    ) -> impl std::future::Future<Output = Result<(), String>> + 'static {
        let pool = self.pool.clone();
        let task=self.runtime.spawn(async move{
            if !(0..=600).contains(&secs)||secs%60!=0{return Err("invalid history minimum".into());}
            if detail{sqlx::query("INSERT INTO settings(key,value) VALUES('__gpui_detail_min_secs',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(secs.to_string()).execute(&pool).await.map_err(|e|e.to_string())?;}
            else{commit_app_setting_mutations(&pool,&[AppSettingMutation{key:"min_session_secs".into(),value:secs.to_string()}]).await.map_err(|e|e.to_string())?;}
            Ok(())
        });
        async move { task.await.map_err(|e| e.to_string())? }
    }
    pub fn history(
        &self,
        day: i64,
        app: Option<String>,
        titles: bool,
    ) -> impl std::future::Future<Output = Result<super::HistoryDay, String>> + 'static {
        let read = self.runtime.spawn(super::history::load(
            self.pool.clone(),
            day,
            app,
            titles,
            self.health.snapshot().last_successful_sample_ms,
            self.locale.get(),
        ));
        async move { read.await.map_err(|e| e.to_string())? }
    }

    pub fn recent(
        &self,
    ) -> impl std::future::Future<Output = Result<super::Recent, String>> + 'static {
        let read = self.runtime.spawn(super::recent::load(
            self.pool.clone(),
            platform::clock::unix_timestamp_millis_i64(),
            self.health.snapshot().last_successful_sample_ms,
            self.locale.get(),
        ));
        async move { read.await.map_err(|e| e.to_string())? }
    }

    pub fn set_paused(
        &self,
        paused: bool,
    ) -> impl std::future::Future<Output = Result<(), String>> + 'static {
        let host = self.host.clone();
        let pool = self.pool.clone();
        let write = self.runtime.spawn(async move {
            let _guard = host.projection().transition.lock().await;
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
            Ok(())
        });
        async move { write.await.map_err(|e| e.to_string())? }
    }

    pub fn power(&self, event: &str) {
        self.host
            .projection()
            .note_power_event(event, platform::clock::unix_timestamp_millis_i64());
        let host = self.host.clone();
        let data = self.data.clone();
        self.runtime.spawn(async move {
            if let Err(e) =
                tracking::runtime::handle_power_lifecycle_event(host, data.as_ref()).await
            {
                eprintln!("recording power event: {e}");
            }
        });
    }
}

async fn observe_recorder_task(
    name: &str,
    host: Host,
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
    (host.0.changed)();
    result
}

impl Recorder {
    pub fn shutdown(&self) -> Result<(), String> {
        let tasks = self.tasks.take();
        if tasks.is_empty() {
            return Ok(());
        }
        let result = self.runtime.block_on(async {
            // Let a transaction reach its boundary before stopping the producer.
            let _guard = self.host.projection().transition.lock().await;
            for task in tasks {
                task.abort();
                let _ = task.await;
            }
            self.host.pause().pause_until_verified();
            let sealed = async {
                if let Some(t) = self.health.snapshot().last_successful_sample_ms {
                    self.data
                        .end_active_sessions(t)
                        .await
                        .map_err(|e| e.to_string())?;
                    self.data
                        .seal_anonymous_activity(t)
                        .await
                        .map_err(|e| e.to_string())?;
                }
                Ok(())
            }
            .await;
            self.pool.close().await;
            sealed
        });
        platform::windows::native_probe::shutdown();
        result
    }
}

impl Drop for Recorder {
    fn drop(&mut self) {
        if let Err(error) = self.shutdown() {
            eprintln!("stop recorder: {error}");
        }
    }
}
