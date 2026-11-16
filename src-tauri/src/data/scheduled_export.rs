mod runtime;
use crate::{
    data::storage_jobs::StorageJobs,
    domain::export_schedule::{ScheduledExportConfigInput, ScheduledExportSnapshot},
};
pub(crate) use runtime::classify_error;
use tauri::AppHandle;
pub async fn get_snapshot(app: &AppHandle) -> Result<ScheduledExportSnapshot, String> {
    runtime::get_snapshot(&StorageJobs::for_app(app).await?).await
}
pub async fn save_config(
    app: &AppHandle,
    input: ScheduledExportConfigInput,
) -> Result<ScheduledExportSnapshot, String> {
    runtime::save_config(&StorageJobs::for_app(app).await?, input).await
}
pub async fn tick(app: &AppHandle) -> Result<bool, String> {
    runtime::tick(&StorageJobs::for_app(app).await?).await
}
