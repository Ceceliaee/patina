use super::{apply_mutation_and_refresh, now_ms, send_tool_alert, ToolsMutation, ToolsStore};
use crate::domain::{
    free_focus::{FreeFocusAction, FreeFocusTask},
    localization::{self, Locale, LocalizationState},
    tools::{ToolAlert, ToolAlertKind, ToolsRuntimeSnapshot},
};
use tauri::{AppHandle, Manager, Runtime};

pub async fn action<R: Runtime>(
    app: &AppHandle<R>,
    store: &impl ToolsStore,
    action: FreeFocusAction,
) -> Result<ToolsRuntimeSnapshot, String> {
    let finished = if let FreeFocusAction::Finish { id } = &action {
        Some(*id)
    } else {
        None
    };
    let now = now_ms();
    let snapshot =
        apply_mutation_and_refresh(app, store, ToolsMutation::FreeFocus(action), now).await?;
    if let Some(task) =
        finished.and_then(|id| snapshot.free_focus_tasks.iter().find(|t| t.id == id))
    {
        send_tool_alert(
            app,
            completion_alert(task.clone(), app.state::<LocalizationState>().locale(), now),
        );
    }
    Ok(snapshot)
}

pub(super) fn completion_alert(task: FreeFocusTask, locale: Locale, now: i64) -> ToolAlert {
    ToolAlert {
        id: format!("free-focus:{}:{}", task.id, task.updated_at),
        kind: ToolAlertKind::FreeFocus,
        title: if task.label.is_empty() {
            localization::text(locale, "native.tools.freeFocusTitle")
        } else {
            task.label.clone()
        },
        body: localization::text(
            locale,
            if task.phase == "break" {
                "native.tools.focusEnded"
            } else {
                "native.tools.breakEnded"
            },
        ),
        occurred_at: now,
        free_focus: Some(task),
        pomodoro: None,
        activity_reminder: None,
    }
}
