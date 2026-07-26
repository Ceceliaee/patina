use crate::app::state::WidgetWindowLifecycleState;
use crate::data::widget_store::SqliteWidgetPlacementStore;
use crate::domain::widget::{
    match_widget_monitor, resolve_widget_placement, select_widget_monitor, WidgetMonitorAffinity,
    WidgetPhysicalRect, WidgetPlacement, WidgetSide,
};
use crate::engine::widget as widget_engine;
use crate::platform::storage_paths;
#[cfg(debug_assertions)]
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;
use tauri::{
    AppHandle, Emitter, Manager, Monitor, PhysicalPosition, PhysicalSize, Position, Runtime, Size,
    WebviewUrl, WebviewWindow, WebviewWindowBuilder,
};

pub(crate) const WIDGET_WINDOW_LABEL: &str = "widget";
pub(crate) const WIDGET_RUNTIME_COLLAPSED_EVENT: &str = "widget-runtime-collapsed";
pub(crate) const WIDGET_RUNTIME_SHOWN_EVENT: &str = "widget-runtime-shown";
const WIDGET_TITLE: &str = "Patina Widget";
const WIDGET_EXPANDED_LOGICAL_WIDTH_WITH_OBJECT: u32 = 228;
const WIDGET_EXPANDED_LOGICAL_WIDTH_COMPACT: u32 = 184;
const WIDGET_EXPANDED_LOGICAL_HEIGHT: u32 = 48;
const WIDGET_COLLAPSED_LOGICAL_WIDTH: u32 = 64;
const WIDGET_COLLAPSED_LOGICAL_HEIGHT: u32 = 48;
const WIDGET_COLLAPSED_VISIBLE_LOGICAL_WIDTH: u32 = 64;
const WIDGET_DESTROY_AFTER_IDLE_SECS: u64 = 3 * 60;
#[cfg(debug_assertions)]
static E2E_WIDGET_SHOW_FAILURE_COUNT: AtomicUsize = AtomicUsize::new(0);

pub(crate) async fn load_widget_placement<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<WidgetPlacement, String> {
    let store = SqliteWidgetPlacementStore::from_app(app).await?;
    widget_engine::load_widget_placement(&store).await
}

pub(crate) async fn save_widget_placement<R: Runtime>(
    app: &AppHandle<R>,
    placement: WidgetPlacement,
) -> Result<(), String> {
    let store = SqliteWidgetPlacementStore::from_app(app).await?;
    widget_engine::save_widget_placement(&store, placement).await
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct WidgetLogicalSize {
    width: u32,
    height: u32,
    visible_width: u32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct WidgetPhysicalSize {
    width: u32,
    height: u32,
    visible_width: u32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct WidgetPhysicalBounds {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
}

pub(crate) async fn show_widget_window_for_minimize<R: Runtime + 'static>(
    app: &AppHandle<R>,
    preferred_monitor: Option<Monitor>,
) -> Result<(), String> {
    fail_widget_show_for_e2e_if_requested()?;
    let placement = load_widget_placement(app).await?;
    apply_widget_layout_internal(app, preferred_monitor, placement, false, false, false, true).await
}

pub(crate) async fn finalize_widget_drag<R: Runtime + 'static>(
    app: &AppHandle<R>,
) -> Result<WidgetPlacement, String> {
    if is_main_window_visible(app) {
        close_widget_window(app);
        return Err("cannot finalize widget drag while the main window is visible".to_string());
    }

    let window = app
        .get_webview_window(WIDGET_WINDOW_LABEL)
        .ok_or_else(|| "failed to finalize widget drag: widget window is missing".to_string())?;
    if window.is_visible().ok() != Some(true) {
        return Err("failed to finalize widget drag: widget window is hidden".to_string());
    }

    let position = window
        .outer_position()
        .map_err(|error| format!("failed to read widget position after drag: {error}"))?;
    let size = window
        .outer_size()
        .map_err(|error| format!("failed to read widget size after drag: {error}"))?;
    let window_rect = WidgetPhysicalRect::new(position.x, position.y, size.width, size.height);
    let monitors = app
        .available_monitors()
        .map_err(|error| format!("failed to enumerate monitors after widget drag: {error}"))?;
    let affinities = monitors
        .iter()
        .map(widget_monitor_affinity)
        .collect::<Vec<_>>();
    let target_index = select_widget_monitor(&window_rect, &affinities)
        .ok_or_else(|| "failed to select a target monitor after widget drag".to_string())?;
    let target_monitor = monitors[target_index].clone();
    let placement = resolve_widget_placement(window_rect, affinities[target_index].clone());

    save_widget_placement(app, placement.clone()).await?;
    apply_widget_layout_internal(
        app,
        Some(target_monitor),
        placement.clone(),
        false,
        false,
        false,
        false,
    )
    .await?;

    Ok(placement)
}

pub(crate) async fn set_widget_window_expanded<R: Runtime + 'static>(
    app: &AppHandle<R>,
    expanded: bool,
    show_object_slot: bool,
) -> Result<(), String> {
    let placement = load_widget_placement(app).await?;
    apply_widget_layout_internal(
        app,
        None,
        placement,
        expanded,
        expanded,
        show_object_slot,
        false,
    )
    .await
}

