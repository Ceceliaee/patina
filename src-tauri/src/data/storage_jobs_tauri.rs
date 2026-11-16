use crate::data::{remote_backup::ScheduledWebDavTarget, sqlite_pool, storage_jobs::StorageJobs};
use crate::platform::{app_paths, storage_paths, webdav::WebDavClient};
use tauri::{AppHandle, Manager};
impl StorageJobs {
    pub(super) async fn for_app(app: &AppHandle) -> Result<Self, String> {
        let paths = storage_paths::resolve_storage_paths(app)?;
        let pool = sqlite_pool::wait_for_sqlite_pool(app).await?;
        let db = pool.clone();
        let network = app.clone();
        let snapshots = app.clone();
        Ok(Self {
            pool,
            profile: app_paths::product_roaming_data_dir(app)?,
            legacy: app.path().app_data_dir().map_err(|e| e.to_string())?,
            database: sqlite_pool::resolve_product_db_path(app)?,
            backups: paths.backup_dir,
            temp: paths.remote_backup_temp_dir,
            target: Box::new(move || {
                let app = network.clone();
                let db = db.clone();
                Box::pin(async move {
                    let (config, password) =
                        crate::data::remote_backup_config::network_snapshot(&app, &db).await?;
                    let client = WebDavClient::new(&config, password)?;
                    Ok(ScheduledWebDavTarget { config, client })
                })
            }),
            snapshot: Box::new(move |path| {
                let app = snapshots.clone();
                Box::pin(async move {
                    crate::data::backup::export_scheduled_backup_create_new(&app, &path).await
                })
            }),
        })
    }
}
