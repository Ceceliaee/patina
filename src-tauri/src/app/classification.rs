use crate::data::classification_service::{
    apply_recording_policy_changes as apply_recording_policy_changes_in_data,
    ClassificationCommitOutcome,
};
use crate::domain::tracking::{
    TRACKING_REASON_APP_EXCLUDED_SEALED, TRACKING_REASON_WEB_DOMAIN_EXCLUDED_SEALED,
};
use crate::engine::tracking::runtime::emit_tracking_data_changed;
use tauri::{AppHandle, Manager, Runtime};

pub async fn apply_recording_policy_changes<R: Runtime>(
    app: &AppHandle<R>,
    outcome: &ClassificationCommitOutcome,
) -> Result<(), String> {
    let changed_at_ms = now_ms();
    if !outcome.app_title_changes.is_empty() {
        if let Some(state) =
            app.try_state::<crate::engine::tracking::title_state::TitleRecordingRuntimeState>()
        {
            state.invalidate_app_overrides();
        }
    }
    let applied = apply_recording_policy_changes_in_data(app, outcome, changed_at_ms).await?;

    if applied.app_sealed {
        let _ = emit_tracking_data_changed(
            app,
            TRACKING_REASON_APP_EXCLUDED_SEALED,
            changed_at_ms as u64,
        );
    }
    if applied.web_sealed {
        let _ = emit_tracking_data_changed(
            app,
            TRACKING_REASON_WEB_DOMAIN_EXCLUDED_SEALED,
            changed_at_ms as u64,
        );
    }
    Ok(())
}

fn now_ms() -> i64 {
    crate::platform::clock::unix_timestamp_millis_i64()
}