pub(crate) fn is_widget_window_visible<R: Runtime>(app: &AppHandle<R>) -> bool {
    app.get_webview_window(WIDGET_WINDOW_LABEL)
        .and_then(|window| window.is_visible().ok())
        .unwrap_or(false)
}

pub(crate) fn close_widget_window<R: Runtime + 'static>(app: &AppHandle<R>) {
    let hide_generation = app.state::<WidgetWindowLifecycleState>().hide();
    if let Some(window) = app.get_webview_window(WIDGET_WINDOW_LABEL) {
        emit_widget_runtime_collapsed(app);
        park_widget_window(&window);
        schedule_widget_destroy_after_idle(app.clone(), hide_generation);
    }
}

fn schedule_widget_destroy_after_idle<R: Runtime + 'static>(
    app: AppHandle<R>,
    hide_generation: u64,
) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(WIDGET_DESTROY_AFTER_IDLE_SECS)).await;

        let lifecycle = app.state::<WidgetWindowLifecycleState>();
        if !lifecycle.should_destroy_hidden_window(hide_generation) {
            return;
        }

        let Some(window) = app.get_webview_window(WIDGET_WINDOW_LABEL) else {
            return;
        };

        if let Err(error) = window.destroy() {
            eprintln!("[widget] failed to destroy idle widget window: {error}");
        }
    });
}

fn emit_widget_runtime_collapsed<R: Runtime>(app: &AppHandle<R>) {
    let _ = app.emit(WIDGET_RUNTIME_COLLAPSED_EVENT, ());
}

fn emit_widget_runtime_shown<R: Runtime>(app: &AppHandle<R>) {
    let _ = app.emit(WIDGET_RUNTIME_SHOWN_EVENT, ());
}

fn park_widget_window<R: Runtime>(window: &WebviewWindow<R>) {
    let _ = window.hide();
    let _ = window.set_focusable(false);
    let _ = window.set_always_on_top(false);
    let _ = window.set_ignore_cursor_events(true);
    let _ = window.set_size(Size::Physical(PhysicalSize::new(1, 1)));
    let _ = window.set_position(Position::Physical(PhysicalPosition::new(-32_000, -32_000)));
}

fn is_main_window_visible<R: Runtime>(app: &AppHandle<R>) -> bool {
    app.get_webview_window(crate::app::tray::MAIN_WINDOW_LABEL)
        .and_then(|window| window.is_visible().ok())
        .unwrap_or(false)
}

pub(crate) fn resolve_widget_monitor<R: Runtime>(
    app: &AppHandle<R>,
    preferred_monitor: Option<Monitor>,
    placement: &WidgetPlacement,
) -> Result<Monitor, String> {
    if let Some(saved_monitor) = placement.monitor.as_ref() {
        let monitors = app
            .available_monitors()
            .map_err(|error| format!("failed to enumerate widget monitors: {error}"))?;
        let affinities = monitors
            .iter()
            .map(widget_monitor_affinity)
            .collect::<Vec<_>>();
        if let Some(index) = match_widget_monitor(saved_monitor, &affinities) {
            return Ok(monitors[index].clone());
        }
    }

    preferred_monitor
        .or_else(|| {
            app.get_webview_window(WIDGET_WINDOW_LABEL)
                .filter(|window| window.is_visible().ok() == Some(true))
                .and_then(|window| window.current_monitor().ok().flatten())
        })
        .or_else(|| {
            app.get_webview_window(crate::app::tray::MAIN_WINDOW_LABEL)
                .and_then(|window| window.current_monitor().ok().flatten())
        })
        .or_else(|| app.primary_monitor().ok().flatten())
        .ok_or_else(|| "failed to resolve widget monitor".to_string())
}

