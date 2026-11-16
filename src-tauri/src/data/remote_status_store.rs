use crate::data::app_settings_service::commit_app_setting_mutations_with_recovery;
use crate::data::icon_cache_service;
use crate::data::repositories::app_settings::{self, AppSettingMutation};
use crate::data::sqlite_pool::wait_for_sqlite_pool;
use crate::domain::settings::RemoteStatusBridgeSettings;
use crate::engine::remote_status_bridge::{RemoteStatusBridgeStore, RemoteStatusStoreFuture};
use crate::engine::tracking::runtime_snapshot::{
    TrackingRuntimeSnapshot, TrackingRuntimeSnapshotState,
};
use tauri::{AppHandle, Manager, Runtime};

pub struct SqliteRemoteStatusBridgeStore<R: Runtime> {
    app: AppHandle<R>,
}

impl<R: Runtime> SqliteRemoteStatusBridgeStore<R> {
    pub fn new(app: AppHandle<R>) -> Self {
        Self { app }
    }
    pub async fn load_settings(&self) -> Result<RemoteStatusBridgeSettings, String> {
        let pool = wait_for_sqlite_pool(&self.app).await?;
        app_settings::load_remote_status_bridge_settings(&pool)
            .await
            .map_err(|error| error.to_string())
    }

    pub async fn save_machine_id(&self, machine_id: &str) -> Result<(), String> {
        commit_app_setting_mutations_with_recovery(
            &self.app,
            &[AppSettingMutation {
                key: "remote_status_bridge_machine_id".to_string(),
                value: machine_id.to_string(),
            }],
        )
        .await
        .map_err(|error| error.to_string())
    }
}

impl<R: Runtime> RemoteStatusBridgeStore for SqliteRemoteStatusBridgeStore<R> {
    fn snapshot(&self) -> Option<TrackingRuntimeSnapshot> {
        self.app
            .try_state::<TrackingRuntimeSnapshotState>()?
            .snapshot()
    }

    fn load_icon<'a>(&'a self, exe_name: &'a str) -> RemoteStatusStoreFuture<'a, Option<String>> {
        Box::pin(async move { icon_cache_service::load_icon_for_exe(&self.app, exe_name).await })
    }
}
