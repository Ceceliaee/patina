use crate::app::main_window;
use crate::app::runtime::now_ms;
use crate::app::state::{AppExitState, DesktopBehaviorState, TraySafetyState};
use crate::app::widget;
use crate::data::app_settings_service::{self, AppSettingMutation};
use crate::data::tracking_pause_service;
use crate::domain::localization::{Locale, LocalizationState};
use crate::domain::settings::{CloseBehavior, DesktopBehaviorSettings};
use crate::engine::tracking::{
    pause_state::TrackingPauseRuntimeState, runtime as tracking_runtime,
    title_state::TitleRecordingRuntimeState,
};
use std::sync::{Mutex, MutexGuard};
use tauri::{
    menu::{Menu, MenuEvent, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, Runtime, Window, WindowEvent,
};

pub(crate) use crate::app::main_window::MAIN_WINDOW_LABEL;
const TRAY_ID: &str = "main";
const TRAY_MENU_SHOW_ID: &str = "tray-show-main";
const TRAY_MENU_TOGGLE_PAUSE_ID: &str = "tray-toggle-pause";
const TRAY_MENU_TOGGLE_TITLE_ID: &str = "tray-toggle-title-recording";
const TRAY_MENU_QUIT_ID: &str = "tray-quit";
#[derive(Clone, Debug, PartialEq, Eq)]
struct TrayMenuLabels {
    show_main: String,
    toggle_pause: String,
    toggle_title: String,
    quit: String,
}

#[derive(Debug, Default)]
pub(crate) struct TrayMenuRebuildState {
    rebuild: Mutex<()>,
}

impl TrayMenuRebuildState {
    fn lock_rebuild(&self) -> MutexGuard<'_, ()> {
        match self.rebuild.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        }
    }
}

fn tray_menu_labels(locale: Locale, tracking_paused: bool, title_enabled: bool) -> TrayMenuLabels {
    TrayMenuLabels {
        show_main: crate::domain::localization::text(locale, "native.tray.showMain"),
        toggle_pause: crate::domain::localization::text(
            locale,
            if tracking_paused {
                "native.tray.resume"
            } else {
                "native.tray.pause"
            },
        ),
        toggle_title: crate::domain::localization::text(
            locale,
            if title_enabled {
                "native.tray.disableTitle"
            } else {
                "native.tray.enableTitle"
            },
        ),
        quit: crate::domain::localization::text(locale, "native.tray.quit"),
    }
}

fn should_redirect_close_to_tray(settings: DesktopBehaviorSettings, exit_requested: bool) -> bool {
    !exit_requested
        && settings.close_behavior == CloseBehavior::Tray
        && settings.should_keep_tray_visible()
}

pub(crate) fn show_main_window<R: Runtime + 'static>(
    app: &AppHandle<R>,
    reason: main_window::MainWindowShowReason,
) -> bool {
    let accepted = main_window::show_main_window(app, reason);
    let settings = app.state::<DesktopBehaviorState>().snapshot();
    apply_tray_visibility(app, settings);
    accepted
}

pub(crate) fn on_main_window_revealed<R: Runtime>(app: &AppHandle<R>) {
    app.state::<TraySafetyState>().clear_forced_visibility();
    let settings = app.state::<DesktopBehaviorState>().snapshot();
    apply_tray_visibility(app, settings);
}

pub(crate) fn apply_tray_visibility<R: Runtime>(
    app: &AppHandle<R>,
    settings: DesktopBehaviorSettings,
) {
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        let should_show = settings.should_keep_tray_visible()
            || app.state::<TraySafetyState>().is_forced_visible();
        if let Err(error) = tray.set_visible(should_show) {
            eprintln!("[tray] failed to apply visibility: {error}");
        }
    }
}

pub(crate) fn ensure_tray_visible<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let tray = app
        .tray_by_id(TRAY_ID)
        .ok_or_else(|| "main tray is unavailable".to_string())?;
    tray.set_visible(true)
        .map_err(|error| format!("failed to show main tray: {error}"))?;
    app.state::<TraySafetyState>().force_visible();
    Ok(())
}

pub(crate) async fn toggle_tracking_paused<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    let settings_commit_state = app.state::<crate::app::state::AppSettingsCommitState>();
    let _settings_commit_guard = settings_commit_state.lock().await;
    let change = tracking_pause_service::toggle_tracking_pause_setting(&app).await?;

    apply_tracking_pause_setting_change(&app, change.tracking_paused, change.reason)
}

