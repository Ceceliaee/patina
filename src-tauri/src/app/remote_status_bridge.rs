use crate::data::remote_status_store::SqliteRemoteStatusBridgeStore;
use crate::engine::remote_status_bridge::{generate_machine_id, RemoteStatusBridgeRuntimeState};
use serde_json::json;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Listener, Manager, Runtime};
const SETTINGS_CHANGED_EVENT: &str = "app-settings-changed";
const TRACKING_EVENT_NAMES: [&str; 2] = ["active-window-changed", "tracking-data-changed"];

fn store<R: Runtime + 'static>(app: &AppHandle<R>) -> Arc<SqliteRemoteStatusBridgeStore<R>> {
    Arc::new(SqliteRemoteStatusBridgeStore::new(app.clone()))
}

pub async fn ensure_machine_id<R: Runtime + 'static>(app: &AppHandle<R>) -> Result<String, String> {
    let store = store(app);
    let current = store
        .load_settings()
        .await
        .map_err(|error| format!("failed to load remote status bridge settings: {error}"))?;

    if !current.machine_id.trim().is_empty() {
        return Ok(current.machine_id);
    }

    let machine_id = generate_machine_id();
    store.save_machine_id(&machine_id).await?;
    app.emit(SETTINGS_CHANGED_EVENT, json!({}))
        .map_err(|error| format!("failed to emit settings refresh event: {error}"))?;
    Ok(machine_id)
}

pub fn start<R: Runtime + 'static>(app: AppHandle<R>) {
    let store = store(&app);
    reload_runtime_settings(app.clone(), Arc::clone(&store));

    let settings_app = app.clone();
    let settings_store = Arc::clone(&store);
    app.listen_any(SETTINGS_CHANGED_EVENT, move |_| {
        reload_runtime_settings(settings_app.clone(), Arc::clone(&settings_store));
    });

    for event_name in TRACKING_EVENT_NAMES {
        let tracking_app = app.clone();
        app.listen_any(event_name, move |_| {
            if let Some(state) = tracking_app.try_state::<RemoteStatusBridgeRuntimeState>() {
                state.notify_snapshot_change();
            }
        });
    }
}

fn reload_runtime_settings<R: Runtime + 'static>(
    app: AppHandle<R>,
    store: Arc<SqliteRemoteStatusBridgeStore<R>>,
) {
    tauri::async_runtime::spawn(async move {
        match store.load_settings().await {
            Ok(settings) => {
                if let Some(state) = app.try_state::<RemoteStatusBridgeRuntimeState>() {
                    state.update(store, settings);
                }
            }
            Err(error) => eprintln!("[remote-status-bridge] failed to load settings: {error}"),
        }
    });
}