fn widget_monitor_affinity(monitor: &Monitor) -> WidgetMonitorAffinity {
    let work_area = monitor.work_area();
    WidgetMonitorAffinity::new(
        monitor.name().cloned(),
        WidgetPhysicalRect::new(
            work_area.position.x,
            work_area.position.y,
            work_area.size.width,
            work_area.size.height,
        ),
    )
}

fn apply_widget_bounds<R: Runtime>(
    window: &WebviewWindow<R>,
    bounds: WidgetPhysicalBounds,
) -> Result<(), String> {
    let _ = window.set_shadow(false);
    window
        .set_size(Size::Physical(PhysicalSize::new(
            bounds.width,
            bounds.height,
        )))
        .map_err(|error| format!("failed to size widget window: {error}"))?;
    window
        .set_position(Position::Physical(PhysicalPosition::new(
            bounds.x, bounds.y,
        )))
        .map_err(|error| format!("failed to position widget window: {error}"))?;
    Ok(())
}

async fn apply_widget_layout_internal<R: Runtime + 'static>(
    app: &AppHandle<R>,
    preferred_monitor: Option<Monitor>,
    placement: WidgetPlacement,
    expanded: bool,
    focus_after_show: bool,
    show_object_slot: bool,
    allow_visible_main_window: bool,
) -> Result<(), String> {
    if !allow_visible_main_window && is_main_window_visible(app) {
        close_widget_window(app);
        return Ok(());
    }

    let monitor = resolve_widget_monitor(app, preferred_monitor, &placement)?;
    let logical_size = resolve_widget_logical_size(expanded, show_object_slot);
    let bounds = resolve_widget_bounds(&monitor, &placement, logical_size);
    let lifecycle = app.state::<WidgetWindowLifecycleState>();

    if let Some(window) = app.get_webview_window(WIDGET_WINDOW_LABEL) {
        lifecycle.show_existing();
        if !expanded {
            emit_widget_runtime_collapsed(app);
        }
        if let Err(error) = show_widget_window_instance(&window, bounds, focus_after_show) {
            close_widget_window(app);
            return Err(error);
        }
        emit_widget_runtime_shown(app);
        return Ok(());
    }

    let logical_x = f64::from(bounds.x) / monitor.scale_factor();
    let logical_y = f64::from(bounds.y) / monitor.scale_factor();
    let webview_root = storage_paths::resolve_storage_paths(app)?.webview_root;
    if !lifecycle.begin_show() {
        return Err("widget window creation is already in progress".to_string());
    }

    let builder = WebviewWindowBuilder::new(
        app,
        WIDGET_WINDOW_LABEL,
        WebviewUrl::App("index.html".into()),
    )
    .title(WIDGET_TITLE)
    .position(logical_x, logical_y)
    .inner_size(
        f64::from(logical_size.width),
        f64::from(logical_size.height),
    )
    .resizable(false)
    .maximizable(false)
    .minimizable(false)
    .closable(false)
    .decorations(false)
    .shadow(false)
    .transparent(true)
    .always_on_top(true)
    .skip_taskbar(true)
    .focusable(true)
    .focused(false)
    .visible(false)
    .data_directory(webview_root);

    #[cfg(debug_assertions)]
    let builder = apply_e2e_widget_browser_args(builder);

    let window = builder.build().map_err(|error| {
        let _ = lifecycle.finish_show();
        format!("failed to create widget window: {error}")
    })?;

    if !lifecycle.finish_show() {
        park_widget_window(&window);
        return Err("widget show was cancelled before creation completed".to_string());
    }

    if let Err(error) = show_widget_window_instance(&window, bounds, focus_after_show) {
        close_widget_window(app);
        return Err(error);
    }
    emit_widget_runtime_shown(app);
    Ok(())
}

fn show_widget_window_instance<R: Runtime>(
    window: &WebviewWindow<R>,
    bounds: WidgetPhysicalBounds,
    focus_after_show: bool,
) -> Result<(), String> {
    let _ = window.set_ignore_cursor_events(false);
    let _ = window.set_always_on_top(true);
    apply_widget_bounds(window, bounds)?;
    let _ = window.set_focusable(true);
    let _ = window.set_shadow(false);
    window
        .show()
        .map_err(|error| format!("failed to show widget window: {error}"))?;
    if focus_after_show {
        let _ = window.set_focus();
    }
    match window.is_visible() {
        Ok(true) => {}
        Ok(false) => return Err("widget window remained hidden after show".to_string()),
        Err(error) => {
            return Err(format!(
                "failed to verify widget window visibility after show: {error}"
            ))
        }
    }
    Ok(())
}

