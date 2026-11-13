use super::sqlite_pool::wait_for_sqlite_pool;
use super::tracking_runtime::{shared_from_provider, TrackingPoolSource};
use crate::engine::tracking::ports::SharedTrackingDataStore;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Runtime};

pub async fn shared_from_app<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<SharedTrackingDataStore, String> {
    let pool_app = app.clone();
    let event_app = app.clone();
    let source: TrackingPoolSource = Arc::new(move || {
        let app = pool_app.clone();
        Box::pin(async move {
            wait_for_sqlite_pool(&app)
                .await
                .map_err(sqlx::Error::Protocol)
        })
    });
    shared_from_provider(
        source,
        Arc::new(move |exe| {
            let _ = event_app.emit("app-icon-changed", exe);
        }),
    )
    .await
    .map_err(|e| e.to_string())
}
