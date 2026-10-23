use crate::engine::tracking::metadata;
use crate::engine::{tools, updater::UpdaterRuntimeState};
use crate::platform::web_activity_bridge;
use crate::platform::windows::{foreground, icon, resource};
use serde::Serialize;
use tauri::Manager;

#[derive(Clone, Debug, Serialize)]
pub struct ResourceDiagnosticsSnapshot {
    pub process_id: u32,
    pub database_timings: Vec<crate::data::sqlite_pool::diagnostics::Snapshot>,
    pub tracking_progress: crate::engine::tracking::watchdog::progress::TrackingProgressSnapshot,
    pub name_resolution: crate::engine::tracking::app_names::NameResolutionDiagnostics,
    pub webview_window_count: usize,
    pub webview_window_labels: Vec<String>,
    pub process_resources: resource::WindowsProcessResourceSnapshot,
    pub process_details_cache: foreground::ProcessDetailsCacheStats,
    pub icon_result_cache: icon::IconResultCacheStats,
    pub icon_negative_cache: metadata::IconNegativeCacheStats,
    pub tool_alerts: tools::ToolAlertQueueStats,
    pub updater_retained_package: crate::engine::updater::UpdaterRetainedPackageStats,
    pub web_activity_bridge: web_activity_bridge::WebActivityBridgeConnectionStats,
    pub native_probes: Vec<crate::platform::windows::native_probe::NativeProbeDiagnostics>,
    pub diagnostic_output_counts: Option<(u64, u64)>,
    pub webview_recovery: Vec<crate::app::webview_recovery::WebviewRecoverySnapshot>,
}

#[tauri::command]
pub fn cmd_get_resource_diagnostics(app: tauri::AppHandle) -> ResourceDiagnosticsSnapshot {
    #[cfg(patina_coverage)]
    crate::flush_coverage();
    let webview_window_labels = app
        .webview_windows()
        .keys()
        .cloned()
        .collect::<Vec<String>>();

    ResourceDiagnosticsSnapshot {
        process_id: std::process::id(),
        database_timings: crate::data::sqlite_pool::diagnostics::snapshot(),
        tracking_progress: app
            .state::<std::sync::Arc<crate::engine::tracking::watchdog::RuntimeHealthState>>()
            .progress
            .snapshot(),
        name_resolution: crate::engine::tracking::app_names::diagnostics(),
        webview_recovery: app
            .state::<crate::app::webview_recovery::WebviewRecoveryState>()
            .snapshot(),
        diagnostic_output_counts: app
            .try_state::<crate::platform::runtime_diagnostics::RuntimeDiagnostics>()
            .map(|state| state.output_counts()),
        native_probes: crate::platform::windows::native_probe::diagnostics(),
        webview_window_count: webview_window_labels.len(),
        webview_window_labels,
        process_resources: resource::current_process_resource_snapshot(),
        process_details_cache: foreground::process_details_cache_stats(),
        icon_result_cache: icon::icon_result_cache_stats(),
        icon_negative_cache: metadata::icon_negative_cache_stats(now_ms()),
        tool_alerts: tools::alert_queue_stats(&app),
        updater_retained_package: app
            .try_state::<UpdaterRuntimeState>()
            .map(|state| state.retained_package_stats())
            .unwrap_or(crate::engine::updater::UpdaterRetainedPackageStats {
                retained: false,
                storage: None,
                size_bytes: None,
            }),
        web_activity_bridge: app
            .try_state::<web_activity_bridge::WebActivityBridgeRuntimeState>()
            .map(|state| state.connection_stats())
            .unwrap_or_else(web_activity_bridge::inactive_connection_stats),
    }
}

fn now_ms() -> i64 {
    crate::platform::clock::unix_timestamp_millis_i64()
}