#[cfg(debug_assertions)]
fn fail_widget_show_for_e2e_if_requested() -> Result<(), String> {
    if std::env::var("PATINA_E2E").as_deref() != Ok("1") {
        return Ok(());
    }

    let requested_failures = std::env::var("PATINA_E2E_WIDGET_SHOW_FAILURES")
        .ok()
        .and_then(|raw| raw.parse::<usize>().ok())
        .unwrap_or(0);
    let attempt = E2E_WIDGET_SHOW_FAILURE_COUNT.fetch_add(1, Ordering::Relaxed);
    if attempt < requested_failures {
        return Err(format!(
            "forced E2E widget show failure {}/{}",
            attempt + 1,
            requested_failures
        ));
    }

    Ok(())
}

#[cfg(not(debug_assertions))]
fn fail_widget_show_for_e2e_if_requested() -> Result<(), String> {
    Ok(())
}

#[cfg(debug_assertions)]
fn apply_e2e_widget_browser_args<R: Runtime>(
    builder: WebviewWindowBuilder<'_, R, AppHandle<R>>,
) -> WebviewWindowBuilder<'_, R, AppHandle<R>> {
    if std::env::var("PATINA_E2E").as_deref() != Ok("1") {
        return builder;
    }

    let devtools_port = std::env::var("PATINA_E2E_DEVTOOLS_PORT")
        .expect("PATINA_E2E_DEVTOOLS_PORT is required when PATINA_E2E=1")
        .parse::<u16>()
        .expect("PATINA_E2E_DEVTOOLS_PORT must be a valid TCP port");
    builder.additional_browser_args(&format!(
        "--remote-debugging-port={devtools_port} \
         --disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection"
    ))
}

fn resolve_widget_logical_size(expanded: bool, show_object_slot: bool) -> WidgetLogicalSize {
    if expanded {
        let width = if show_object_slot {
            WIDGET_EXPANDED_LOGICAL_WIDTH_WITH_OBJECT
        } else {
            WIDGET_EXPANDED_LOGICAL_WIDTH_COMPACT
        };
        WidgetLogicalSize {
            width,
            height: WIDGET_EXPANDED_LOGICAL_HEIGHT,
            visible_width: width,
        }
    } else {
        WidgetLogicalSize {
            width: WIDGET_COLLAPSED_LOGICAL_WIDTH,
            height: WIDGET_COLLAPSED_LOGICAL_HEIGHT,
            visible_width: WIDGET_COLLAPSED_VISIBLE_LOGICAL_WIDTH,
        }
    }
}

fn logical_dimension_to_physical(logical: u32, scale_factor: f64) -> u32 {
    debug_assert!(scale_factor.is_finite() && scale_factor > 0.0);
    let safe_scale_factor = if scale_factor.is_finite() && scale_factor > 0.0 {
        scale_factor
    } else {
        1.0
    };
    (f64::from(logical) * safe_scale_factor).round().max(1.0) as u32
}

fn resolve_widget_physical_size(
    logical_size: WidgetLogicalSize,
    scale_factor: f64,
) -> WidgetPhysicalSize {
    WidgetPhysicalSize {
        width: logical_dimension_to_physical(logical_size.width, scale_factor),
        height: logical_dimension_to_physical(logical_size.height, scale_factor),
        visible_width: logical_dimension_to_physical(logical_size.visible_width, scale_factor),
    }
}

fn resolve_widget_bounds(
    monitor: &Monitor,
    placement: &WidgetPlacement,
    logical_size: WidgetLogicalSize,
) -> WidgetPhysicalBounds {
    let physical_size = resolve_widget_physical_size(logical_size, monitor.scale_factor());
    let work_area = monitor.work_area();
    resolve_widget_bounds_from_work_area(
        work_area.position.x,
        work_area.position.y,
        work_area.size.width,
        work_area.size.height,
        placement,
        physical_size,
    )
}

fn resolve_widget_bounds_from_work_area(
    work_x: i32,
    work_y: i32,
    work_width: u32,
    work_height: u32,
    placement: &WidgetPlacement,
    physical_size: WidgetPhysicalSize,
) -> WidgetPhysicalBounds {
    let max_y_offset = work_height.saturating_sub(physical_size.height);
    let y_offset = (placement.anchor_y * f64::from(max_y_offset)).round() as i32;
    let y = work_y + y_offset;
    let hidden_offset = physical_size
        .width
        .saturating_sub(physical_size.visible_width) as i32;
    let x = match placement.side {
        WidgetSide::Left => work_x - hidden_offset,
        WidgetSide::Right => {
            work_x + work_width as i32 - physical_size.width as i32 + hidden_offset
        }
    };

    WidgetPhysicalBounds {
        x,
        y,
        width: physical_size.width,
        height: physical_size.height,
    }
}

