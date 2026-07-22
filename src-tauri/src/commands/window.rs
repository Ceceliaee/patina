use crate::app::main_window;
use crate::commands::error::CommandErrorDto;
use serde::Serialize;
use tauri::{AppHandle, Manager, WebviewWindow};

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MainWindowReadyResultDto {
    outcome: &'static str,
    generation: u64,
}

#[tauri::command]
pub fn cmd_minimize_main_window(app: AppHandle) {
    main_window::minimize_main_window(&app);
}

#[tauri::command]
pub fn cmd_mark_main_window_ready(
    window: WebviewWindow,
    generation: u64,
) -> Result<MainWindowReadyResultDto, CommandErrorDto> {
    if window.label() != main_window::MAIN_WINDOW_LABEL {
        return Err(CommandErrorDto::new(
            "MAIN_WINDOW_READY_INVALID_CALLER",
            "only the main window can report main-window readiness",
            false,
        ));
    }

    let outcome = main_window::mark_main_window_ready(window.app_handle(), generation)
        .map_err(|error| CommandErrorDto::new("MAIN_WINDOW_READY_REVEAL_FAILED", error, true))?;

    Ok(MainWindowReadyResultDto {
        outcome: outcome.as_str(),
        generation,
    })
}
