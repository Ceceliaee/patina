use crate::data::repositories::web_activity::{
    end_active_segment, load_domain_recording_enabled, upsert_active_segment,
    WebActivitySegmentInput,
};
use crate::data::{app_settings_service, sqlite_pool::wait_for_sqlite_pool};
use crate::domain::settings::WebActivitySettings;
use crate::domain::web_activity::{
    is_supported_browser_exe, sanitize_active_tab_payload, sanitize_browser_client_id,
    sanitize_browser_kind, sanitize_extension_version, BrowserActiveTabPayload,
    WebActivityBridgeSnapshot,
};
use crate::engine::tracking::runtime_snapshot::TrackingRuntimeSnapshotState;
use sqlx::{Pool, Row, Sqlite};
use std::sync::Mutex;
use tauri::{AppHandle, Manager, Runtime};

const BROWSER_BRIDGE_CONNECTED_WINDOW_MS: i64 = 30_000;

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
    pool: &Pool<Sqlite>,
    settings: &WebActivitySettings,
    payload: BrowserActiveTabPayload,
    now_ms: i64,
) -> Result<bool, String> {
    if let Some(state) = app.try_state::<WebActivityRuntimeState>() {
        state.observe_active_tab(&payload, now_ms);
    }

    if !settings.enabled {
        return seal_active_segment(pool, now_ms).await;
    }

    let Some(sanitized) = sanitize_active_tab_payload(payload)? else {
        return seal_active_segment(pool, now_ms).await;
    };
    if !load_domain_recording_enabled(pool, &sanitized.normalized_domain)
        .await
        .map_err(|error| format!("failed to load web domain override: {error}"))?
    {
        return seal_active_segment(pool, now_ms).await;
    }

    // Check domain blacklist
    if is_blacklisted_domain(app, &sanitized.normalized_domain).await {
        return seal_active_segment(pool, now_ms).await;
    }

    let Some(snapshot) = app
        .try_state::<TrackingRuntimeSnapshotState>()
        .and_then(|state| state.snapshot())
    else {
        return seal_active_segment(pool, now_ms).await;
    };
    if !snapshot.status.is_tracking_active
        || snapshot.window.is_afk
        || !is_supported_browser_exe(&snapshot.window.exe_name)
    {
        return seal_active_segment(pool, now_ms).await;
    }

    let input = WebActivitySegmentInput::from_sanitized(
        sanitized,
        snapshot.window.exe_name.trim().to_ascii_lowercase(),
    );

    // Apply privacy mode: strip url, title, favicon before storing
    let privacy = app_settings_service::load_privacy_settings(app).await.unwrap_or_default();
    let input = if privacy.privacy_mode {
        WebActivitySegmentInput {
            url: None,
            title: None,
            favicon_url: None,
            ..input
        }
    } else {
        input
    };

    upsert_active_segment(pool, &input, now_ms)
        .await
        .map_err(|error| format!("failed to save web activity: {error}"))
}

pub async fn load_runtime_settings<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<WebActivitySettings, String> {
    app_settings_service::load_web_activity_settings(app).await
}

pub async fn record_active_tab_for_app<R: Runtime>(
    app: &AppHandle<R>,
    settings: &WebActivitySettings,
    payload: BrowserActiveTabPayload,
    now_ms: i64,
) -> Result<bool, String> {
    let pool = wait_for_sqlite_pool(app).await?;
    record_active_tab(app, &pool, settings, payload, now_ms).await
}

pub async fn seal_active_segment_for_app<R: Runtime>(
    app: &AppHandle<R>,
    now_ms: i64,
) -> Result<bool, String> {
    let pool = wait_for_sqlite_pool(app).await?;
    seal_active_segment(&pool, now_ms).await
}

pub async fn seal_if_tracking_inactive_for_app<R: Runtime>(
    app: &AppHandle<R>,
    now_ms: i64,
) -> Result<bool, String> {
    let pool = wait_for_sqlite_pool(app).await?;
    seal_if_tracking_inactive(app, &pool, now_ms).await
}

pub async fn seal_if_tracking_inactive<R: Runtime>(
    app: &tauri::AppHandle<R>,
    pool: &Pool<Sqlite>,
    now_ms: i64,
) -> Result<bool, String> {
    let should_seal = app
        .try_state::<TrackingRuntimeSnapshotState>()
        .and_then(|state| state.snapshot())
        .map(|snapshot| {
            !snapshot.status.is_tracking_active
                || snapshot.window.is_afk
                || !is_supported_browser_exe(&snapshot.window.exe_name)
        })
        .unwrap_or(true);

    if should_seal {
        return seal_active_segment(pool, now_ms).await;
    }

    Ok(false)
}

pub async fn seal_active_segment(pool: &Pool<Sqlite>, now_ms: i64) -> Result<bool, String> {
    end_active_segment(pool, now_ms)
        .await
        .map_err(|error| format!("failed to seal web activity: {error}"))
}

/// Check if a domain is in the blacklist (stored as JSON array in settings)
async fn is_blacklisted_domain<R: Runtime>(app: &AppHandle<R>, domain: &str) -> bool {
    let pool = match wait_for_sqlite_pool(app).await {
        Ok(p) => p,
        Err(_) => return false,
    };
    let row = sqlx::query("SELECT value FROM settings WHERE key = 'blacklisted_domains'")
        .fetch_optional(&pool)
        .await
        .ok()
        .flatten();
    let raw = row.map(|r| r.get::<String, _>("value"));
    let Some(raw) = raw else { return false };
    if raw.is_empty() { return false; }
    let domains: Vec<String> = match serde_json::from_str(&raw) {
        Ok(d) => d,
        Err(_) => return false,
    };
    let lower = domain.to_lowercase();
    domains.iter().any(|d| d.to_lowercase() == lower)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::data::schema as db_schema;
    use sqlx::{Executor, SqlitePool};

    async fn setup_test_db() -> SqlitePool {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        pool.execute(db_schema::CURRENT_BASELINE_SCHEMA_SQL)
            .await
            .unwrap();
        pool.execute(db_schema::WEB_ACTIVITY_SCHEMA_SQL)
            .await
            .unwrap();
        pool
    }

    #[test]
    fn inactive_settings_seal_existing_web_segment() {
        tauri::async_runtime::block_on(async {
            let pool = setup_test_db().await;
            let input = WebActivitySegmentInput {
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
            assert!(seal_active_segment(&pool, 2_000).await.unwrap());

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
