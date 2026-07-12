use std::sync::Arc;

use crate::app::{
    runtime,
    state::{
        AppExitState, AppRestartState, DesktopBehaviorState, MainWindowLifecycleState,
        WidgetWindowLifecycleState,
    },
    tray,
};
use crate::engine::{
    tools::{ToolsRuntimeState, ToolsRuntimeWakeState},
    tracking::{
        pause_state::TrackingPauseRuntimeState, runtime_snapshot::TrackingRuntimeSnapshotState,
        title_state::TitleRecordingRuntimeState, watchdog::RuntimeHealthState,
    },
    updater::UpdaterRuntimeState,
    web_activity::WebActivityRuntimeState,
};
use crate::{commands, data};
use tauri::Manager;

pub struct BootstrapInput {
    pub runtime_health: Arc<RuntimeHealthState>,
    pub launched_by_autostart: bool,
    pub app_version: String,
}

pub fn build(input: BootstrapInput) -> tauri::Builder<tauri::Wry> {
    let builder = register_single_instance_plugin(tauri::Builder::<tauri::Wry>::default());
    let builder = register_managed_state_and_plugins(
        builder,
        &input.app_version,
        input.runtime_health.clone(),
    );
    let builder = register_invoke_handlers(builder);
    register_runtime_hooks(builder, input.runtime_health, input.launched_by_autostart)
}

fn register_single_instance_plugin(
    builder: tauri::Builder<tauri::Wry>,
) -> tauri::Builder<tauri::Wry> {
    #[cfg(all(desktop, not(debug_assertions)))]
    {
        return builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            tray::show_main_window(app);
        }));
    }

    #[cfg(any(not(desktop), debug_assertions))]
    builder
}

fn register_managed_state_and_plugins(
    builder: tauri::Builder<tauri::Wry>,
    app_version: &str,
    runtime_health: Arc<RuntimeHealthState>,
) -> tauri::Builder<tauri::Wry> {
    builder
        .manage(DesktopBehaviorState::default())
        .manage(AppExitState::default())
        .manage(AppRestartState::default())
        .manage(MainWindowLifecycleState::default())
        .manage(WidgetWindowLifecycleState::default())
        .manage(TrackingRuntimeSnapshotState::default())
        .manage(TrackingPauseRuntimeState::default())
        .manage(TitleRecordingRuntimeState::default())
        .manage(runtime_health)
        .manage(ToolsRuntimeState::default())
        .manage(ToolsRuntimeWakeState::default())
        .manage(crate::platform::web_activity_bridge::WebActivityBridgeRuntimeState::default())
        .manage(crate::engine::remote_status_bridge::RemoteStatusBridgeRuntimeState::default())
        .manage(WebActivityRuntimeState::default())
        .manage(UpdaterRuntimeState::new(app_version.to_string()))
        .plugin(
            tauri_plugin_autostart::Builder::new()
                .args(vec![runtime::AUTOSTART_ARG.to_string()])
                .build(),
        )
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
}

