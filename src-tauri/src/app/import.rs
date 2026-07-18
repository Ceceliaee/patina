use crate::data::import::{
    self,
    model::{ImportClassificationMutation, ImportCommitReportDto, ImportDeleteReportDto},
};
use crate::engine::tracking::runtime as tracking_runtime;
use tauri::{AppHandle, Runtime};

pub(crate) async fn commit_and_refresh<R: Runtime>(
    app: AppHandle<R>,
    file_path: String,
    expected_fingerprint: String,
    classification_mutations: Vec<ImportClassificationMutation>,
) -> Result<ImportCommitReportDto, String> {
    let report = import::commit_canonical_import(
        &app,
        file_path,
        expected_fingerprint,
        classification_mutations,
    )
    .await?;
    emit_refresh(&app, "external-data-imported");
    Ok(report)
}

pub(crate) async fn delete_batch_and_refresh<R: Runtime>(
    app: AppHandle<R>,
    batch_id: String,
) -> Result<ImportDeleteReportDto, String> {
    let report = import::delete_import_batch(&app, batch_id).await?;
    emit_refresh(&app, "external-import-deleted");
    Ok(report)
}

fn emit_refresh<R: Runtime>(app: &AppHandle<R>, reason: &str) {
    if let Err(error) = tracking_runtime::emit_tracking_data_changed(app, reason, now_ms()) {
        eprintln!("[import] data committed but refresh event failed: {error}");
    }
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or_default()
}
