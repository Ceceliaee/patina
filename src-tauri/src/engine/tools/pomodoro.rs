use super::{apply_mutation_and_refresh, now_ms, StartPomodoroRequest, ToolsMutation, ToolsStore};
use crate::domain::localization::{self, Locale};
use crate::domain::tools::{
    CompletedPomodoroNotification, PomodoroPhase, ToolAlert, ToolAlertKind, ToolsRuntimeSnapshot,
};
use tauri::{AppHandle, Runtime};

pub async fn start_pomodoro<R: Runtime>(
    app: &AppHandle<R>,
    store: &impl ToolsStore,
    request: StartPomodoroRequest,
) -> Result<ToolsRuntimeSnapshot, String> {
    apply_mutation_and_refresh(app, store, ToolsMutation::StartPomodoro(request), now_ms()).await
}

pub async fn pomodoro_task<R: Runtime>(
    app: &AppHandle<R>,
    store: &impl ToolsStore,
    action: crate::domain::tools::PomodoroTaskAction,
) -> Result<ToolsRuntimeSnapshot, String> {
    apply_mutation_and_refresh(app, store, ToolsMutation::PomodoroTask(action), now_ms()).await
}

pub async fn pause_pomodoro<R: Runtime>(
    app: &AppHandle<R>,
    store: &impl ToolsStore,
) -> Result<ToolsRuntimeSnapshot, String> {
    apply_mutation_and_refresh(app, store, ToolsMutation::PausePomodoro, now_ms()).await
}

pub async fn resume_pomodoro<R: Runtime>(
    app: &AppHandle<R>,
    store: &impl ToolsStore,
) -> Result<ToolsRuntimeSnapshot, String> {
    apply_mutation_and_refresh(app, store, ToolsMutation::ResumePomodoro, now_ms()).await
}

pub async fn skip_pomodoro_phase<R: Runtime>(
    app: &AppHandle<R>,
    store: &impl ToolsStore,
) -> Result<ToolsRuntimeSnapshot, String> {
    apply_mutation_and_refresh(app, store, ToolsMutation::SkipPomodoroPhase, now_ms()).await
}

pub async fn reset_pomodoro<R: Runtime>(
    app: &AppHandle<R>,
    store: &impl ToolsStore,
) -> Result<ToolsRuntimeSnapshot, String> {
    apply_mutation_and_refresh(app, store, ToolsMutation::ResetPomodoro, now_ms()).await
}

pub(super) fn completion_alert(
    completed_phase: CompletedPomodoroNotification,
    locale: Locale,
    now: i64,
) -> ToolAlert {
    let title_key = match completed_phase.completed_phase {
        PomodoroPhase::Focus => "native.tools.focusEnded",
        PomodoroPhase::ShortBreak => "native.tools.breakEnded",
        PomodoroPhase::LongBreak => "native.tools.pomodoroGroupCompleted",
    };
    let body_key = if completed_phase.completed_phase == PomodoroPhase::LongBreak {
        "native.tools.pomodoroGroupRestart"
    } else {
        match completed_phase.next_phase {
            PomodoroPhase::Focus => "native.tools.nextFocus",
            PomodoroPhase::ShortBreak => "native.tools.nextShortBreak",
            PomodoroPhase::LongBreak => "native.tools.nextLongBreak",
        }
    };
    let label = &completed_phase.task.label;
    let body = localization::text(locale, body_key);
    ToolAlert {
        id: format!(
            "pomodoro:{}:{}:{}:{now}",
            completed_phase.run_id,
            completed_phase.completed_focus_count,
            completed_phase.completed_phase.as_str()
        ),
        kind: ToolAlertKind::Pomodoro,
        title: if label.is_empty() {
            localization::text(locale, title_key)
        } else {
            format!("{label} · {}", localization::text(locale, title_key))
        },
        body,
        free_focus: None,
        pomodoro: Some(completed_phase.task),
        occurred_at: now,
        activity_reminder: None,
    }
}
