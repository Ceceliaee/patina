use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, Runtime};

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ToolsSection {
    Pomodoro,
    Reminders,
}

#[derive(Default)]
pub(crate) struct ToolsNavigationState(Mutex<Option<ToolsSection>>);

impl ToolsNavigationState {
    pub(crate) fn take(&self) -> Option<ToolsSection> {
        self.0
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .take()
    }
}

pub(crate) fn open<R: Runtime>(app: &AppHandle<R>, section: ToolsSection) -> Result<(), String> {
    let state = app.state::<ToolsNavigationState>();
    *state.0.lock().unwrap_or_else(|error| error.into_inner()) = Some(section);
    if !super::show_main_window(app, super::MainWindowShowReason::Mini) {
        state.take();
        return Err("Could not open the main window".into());
    }
    // A cold main WebView consumes the pending target after subscribing.
    let _ = app.emit_to("main", "main-tools-target-changed", ());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn latest_target_survives_until_consumed_once() {
        let state = ToolsNavigationState::default();
        assert_eq!(state.take(), None);
        *state.0.lock().unwrap() = Some(ToolsSection::Pomodoro);
        *state.0.lock().unwrap() = Some(ToolsSection::Reminders);
        assert_eq!(state.take(), Some(ToolsSection::Reminders));
        assert_eq!(state.take(), None);
    }
}
