pub use super::prepared::{prepare_canonical_import, PreparedCanonicalImport};
use crate::data::import::model::{ImportBatchDto, ImportCommitReportDto, ImportDeleteReportDto};
use crate::data::repositories::import_batches;
use crate::data::sqlite_pool::wait_for_sqlite_pool;
use tauri::{AppHandle, Runtime};
pub async fn commit_canonical_import<R: Runtime>(
    app: &AppHandle<R>,
    prepared: PreparedCanonicalImport,
) -> Result<ImportCommitReportDto, String> {
    let pool = wait_for_sqlite_pool(app).await?;
    super::prepared::commit_in_pool(&pool, prepared).await
}
pub async fn list_import_batches<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<Vec<ImportBatchDto>, String> {
    let pool = wait_for_sqlite_pool(app).await?;
    import_batches::list(&pool).await
}

pub async fn delete_import_batch<R: Runtime>(
    app: &AppHandle<R>,
    batch_id: String,
) -> Result<ImportDeleteReportDto, String> {
    let pool = wait_for_sqlite_pool(app).await?;
    import_batches::delete(&pool, batch_id.trim()).await
}
