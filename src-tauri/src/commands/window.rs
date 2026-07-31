use crate::app::main_window;
use crate::app::state::MainWindowRenderToken;
use crate::commands::error::CommandErrorDto;
use serde::Serialize;
use tauri::{AppHandle, Manager, WebviewWindow};

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MainWindowReadyResultDto {
    outcome: &'static str,
    generation: u64,
    load_epoch: u64,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MainWindowRenderTokenDto {
    generation: u64,
    load_epoch: u64,
}

#[tauri::command]
pub async fn cmd_minimize_main_window(app: AppHandle) -> Result<(), CommandErrorDto> {
    main_window::minimize_main_window(&app)
        .await
        .map_err(|error| CommandErrorDto::new("MAIN_WINDOW_MINIMIZE_FAILED", error, true))
}

#[tauri::command]
pub fn cmd_get_main_window_render_token(
    window: WebviewWindow,
) -> Result<MainWindowRenderTokenDto, CommandErrorDto> {
    if window.label() != main_window::MAIN_WINDOW_LABEL {
        return Err(CommandErrorDto::new(
            "MAIN_WINDOW_READY_INVALID_CALLER",
            "only the main window can read main-window render state",
            false,
        ));
    }

    let token =
        main_window::current_main_window_render_token(window.app_handle()).ok_or_else(|| {
            CommandErrorDto::new(
                "MAIN_WINDOW_READY_UNAVAILABLE",
                "main-window render state is unavailable",
                true,
            )
        })?;

    Ok(MainWindowRenderTokenDto {
        generation: token.generation,
        load_epoch: token.load_epoch,
    })
}

#[tauri::command]
pub fn cmd_mark_main_window_ready(
    window: WebviewWindow,
    generation: u64,
    load_epoch: u64,
) -> Result<MainWindowReadyResultDto, CommandErrorDto> {
    if window.label() != main_window::MAIN_WINDOW_LABEL {
        return Err(CommandErrorDto::new(
            "MAIN_WINDOW_READY_INVALID_CALLER",
            "only the main window can report main-window readiness",
            false,
        ));
    }

    let token = MainWindowRenderToken {
        generation,
        load_epoch,
    };
    let outcome = main_window::mark_main_window_ready(window.app_handle(), token)
        .map_err(|error| CommandErrorDto::new("MAIN_WINDOW_READY_REVEAL_FAILED", error, true))?;

    Ok(MainWindowReadyResultDto {
        outcome: outcome.as_str(),
        generation,
        load_epoch,
    })
}
