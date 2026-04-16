use std::sync::Arc;

use crate::app::{runtime, state::DesktopBehaviorState, tray};
use crate::engine::{tracking::watchdog::RuntimeHealthState, updater::UpdaterRuntimeState};
use crate::{commands, data};

pub struct BootstrapInput {
    pub runtime_health: Arc<RuntimeHealthState>,
    pub launched_by_autostart: bool,
    pub app_version: String,
}

pub fn build(input: BootstrapInput) -> tauri::Builder<tauri::Wry> {
    let builder = register_single_instance_plugin(tauri::Builder::<tauri::Wry>::default());
    let builder = register_managed_state_and_plugins(builder, &input.app_version);
    let builder = register_invoke_handlers(builder);
    register_runtime_hooks(builder, input.runtime_health, input.launched_by_autostart)
}

fn register_single_instance_plugin(
    mut builder: tauri::Builder<tauri::Wry>,
) -> tauri::Builder<tauri::Wry> {
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            tray::show_main_window(app);
        }));
    }

    builder
}

fn register_managed_state_and_plugins(
    builder: tauri::Builder<tauri::Wry>,
    app_version: &str,
) -> tauri::Builder<tauri::Wry> {
    builder
        .manage(DesktopBehaviorState::default())
        .manage(UpdaterRuntimeState::new(app_version.to_string()))
        .plugin(
            tauri_plugin_autostart::Builder::new()
                .args(vec![runtime::AUTOSTART_ARG.to_string()])
                .build(),
        )
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations(
                    data::sqlite_pool::SQLITE_DB_NAME,
                    data::migrations::tracker_migrations(),
                )
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
}

fn register_invoke_handlers(builder: tauri::Builder<tauri::Wry>) -> tauri::Builder<tauri::Wry> {
    builder.invoke_handler(tauri::generate_handler![
        commands::apps::get_icon,
        commands::tracking::get_current_active_window,
        commands::tracking::cmd_set_idle_timeout,
        commands::settings::cmd_set_desktop_behavior,
        commands::settings::cmd_set_launch_behavior,
        commands::update::cmd_get_update_snapshot,
        commands::update::cmd_check_for_updates,
        commands::update::cmd_download_update,
        commands::update::cmd_install_update,
        commands::backup::cmd_pick_backup_save_file,
        commands::backup::cmd_pick_backup_file,
        commands::backup::cmd_preview_backup,
        commands::backup::cmd_export_backup,
        commands::backup::cmd_restore_backup
    ])
}

fn register_runtime_hooks(
    builder: tauri::Builder<tauri::Wry>,
    runtime_health: Arc<RuntimeHealthState>,
    launched_by_autostart: bool,
) -> tauri::Builder<tauri::Wry> {
    builder
        .on_menu_event(tray::handle_menu_event)
        .on_tray_icon_event(tray::handle_tray_icon_event)
        .on_window_event(tray::handle_window_event)
        .setup(move |app| {
            Ok(runtime::setup(
                app,
                runtime_health.clone(),
                launched_by_autostart,
            )?)
        })
}
