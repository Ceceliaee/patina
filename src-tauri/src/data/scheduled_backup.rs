mod runtime;
use crate::{
    data::storage_jobs::StorageJobs,
    domain::backup_schedule::{ScheduledBackupConfigInput, ScheduledBackupSnapshot},
};
pub(crate) use runtime::classify_error;
use tauri::AppHandle;
pub async fn get_snapshot(app: &AppHandle) -> Result<ScheduledBackupSnapshot, String> {
    runtime::get_snapshot(&StorageJobs::for_app(app).await?).await
}
pub async fn save_config(
    app: &AppHandle,
    input: ScheduledBackupConfigInput,
) -> Result<ScheduledBackupSnapshot, String> {
    runtime::save_config(&StorageJobs::for_app(app).await?, input).await
}
pub async fn tick(app: &AppHandle) -> Result<bool, String> {
    runtime::tick(&StorageJobs::for_app(app).await?).await
}
pub async fn refresh_webdav_target_after_settings_change(app: &AppHandle) -> Result<bool, String> {
    runtime::refresh_webdav_target_after_settings_change(&StorageJobs::for_app(app).await?).await
}
