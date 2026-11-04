use crate::domain::mini_window::content::{self, MiniStatusSnapshot, MiniToolKind, MiniToolState};
use crate::domain::tracking::TrackingStatusSnapshot;
use crate::engine::tools::ToolsRuntimeState;
use crate::engine::tracking::runtime_snapshot::{
    TrackingRuntimeProbeStatus, TrackingRuntimeSnapshotState,
};
use crate::platform::windows::foreground::WindowInfo;
use serde::Serialize;
use tauri::{AppHandle, Manager, Runtime};

pub(super) fn current_status<R: Runtime>(app: &AppHandle<R>) -> MiniStatusSnapshot {
    content::build_mini_status_snapshot(
        app.state::<ToolsRuntimeState>().snapshot(),
        chrono::Utc::now().timestamp_millis(),
    )
}

pub(super) async fn control_tool<R: Runtime>(
    app: &AppHandle<R>,
    kind: MiniToolKind,
    id: i64,
    resume: bool,
) -> Result<(), String> {
    let status = current_status(app);
    let expected = if resume {
        MiniToolState::Paused
    } else {
        MiniToolState::Running
    };
    if !status
        .tools
        .iter()
        .any(|tool| tool.kind == kind && tool.id == id && tool.state == expected)
    {
        return Err("Mini tool state changed".into());
    }
    match kind {
        MiniToolKind::Pomodoro => {
            use crate::domain::tools::PomodoroTaskAction;
            super::super::tools::pomodoro_task(
                app,
                if resume {
                    PomodoroTaskAction::Resume { id }
                } else {
                    PomodoroTaskAction::Pause { id }
                },
            )
            .await?;
        }
        MiniToolKind::FreeFocus => {
            use crate::domain::free_focus::FreeFocusAction;
            super::super::tools::free_focus(
                app,
                if resume {
                    FreeFocusAction::Resume { id }
                } else {
                    FreeFocusAction::Pause { id }
                },
            )
            .await?;
        }
    }
    Ok(())
}

#[derive(Clone, Debug, Serialize)]
pub(crate) struct MiniPresentationSnapshot {
    pub tracking_paused: bool,
    pub window: WindowInfo,
    pub tracking_status: TrackingStatusSnapshot,
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
    let status = current_status(app);

    Ok(MiniPresentationSnapshot {
        tracking_paused,
        window: tracking.window,
        tracking_status: tracking.status,
        tracking_probe_status: tracking.probe_status,
        status,
    })
}
