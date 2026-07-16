use crate::data::app_settings_service::commit_app_setting_mutations_with_recovery;
use crate::data::icon_cache_service;
use crate::data::repositories::app_settings::{self, AppSettingMutation};
use crate::data::sqlite_pool::wait_for_sqlite_pool;
use crate::domain::settings::RemoteStatusBridgeSettings;
use crate::engine::remote_status_bridge::{RemoteStatusBridgeStore, RemoteStatusStoreFuture};
use tauri::{AppHandle, Runtime};

pub struct SqliteRemoteStatusBridgeStore<R: Runtime> {
    app: AppHandle<R>,
}

impl<R: Runtime> SqliteRemoteStatusBridgeStore<R> {
    pub fn new(app: AppHandle<R>) -> Self {
        Self { app }
    }
}

impl<R: Runtime> RemoteStatusBridgeStore for SqliteRemoteStatusBridgeStore<R> {
    fn load_settings(&self) -> RemoteStatusStoreFuture<'_, RemoteStatusBridgeSettings> {
        Box::pin(async move {
            let pool = wait_for_sqlite_pool(&self.app).await?;
            app_settings::load_remote_status_bridge_settings(&pool)
                .await
                .map_err(|error| error.to_string())
        })
    }

    fn save_machine_id<'a>(&'a self, machine_id: &'a str) -> RemoteStatusStoreFuture<'a, ()> {
        Box::pin(async move {
            commit_app_setting_mutations_with_recovery(
                &self.app,
                &[AppSettingMutation {
                    key: "remote_status_bridge_machine_id".to_string(),
                    value: machine_id.to_string(),
                }],
            )
            .await
            .map_err(|error| error.to_string())
        })
    }

    fn load_icon<'a>(&'a self, exe_name: &'a str) -> RemoteStatusStoreFuture<'a, Option<String>> {
        Box::pin(async move { icon_cache_service::load_icon_for_exe(&self.app, exe_name).await })
    }
}
