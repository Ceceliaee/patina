use crate::app::main_window;
use crate::app::runtime::now_ms;
use crate::app::state::{AppExitState, DesktopBehaviorState};
use crate::app::widget;
use crate::data::repositories::tracker_settings;
use crate::data::sqlite_pool::wait_for_sqlite_pool;
use crate::domain::settings::{CloseBehavior, DesktopBehaviorSettings, MinimizeBehavior};
use crate::engine::tracking::runtime as tracking_runtime;
use sqlx::{Pool, Sqlite};
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
    let pool = wait_for_sqlite_pool(&app).await?;
    let reason = toggle_tracking_paused_in_pool(&pool)
        .await
        .map_err(|error| format!("failed to toggle tracking pause setting: {error}"))?;

    tracking_runtime::emit_tracking_data_changed(&app, reason, now_ms())
        .map_err(|error| format!("failed to emit tracking pause event: {error}"))?;

    Ok(())
}

pub(crate) async fn toggle_tracking_paused_in_pool(
    pool: &Pool<Sqlite>,
) -> Result<&'static str, sqlx::Error> {
    let current = tracker_settings::load_tracking_paused_setting(pool).await?;
    let next = !current;

    tracker_settings::save_tracking_paused_setting(pool, next).await?;

    Ok(if next {
        "tracking-paused"
    } else {
        "tracking-resumed"
    })
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
        return;
    }

    if !window.is_minimized().unwrap_or(false) {
        return;
    }

    if settings.minimize_behavior == MinimizeBehavior::Widget {
        let preferred_monitor = window.current_monitor().ok().flatten();
        let _ = window.hide();
        let app_handle = app.clone();
        tauri::async_runtime::spawn(async move {
            if let Err(error) = widget::show_widget_window(&app_handle, preferred_monitor).await {
                eprintln!("[widget] failed to show widget window: {error}");
            }
        });
    }
}

pub(crate) fn setup_tray<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let open_item = MenuItem::with_id(
        app,
        TRAY_MENU_SHOW_ID,
        "\u{6253}\u{5f00}\u{4e3b}\u{754c}\u{9762}",
        true,
        None::<&str>,
    )?;
    let toggle_pause_item = MenuItem::with_id(
        app,
        TRAY_MENU_TOGGLE_PAUSE_ID,
        "\u{6682}\u{505c}/\u{6062}\u{590d}\u{8ffd}\u{8e2a}",
        true,
        None::<&str>,
    )?;
    let quit_item = MenuItem::with_id(
        app,
        TRAY_MENU_QUIT_ID,
        "\u{9000}\u{51fa}\u{5e94}\u{7528}",
        true,
        None::<&str>,
    )?;
    let menu = Menu::with_items(app, &[&open_item, &toggle_pause_item, &quit_item])?;

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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::data::schema as db_schema;
    use sqlx::{Executor, SqlitePool};

    async fn setup_test_db() -> SqlitePool {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        pool.execute(db_schema::CURRENT_BASELINE_SCHEMA_SQL)
            .await
            .unwrap();
        pool
    }

    #[test]
    fn toggle_tracking_paused_in_pool_flips_setting_and_reason() {
        tauri::async_runtime::block_on(async {
            let pool = setup_test_db().await;

            let first_reason = toggle_tracking_paused_in_pool(&pool).await.unwrap();
            let first_value = tracker_settings::load_tracking_paused_setting(&pool)
                .await
                .unwrap();
            let second_reason = toggle_tracking_paused_in_pool(&pool).await.unwrap();
            let second_value = tracker_settings::load_tracking_paused_setting(&pool)
                .await
                .unwrap();

            assert_eq!(first_reason, "tracking-paused");
            assert!(first_value);
            assert_eq!(second_reason, "tracking-resumed");
            assert!(!second_value);
        });
    }

    #[test]
    fn explicit_exit_bypasses_close_to_tray_redirect() {
        let settings =
            DesktopBehaviorSettings::default().with_raw_desktop_behavior("tray", "taskbar");

        assert!(should_redirect_close_to_tray(settings, false));
        assert!(!should_redirect_close_to_tray(settings, true));
    }
}
