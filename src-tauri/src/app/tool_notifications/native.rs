use super::WINDOW_LABEL;
use crate::domain::window_geometry::PhysicalRect;
use tauri::{AppHandle, Manager, Runtime, WebviewUrl, WebviewWindowBuilder};

pub(super) fn create<R: Runtime + 'static>(app: &AppHandle<R>) -> Result<(), String> {
    let root = crate::platform::storage_paths::resolve_storage_paths(app)?.webview_root;
    let builder =
        WebviewWindowBuilder::new(app, WINDOW_LABEL, WebviewUrl::App("index.html".into()))
            .title("Patina Notification")
            .inner_size(520.0, 240.0)
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
        let port = std::env::var("PATINA_E2E_DEVTOOLS_PORT").map_err(|e| e.to_string())?;
        builder.additional_browser_args(&format!("--remote-debugging-port={port} --disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection"))
    } else {
        builder
    };
    let window = builder.build().map_err(|e| e.to_string())?;
    let owner = app.clone();
    window.on_window_event(move |event| {
        // Closing a native carrier cannot confirm or discard a business reminder.
        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
        }
        if matches!(event, tauri::WindowEvent::Destroyed) {
            let owner = owner.clone();
            tauri::async_runtime::spawn(async move {
                let _ = super::refresh(&owner).await;
            });
        }
    });
    if let Err(error) =
        crate::platform::windows::window_activation::install_captionless_frame(&window)
    {
        let _ = window.destroy();
        return Err(error);
    }
    crate::app::webview_recovery::observe(
        &window,
        crate::app::webview_recovery::WindowKind::ToolNotification,
        0,
    );
    Ok(())
}

pub(super) fn show<R: Runtime>(app: &AppHandle<R>, width: f64, height: f64) -> Result<(), String> {
    if !width.is_finite() || !(1.0..=4096.0).contains(&width) {
        return Err("Invalid notification width".into());
    }
    if !height.is_finite() || !(1.0..=4096.0).contains(&height) {
        return Err("Invalid notification height".into());
    }
    let window = app
        .get_webview_window(WINDOW_LABEL)
        .ok_or("Notification window is unavailable")?;
    let monitor = if window.is_visible().unwrap_or(false) {
        window.current_monitor().ok().flatten()
    } else {
        crate::platform::windows::notification_window::foreground_point()
            .and_then(|(x, y)| app.monitor_from_point(x, y).ok().flatten())
    }
    .or_else(|| app.primary_monitor().ok().flatten())
    .ok_or("No notification display available")?;
    let area = monitor.work_area();
    let scale = monitor.scale_factor();
    let rect = placement(
        PhysicalRect::new(
            area.position.x,
            area.position.y,
            area.size.width,
            area.size.height,
        ),
        scale,
        width,
        height,
    );
    crate::platform::windows::window_activation::position_without_activation(&window, rect)?;
    crate::platform::windows::notification_window::show_without_activation(&window)
}

fn placement(area: PhysicalRect, scale: f64, width: f64, height: f64) -> PhysicalRect {
    let margin = (16.0 * scale).round() as u32;
    let margin_x = margin.min(area.width.saturating_sub(1) / 2);
    let margin_y = margin.min(area.height.saturating_sub(1) / 2);
    let width = ((width.ceil() + 4.0) * scale).round() as u32;
    let width = width.min(area.width.saturating_sub(margin_x * 2)).max(1);
    let height = ((height.ceil() + 4.0) * scale).round() as u32;
    let height = height.min(area.height.saturating_sub(margin_y * 2)).max(1);
    PhysicalRect::new(
        area.x + area.width as i32 - width as i32 - margin_x as i32,
        area.y + area.height as i32 - height as i32 - margin_y as i32,
        width,
        height,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn notification_placement_respects_dpi_negative_origins_and_small_work_areas() {
        for area in [
            PhysicalRect::new(0, 48, 1920, 1032),
            PhysicalRect::new(-2560, -400, 2480, 1440),
            PhysicalRect::new(0, 0, 200, 120),
        ] {
            for scale in [1.0, 1.25, 1.5, 2.0] {
                for height in [240.0, 4000.0] {
                    let rect = placement(area, scale, 486.0, height);
                    assert!(rect.x >= area.x && rect.y >= area.y);
                    assert!(rect.right() <= area.right() && rect.bottom() <= area.bottom());
                    assert!(rect.width > 0 && rect.height > 0);
                }
            }
        }
        assert_eq!(
            placement(PhysicalRect::new(0, 0, 1920, 1080), 1.5, 400.0, 240.0).width,
            606
        );
    }
}
