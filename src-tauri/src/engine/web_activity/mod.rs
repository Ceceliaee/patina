use crate::domain::settings::WebActivitySettings;
use crate::domain::web_activity::{
    sanitize_active_tab_payload, sanitize_browser_client_id, sanitize_browser_kind,
    sanitize_extension_version, BrowserActiveTabPayload, WebActivityBridgeSnapshot,
    WebActivitySegmentInput,
};
use crate::engine::tracking::runtime_snapshot::TrackingRuntimeSnapshotState;
use crate::engine::tracking::title_state::TitleRecordingRuntimeState;
use std::future::Future;
use std::pin::Pin;
use std::sync::Mutex;
use tauri::{Manager, Runtime};

const BROWSER_BRIDGE_CONNECTED_WINDOW_MS: i64 = 30_000;

pub type WebActivityStoreFuture<'a, T> =
    Pin<Box<dyn Future<Output = Result<T, String>> + Send + 'a>>;

pub trait WebActivityStore: Send + Sync {
    fn expire_active_segment(&self, now_ms: i64) -> WebActivityStoreFuture<'_, bool>;
    fn seal_source<'a>(
        &'a self,
        client: &'a str,
        native_session_id: i64,
        now_ms: i64,
    ) -> WebActivityStoreFuture<'a, bool>;
    fn load_domain_recording_enabled<'a>(
        &'a self,
        normalized_domain: &'a str,
    ) -> WebActivityStoreFuture<'a, bool>;
    fn load_domain_title_recording_enabled<'a>(
        &'a self,
        normalized_domain: &'a str,
    ) -> WebActivityStoreFuture<'a, bool>;
    fn upsert_active_segment<'a>(
        &'a self,
        input: &'a WebActivitySegmentInput,
        now_ms: i64,
    ) -> WebActivityStoreFuture<'a, bool>;
    fn seal_active_segment(&self, now_ms: i64) -> WebActivityStoreFuture<'_, bool>;
}

#[derive(Clone, Debug, Default)]
struct WebActivityClientSnapshot {
    browser_client_id: Option<String>,
    browser_kind: Option<String>,
    extension_version: Option<String>,
    last_activity_at_ms: Option<i64>,
}

#[derive(Debug, Default)]
pub struct WebActivityRuntimeState {
    inner: Mutex<WebActivityClientSnapshot>,
    pub(crate) maintenance: std::sync::Arc<tokio::sync::Mutex<()>>,
    ingest: tokio::sync::Mutex<()>,
}

impl WebActivityRuntimeState {
    pub fn reset_client(&self) {
        let mut guard = match self.inner.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        *guard = WebActivityClientSnapshot::default();
    }

    pub fn observe_active_tab(&self, payload: &BrowserActiveTabPayload, now_ms: i64) {
        self.update_client(
            Some(sanitize_browser_client_id(
                payload.browser_client_id.as_deref(),
            )),
            Some(sanitize_browser_kind(payload.browser_kind.as_deref())),
            sanitize_extension_version(payload.extension_version.as_deref()),
            now_ms,
        );
    }

    pub fn snapshot(
        &self,
        settings: &WebActivitySettings,
        now_ms: i64,
    ) -> WebActivityBridgeSnapshot {
        let client = match self.inner.lock() {
            Ok(guard) => guard.clone(),
            Err(poisoned) => poisoned.into_inner().clone(),
        };
        let connected = client
            .last_activity_at_ms
            .map(|last| now_ms.saturating_sub(last) <= BROWSER_BRIDGE_CONNECTED_WINDOW_MS)
            .unwrap_or(false);

        WebActivityBridgeSnapshot {
            enabled: settings.enabled,
            connected,
            browser_client_id: client.browser_client_id,
            browser_kind: client.browser_kind,
            extension_version: client.extension_version,
            last_activity_at_ms: client.last_activity_at_ms,
        }
    }

