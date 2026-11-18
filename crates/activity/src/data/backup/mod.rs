pub mod import_data;
pub mod merge;
pub mod prepared_source;
pub mod records;
pub mod snapshot;
pub use records::RestoreStrategy;
pub(crate) use snapshot::{validate_scheduled_snapshot, write_snapshot_archive_create_new};
pub(crate) async fn preview_backup(
    path: String,
) -> Result<crate::domain::backup::BackupPreview, crate::domain::backup::BackupError> {
    preview(&path).await.map_err(Into::into)
}
pub(crate) use prepared_source::prepare_snapshot_source;
pub(crate) use snapshot::{merge_snapshot_backup, prepare_snapshot_backup, write_snapshot_archive};
pub(crate) async fn preview(path: &str) -> Result<crate::domain::backup::BackupPreview, String> {
    let src = prepare_snapshot_source(path, None).map_err(|e| e.to_string())?;
    let mut p = snapshot::extract_snapshot_archive(&src.path, false)
        .await?
        .preview
        .clone();
    p.hash = src.content_sha256.clone();
    Ok(p)
}
