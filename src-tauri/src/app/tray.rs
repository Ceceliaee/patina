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
use crate::platform::windows::tray_icon_theme::{self, TaskbarTheme, TaskbarThemeWatcher};
use std::sync::{Mutex, MutexGuard};
use tauri::{
    image::Image,
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

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum TrayIconVariant {
    LightTaskbarActive,
    LightTaskbarPaused,
    DarkTaskbarActive,
    DarkTaskbarPaused,
}

#[derive(Debug, Default)]
struct TrayIconAppearance {
    last_known_theme: Option<TaskbarTheme>,
    applied_variant: Option<TrayIconVariant>,
}

#[derive(Default)]
pub(crate) struct TrayIconRuntimeState {
    appearance: Mutex<TrayIconAppearance>,
    watcher: Mutex<Option<TaskbarThemeWatcher>>,
}

impl TrayIconRuntimeState {
    fn lock_appearance(&self) -> MutexGuard<'_, TrayIconAppearance> {
        match self.appearance.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        }
    }

    fn lock_watcher(&self) -> MutexGuard<'_, Option<TaskbarThemeWatcher>> {
        match self.watcher.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        }
    }

    fn stop_watcher(&self) {
        if let Some(mut watcher) = self.lock_watcher().take() {
            watcher.stop();
        }
    }
}

fn select_tray_icon_variant(theme: TaskbarTheme, tracking_paused: bool) -> Option<TrayIconVariant> {
    match (theme, tracking_paused) {
        (TaskbarTheme::Light, false) => Some(TrayIconVariant::LightTaskbarActive),
        (TaskbarTheme::Light, true) => Some(TrayIconVariant::LightTaskbarPaused),
        (TaskbarTheme::Dark, false) => Some(TrayIconVariant::DarkTaskbarActive),
        (TaskbarTheme::Dark, true) => Some(TrayIconVariant::DarkTaskbarPaused),
        (TaskbarTheme::Unknown, _) => None,
    }
}

fn resolve_tray_icon_variant(
    appearance: &mut TrayIconAppearance,
    observed_theme: TaskbarTheme,
    tracking_paused: bool,
) -> Option<TrayIconVariant> {
    if observed_theme.is_known() {
        appearance.last_known_theme = Some(observed_theme);
    }
    appearance
        .last_known_theme
        .and_then(|theme| select_tray_icon_variant(theme, tracking_paused))
}

fn load_tray_icon(variant: TrayIconVariant) -> Result<Image<'static>, String> {
    let bytes = match variant {
        TrayIconVariant::LightTaskbarActive => {
            include_bytes!("../../icons/tray/on-light-active.png").as_slice()
        }
        TrayIconVariant::LightTaskbarPaused => {
            include_bytes!("../../icons/tray/on-light-paused.png").as_slice()
        }
        TrayIconVariant::DarkTaskbarActive => {
            include_bytes!("../../icons/tray/on-dark-active.png").as_slice()
        }
        TrayIconVariant::DarkTaskbarPaused => {
            include_bytes!("../../icons/tray/on-dark-paused.png").as_slice()
        }
    };
    decode_tray_icon(bytes)
}

fn decode_tray_icon(bytes: &[u8]) -> Result<Image<'static>, String> {
    let decoded = image::load_from_memory(bytes)
        .map_err(|error| format!("invalid embedded PNG: {error}"))?
        .to_rgba8();
    let (width, height) = decoded.dimensions();
    Ok(Image::new_owned(decoded.into_raw(), width, height))
}

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
    if let Err(error) = refresh_tray_icon(app, None) {
        eprintln!("[tray] failed to update tracking state icon: {error}");
    }
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

