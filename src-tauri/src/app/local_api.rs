use crate::commands::tracking::CurrentTrackingSnapshot;
use crate::data::repositories::app_settings;
use crate::data::sqlite_pool::wait_for_sqlite_pool;
use crate::data::tracking_runtime::TrackingRuntimeDataStore;
use crate::domain::settings::LocalApiSettings;
use crate::engine::tracking::runtime::load_current_tracking_snapshot;
use crate::platform::local_api::{
    self, LocalApiRuntimeDeps, LocalApiRuntimeState, LOCAL_API_ACTIVE_WINDOW_EVENT,
    LOCAL_API_SETTINGS_CHANGED_EVENT, LOCAL_API_TRACKING_DATA_EVENT,
};
use serde_json::Value;
use std::future::Future;
use std::pin::Pin;
use tauri::{AppHandle, Listener, Manager, Runtime};

pub fn start<R: Runtime + 'static>(app: AppHandle<R>) {
    if app.try_state::<LocalApiRuntimeState>().is_none() {
        eprintln!("[local-api] runtime state is not available");
        return;
    }

    spawn_settings_bootstrap(app.clone());
    register_event_forwarders(app);
}

fn spawn_settings_bootstrap<R: Runtime + 'static>(app: AppHandle<R>) {
    tauri::async_runtime::spawn(async move {
        match load_local_api_settings(&app).await {
            Ok(settings) => update_runtime_state(app, settings),
            Err(error) => eprintln!("[local-api] failed to load settings: {error}"),
        }
    });
}

fn register_event_forwarders<R: Runtime + 'static>(app: AppHandle<R>) {
    let settings_app = app.clone();
    app.listen_any(LOCAL_API_SETTINGS_CHANGED_EVENT, move |_| {
        let settings_app = settings_app.clone();
        tauri::async_runtime::spawn(async move {
            match load_local_api_settings(&settings_app).await {
                Ok(settings) => update_runtime_state(settings_app, settings),
                Err(error) => eprintln!("[local-api] failed to reload settings: {error}"),
            }
        });
    });

    let active_window_app = app.clone();
    app.listen_any(LOCAL_API_ACTIVE_WINDOW_EVENT, move |event| {
        broadcast_event(
            &active_window_app,
            LOCAL_API_ACTIVE_WINDOW_EVENT,
            event.payload(),
        );
    });

    let tracking_data_app = app.clone();
    app.listen_any(LOCAL_API_TRACKING_DATA_EVENT, move |event| {
        broadcast_event(
            &tracking_data_app,
            LOCAL_API_TRACKING_DATA_EVENT,
            event.payload(),
        );
    });
}

fn update_runtime_state<R: Runtime + 'static>(app: AppHandle<R>, settings: LocalApiSettings) {
    if let Some(state) = app.try_state::<LocalApiRuntimeState>() {
        state.update(
            app.clone(),
            settings,
            LocalApiRuntimeDeps {
                load_token: load_current_token_boxed::<R>,
                load_snapshot: load_snapshot_message_boxed::<R>,
            },
        );
    }
}

fn broadcast_event<R: Runtime>(app: &AppHandle<R>, event_type: &str, payload: &str) {
    if let Some(state) = app.try_state::<LocalApiRuntimeState>() {
        state.broadcast(local_api::message_json(
            event_type,
            serde_json::from_str(payload).unwrap_or(Value::Null),
        ));
    }
}

async fn load_local_api_settings<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<LocalApiSettings, String> {
    let pool = wait_for_sqlite_pool(app).await?;
    app_settings::load_local_api_settings(&pool)
        .await
        .map_err(|error| format!("failed to load local api settings: {error}"))
}

async fn load_current_token<R: Runtime>(app: AppHandle<R>) -> Option<String> {
    load_local_api_settings(&app)
        .await
        .ok()
        .map(|settings| settings.token)
}

fn load_current_token_boxed<R: Runtime + 'static>(
    app: AppHandle<R>,
) -> Pin<Box<dyn Future<Output = Option<String>> + Send>> {
    Box::pin(load_current_token(app))
}

async fn load_snapshot_message<R: Runtime>(app: AppHandle<R>) -> Option<String> {
    let pool = wait_for_sqlite_pool(&app).await.ok()?;
    let data = TrackingRuntimeDataStore::new(pool);
    let snapshot = load_current_tracking_snapshot(&data).await.ok()?;
    let payload = CurrentTrackingSnapshot {
        window: snapshot.window,
        status: snapshot.status,
    };
    Some(local_api::message_json(
        "snapshot",
        serde_json::to_value(payload).unwrap_or(Value::Null),
    ))
}

fn load_snapshot_message_boxed<R: Runtime + 'static>(
    app: AppHandle<R>,
) -> Pin<Box<dyn Future<Output = Option<String>> + Send>> {
    Box::pin(load_snapshot_message(app))
}
