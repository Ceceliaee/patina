use crate::app::main_window;
use crate::app::runtime::now_ms;
use crate::app::state::{AppExitState, DesktopBehaviorState};
use crate::app::widget;
use crate::data::tracking_pause_service;
use crate::domain::settings::{CloseBehavior, DesktopBehaviorSettings};
use crate::engine::tracking::{
    pause_state::TrackingPauseRuntimeState, runtime as tracking_runtime,
};
use tauri::{
    menu::{Menu, MenuEvent, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, Runtime, Window, WindowEvent,
};

pub(crate) use crate::app::main_window::MAIN_WINDOW_LABEL;
const TRAY_ID: &str = "main";
const TRAY_MENU_SHOW_ID: &str = "tray-show-main";
const TRAY_MENU_TOGGLE_PAUSE_ID: &str = "tray-toggle-pause";
const TRAY_MENU_QUIT_ID: &str = "tray-quit";
const TRAY_MENU_SHOW_LABEL: &str = "打开主界面";
const TRAY_MENU_PAUSE_LABEL: &str = "暂停追踪";
const TRAY_MENU_RESUME_LABEL: &str = "恢复追踪";
const TRAY_MENU_QUIT_LABEL: &str = "退出应用";

fn tracking_pause_menu_label(tracking_paused: bool) -> &'static str {
    if tracking_paused {
        TRAY_MENU_RESUME_LABEL
    } else {
        TRAY_MENU_PAUSE_LABEL
    }
}

fn should_redirect_close_to_tray(settings: DesktopBehaviorSettings, exit_requested: bool) -> bool {
    !exit_requested
        && settings.close_behavior == CloseBehavior::Tray
        && settings.should_keep_tray_visible()
}

pub(crate) fn show_main_window<R: Runtime + 'static>(app: &AppHandle<R>) {
    main_window::show_main_window(app);
}

pub(crate) fn apply_tray_visibility<R: Runtime>(
    app: &AppHandle<R>,
    settings: DesktopBehaviorSettings,
) {
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        if let Err(error) = tray.set_visible(settings.should_keep_tray_visible()) {
            eprintln!("[tray] failed to apply visibility: {error}");
        }
    }
}

pub(crate) async fn toggle_tracking_paused<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    let change = tracking_pause_service::toggle_tracking_pause_setting(&app).await?;

    apply_tracking_pause_setting_change(&app, change.tracking_paused, change.reason)
}

pub(crate) fn apply_tracking_pause_setting_change<R: Runtime>(
    app: &AppHandle<R>,
    tracking_paused: bool,
    reason: &'static str,
) -> Result<(), String> {
    update_tracking_pause_runtime_state(app, tracking_paused);
    if let Err(error) = apply_tracking_pause_menu_label(app, tracking_paused) {
        eprintln!("[tray] failed to update tracking pause menu label: {error}");
    }
    tracking_runtime::emit_tracking_data_changed(app, reason, now_ms())
        .map_err(|error| format!("failed to emit tracking pause event: {error}"))?;

    Ok(())
}

pub(crate) fn tracking_pause_event_reason(tracking_paused: bool) -> &'static str {
    tracking_pause_service::tracking_pause_event_reason(tracking_paused)
}

fn update_tracking_pause_runtime_state<R: Runtime>(app: &AppHandle<R>, tracking_paused: bool) {
    if let Some(state) = app.try_state::<TrackingPauseRuntimeState>() {
        state.set_after_write(tracking_paused, now_ms() as i64);
    }
}

fn apply_tracking_pause_menu_label<R: Runtime>(
    app: &AppHandle<R>,
    tracking_paused: bool,
) -> tauri::Result<()> {
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        let menu = build_tray_menu(app, tracking_paused)?;
        tray.set_menu(Some(menu))?;
    }

    Ok(())
}