#[cfg(test)]
mod tests {
    use super::{
        resolve_widget_bounds_from_work_area, resolve_widget_logical_size,
        resolve_widget_physical_size, WidgetPhysicalBounds, WidgetPhysicalSize,
    };
    use crate::domain::widget::{WidgetPlacement, WidgetSide};

    #[test]
    fn widget_bounds_snap_to_expected_collapsed_edge_and_height() {
        let left = resolve_widget_bounds_from_work_area(
            0,
            0,
            1920,
            1040,
            &WidgetPlacement::new(WidgetSide::Left, 0.5),
            WidgetPhysicalSize {
                width: 64,
                height: 48,
                visible_width: 64,
            },
        );
        assert_eq!(
            left,
            WidgetPhysicalBounds {
                x: 0,
                y: 496,
                width: 64,
                height: 48,
            }
        );

        let right = resolve_widget_bounds_from_work_area(
            0,
            0,
            1920,
            1040,
            &WidgetPlacement::new(WidgetSide::Right, 0.0),
            WidgetPhysicalSize {
                width: 64,
                height: 48,
                visible_width: 64,
            },
        );
        assert_eq!(right.x, 1856);
        assert_eq!(right.y, 0);
    }

    #[test]
    fn widget_bounds_snap_to_expected_expanded_edge_and_height() {
        let left = resolve_widget_bounds_from_work_area(
            0,
            0,
            1920,
            1040,
            &WidgetPlacement::new(WidgetSide::Left, 0.5),
            WidgetPhysicalSize {
                width: 228,
                height: 48,
                visible_width: 228,
            },
        );
        assert_eq!(
            left,
            WidgetPhysicalBounds {
                x: 0,
                y: 496,
                width: 228,
                height: 48,
            }
        );

        let right = resolve_widget_bounds_from_work_area(
            0,
            0,
            1920,
            1040,
            &WidgetPlacement::new(WidgetSide::Right, 0.0),
            WidgetPhysicalSize {
                width: 228,
                height: 48,
                visible_width: 228,
            },
        );
        assert_eq!(right.x, 1692);
        assert_eq!(right.y, 0);
    }

    #[test]
    fn widget_bounds_snap_to_expected_compact_expanded_width() {
        let right = resolve_widget_bounds_from_work_area(
            0,
            0,
            1920,
            1040,
            &WidgetPlacement::new(WidgetSide::Right, 0.0),
            WidgetPhysicalSize {
                width: 184,
                height: 48,
                visible_width: 184,
            },
        );

        assert_eq!(right.x, 1736);
        assert_eq!(right.y, 0);
        assert_eq!(right.width, 184);
    }

    #[test]
    fn widget_logical_sizes_map_to_expected_physical_sizes_at_supported_dpi_scales() {
        let cases = [
            (
                false,
                false,
                1.0,
                WidgetPhysicalSize {
                    width: 64,
                    height: 48,
                    visible_width: 64,
                },
            ),
            (
                false,
                false,
                1.25,
                WidgetPhysicalSize {
                    width: 80,
                    height: 60,
                    visible_width: 80,
                },
            ),
            (
                false,
                false,
                1.5,
                WidgetPhysicalSize {
                    width: 96,
                    height: 72,
                    visible_width: 96,
                },
            ),
            (
                false,
                false,
                2.0,
                WidgetPhysicalSize {
                    width: 128,
                    height: 96,
                    visible_width: 128,
                },
            ),
            (
                true,
                false,
                1.0,
                WidgetPhysicalSize {
                    width: 184,
                    height: 48,
                    visible_width: 184,
                },
            ),
            (
                true,
                false,
                1.25,
                WidgetPhysicalSize {
                    width: 230,
                    height: 60,
                    visible_width: 230,
                },
            ),
            (
                true,
                false,
                1.5,
                WidgetPhysicalSize {
                    width: 276,
                    height: 72,
                    visible_width: 276,
                },
            ),
            (
                true,
                false,
                2.0,
                WidgetPhysicalSize {
                    width: 368,
                    height: 96,
                    visible_width: 368,
                },
            ),
            (
                true,
                true,
                1.0,
                WidgetPhysicalSize {
                    width: 228,
                    height: 48,
                    visible_width: 228,
                },
            ),
            (
                true,
                true,
                1.25,
                WidgetPhysicalSize {
                    width: 285,
                    height: 60,
                    visible_width: 285,
                },
            ),
            (
                true,
                true,
                1.5,
                WidgetPhysicalSize {
                    width: 342,
                    height: 72,
                    visible_width: 342,
                },
            ),
            (
                true,
                true,
                2.0,
                WidgetPhysicalSize {
                    width: 456,
                    height: 96,
                    visible_width: 456,
                },
            ),
        ];

        for (expanded, show_object_slot, scale_factor, expected) in cases {
            let logical_size = resolve_widget_logical_size(expanded, show_object_slot);
            assert_eq!(
                resolve_widget_physical_size(logical_size, scale_factor),
                expected
            );
        }
    }

