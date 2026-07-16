use crate::data::remote_status_store::SqliteRemoteStatusBridgeStore;
use crate::engine::remote_status_bridge::{self, RemoteStatusBridgeStore};
use std::sync::Arc;
use tauri::{AppHandle, Runtime};

fn store<R: Runtime + 'static>(app: &AppHandle<R>) -> Arc<dyn RemoteStatusBridgeStore> {
    Arc::new(SqliteRemoteStatusBridgeStore::new(app.clone()))
}

pub(crate) async fn ensure_machine_id<R: Runtime + 'static>(
    app: &AppHandle<R>,
) -> Result<String, String> {
    let store = store(app);
    remote_status_bridge::ensure_machine_id(app, store.as_ref()).await
}

pub(crate) fn start<R: Runtime + 'static>(app: AppHandle<R>) {
    let store = store(&app);
    remote_status_bridge::start(app, store);
}