pub(crate) async fn refresh_tracking_pause_from_storage<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<(), String> {
    let tracking_paused = tracking_pause_service::load_tracking_pause_setting(app).await?;
    update_tracking_pause_runtime_state(app, tracking_paused);
    if let Err(error) = refresh_tray_icon(app, None) {
        eprintln!("[tray] failed to refresh restored tracking state icon: {error}");
    }
    if let Err(error) = rebuild_tray_menu(app) {
        eprintln!("[tray] failed to refresh restored tracking state menu: {error}");
    }
    Ok(())
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

    let observed_theme = tray_icon_theme::current_taskbar_theme();
    let initial_variant = prepare_tray_icon_variant(app, observed_theme, tracking_paused);

    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .menu(&menu)
        .tooltip("Patina")
        .show_menu_on_left_click(false);

    let mut applied_initial_variant = None;
    if let Some(variant) = initial_variant {
        match load_tray_icon(variant) {
            Ok(icon) => {
                builder = builder.icon(icon);
                applied_initial_variant = Some(variant);
            }
            Err(error) => {
                eprintln!("[tray] failed to decode initial {variant:?} icon: {error}");
                if let Some(icon) = app.default_window_icon().cloned() {
                    builder = builder.icon(icon);
                }
            }
        }
    } else if let Some(icon) = app.default_window_icon().cloned() {
        builder = builder.icon(icon);
    }

    builder.build(app)?;
    if let Some(state) = app.try_state::<TrayIconRuntimeState>() {
        state.lock_appearance().applied_variant = applied_initial_variant;
    }
    start_taskbar_theme_watcher(app);
    Ok(())
}

fn prepare_tray_icon_variant<R: Runtime>(
    app: &AppHandle<R>,
    observed_theme: TaskbarTheme,
    tracking_paused: bool,
) -> Option<TrayIconVariant> {
    let state = app.try_state::<TrayIconRuntimeState>()?;
    let mut appearance = state.lock_appearance();
    resolve_tray_icon_variant(&mut appearance, observed_theme, tracking_paused)
}

fn refresh_tray_icon<R: Runtime>(
    app: &AppHandle<R>,
    observed_theme: Option<TaskbarTheme>,
) -> Result<(), String> {
    let state = app
        .try_state::<TrayIconRuntimeState>()
        .ok_or_else(|| "tray icon runtime state is unavailable".to_string())?;
    let mut appearance = state.lock_appearance();
    if appearance.last_known_theme.is_none() {
        let current = tray_icon_theme::current_taskbar_theme();
        let _ = resolve_tray_icon_variant(&mut appearance, current, false);
    }

    let tracking_paused = app
        .try_state::<TrackingPauseRuntimeState>()
        .and_then(|state| state.snapshot())
        .map(|snapshot| snapshot.tracking_paused)
        .unwrap_or(false);
    let observed_theme = observed_theme.unwrap_or(TaskbarTheme::Unknown);
    let Some(variant) = resolve_tray_icon_variant(&mut appearance, observed_theme, tracking_paused)
    else {
        return Ok(());
    };
    if appearance.applied_variant == Some(variant) {
        return Ok(());
    }

    let icon = load_tray_icon(variant)
        .map_err(|error| format!("failed to decode {variant:?} icon: {error}"))?;
    let tray = app
        .tray_by_id(TRAY_ID)
        .ok_or_else(|| "main tray is unavailable".to_string())?;
    tray.set_icon(Some(icon))
        .map_err(|error| format!("failed to apply {variant:?} icon: {error}"))?;
    appearance.applied_variant = Some(variant);
    Ok(())
}

fn start_taskbar_theme_watcher<R: Runtime>(app: &AppHandle<R>) {
    let Some(state) = app.try_state::<TrayIconRuntimeState>() else {
        eprintln!("[tray] cannot start taskbar theme watcher without runtime state");
        return;
    };
    let mut watcher_slot = state.lock_watcher();
    if watcher_slot.is_some() {
        return;
    }

    let app_handle = app.clone();
    match TaskbarThemeWatcher::start(move |theme| {
        if let Err(error) = refresh_tray_icon(&app_handle, Some(theme)) {
            eprintln!("[tray] failed to update icon after Windows theme change: {error}");
        }
    }) {
        Ok(watcher) => *watcher_slot = Some(watcher),
        Err(error) => eprintln!("[tray] failed to watch Windows taskbar theme: {error}"),
    }
}