    fn update_client(
        &self,
        browser_client_id: Option<String>,
        browser_kind: Option<String>,
        extension_version: Option<String>,
        now_ms: i64,
    ) {
        let mut guard = match self.inner.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        if browser_client_id.is_some() {
            guard.browser_client_id = browser_client_id;
        }
        if browser_kind.is_some() {
            guard.browser_kind = browser_kind;
        }
        if extension_version.is_some() {
            guard.extension_version = extension_version;
        }
        guard.last_activity_at_ms = Some(now_ms);
    }
}

pub async fn record_active_tab<R: Runtime>(
    app: &tauri::AppHandle<R>,
    store: &impl WebActivityStore,
    settings: &WebActivitySettings,
    payload: BrowserActiveTabPayload,
    now_ms: i64,
    generation: u64,
) -> Result<bool, String> {
    let runtime = app.state::<WebActivityRuntimeState>();
    let tracking = app.state::<TrackingRuntimeSnapshotState>();
    let entry = tracking.snapshot();
    let _ingest = runtime.ingest.lock().await;
    let _transition = tracking.transition.lock().await;
    let processed_at = crate::platform::clock::unix_timestamp_millis_i64();
    if now_ms > processed_at || processed_at.saturating_sub(now_ms) > 5_000 {
        return Ok(false);
    }
    if !tracking.accepts_sample(generation) {
        return Ok(false);
    }
    let Some(snapshot) = tracking.snapshot() else {
        return Ok(false);
    };
    let Some(native) = snapshot.active_session.as_ref() else {
        return Ok(false);
    };
    if entry
        .and_then(|value| value.active_session)
        .map(|value| value.id)
        != Some(native.id)
        || !accepts_browser_observation(&snapshot, payload.browser_kind.as_deref(), processed_at)
        || !settings.enabled
    {
        return Ok(false);
    }
    let observed_at = payload.captured_at_ms.unwrap_or(now_ms);
    if observed_at < native.start_time
        || observed_at > now_ms
        || now_ms.saturating_sub(observed_at) > 5_000
    {
        return Ok(false);
    }
    let client = sanitize_browser_client_id(payload.browser_client_id.as_deref());
    runtime.observe_active_tab(&payload, now_ms);
    let Some(mut sanitized) = sanitize_active_tab_payload(payload)? else {
        return store.seal_source(&client, native.id, observed_at).await;
    };
    if !store
        .load_domain_recording_enabled(&sanitized.normalized_domain)
        .await?
    {
        return store.seal_source(&client, native.id, observed_at).await;
    }
    let global_title_enabled = app
        .try_state::<TitleRecordingRuntimeState>()
        .map(|state| state.is_enabled())
        .unwrap_or(true);
    if !global_title_enabled
        || !store
            .load_domain_title_recording_enabled(&sanitized.normalized_domain)
            .await?
    {
        sanitized.title = None;
    }
    // Power notifications invalidate eligibility synchronously, including while
    // domain policy reads were awaiting SQLite.
    if !tracking.accepts_sample(generation) {
        return Ok(false);
    }
    let input = WebActivitySegmentInput::from_sanitized(
        sanitized,
        snapshot.window.exe_name.trim().to_ascii_lowercase(),
        native.id,
    );
    store.upsert_active_segment(&input, observed_at).await
}

fn accepts_browser_observation(
    snapshot: &crate::engine::tracking::runtime_snapshot::TrackingRuntimeSnapshot,
    kind: Option<&str>,
    now_ms: i64,
) -> bool {
    use crate::engine::tracking::runtime_snapshot::TrackingRuntimeProbeStatus;
    let Some(native) = snapshot.active_session.as_ref() else {
        return false;
    };
    snapshot.status.is_tracking_active
        && !snapshot.window.is_afk
        && snapshot.probe_status == TrackingRuntimeProbeStatus::Ok
        && now_ms >= snapshot.sampled_at_ms
        && now_ms - snapshot.sampled_at_ms <= 8_000
        && now_ms >= native.start_time
        && native
            .exe_name
            .eq_ignore_ascii_case(&snapshot.window.exe_name)
        && browser_kind_matches_foreground(kind, &native.exe_name)
}

