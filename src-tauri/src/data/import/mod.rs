pub mod canonical_csv;
pub mod commit;
pub mod destructure;
pub mod model;
pub mod paths;
mod prepared;
pub mod preview;

pub use commit::{
    commit_canonical_import, delete_import_batch, list_import_batches, prepare_canonical_import,
};
pub use destructure::destructure_external_file;
use model::ImportPreviewDto;
pub use paths::{pick_canonical_csv_file, pick_external_data_file};
use tauri::{AppHandle, Runtime};
pub async fn preview_canonical_import<R: Runtime>(
    app: &AppHandle<R>,
    file_path: String,
) -> Result<ImportPreviewDto, String> {
    preview::preview_in_pool(
        &crate::data::sqlite_pool::wait_for_sqlite_pool(app).await?,
        file_path,
    )
    .await
}
