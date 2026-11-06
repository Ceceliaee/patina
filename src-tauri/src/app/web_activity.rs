use crate::data::app_settings_service;
use crate::data::web_activity_store::SqliteWebActivityStore;
use crate::domain::settings::WebActivitySettings;
use crate::domain::tracking::TrackingDataChangedPayload;
use crate::domain::web_activity::{
    BrowserActiveTabPayload, WebActivityChange, WEB_ACTIVITY_CHANGED_REASON,
};
use crate::engine::web_activity::{self as web_activity_engine, WebActivityRuntimeState};
use crate::platform::web_activity_bridge::{
    WebActivityBridgeHttpRequest, WebActivityBridgeHttpResponse, WebActivityBridgeRuntimeState,
};
use serde_json::json;
use tauri::{AppHandle, Emitter, Manager, Runtime, State};

async fn load_runtime_settings<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<WebActivitySettings, String> {
    app_settings_service::load_web_activity_settings(app).await
}

async fn record_active_tab_for_app<R: Runtime>(
    app: &AppHandle<R>,
    settings: &WebActivitySettings,
    payload: BrowserActiveTabPayload,
    now_ms: i64,
    generation: u64,
) -> Result<WebActivityChange, String> {
    let store = SqliteWebActivityStore::from_app(app).await?;
    web_activity_engine::record_active_tab(app, &store, settings, payload, now_ms, generation).await
}

pub(crate) async fn seal_active_segment_for_app<R: Runtime>(
    app: &AppHandle<R>,
    now_ms: i64,
) -> Result<bool, String> {
    let store = SqliteWebActivityStore::from_app(app).await?;
    web_activity_engine::seal_active_segment(&store, now_ms).await
}

pub async fn handle_http_request<R: Runtime>(
    app: AppHandle<R>,
    request: WebActivityBridgeHttpRequest,
) -> WebActivityBridgeHttpResponse {
    if !request.method.eq_ignore_ascii_case("POST") {
        return web_activity_http_response(
            405,
            false,
            "method-not-allowed",
            "unsupported web activity method",
        );
    }
    if request.path != "/web-activity" {
        return web_activity_http_response(
            404,
            false,
            "not-found",
            "unsupported web activity path",
        );
    }

    let now_ms = crate::app::runtime::now_ms() as i64;
    let generation = app
        .state::<crate::engine::tracking::runtime_snapshot::TrackingRuntimeSnapshotState>()
        .lifecycle_generation();
    let settings = match load_runtime_settings(&app).await {
        Ok(settings) => settings,
        Err(error) => {
            return web_activity_http_response(
                500,
                false,
                "settings-unavailable",
                &format!("failed to load web activity settings: {error}"),
            );
        }
    };

    let token = bearer_token(request.authorization.as_deref());
    if settings.token.is_empty() || token.as_deref() != Some(settings.token.as_str()) {
        return web_activity_http_response(
            401,
            false,
            "unauthorized",
            "invalid web activity token",
        );
    }

    if !settings.enabled {
        return WebActivityBridgeHttpResponse::json(
            409,
            json!({
                "ok": false,
                "enabled": false,
                "code": "web-recording-disabled",
                "message": "Patina web recording is off.",
                "serverTimeMs": now_ms,
            }),
        );
    }

    let payload = match serde_json::from_slice::<BrowserActiveTabPayload>(&request.body) {
        Ok(payload) => payload,
        Err(error) => {
            return web_activity_http_response(
                400,
                false,
                "invalid-payload",
                &format!("invalid active tab: {error}"),
            );
        }
    };

    match record_active_tab_for_app(&app, &settings, payload, now_ms, generation).await {
        Ok(change) => {
            let changed = change.changed();
            if changed {
                app.state::<WebActivityRuntimeState>()
                    .expiry_changed
                    .notify_one();
                emit_web_activity_changed(&app, now_ms);
            }
            if let WebActivityChange::TargetChanged { normalized_domain } = change {
                crate::engine::tools::notify_activity_reminder_web_transition(
                    &app,
                    normalized_domain.as_deref(),
                );
                if normalized_domain.is_none() {
                    // Anonymous web recording can also end the named browser session.
                    crate::app::tools::notify_tracking_transition(&app);
                }
            }
            WebActivityBridgeHttpResponse::json(
                200,
                json!({
                    "ok": true,
                    "enabled": true,
                    "changed": changed,
                    "serverTimeMs": now_ms,
                }),
            )
        }
        Err(error) => web_activity_http_response(400, false, "record-failed", &error),
    }
}