fn register_invoke_handlers(builder: tauri::Builder<tauri::Wry>) -> tauri::Builder<tauri::Wry> {
    builder.invoke_handler(tauri::generate_handler![
        commands::apps::get_icon,
        commands::tracking::get_current_active_window,
        commands::tracking::get_current_tracking_snapshot,
        commands::tracking::cmd_get_tracker_health_snapshot,
        commands::tracking::cmd_set_afk_threshold,
        commands::settings::cmd_set_desktop_behavior,
        commands::settings::cmd_set_launch_behavior,
        commands::settings::cmd_set_background_optimization,
        commands::settings::cmd_commit_app_settings,
        commands::settings::cmd_commit_classification_settings,
        commands::export::cmd_pick_export_save_file,
        commands::export::cmd_export_data,
        commands::tools::cmd_get_tools_snapshot,
        commands::tools::cmd_get_tool_alerts,
        commands::tools::cmd_dismiss_tool_alert,
        commands::tools::cmd_create_reminder,
        commands::tools::cmd_cancel_reminder,
        commands::tools::cmd_create_software_reminder_rule,
        commands::tools::cmd_disable_software_reminder_rule,
        commands::tools::cmd_start_timer,
        commands::tools::cmd_pause_timer,
        commands::tools::cmd_resume_timer,
        commands::tools::cmd_reset_timer,
        commands::tools::cmd_add_timer_lap,
        commands::tools::cmd_start_pomodoro,
        commands::tools::cmd_pause_pomodoro,
        commands::tools::cmd_resume_pomodoro,
        commands::tools::cmd_skip_pomodoro_phase,
        commands::tools::cmd_reset_pomodoro,
        commands::widget::cmd_get_widget_icon_map,
        commands::widget::cmd_get_widget_icon,
        commands::widget::cmd_get_widget_placement,
        commands::widget::cmd_set_widget_placement,
        commands::widget::cmd_apply_widget_layout,
        commands::widget::cmd_set_widget_expanded,
        commands::widget::cmd_show_main_window,
        commands::widget::cmd_hide_widget_window,
        commands::widget::cmd_toggle_tracking_paused,
        commands::widget::cmd_show_widget_window,
        commands::widget::cmd_is_primary_mouse_button_down,
        commands::window::cmd_minimize_main_window,
        commands::update::cmd_get_update_snapshot,
        commands::update::cmd_check_for_updates,
        commands::update::cmd_download_update,
        commands::update::cmd_install_update,
        commands::web_activity::cmd_get_web_activity_bridge_snapshot,
        commands::backup::cmd_pick_backup_save_file,
        commands::backup::cmd_pick_backup_file,
        commands::backup::cmd_preview_backup,
        commands::backup::cmd_export_backup,
        commands::backup::cmd_restore_backup,
        commands::backup::cmd_save_webdav_backup_secret,
        commands::backup::cmd_delete_webdav_backup_secret,
        commands::backup::cmd_has_webdav_backup_secret,
        commands::backup::cmd_reveal_webdav_backup_secret,
        commands::backup::cmd_test_webdav_backup_target,
        commands::backup::cmd_upload_webdav_backup,
        commands::backup::cmd_list_webdav_backups,
        commands::backup::cmd_download_webdav_backup,
        commands::storage::cmd_get_storage_snapshot,
        commands::storage::cmd_pick_storage_directory,
        commands::storage::cmd_preview_storage_migration,
        commands::storage::cmd_preview_webview_cache_migration,
        commands::storage::cmd_preview_restore_default_storage_migration,
        commands::storage::cmd_preview_restore_default_webview_cache_migration,
        commands::storage::cmd_restart_and_apply_storage_migration,
        commands::storage::cmd_restart_and_apply_webview_cache_migration,
        commands::storage::cmd_restart_and_apply_restore_default_storage_migration,
        commands::storage::cmd_restart_and_apply_restore_default_webview_cache_migration,
        commands::storage::cmd_restart_and_clear_webview_cache,
        commands::storage::cmd_get_webview_cache_snapshot,
        commands::storage::cmd_open_storage_directory,
        commands::persistence::cmd_reopen_sqlite_pool,
        commands::persistence::cmd_delete_sessions_before,
        commands::persistence::cmd_clear_all_session_window_titles,
        commands::persistence::cmd_delete_sessions_by_exe_names,
        commands::persistence::cmd_delete_sessions_by_exe_names_between,
        commands::persistence::cmd_delete_web_activity_segments_before,
        commands::persistence::cmd_delete_web_activity_segments_by_domain,
        commands::persistence::cmd_save_remote_backup_settings,
        commands::persistence::cmd_save_remote_backup_remote_dir,
        commands::persistence::cmd_save_remote_backup_last_backup_at,
        commands::persistence::cmd_clear_remote_backup_settings,
        commands::persistence::cmd_save_data_bootstrap_snapshot_payload,
        commands::persistence::cmd_clear_data_bootstrap_snapshot_payload,
        commands::screenshots::cmd_get_screenshot_settings,
        commands::screenshots::cmd_set_screenshot_settings,
        commands::screenshots::cmd_query_screenshots,
        commands::screenshots::cmd_get_screenshot_data,
        commands::screenshots::cmd_get_screenshot_file_path,
        commands::screenshots::cmd_reveal_screenshot_in_folder,
        commands::diagnostics::cmd_get_resource_diagnostics,
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
            tauri::async_runtime::block_on(data::storage_migration::run_pending_storage_migration(
                app.handle(),
            ))
            .map_err(std::io::Error::other)?;
            tauri::async_runtime::block_on(data::sqlite_pool::initialize_app_sqlite(app.handle()))
                .map_err(std::io::Error::other)?;
            Ok(runtime::setup(
                app,
                runtime_health.clone(),
                launched_by_autostart,
            )?)
        })
}

pub(crate) fn handle_run_event(app: &tauri::AppHandle, event: tauri::RunEvent) {
    if let tauri::RunEvent::ExitRequested { api, .. } = event {
        let exit_requested = app.state::<AppExitState>().is_exit_requested();
        let keep_tray_visible = app
            .state::<DesktopBehaviorState>()
            .snapshot()
            .should_keep_tray_visible();

        if keep_tray_visible && !exit_requested {
            api.prevent_exit();
        }
    }
}