fn browser_kind_matches_foreground(kind: Option<&str>, exe: &str) -> bool {
    use crate::domain::web_activity::{
        resolve_web_activity_browser_family, WebActivityBrowserFamily,
    };
    let exe = exe.trim().to_ascii_lowercase();
    let family = resolve_web_activity_browser_family(&exe);
    let Some(kind) = kind.map(str::trim).filter(|kind| !kind.is_empty()) else {
        // Optional Firefox technical data cannot be made a tracking prerequisite.
        // Without it, native eligibility and finite observation lifetime still apply.
        return family.is_some();
    };
    match kind.to_ascii_lowercase().as_str() {
        "edge" => exe == "msedge.exe",
        "opera" => exe == "opera.exe",
        "vivaldi" => exe == "vivaldi.exe",
        "brave" => exe == "brave.exe",
        "firefox" | "zen" | "floorp" | "iceweasel" => {
            family == Some(WebActivityBrowserFamily::Firefox)
        }
        "chrome" | "chromium" => {
            family == Some(WebActivityBrowserFamily::Chromium)
                && !matches!(exe.as_str(), "msedge.exe" | "opera.exe" | "vivaldi.exe")
        }
        _ => false,
    }
}

pub async fn expire_active_segment(
    store: &impl WebActivityStore,
    now_ms: i64,
) -> Result<bool, String> {
    store.expire_active_segment(now_ms).await
}

