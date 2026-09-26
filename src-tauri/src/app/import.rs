use crate::data::import::{
    self,
    model::{ImportClassificationMutation, ImportCommitReportDto, ImportDeleteReportDto},
};
use crate::engine::tracking::runtime as tracking_runtime;
use crate::engine::tracking::{
    runtime_snapshot::TrackingRuntimeSnapshotState, title_state::TitleRecordingRuntimeState,
};
use tauri::{AppHandle, Manager, Runtime};

pub(crate) async fn commit_and_refresh<R: Runtime>(
    app: AppHandle<R>,
    file_path: String,
    expected_fingerprint: String,
    classification_mutations: Vec<ImportClassificationMutation>,
) -> Result<ImportCommitReportDto, String> {
    // Validate and parse the file before blocking the sampling transition.
    let prepared =
        import::prepare_canonical_import(file_path, expected_fingerprint, classification_mutations)
            .await?;
    let report = with_import_policy_refresh(
        &app.state::<TrackingRuntimeSnapshotState>(),
        &app.state::<TitleRecordingRuntimeState>(),
        import::commit_canonical_import(&app, prepared),
    )
    .await?;
    emit_refresh(&app, "external-data-imported");
    Ok(report)
}

pub(crate) async fn delete_batch_and_refresh<R: Runtime>(
    app: AppHandle<R>,
    batch_id: String,
) -> Result<ImportDeleteReportDto, String> {
    let report = with_import_policy_refresh(
        &app.state::<TrackingRuntimeSnapshotState>(),
        &app.state::<TitleRecordingRuntimeState>(),
        import::delete_import_batch(&app, batch_id),
    )
    .await?;
    emit_refresh(&app, "external-import-deleted");
    Ok(report)
}

async fn with_import_policy_refresh<T>(
    tracking: &TrackingRuntimeSnapshotState,
    titles: &TitleRecordingRuntimeState,
    operation: impl std::future::Future<Output = Result<T, String>>,
) -> Result<T, String> {
    // Import can write overrides; deleting a batch can remove orphaned ones.
    // Keep the transaction and invalidation indivisible to the sampling loop.
    let _transition = tracking.transition.lock().await;
    let result = operation.await?;
    titles.invalidate_app_overrides();
    Ok(result)
}

fn emit_refresh<R: Runtime>(app: &AppHandle<R>, reason: &str) {
    if let Err(error) = tracking_runtime::emit_tracking_data_changed(app, reason, now_ms()) {
        eprintln!("[import] data committed but refresh event failed: {error}");
    }
}

fn now_ms() -> u64 {
    crate::platform::clock::unix_timestamp_millis_u64()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn import_policy_refresh_serializes_commit_and_invalidates_only_success() {
        tauri::async_runtime::block_on(async {
            let tracking = TrackingRuntimeSnapshotState::default();
            let titles = TitleRecordingRuntimeState::default();
            let held = tracking.transition.lock().await;
            let mut operation = Box::pin(with_import_policy_refresh(&tracking, &titles, async {
                assert!(tracking.transition.try_lock().is_err());
                assert_eq!(titles.override_generation(), 0);
                Ok(42)
            }));
            assert!(futures_util::poll!(&mut operation).is_pending());
            assert_eq!(titles.override_generation(), 0);
            drop(held);
            assert_eq!(operation.await.unwrap(), 42);
            assert_eq!(titles.override_generation(), 1);
            assert!(tracking.transition.try_lock().is_ok());

            let failure = with_import_policy_refresh(&tracking, &titles, async {
                assert!(tracking.transition.try_lock().is_err());
                Err::<(), _>("transaction rejected".to_string())
            })
            .await;
            assert_eq!(failure.unwrap_err(), "transaction rejected");
            assert_eq!(titles.override_generation(), 1);
            assert!(tracking.transition.try_lock().is_ok());
        });
    }
}