pub(crate) fn handle_menu_event<R: Runtime>(app: &AppHandle<R>, event: MenuEvent) {
    if event.id() == TRAY_MENU_SHOW_ID {
        show_main_window(app);
        return;
    }

    if event.id() == TRAY_MENU_TOGGLE_PAUSE_ID {
        let app_handle = app.clone();
        tauri::async_runtime::spawn(async move {
            if let Err(error) = toggle_tracking_paused(app_handle).await {
                eprintln!("[tray] failed to toggle tracking pause: {error}");
            }
        });
        return;
    }

    if event.id() == TRAY_MENU_QUIT_ID {
        app.state::<AppExitState>().request_exit();
        app.exit(0);
    }
}

pub(crate) fn handle_tray_icon_event<R: Runtime>(app: &AppHandle<R>, event: TrayIconEvent) {
    match event {
        TrayIconEvent::Click {
            button: MouseButton::Left,
            button_state: MouseButtonState::Up,
            ..
        }
        | TrayIconEvent::DoubleClick {
            button: MouseButton::Left,
            ..
        } => {
            show_main_window(app);
        }
        _ => {}
    }
}

pub(crate) fn handle_window_event<R: Runtime>(window: &Window<R>, event: &WindowEvent) {
    if window.label() == widget::WIDGET_WINDOW_LABEL {
        if let WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            show_main_window(window.app_handle());
        }
        return;
    }

    if window.label() != MAIN_WINDOW_LABEL {
        return;
    }

    let app = window.app_handle();

    if matches!(event, WindowEvent::Focused(true)) && window.is_visible().unwrap_or(false) {
        widget::close_widget_window(app);
        return;
    }

    let state = app.state::<DesktopBehaviorState>();
    let settings = state.snapshot();
    let exit_requested = app.state::<AppExitState>().is_exit_requested();

    if let WindowEvent::CloseRequested { api, .. } = event {
        if should_redirect_close_to_tray(settings, exit_requested) {
            api.prevent_close();
            widget::close_widget_window(app);
            main_window::hide_main_window_for_background(app, window);
        }
    }
}

pub(crate) fn setup_tray<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let tracking_paused =
        tauri::async_runtime::block_on(tracking_pause_service::load_tracking_pause_setting(app))
            .unwrap_or_else(|error| {
                eprintln!("[tray] failed to initialize tracking pause menu label: {error}");
                false
            });
    update_tracking_pause_runtime_state(app, tracking_paused);

    let menu = build_tray_menu(app, tracking_paused)?;

    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .menu(&menu)
        .tooltip("Patina")
        .show_menu_on_left_click(false);

    if let Some(icon) = app.default_window_icon().cloned() {
        builder = builder.icon(icon);
    }

    builder.build(app)?;
    Ok(())
}

fn build_tray_menu<R: Runtime>(
    app: &AppHandle<R>,
    tracking_paused: bool,
) -> tauri::Result<Menu<R>> {
    let open_item = MenuItem::with_id(
        app,
        TRAY_MENU_SHOW_ID,
        TRAY_MENU_SHOW_LABEL,
        true,
        None::<&str>,
    )?;
    let toggle_pause_item = MenuItem::with_id(
        app,
        TRAY_MENU_TOGGLE_PAUSE_ID,
        tracking_pause_menu_label(tracking_paused),
        true,
        None::<&str>,
    )?;
    let quit_item = MenuItem::with_id(
        app,
        TRAY_MENU_QUIT_ID,
        TRAY_MENU_QUIT_LABEL,
        true,
        None::<&str>,
    )?;
    Menu::with_items(app, &[&open_item, &toggle_pause_item, &quit_item])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tracking_pause_menu_label_matches_next_available_action() {
        assert_eq!(tracking_pause_menu_label(false), "暂停追踪");
        assert_eq!(tracking_pause_menu_label(true), "恢复追踪");
    }

    #[test]
    fn explicit_exit_bypasses_close_to_tray_redirect() {
        let settings =
            DesktopBehaviorSettings::default().with_raw_desktop_behavior("tray", "taskbar");

        assert!(should_redirect_close_to_tray(settings, false));
        assert!(!should_redirect_close_to_tray(settings, true));
    }
}