pub async fn seal_active_segment(
    store: &impl WebActivityStore,
    now_ms: i64,
) -> Result<bool, String> {
    store
        .seal_active_segment(now_ms)
        .await
        .map_err(|error| format!("failed to seal web activity: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::data::repositories::web_activity::upsert_active_segment;
    use crate::data::schema as db_schema;
    use crate::data::web_activity_store::SqliteWebActivityStore;
    use sqlx::{Executor, SqlitePool};

    #[test]
    fn browser_eligibility_requires_coherent_fresh_native_facts_and_available_source_evidence() {
        use crate::engine::tracking::runtime_snapshot::{
            TrackingRuntimeProbeDiagnostics, TrackingRuntimeProbeStatus, TrackingRuntimeSnapshot,
        };
        let window = serde_json::from_value(serde_json::json!({
            "hwnd":"1", "root_owner_hwnd":"1", "process_id":1, "window_class":"Browser", "title":"Page",
            "exe_name":"msedge.exe", "process_path":"", "is_afk":false, "idle_time_ms":0
        })).unwrap();
        let mut snapshot = TrackingRuntimeSnapshot {
            generation: 0,
            window,
            status: crate::domain::tracking::TrackingStatusSnapshot {
                is_tracking_active: true,
                ..Default::default()
            },
            sampled_at_ms: 2_000,
            probe_status: TrackingRuntimeProbeStatus::Ok,
            degraded_reason: None,
            probe_diagnostics: TrackingRuntimeProbeDiagnostics::default(),
            active_session: Some(crate::domain::tracking::ActiveSessionSnapshot {
                id: 1,
                app_name: "Edge".into(),
                exe_name: "msedge.exe".into(),
                start_time: 1_000,
                continuity_group_start_time: 1_000,
                closed_duration_ms: 0,
            }),
        };
        assert!(accepts_browser_observation(&snapshot, Some("edge"), 3_000));
        assert!(!accepts_browser_observation(
            &snapshot,
            Some("chrome"),
            3_000
        ));
        assert!(!accepts_browser_observation(
            &snapshot,
            Some("edge"),
            10_001
        ));
        assert!(!accepts_browser_observation(&snapshot, Some("edge"), 1_999));
        snapshot.probe_status = TrackingRuntimeProbeStatus::TimeoutFallback;
        assert!(!accepts_browser_observation(&snapshot, Some("edge"), 3_000));
        snapshot.probe_status = TrackingRuntimeProbeStatus::Ok;
        snapshot.window.exe_name = "chrome.exe".into();
        assert!(!accepts_browser_observation(
            &snapshot,
            Some("chrome"),
            3_000
        ));
        snapshot.active_session = None;
        assert!(!accepts_browser_observation(&snapshot, None, 3_000));
        assert!(browser_kind_matches_foreground(None, "firefox.exe"));
        assert!(!browser_kind_matches_foreground(Some("edge"), "chrome.exe"));
        assert!(!browser_kind_matches_foreground(None, "code.exe"));
    }

    async fn setup_test_db() -> SqlitePool {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        pool.execute(db_schema::CURRENT_BASELINE_SCHEMA_SQL)
            .await
            .unwrap();
        pool.execute(db_schema::WEB_ACTIVITY_SCHEMA_SQL)
            .await
            .unwrap();
        pool.execute(db_schema::WEB_ACTIVITY_SESSION_SCHEMA_SQL)
            .await
            .unwrap();
        crate::data::repositories::sessions::start_session(&pool, "Chrome", "chrome.exe", "", 0, 0)
            .await
            .unwrap();
        pool
    }

    #[test]
    fn inactive_settings_seal_existing_web_segment() {
        tauri::async_runtime::block_on(async {
            let pool = setup_test_db().await;
            let input = WebActivitySegmentInput {
                native_session_id: 1,
                browser_client_id: "client".into(),
                browser_kind: "chrome".into(),
                browser_exe_name: "chrome.exe".into(),
                domain: "github.com".into(),
                normalized_domain: "github.com".into(),
                url: None,
                title: Some("Issue".into()),
                favicon_url: None,
            };
            upsert_active_segment(&pool, &input, 1_000).await.unwrap();
            let store = SqliteWebActivityStore::new(pool.clone());
            assert!(seal_active_segment(&store, 2_000).await.unwrap());

            let duration: Option<i64> =
                sqlx::query_scalar("SELECT duration FROM web_activity_segments LIMIT 1")
                    .fetch_one(&pool)
                    .await
                    .unwrap();
            assert_eq!(duration, Some(1_000));
        });
    }

    #[test]
    fn bridge_snapshot_marks_recent_client_connected() {
        let state = WebActivityRuntimeState::default();
        state.observe_active_tab(
            &BrowserActiveTabPayload {
                browser_client_id: Some("client".into()),
                browser_kind: Some("chrome".into()),
                extension_version: Some("0.1.0".into()),
                tab_id: Some(1),
                window_id: Some(1),
                url: Some("https://example.com".into()),
                title: Some("Example".into()),
                fav_icon_url: None,
                incognito: Some(false),
                captured_at_ms: Some(1_000),
                event_reason: Some("activated".into()),
            },
            1_000,
        );

        let snapshot = state.snapshot(
            &WebActivitySettings {
                enabled: true,
                token: "secret".into(),
            },
            2_000,
        );

        assert!(snapshot.connected);
        assert_eq!(snapshot.browser_kind.as_deref(), Some("chrome"));
    }

    #[test]
    fn reset_client_clears_recent_bridge_connection() {
        let state = WebActivityRuntimeState::default();
        state.observe_active_tab(
            &BrowserActiveTabPayload {
                browser_client_id: Some("client".into()),
                browser_kind: Some("chrome".into()),
                extension_version: Some("0.1.0".into()),
                tab_id: Some(1),
                window_id: Some(1),
                url: Some("https://example.com".into()),
                title: Some("Example".into()),
                fav_icon_url: None,
                incognito: Some(false),
                captured_at_ms: Some(1_000),
                event_reason: Some("activated".into()),
            },
            1_000,
        );

        state.reset_client();

        let snapshot = state.snapshot(
            &WebActivitySettings {
                enabled: true,
                token: "secret".into(),
            },
            2_000,
        );

        assert!(!snapshot.connected);
        assert_eq!(snapshot.browser_client_id, None);
        assert_eq!(snapshot.last_activity_at_ms, None);
    }
}