pub(crate) fn apply_tracking_pause_setting_change<R: Runtime>(
    app: &AppHandle<R>,
    tracking_paused: bool,
    reason: &'static str,
) -> Result<(), String> {
    update_tracking_pause_runtime_state(app, tracking_paused);
    if let Err(error) = rebuild_tray_menu(app) {
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

pub(crate) async fn toggle_title_recording<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    let title_state = app.state::<TitleRecordingRuntimeState>();
    let _update_guard = title_state.lock_update().await;
    let settings_commit_state = app.state::<crate::app::state::AppSettingsCommitState>();
    let _settings_commit_guard = settings_commit_state.lock().await;
    let current = title_state.is_enabled();
    let next = !current;
    app_settings_service::commit_app_setting_mutations_with_recovery(
        &app,
        &[AppSettingMutation {
            key: "title_recording_enabled".into(),
            value: if next { "1".into() } else { "0".into() },
        }],
    )
    .await
    .map_err(|error| error.to_string())?;
    apply_title_recording_setting_change(&app, next).await
}

pub(crate) async fn apply_title_recording_setting_change<R: Runtime>(
    app: &AppHandle<R>,
    enabled: bool,
) -> Result<(), String> {
    if let Some(state) = app.try_state::<TitleRecordingRuntimeState>() {
        state.set_enabled(enabled);
    }
    let changed_at_ms = now_ms() as i64;
    if !enabled {
        if let Err(error) = app_settings_service::disable_active_app_title(app, changed_at_ms).await
        {
            eprintln!("[tray] failed to seal app title boundary: {error}");
        }
    }
    if let Err(error) =
        crate::app::web_activity::seal_active_segment_for_app(app, changed_at_ms).await
    {
        eprintln!("[tray] failed to seal web title boundary: {error}");
    }
    rebuild_tray_menu(app)
        .map_err(|error| format!("failed to update title recording menu: {error}"))?;
    if let Err(error) = tracking_runtime::emit_tracking_data_changed(
        app,
        if enabled {
            "title-recording-enabled"
        } else {
            "title-recording-disabled"
        },
        changed_at_ms as u64,
    ) {
        eprintln!("[tray] failed to emit title recording event: {error}");
    }
    if let Err(error) = app.emit("app-settings-changed", serde_json::json!({})) {
        eprintln!("[tray] failed to emit settings refresh event: {error}");
    }
    Ok(())
}

pub(crate) fn apply_language_setting_change<R: Runtime>(
    app: &AppHandle<R>,
    raw_language: &str,
) -> Result<(), String> {
    let state = app
        .try_state::<LocalizationState>()
        .ok_or_else(|| "localization state is unavailable".to_string())?;
    state.set_tag(raw_language);
    if let Err(error) = rebuild_tray_menu(app) {
        // The database commit is already authoritative. Keep the runtime locale aligned
        // and retain the last usable native menu until the next rebuild opportunity.
        eprintln!("[tray] failed to rebuild menu after language update: {error}");
    }
    Ok(())
}

pub(crate) fn handle_menu_event<R: Runtime>(app: &AppHandle<R>, event: MenuEvent) {
    if event.id() == TRAY_MENU_SHOW_ID {
        show_main_window(app, main_window::MainWindowShowReason::TrayMenu);
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

    if event.id() == TRAY_MENU_TOGGLE_TITLE_ID {
        let app_handle = app.clone();
        tauri::async_runtime::spawn(async move {
            if let Err(error) = toggle_title_recording(app_handle).await {
                eprintln!("[tray] failed to toggle title recording: {error}");
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
            show_main_window(app, main_window::MainWindowShowReason::TrayIcon);
        }
        _ => {}
    }
}

pub(crate) fn handle_window_event<R: Runtime>(window: &Window<R>, event: &WindowEvent) {
    if window.label() == widget::WIDGET_WINDOW_LABEL {
        if let WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            show_main_window(
                window.app_handle(),
                main_window::MainWindowShowReason::Widget,
            );
        }
        return;
    }

    if window.label() != MAIN_WINDOW_LABEL {
        return;
    }

    let app = window.app_handle();

    if matches!(event, WindowEvent::Destroyed) {
        main_window::handle_unexpected_main_window_destroyed(app);
        return;
    }

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
    let language_raw =
        tauri::async_runtime::block_on(app_settings_service::load_language_setting(app))
            .unwrap_or_else(|error| {
                eprintln!("[tray] failed to initialize tray menu language: {error}");
                None
            });
    let locale = Locale::from_tag(language_raw.as_deref());
    if let Some(state) = app.try_state::<LocalizationState>() {
        state.set_tag(locale.tag());
    }

    let tracking_paused =
        tauri::async_runtime::block_on(tracking_pause_service::load_tracking_pause_setting(app))
            .unwrap_or_else(|error| {
                eprintln!("[tray] failed to initialize tracking pause menu label: {error}");
                false
            });
    update_tracking_pause_runtime_state(app, tracking_paused);

    let title_enabled =
        tauri::async_runtime::block_on(app_settings_service::load_title_recording_enabled(app))
            .unwrap_or_else(|error: String| {
                eprintln!("[tray] failed to initialize title recording menu label: {error}");
                true
            });
    if let Some(state) = app.try_state::<TitleRecordingRuntimeState>() {
        state.set_enabled(title_enabled);
    }

    let menu = build_tray_menu(app, locale, tracking_paused, title_enabled)?;

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
    locale: Locale,
    tracking_paused: bool,
    title_enabled: bool,
) -> tauri::Result<Menu<R>> {
    let labels = tray_menu_labels(locale, tracking_paused, title_enabled);
    let open_item = MenuItem::with_id(
        app,
        TRAY_MENU_SHOW_ID,
        &labels.show_main,
        true,
        None::<&str>,
    )?;
    let toggle_pause_item = MenuItem::with_id(
        app,
        TRAY_MENU_TOGGLE_PAUSE_ID,
        &labels.toggle_pause,
        true,
        None::<&str>,
    )?;
    let quit_item = MenuItem::with_id(app, TRAY_MENU_QUIT_ID, &labels.quit, true, None::<&str>)?;
    let toggle_title_item = MenuItem::with_id(
        app,
        TRAY_MENU_TOGGLE_TITLE_ID,
        &labels.toggle_title,
        true,
        None::<&str>,
    )?;
    Menu::with_items(
        app,
        &[
            &open_item,
            &toggle_pause_item,
            &toggle_title_item,
            &quit_item,
        ],
    )
}

fn rebuild_tray_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let rebuild_state = app.try_state::<TrayMenuRebuildState>();
    // Runtime setting commands and tray clicks can overlap. Serializing the full
    // snapshot/build/set sequence prevents an older rebuild from winning last.
    let _rebuild_guard = rebuild_state.as_ref().map(|state| state.lock_rebuild());
    let locale = app
        .try_state::<LocalizationState>()
        .map(|state| state.locale())
        .unwrap_or_default();
    let tracking_paused = app
        .try_state::<TrackingPauseRuntimeState>()
        .and_then(|state| state.snapshot())
        .map(|snapshot| snapshot.tracking_paused)
        .unwrap_or(false);
    let title_enabled = app
        .try_state::<TitleRecordingRuntimeState>()
        .map(|state| state.is_enabled())
        .unwrap_or(true);

    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        tray.set_menu(Some(build_tray_menu(
            app,
            locale,
            tracking_paused,
            title_enabled,
        )?))?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tray_language_normalization_matches_frontend_fallback_contract() {
        assert_eq!(Locale::from_tag(None), Locale::ZhCn);
        assert_eq!(Locale::from_tag(Some(" zh-CN ")), Locale::ZhCn);
        assert_eq!(Locale::from_tag(Some(" en-us ")), Locale::EnUs);
        assert_eq!(Locale::from_tag(Some("fr-FR")), Locale::ZhCn);
        assert_eq!(Locale::from_tag(Some("")), Locale::ZhCn);
    }

    #[test]
    fn tray_menu_labels_cover_every_language_and_dynamic_state_combination() {
        let cases = [
            (
                Locale::ZhCn,
                false,
                true,
                ["打开主界面", "暂停追踪", "屏蔽标题", "退出应用"],
            ),
            (
                Locale::ZhCn,
                true,
                true,
                ["打开主界面", "恢复追踪", "屏蔽标题", "退出应用"],
            ),
            (
                Locale::ZhCn,
                false,
                false,
                ["打开主界面", "暂停追踪", "记录标题", "退出应用"],
            ),
            (
                Locale::ZhCn,
                true,
                false,
                ["打开主界面", "恢复追踪", "记录标题", "退出应用"],
            ),
            (
                Locale::EnUs,
                false,
                true,
                [
                    "Open main window",
                    "Pause tracking",
                    "Block titles",
                    "Exit Patina",
                ],
            ),
            (
                Locale::EnUs,
                true,
                true,
                [
                    "Open main window",
                    "Resume tracking",
                    "Block titles",
                    "Exit Patina",
                ],
            ),
            (
                Locale::EnUs,
                false,
                false,
                [
                    "Open main window",
                    "Pause tracking",
                    "Record titles",
                    "Exit Patina",
                ],
            ),
            (
                Locale::EnUs,
                true,
                false,
                [
                    "Open main window",
                    "Resume tracking",
                    "Record titles",
                    "Exit Patina",
                ],
            ),
        ];

        for (language, tracking_paused, title_enabled, expected) in cases {
            let labels = tray_menu_labels(language, tracking_paused, title_enabled);
            assert_eq!(
                [
                    labels.show_main,
                    labels.toggle_pause,
                    labels.toggle_title,
                    labels.quit,
                ],
                expected.map(str::to_owned)
            );
        }
    }

    #[test]
    fn explicit_exit_bypasses_close_to_tray_redirect() {
        let settings =
            DesktopBehaviorSettings::default().with_raw_desktop_behavior("tray", "taskbar");

        assert!(should_redirect_close_to_tray(settings, false));
        assert!(!should_redirect_close_to_tray(settings, true));
    }
}
