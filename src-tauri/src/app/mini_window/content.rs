use crate::domain::mini_window::content::{self, MiniStatusSnapshot};
use crate::domain::tracking::{ActiveSessionSnapshot, TrackingStatusSnapshot};
use crate::engine::tools::ToolsRuntimeState;
use crate::engine::tracking::runtime_snapshot::{
    TrackingRuntimeProbeStatus, TrackingRuntimeSnapshotState,
};
use crate::platform::windows::foreground::WindowInfo;
use serde::Serialize;
use tauri::{AppHandle, Manager, Runtime};

#[derive(Clone, Debug, Serialize)]
pub(crate) struct MiniPresentationSnapshot {
    pub tracking_paused: bool,
    pub window: WindowInfo,
    pub tracking_status: TrackingStatusSnapshot,
    pub tracking_sampled_at_ms: i64,
    pub tracking_probe_status: TrackingRuntimeProbeStatus,
    pub status: MiniStatusSnapshot,
}

pub(crate) async fn get_mini_presentation_snapshot<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<MiniPresentationSnapshot, String> {
    let state = app.state::<TrackingRuntimeSnapshotState>();
    let _transition = state.transition.lock().await;
    let tracking_paused =
        crate::data::tracking_pause_service::load_tracking_pause_setting(app).await?;
    let tracking = state
        .snapshot()
        .ok_or_else(|| "tracking runtime snapshot is not ready".to_string())?;
    if !mini_tracking_identity_is_consistent(&tracking.window, tracking.active_session.as_ref()) {
        return Err("mini presentation snapshot is settling".to_string());
    }
    let tools = app.state::<ToolsRuntimeState>().snapshot();
    let status = content::build_mini_status_snapshot(
        tracking.active_session,
        tools,
        chrono::Utc::now().timestamp_millis(),
    );

    Ok(MiniPresentationSnapshot {
        tracking_paused,
        window: tracking.window,
        tracking_status: tracking.status,
        tracking_sampled_at_ms: tracking.sampled_at_ms,
        tracking_probe_status: tracking.probe_status,
        status,
    })
}

fn mini_tracking_identity_is_consistent(
    window: &WindowInfo,
    active_session: Option<&ActiveSessionSnapshot>,
) -> bool {
    active_session.is_none_or(|session| {
        session
            .exe_name
            .trim()
            .eq_ignore_ascii_case(window.exe_name.trim())
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn tracking_window(exe_name: &str) -> WindowInfo {
        WindowInfo {
            hwnd: "0x100".into(),
            root_owner_hwnd: "0x100".into(),
            process_id: 123,
            window_class: "Chrome_WidgetWin_1".into(),
            title: "Window".into(),
            exe_name: exe_name.into(),
            process_path: format!(r"C:\Program Files\{exe_name}"),
            app_user_model_id: String::new(),
            is_afk: false,
            idle_time_ms: 0,
        }
    }

    fn active_session(exe_name: &str) -> ActiveSessionSnapshot {
        ActiveSessionSnapshot {
            id: 1,
            app_name: exe_name.trim_end_matches(".exe").into(),
            exe_name: exe_name.into(),
            start_time: 1_000,
            continuity_group_start_time: 1_000,
            closed_duration_ms: 0,
        }
    }

    #[test]
    fn mini_presentation_rejects_cross_application_snapshot_tearing() {
        let codex = tracking_window("ChatGPT.exe");
        let pixpin = active_session("PixPin.exe");
        let matching = active_session("chatgpt.EXE");

        assert!(!mini_tracking_identity_is_consistent(&codex, Some(&pixpin)));
        assert!(mini_tracking_identity_is_consistent(
            &codex,
            Some(&matching)
        ));
        assert!(mini_tracking_identity_is_consistent(&codex, None));
    }
}
