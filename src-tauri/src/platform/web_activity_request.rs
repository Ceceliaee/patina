use super::web_activity_bridge::{WebActivityBridgeHttpRequest, WebActivityBridgeHttpResponse};
use crate::domain::{settings::WebActivitySettings, web_activity::BrowserActiveTabPayload};
use serde_json::json;

pub(crate) fn parse(
    request: WebActivityBridgeHttpRequest,
    settings: Result<WebActivitySettings, String>,
    now_ms: i64,
) -> Result<(WebActivitySettings, BrowserActiveTabPayload), WebActivityBridgeHttpResponse> {
    if !request.method.eq_ignore_ascii_case("POST") {
        return Err(web_activity_http_response(
            405,
            false,
            "method-not-allowed",
            "unsupported web activity method",
        ));
    }
    if request.path != "/web-activity" {
        return Err(web_activity_http_response(
            404,
            false,
            "not-found",
            "unsupported web activity path",
        ));
    }

    let settings = match settings {
        Ok(settings) => settings,
        Err(error) => {
            return Err(web_activity_http_response(
                500,
                false,
                "settings-unavailable",
                &format!("failed to load web activity settings: {error}"),
            ));
        }
    };

    let token = bearer_token(request.authorization.as_deref());
    if settings.token.is_empty() || token.as_deref() != Some(settings.token.as_str()) {
        return Err(web_activity_http_response(
            401,
            false,
            "unauthorized",
            "invalid web activity token",
        ));
    }

    if !settings.enabled {
        return Err(WebActivityBridgeHttpResponse::json(
            409,
            json!({
                "ok": false,
                "enabled": false,
                "code": "web-recording-disabled",
                "message": "Patina web recording is off.",
                "serverTimeMs": now_ms,
            }),
        ));
    }

    let payload = match serde_json::from_slice::<BrowserActiveTabPayload>(&request.body) {
        Ok(payload) => payload,
        Err(error) => {
            return Err(web_activity_http_response(
                400,
                false,
                "invalid-payload",
                &format!("invalid active tab: {error}"),
            ));
        }
    };

    Ok((settings, payload))
}

pub(crate) fn recorded(changed: bool, now_ms: i64) -> WebActivityBridgeHttpResponse {
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

pub(crate) fn web_activity_http_response(
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