pub(crate) fn stop_taskbar_theme_watcher<R: Runtime>(app: &AppHandle<R>) {
    if let Some(state) = app.try_state::<TrayIconRuntimeState>() {
        state.stop_watcher();
    }
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

    const INSTALLED_ICON_BASELINE: &[u8] = include_bytes!("../../icons/32x32.png");
    const TRAY_ICON_ASSETS: &[(TrayIconVariant, &[u8])] = &[
        (
            TrayIconVariant::LightTaskbarActive,
            include_bytes!("../../icons/tray/on-light-active.png"),
        ),
        (
            TrayIconVariant::LightTaskbarPaused,
            include_bytes!("../../icons/tray/on-light-paused.png"),
        ),
        (
            TrayIconVariant::DarkTaskbarActive,
            include_bytes!("../../icons/tray/on-dark-active.png"),
        ),
        (
            TrayIconVariant::DarkTaskbarPaused,
            include_bytes!("../../icons/tray/on-dark-paused.png"),
        ),
    ];

    #[test]
    fn tray_icon_variant_selection_covers_taskbar_theme_and_tracking_state() {
        assert_eq!(
            select_tray_icon_variant(TaskbarTheme::Light, false),
            Some(TrayIconVariant::LightTaskbarActive)
        );
        assert_eq!(
            select_tray_icon_variant(TaskbarTheme::Light, true),
            Some(TrayIconVariant::LightTaskbarPaused)
        );
        assert_eq!(
            select_tray_icon_variant(TaskbarTheme::Dark, false),
            Some(TrayIconVariant::DarkTaskbarActive)
        );
        assert_eq!(
            select_tray_icon_variant(TaskbarTheme::Dark, true),
            Some(TrayIconVariant::DarkTaskbarPaused)
        );
        assert_eq!(select_tray_icon_variant(TaskbarTheme::Unknown, false), None);
        assert_eq!(select_tray_icon_variant(TaskbarTheme::Unknown, true), None);
    }

    #[test]
    fn unknown_taskbar_theme_preserves_last_known_theme_and_current_tracking_state() {
        let mut appearance = TrayIconAppearance::default();
        assert_eq!(
            resolve_tray_icon_variant(&mut appearance, TaskbarTheme::Unknown, false),
            None
        );
        assert_eq!(
            resolve_tray_icon_variant(&mut appearance, TaskbarTheme::Dark, false),
            Some(TrayIconVariant::DarkTaskbarActive)
        );
        assert_eq!(
            resolve_tray_icon_variant(&mut appearance, TaskbarTheme::Unknown, true),
            Some(TrayIconVariant::DarkTaskbarPaused)
        );
    }

    #[test]
    fn tray_icon_assets_match_installed_geometry_and_each_other() {
        let installed_icon = image::load_from_memory(INSTALLED_ICON_BASELINE)
            .expect("failed to decode installed icon baseline")
            .to_rgba8();
        let installed_geometry = installed_icon
            .pixels()
            .map(|pixel| {
                if pixel[0] == 0 && pixel[1] == 0 && pixel[2] == 0 {
                    0
                } else {
                    pixel[3]
                }
            })
            .collect::<Vec<_>>();
        let decoded = TRAY_ICON_ASSETS
            .iter()
            .map(|(variant, bytes)| {
                let image = image::load_from_memory(bytes)
                    .unwrap_or_else(|error| panic!("failed to decode {variant:?}: {error}"))
                    .to_rgba8();
                let alpha = image.pixels().map(|pixel| pixel[3]).collect::<Vec<_>>();
                let bounds = non_transparent_bounds(&image);
                (*variant, image.dimensions(), alpha, bounds)
            })
            .collect::<Vec<_>>();
        let baseline = &decoded[0];

        for (variant, dimensions, alpha, bounds) in &decoded[1..] {
            assert_eq!(*dimensions, baseline.1, "{variant:?} dimensions changed");
            assert_eq!(*alpha, baseline.2, "{variant:?} geometry/alpha changed");
            assert_eq!(*bounds, baseline.3, "{variant:?} visible bounds changed");
        }
        assert_eq!(baseline.1, (32, 32));
        assert_eq!(baseline.2, installed_geometry);
        assert_eq!(baseline.3, Some((0, 0, 31, 31)));
    }

    #[test]
    fn tray_icon_assets_contain_their_declared_ring_and_focus_colors() {
        let expected_colors = [
            (0x5F, 0x6B, 0x7A, 0x39, 0x46, 0x57),
            (0xA8, 0xAF, 0xB8, 0x7B, 0x85, 0x92),
            (0xC9, 0xD1, 0xDC, 0xEE, 0xF2, 0xF6),
            (0x48, 0x4C, 0x51, 0x65, 0x6A, 0x71),
        ];

        for ((variant, bytes), (rr, rg, rb, fr, fg, fb)) in
            TRAY_ICON_ASSETS.iter().zip(expected_colors)
        {
            let image = image::load_from_memory(bytes)
                .unwrap_or_else(|error| panic!("failed to decode {variant:?}: {error}"))
                .to_rgba8();
            let visible_colors = image
                .pixels()
                .filter(|pixel| pixel[3] > 0)
                .map(|pixel| [pixel[0], pixel[1], pixel[2]])
                .collect::<std::collections::BTreeSet<_>>();
            assert_eq!(
                visible_colors,
                std::collections::BTreeSet::from([[rr, rg, rb], [fr, fg, fb]]),
                "{variant:?} contains colors outside the two declared roles"
            );
        }
    }

    #[test]
    fn invalid_tray_icon_bytes_fail_without_panicking() {
        let error = decode_tray_icon(b"not a png").expect_err("invalid bytes must fail");
        assert!(error.contains("invalid embedded PNG"));
    }

    #[test]
    fn tray_icon_focus_role_stays_stronger_than_ring_role() {
        let roles: [(u32, u32, bool); 4] = [
            (0x5F6B7A, 0x394657, true),
            (0xA8AFB8, 0x7B8592, true),
            (0xC9D1DC, 0xEEF2F6, false),
            (0x484C51, 0x656A71, false),
        ];

        for (ring, focus, on_light_taskbar) in roles {
            let ring_luminance = rgb_luminance(ring);
            let focus_luminance = rgb_luminance(focus);
            if on_light_taskbar {
                assert!(focus_luminance < ring_luminance);
            } else {
                assert!(focus_luminance > ring_luminance);
            }
        }
    }

    fn non_transparent_bounds(image: &image::RgbaImage) -> Option<(u32, u32, u32, u32)> {
        let mut bounds: Option<(u32, u32, u32, u32)> = None;
        for (x, y, pixel) in image.enumerate_pixels() {
            // Lanczos export can leave alpha=1 resampling dust on the outer edge.
            // Ignore that invisible fringe when asserting the meaningful bounds.
            if pixel[3] <= 1 {
                continue;
            }
            bounds = Some(match bounds {
                Some((min_x, min_y, max_x, max_y)) => {
                    (min_x.min(x), min_y.min(y), max_x.max(x), max_y.max(y))
                }
                None => (x, y, x, y),
            });
        }
        bounds
    }

    fn rgb_luminance(rgb: u32) -> f64 {
        let channel = |shift: u32| {
            let value = ((rgb >> shift) & 0xff_u32) as f64 / 255.0;
            if value <= 0.04045 {
                value / 12.92
            } else {
                ((value + 0.055) / 1.055).powf(2.4)
            }
        };
        0.2126 * channel(16) + 0.7152 * channel(8) + 0.0722 * channel(0)
    }

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
