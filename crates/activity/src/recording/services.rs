use super::desktop::{RecordingSignals, TrackingHost};
use crate::{
    data::{repositories::icon_cache, web_activity_store::SqliteWebActivityStore},
    domain::settings::WebActivitySettings,
    engine::{
        remote_status_bridge::{
            generate_machine_id, RemoteStatusBridgeStore, RemoteStatusStoreFuture,
        },
        tracking::runtime_snapshot::TrackingRuntimeSnapshot,
        web_activity::{self, WebActivityContext, WebActivityRuntimeState},
    },
    platform::{clock::unix_timestamp_millis_i64, web_activity_bridge::*, web_activity_request},
    AppPreferences,
};
use sqlx::SqlitePool;
use std::{sync::Arc, time::Duration};

pub struct ActivityBridges {
    accepting_requests: tokio::sync::RwLock<bool>,
    remote: crate::engine::remote_status_bridge::RemoteStatusBridgeRuntimeState,
    host: RecordingSignals,
    pool: SqlitePool,
    listener: WebActivityBridgeRuntimeState,
    web: WebActivityRuntimeState,
}

impl ActivityBridges {
    pub fn new(pool: SqlitePool, host: RecordingSignals) -> Self {
        let remote = crate::engine::remote_status_bridge::RemoteStatusBridgeRuntimeState::new(
            host.snapshot_changes(),
        );
        Self {
            accepting_requests: tokio::sync::RwLock::new(true),
            pool,
            remote,
            host,
            listener: Default::default(),
            web: Default::default(),
        }
    }

    pub fn apply(self: &Arc<Self>, prefs: &AppPreferences) {
        if self.listener.update(
            self.clone(),
            prefs.web.clone(),
            WebActivityBridgeRuntimeDeps {
                handle_http_request: Self::request,
            },
        ) {
            self.web.expiry_changed.notify_one();
        }
        self.remote.update(self.clone(), prefs.remote.clone());
    }

    pub(super) async fn stop(self: &Arc<Self>) {
        self.listener.update(
            self.clone(),
            Default::default(),
            WebActivityBridgeRuntimeDeps {
                handle_http_request: Self::request,
            },
        );
        self.remote.update(self.clone(), Default::default());
        *self.accepting_requests.write().await = false;
    }

    fn request(
        this: Arc<Self>,
        request: WebActivityBridgeHttpRequest,
    ) -> WebActivityBridgeHttpFuture {
        Box::pin(async move {
            let accepting = this.accepting_requests.read().await;
            let now = unix_timestamp_millis_i64();
            let tracking = this.host.projection();
            let generation = tracking.lifecycle_generation();
            let current = this.listener.current_settings();
            let settings = WebActivitySettings {
                enabled: current.enabled && *accepting,
                token: current.token,
            };
            let (settings, payload) =
                match web_activity_request::authorize_and_parse(request, Ok(settings), now) {
                    Ok(parsed) => parsed,
                    Err(response) => return response,
                };
            let store = SqliteWebActivityStore::new(this.pool.clone());
            let context = WebActivityContext {
                runtime: &this.web,
                tracking,
                titles: Some(this.host.titles()),
            };
            match web_activity::record_active_tab(
                context, &store, &settings, payload, now, generation,
            )
            .await
            {
                Ok(change) => {
                    if change.changed() {
                        this.web.expiry_changed.notify_one();
                        this.host.notify();
                    }
                    web_activity_request::recording_response(change.changed(), now)
                }
                Err(_) => web_activity_request::error_response(
                    400,
                    "record-failed",
                    "failed to record active tab",
                ),
            }
        })
    }

    pub(super) async fn expire(self: Arc<Self>) -> Result<(), String> {
        let store = SqliteWebActivityStore::new(self.pool.clone());
        loop {
            let delay = match store.next_expiry().await {
                Ok(Some(deadline)) => {
                    let now = unix_timestamp_millis_i64();
                    if deadline > now {
                        Duration::from_millis((deadline - now) as u64).min(Duration::from_secs(60))
                    } else if web_activity::expire_active_segment(&store, now)
                        .await
                        .unwrap_or(false)
                    {
                        self.host.notify();
                        Duration::ZERO
                    } else {
                        Duration::from_secs(3)
                    }
                }
                Ok(None) => Duration::from_secs(60),
                Err(_) => Duration::from_secs(3),
            };
            tokio::select! {
                _ = self.web.expiry_changed.notified() => (),
                _ = tokio::time::sleep(delay) => (),
            }
        }
    }
}

pub async fn ensure_machine_id(pool: &SqlitePool) -> Result<(), String> {
    sqlx::query(
        "INSERT INTO settings(key,value) VALUES('remote_status_bridge_machine_id',?)
        ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE trim(settings.value)=''",
    )
    .bind(generate_machine_id())
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;
    Ok(())
}

impl RemoteStatusBridgeStore for ActivityBridges {
    fn snapshot(&self) -> Option<TrackingRuntimeSnapshot> {
        self.host.projection().snapshot()
    }
    fn load_icon<'a>(&'a self, exe: &'a str) -> RemoteStatusStoreFuture<'a, Option<String>> {
        Box::pin(icon_cache::fetch_icon_for_exe(&self.pool, exe))
    }
}