pub fn spawn_observation_expiry<R: Runtime + 'static>(app: AppHandle<R>) {
    tauri::async_runtime::spawn(async move {
        use std::time::Duration;
        let state = app.state::<WebActivityRuntimeState>();
        loop {
            let delay = match next_expiry_delay(&app).await {
                Ok(delay) => delay,
                Err(error) => {
                    eprintln!("[web-activity] expiry check failed: {error}");
                    tokio::time::sleep(Duration::from_secs(3)).await;
                    continue;
                }
            };
            tokio::select! {
                _ = state.expiry_changed.notified() => (),
                _ = tokio::time::sleep(delay) => (),
            }
        }
    });
}

async fn next_expiry_delay<R: Runtime>(app: &AppHandle<R>) -> Result<std::time::Duration, String> {
    use std::time::Duration;
    // A fresh pool read also reconciles a replaced database and wall-clock adjustments.
    let reconcile = Duration::from_secs(60);
    let store = SqliteWebActivityStore::from_app(app).await?;
    let Some(deadline) = store.next_expiry().await? else {
        return Ok(reconcile);
    };
    let now_ms = crate::app::runtime::now_ms() as i64;
    if deadline > now_ms {
        return Ok(reconcile.min(Duration::from_millis((deadline - now_ms) as u64)));
    }
    if web_activity_engine::expire_active_segment(&store, now_ms).await? {
        emit_web_activity_changed(app, now_ms);
        crate::engine::tools::notify_activity_reminder_web_transition(app, None);
    }
    Ok(Duration::ZERO)
}

pub async fn get_bridge_snapshot<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, WebActivityRuntimeState>,
) -> Result<crate::domain::web_activity::WebActivityBridgeSnapshot, String> {
    let bridge_settings = app_settings_service::load_web_activity_bridge_settings(&app).await?;
    let settings = WebActivitySettings {
        enabled: bridge_settings.enabled,
        token: bridge_settings.token.clone(),
    };
    let bridge_runtime_current = app
        .try_state::<WebActivityBridgeRuntimeState>()
        .map(|bridge_state| bridge_state.current_settings());
    if bridge_runtime_current.as_ref() != Some(&bridge_settings) {
        return Ok(crate::domain::web_activity::WebActivityBridgeSnapshot {
            enabled: settings.enabled,
            connected: false,
            browser_client_id: None,
            browser_kind: None,
            extension_version: None,
            last_activity_at_ms: None,
        });
    }

    Ok(state.snapshot(&settings, crate::app::runtime::now_ms() as i64))
}

fn emit_web_activity_changed<R: Runtime>(app: &AppHandle<R>, changed_at_ms: i64) {
    let _ = app.emit(
        "tracking-data-changed",
        TrackingDataChangedPayload::new(WEB_ACTIVITY_CHANGED_REASON, changed_at_ms as u64),
    );
}

fn bearer_token(authorization: Option<&str>) -> Option<String> {
    let value = authorization?.trim();
    let token = value
        .strip_prefix("Bearer ")
        .or_else(|| value.strip_prefix("bearer "))
        .unwrap_or(value)
        .trim()
        .to_string();
    if token.is_empty() {
        None
    } else {
        Some(token)
    }
}

fn web_activity_http_response(
    status: u16,
    ok: bool,
    code: &str,
    message: &str,
) -> WebActivityBridgeHttpResponse {
    WebActivityBridgeHttpResponse::json(
        status,
        json!({
            "ok": ok,
            "code": code,
            "message": message,
        }),
    )
}
