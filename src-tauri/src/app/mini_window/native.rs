use crate::domain::mini_window::geometry::{
    match_monitor, select_monitor, select_monitor_for_release, MonitorAffinity,
};
use crate::domain::mini_window::{bounds, Placement, Rect};
use crate::domain::window_geometry::PhysicalPoint;
use tauri::{
    AppHandle, Manager, Monitor, Runtime, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
};

pub(super) fn affinity(monitor: &Monitor) -> MonitorAffinity {
    let area = monitor.work_area();
    MonitorAffinity::new(
        monitor.name().cloned(),
        Rect::new(
            area.position.x,
            area.position.y,
            area.size.width,
            area.size.height,
        ),
    )
}

pub(super) fn monitor<R: Runtime>(
    app: &AppHandle<R>,
    placement: &Placement,
) -> Result<Monitor, String> {
    let monitors = app.available_monitors().map_err(|e| e.to_string())?;
    let saved = placement
        .monitor
        .as_ref()
        .and_then(|saved| match_monitor(saved, &monitors.iter().map(affinity).collect::<Vec<_>>()));
    saved
        .and_then(|index| monitors.get(index).cloned())
        .or_else(|| {
            if placement.monitor.is_some() {
                return app.primary_monitor().ok().flatten();
            }
            app.get_webview_window("main")
                .and_then(|window| window.current_monitor().ok().flatten())
        })
        .or_else(|| app.primary_monitor().ok().flatten())
        .ok_or_else(|| "No display is available for the mini window".to_string())
}

pub(super) fn release_monitor<R: Runtime>(
    app: &AppHandle<R>,
    rect: Rect,
) -> Result<Monitor, String> {
    let monitors = app.available_monitors().map_err(|e| e.to_string())?;
    let cursor = app
        .cursor_position()
        .ok()
        .map(|p| PhysicalPoint::new(p.x.round() as i32, p.y.round() as i32));
    let affinities = monitors.iter().map(affinity).collect::<Vec<_>>();
    let index = cursor
        .and_then(|point| select_monitor_for_release(point, &affinities))
        .or_else(|| select_monitor(&rect, &affinities))
        .ok_or_else(|| "No display is available for mini window release".to_string())?;
    Ok(monitors[index].clone())
}

pub(super) fn rect<R: Runtime>(window: &WebviewWindow<R>) -> Result<Rect, String> {
    let position = window.outer_position().map_err(|e| e.to_string())?;
    let size = window.outer_size().map_err(|e| e.to_string())?;
    Ok(Rect::new(position.x, position.y, size.width, size.height))
}

pub(super) fn apply_bounds<R: Runtime>(
    window: &WebviewWindow<R>,
    bounds: Rect,
) -> Result<(), String> {
    if rect(window).ok() == Some(bounds) {
        return Ok(());
    }
    crate::platform::windows::window_activation::position_without_activation(window, bounds)
}

pub(super) fn create<R: Runtime + 'static>(
    app: &AppHandle<R>,
    placement: &Placement,
    epoch: u64,
) -> Result<WebviewWindow<R>, String> {
    let monitor = monitor(app, placement)?;
    let rect = bounds(
        placement,
        true,
        affinity(&monitor).work_area,
        monitor.scale_factor(),
    );
    let root = crate::platform::storage_paths::resolve_storage_paths(app)?.webview_root;
    let builder = WebviewWindowBuilder::new(app, "mini", WebviewUrl::App("index.html".into()))
        .title("Patina Mini")
        .inner_size(304.0, 240.0)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .decorations(false)
        .shadow(false)
        .transparent(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .focusable(true)
        .focused(false)
        .visible(false)
        .data_directory(root);
    #[cfg(debug_assertions)]
    let builder = if std::env::var("PATINA_E2E").as_deref() == Ok("1") {
        let port = std::env::var("PATINA_E2E_DEVTOOLS_PORT")
            .map_err(|e| e.to_string())?
            .parse::<u16>()
            .map_err(|e| e.to_string())?;
        builder.additional_browser_args(&format!("--remote-debugging-port={port} --disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection"))
    } else {
        builder
    };
    let window = builder.build().map_err(|e| e.to_string())?;
    let owner = app.clone();
    window.on_window_event(move |event| {
        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            let app = owner.clone();
            tauri::async_runtime::spawn(async move {
                let _ = super::action(&app, epoch, super::Action::Close).await;
            });
        }
    });
    if let Err(error) =
        crate::platform::windows::window_activation::install_captionless_frame(&window)
            .and_then(|()| apply_bounds(&window, rect))
    {
        let _ = window.destroy();
        return Err(error);
    }
    super::super::webview_recovery::observe(
        &window,
        super::super::webview_recovery::WindowKind::Mini,
        0,
    );
    Ok(window)
}

pub(super) fn fullscreen<R: Runtime>(window: &WebviewWindow<R>, monitor: &Monitor) -> bool {
    let excluded = window.hwnd().ok().map(|hwnd| hwnd.0 as usize);
    let rect = Rect::new(
        monitor.position().x,
        monitor.position().y,
        monitor.size().width,
        monitor.size().height,
    );
    crate::platform::windows::fullscreen::foreground_fullscreen_monitor(excluded) == Some(rect)
}
