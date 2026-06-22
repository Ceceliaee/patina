use crate::data::repositories::app_settings;
use crate::data::sqlite_pool::wait_for_sqlite_pool;
use crate::domain::settings::WebActivityBridgeSettings;
use crate::engine::web_activity::WebActivityRuntimeState;
use crate::platform::web_activity_bridge::{
    WebActivityBridgeHttpRequest, WebActivityBridgeHttpResponse, WebActivityBridgeRuntimeDeps,
    WebActivityBridgeRuntimeState, WEB_ACTIVITY_BRIDGE_ACTIVE_WINDOW_EVENT,
    WEB_ACTIVITY_BRIDGE_SETTINGS_CHANGED_EVENT, WEB_ACTIVITY_BRIDGE_TRACKING_DATA_EVENT,
};
use std::future::Future;
use std::pin::Pin;
use tauri::{AppHandle, Listener, Manager, Runtime};

pub fn start<R: Runtime + 'static>(app: AppHandle<R>) {
    if app.try_state::<WebActivityBridgeRuntimeState>().is_none() {
        eprintln!("[web-activity-bridge] runtime state is not available");
        return;
    }

    spawn_settings_bootstrap(app.clone());
    register_event_handlers(app);
}

fn spawn_settings_bootstrap<R: Runtime + 'static>(app: AppHandle<R>) {
    tauri::async_runtime::spawn(async move {
        match load_web_activity_bridge_settings(&app).await {
            Ok(settings) => update_runtime_state(app, settings),
            Err(error) => eprintln!("[web-activity-bridge] failed to load settings: {error}"),
        }
    });
}

fn register_event_handlers<R: Runtime + 'static>(app: AppHandle<R>) {
    let settings_app = app.clone();
    app.listen_any(WEB_ACTIVITY_BRIDGE_SETTINGS_CHANGED_EVENT, move |_| {
        let settings_app = settings_app.clone();
        tauri::async_runtime::spawn(async move {
            match load_web_activity_bridge_settings(&settings_app).await {
                Ok(settings) => update_runtime_state(settings_app, settings),
                Err(error) => {
                    eprintln!("[web-activity-bridge] failed to reload settings: {error}")
                }
            }
        });
    });

    let active_window_app = app.clone();
    app.listen_any(WEB_ACTIVITY_BRIDGE_ACTIVE_WINDOW_EVENT, move |_| {
        crate::app::web_activity::spawn_foreground_sync(active_window_app.clone());
    });

    let tracking_data_app = app.clone();
    app.listen_any(WEB_ACTIVITY_BRIDGE_TRACKING_DATA_EVENT, move |_| {
        crate::app::web_activity::spawn_foreground_sync(tracking_data_app.clone());
    });
}

fn update_runtime_state<R: Runtime + 'static>(
    app: AppHandle<R>,
    settings: WebActivityBridgeSettings,
) {
    if let Some(state) = app.try_state::<WebActivityBridgeRuntimeState>() {
        let bridge_restarted = state.update(
            app.clone(),
            settings,
            WebActivityBridgeRuntimeDeps {
                handle_http_request: handle_http_request_boxed::<R>,
            },
        );
        if bridge_restarted {
            if let Some(web_activity_state) = app.try_state::<WebActivityRuntimeState>() {
                web_activity_state.reset_client();
            }
        }
    }
}

async fn load_web_activity_bridge_settings<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<WebActivityBridgeSettings, String> {
    let pool = wait_for_sqlite_pool(app).await?;
    app_settings::load_web_activity_bridge_settings(&pool)
        .await
        .map_err(|error| format!("failed to load web activity bridge settings: {error}"))
}

fn handle_http_request_boxed<R: Runtime + 'static>(
    app: AppHandle<R>,
    request: WebActivityBridgeHttpRequest,
) -> Pin<Box<dyn Future<Output = WebActivityBridgeHttpResponse> + Send>> {
    Box::pin(crate::app::web_activity::handle_http_request(app, request))
}
