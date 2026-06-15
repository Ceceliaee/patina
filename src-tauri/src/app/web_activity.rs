use crate::data::repositories::app_settings;
use crate::data::sqlite_pool::wait_for_sqlite_pool;
use crate::domain::tracking::TrackingDataChangedPayload;
use crate::domain::web_activity::{
    BrowserActiveTabPayload, BrowserClientHeartbeatPayload, BrowserClientHelloPayload,
    LocalApiClientRole, WEB_ACTIVITY_CHANGED_REASON,
};
use crate::engine::web_activity::{
    bridge_disabled_message, bridge_error_message, bridge_ok_message, record_active_tab,
    seal_active_segment, seal_if_tracking_inactive, WebActivityRuntimeState,
};
use crate::platform::local_api::{LocalApiHttpRequest, LocalApiHttpResponse};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, Runtime, State};

pub async fn handle_local_api_message<R: Runtime>(
    app: AppHandle<R>,
    role: LocalApiClientRole,
    raw_message: String,
) -> Option<String> {
    if role != LocalApiClientRole::BrowserBridge {
        return None;
    }

    let parsed = match serde_json::from_str::<Value>(&raw_message) {
        Ok(value) => value,
        Err(error) => return Some(bridge_error_message(&format!("invalid json: {error}"))),
    };
    let message_type = parsed
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let data = parsed.get("data").cloned().unwrap_or(Value::Null);
    let now_ms = crate::app::runtime::now_ms() as i64;
    let pool = match wait_for_sqlite_pool(&app).await {
        Ok(pool) => pool,
        Err(error) => return Some(bridge_error_message(&error)),
    };
    let settings = match app_settings::load_web_activity_settings(&pool).await {
        Ok(settings) => settings,
        Err(error) => {
            return Some(bridge_error_message(&format!(
                "failed to load web activity settings: {error}"
            )))
        }
    };

    match message_type {
        "browser-client-hello" => {
            let payload = match serde_json::from_value::<BrowserClientHelloPayload>(data) {
                Ok(payload) => payload,
                Err(error) => {
                    return Some(bridge_error_message(&format!("invalid hello: {error}")))
                }
            };
            if let Some(state) = app.try_state::<WebActivityRuntimeState>() {
                state.observe_client_hello(&payload, now_ms);
            }
            if settings.enabled {
                Some(bridge_ok_message(&settings, now_ms))
            } else {
                Some(bridge_disabled_message(now_ms))
            }
        }
        "browser-client-heartbeat" => {
            let payload = match serde_json::from_value::<BrowserClientHeartbeatPayload>(data) {
                Ok(payload) => payload,
                Err(error) => {
                    return Some(bridge_error_message(&format!("invalid heartbeat: {error}")))
                }
            };
            if let Some(state) = app.try_state::<WebActivityRuntimeState>() {
                state.observe_heartbeat(&payload, now_ms);
            }
            if settings.enabled {
                Some(bridge_ok_message(&settings, now_ms))
            } else {
                let _ = seal_active_segment(&pool, now_ms).await;
                Some(bridge_disabled_message(now_ms))
            }
        }
        "web-active-tab" => {
            let payload = match serde_json::from_value::<BrowserActiveTabPayload>(data) {
                Ok(payload) => payload,
                Err(error) => {
                    return Some(bridge_error_message(&format!(
                        "invalid active tab: {error}"
                    )))
                }
            };
            match record_active_tab(&app, &pool, &settings, payload, now_ms).await {
                Ok(changed) => {
                    if changed {
                        emit_web_activity_changed(&app, now_ms);
                    }
                    if settings.enabled {
                        Some(bridge_ok_message(&settings, now_ms))
                    } else {
                        Some(bridge_disabled_message(now_ms))
                    }
                }
                Err(error) => Some(bridge_error_message(&error)),
            }
        }
        _ => Some(bridge_error_message("unsupported browser bridge message")),
    }
}

pub async fn handle_http_request<R: Runtime>(
    app: AppHandle<R>,
    request: LocalApiHttpRequest,
) -> LocalApiHttpResponse {
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
    let pool = match wait_for_sqlite_pool(&app).await {
        Ok(pool) => pool,
        Err(error) => {
            return web_activity_http_response(500, false, "storage-unavailable", &error);
        }
    };
    let settings = match app_settings::load_web_activity_settings(&pool).await {
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
        let _ = seal_active_segment(&pool, now_ms).await;
        return LocalApiHttpResponse::json(
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

    match record_active_tab(&app, &pool, &settings, payload, now_ms).await {
        Ok(changed) => {
            if changed {
                emit_web_activity_changed(&app, now_ms);
            }
            LocalApiHttpResponse::json(
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

pub fn spawn_foreground_sync<R: Runtime + 'static>(app: AppHandle<R>) {
    tauri::async_runtime::spawn(async move {
        if let Err(error) = sync_foreground_state(app).await {
            eprintln!("[web-activity] failed to sync foreground state: {error}");
        }
    });
}

pub fn spawn_startup_repair<R: Runtime + 'static>(app: AppHandle<R>) {
    tauri::async_runtime::spawn(async move {
        let now_ms = crate::app::runtime::now_ms() as i64;
        let pool = match wait_for_sqlite_pool(&app).await {
            Ok(pool) => pool,
            Err(error) => {
                eprintln!("[web-activity] failed to load sqlite pool for startup repair: {error}");
                return;
            }
        };
        match seal_active_segment(&pool, now_ms).await {
            Ok(true) => emit_web_activity_changed(&app, now_ms),
            Ok(false) => {}
            Err(error) => eprintln!("[web-activity] failed to repair active segment: {error}"),
        }
    });
}

pub async fn sync_foreground_state<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    let pool = wait_for_sqlite_pool(&app).await?;
    let now_ms = crate::app::runtime::now_ms() as i64;
    if seal_if_tracking_inactive(&app, &pool, now_ms).await? {
        emit_web_activity_changed(&app, now_ms);
    }
    Ok(())
}

pub async fn get_bridge_snapshot<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, WebActivityRuntimeState>,
) -> Result<crate::domain::web_activity::WebActivityBridgeSnapshot, String> {
    let pool = wait_for_sqlite_pool(&app).await?;
    let settings = app_settings::load_web_activity_settings(&pool)
        .await
        .map_err(|error| format!("failed to load web activity settings: {error}"))?;
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
) -> LocalApiHttpResponse {
    LocalApiHttpResponse::json(
        status,
        json!({
            "ok": ok,
            "code": code,
            "message": message,
        }),
    )
}
