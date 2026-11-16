use crate::data::app_settings_service;
use crate::data::web_activity_store::SqliteWebActivityStore;
use crate::domain::settings::WebActivitySettings;
use crate::domain::tracking::TrackingDataChangedPayload;
use crate::domain::web_activity::{
    BrowserActiveTabPayload, WebActivityChange, WEB_ACTIVITY_CHANGED_REASON,
};
use crate::engine::web_activity::{self as web_activity_engine, WebActivityRuntimeState};
use crate::platform::web_activity_bridge::{
    WebActivityBridgeHttpRequest, WebActivityBridgeHttpResponse,
};
use crate::platform::web_activity_request::web_activity_http_response;
use tauri::{AppHandle, Emitter, Manager, Runtime};

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
    let titles =
        app.try_state::<crate::engine::tracking::title_state::TitleRecordingRuntimeState>();
    let context = web_activity_engine::WebActivityContext {
        runtime: &app.state::<WebActivityRuntimeState>(),
        tracking: &app
            .state::<crate::engine::tracking::runtime_snapshot::TrackingRuntimeSnapshotState>(),
        titles: titles.as_deref(),
    };
    web_activity_engine::record_active_tab(context, &store, settings, payload, now_ms, generation)
        .await
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
    let now_ms = crate::app::runtime::now_ms() as i64;
    let generation = app
        .state::<crate::engine::tracking::runtime_snapshot::TrackingRuntimeSnapshotState>()
        .lifecycle_generation();
    let (settings, payload) = match crate::platform::web_activity_request::parse(
        request,
        load_runtime_settings(&app).await,
        now_ms,
    ) {
        Ok(parsed) => parsed,
        Err(response) => return response,
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
            crate::platform::web_activity_request::recorded(changed, now_ms)
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

fn emit_web_activity_changed<R: Runtime>(app: &AppHandle<R>, changed_at_ms: i64) {
    let _ = app.emit(
        "tracking-data-changed",
        TrackingDataChangedPayload::new(WEB_ACTIVITY_CHANGED_REASON, changed_at_ms as u64),
    );
}
