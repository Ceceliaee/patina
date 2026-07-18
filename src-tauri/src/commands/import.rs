use crate::commands::settings::ClassificationSettingMutationDto;
use crate::data::import::model::{
    DestructureReportDto, ImportBatchDto, ImportClassificationMutation, ImportCommitReportDto,
    ImportDeleteReportDto, ImportPreviewDto,
};
use crate::{app, data::import};
use tauri::AppHandle;

#[tauri::command]
pub fn cmd_pick_canonical_import_file(initial_path: Option<String>) -> Option<String> {
    import::pick_canonical_csv_file(initial_path)
}

#[tauri::command]
pub fn cmd_pick_external_import_file(initial_path: Option<String>) -> Option<String> {
    import::pick_external_data_file(initial_path)
}

#[tauri::command]
pub async fn cmd_preview_canonical_import(
    file_path: String,
    app: AppHandle,
) -> Result<ImportPreviewDto, String> {
    import::preview_canonical_import(&app, file_path).await
}

#[tauri::command]
pub async fn cmd_commit_canonical_import(
    file_path: String,
    expected_fingerprint: String,
    classification_mutations: Vec<ClassificationSettingMutationDto>,
    app: AppHandle,
) -> Result<ImportCommitReportDto, String> {
    app::import::commit_and_refresh(
        app,
        file_path,
        expected_fingerprint,
        classification_mutations
            .into_iter()
            .map(|mutation| {
                let (key, value) = mutation.into_parts();
                ImportClassificationMutation { key, value }
            })
            .collect(),
    )
    .await
}

#[tauri::command]
pub async fn cmd_destructure_external_data(
    file_path: String,
) -> Result<DestructureReportDto, String> {
    import::destructure_external_file(file_path).await
}

#[tauri::command]
pub async fn cmd_list_import_batches(app: AppHandle) -> Result<Vec<ImportBatchDto>, String> {
    import::list_import_batches(&app).await
}

#[tauri::command]
pub async fn cmd_delete_import_batch(
    batch_id: String,
    app: AppHandle,
) -> Result<ImportDeleteReportDto, String> {
    app::import::delete_batch_and_refresh(app, batch_id).await
}
