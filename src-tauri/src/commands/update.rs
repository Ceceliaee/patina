use tauri::{AppHandle, State};

use crate::app::updater;
use crate::domain::update::UpdateSnapshot;
use crate::engine::updater::UpdaterRuntimeState;

#[tauri::command]
pub fn cmd_get_update_snapshot(update_state: State<'_, UpdaterRuntimeState>) -> UpdateSnapshot {
    update_state.snapshot()
}

#[tauri::command]
pub async fn cmd_check_for_updates(
    app: AppHandle,
    update_state: State<'_, UpdaterRuntimeState>,
    silent: bool,
) -> Result<UpdateSnapshot, String> {
    updater::check_for_updates(&app, &update_state, silent).await
}

#[tauri::command]
pub async fn cmd_download_update(
    app: AppHandle,
    update_state: State<'_, UpdaterRuntimeState>,
) -> Result<UpdateSnapshot, String> {
    updater::download_pending(&app, &update_state).await
}

#[tauri::command]
pub async fn cmd_install_update(
    app: AppHandle,
    update_state: State<'_, UpdaterRuntimeState>,
) -> Result<UpdateSnapshot, String> {
    updater::install_downloaded(&app, &update_state).await
}