    #[test]
    fn widget_bounds_stay_inside_representative_work_areas_across_dpi_matrix() {
        let resolutions = [
            (1280_u32, 720_u32),
            (1366, 768),
            (1600, 900),
            (1920, 1080),
            (2560, 1440),
            (3840, 2160),
        ];
        let scales = [1.0_f64, 1.25, 1.5, 2.0];
        let states = [(false, false), (true, false), (true, true)];
        let sides = [WidgetSide::Left, WidgetSide::Right];
        let anchors = [0.0_f64, 0.5, 1.0];
        let mut case_count = 0;

        for (resolution_width, resolution_height) in resolutions {
            for scale_factor in scales {
                let taskbar_height = (48.0 * scale_factor).round() as u32;
                let work_height = resolution_height.saturating_sub(taskbar_height);

                for (expanded, show_object_slot) in states {
                    let logical_size = resolve_widget_logical_size(expanded, show_object_slot);
                    let physical_size = resolve_widget_physical_size(logical_size, scale_factor);

                    for side in sides {
                        for anchor_y in anchors {
                            case_count += 1;
                            let bounds = resolve_widget_bounds_from_work_area(
                                0,
                                0,
                                resolution_width,
                                work_height,
                                &WidgetPlacement::new(side, anchor_y),
                                physical_size,
                            );

                            assert!(bounds.x >= 0);
                            assert!(bounds.y >= 0);
                            assert!(bounds.x + bounds.width as i32 <= resolution_width as i32);
                            assert!(bounds.y + bounds.height as i32 <= work_height as i32);

                            let expected_x = match side {
                                WidgetSide::Left => 0,
                                WidgetSide::Right => {
                                    resolution_width as i32 - physical_size.width as i32
                                }
                            };
                            assert_eq!(bounds.x, expected_x);
                            if anchor_y == 0.0 {
                                assert_eq!(bounds.y, 0);
                            } else if anchor_y == 1.0 {
                                assert_eq!(bounds.y + bounds.height as i32, work_height as i32);
                            }
                        }
                    }
                }
            }
        }

        assert_eq!(case_count, 432);
    }

    #[test]
    fn widget_bounds_preserve_negative_monitor_origins() {
        let physical_size =
            resolve_widget_physical_size(resolve_widget_logical_size(true, true), 1.5);
        let left = resolve_widget_bounds_from_work_area(
            -2560,
            -1440,
            2560,
            1368,
            &WidgetPlacement::new(WidgetSide::Left, 0.0),
            physical_size,
        );
        let right = resolve_widget_bounds_from_work_area(
            -2560,
            -1440,
            2560,
            1368,
            &WidgetPlacement::new(WidgetSide::Right, 1.0),
            physical_size,
        );

        assert_eq!(left.x, -2560);
        assert_eq!(left.y, -1440);
        assert_eq!(right.x + right.width as i32, 0);
        assert_eq!(right.y + right.height as i32, -72);
    }

    #[test]
    fn widget_bounds_use_offset_work_areas_for_top_and_left_taskbars() {
        let placement = WidgetPlacement::new(WidgetSide::Right, 1.0);
        let bounds = resolve_widget_bounds_from_work_area(
            48,
            64,
            1872,
            976,
            &placement,
            WidgetPhysicalSize {
                width: 80,
                height: 60,
                visible_width: 80,
            },
        );

        assert_eq!(bounds.x, 1840);
        assert_eq!(bounds.y, 980);
        assert_eq!(bounds.x + bounds.width as i32, 1920);
        assert_eq!(bounds.y + bounds.height as i32, 1040);
    }
}
