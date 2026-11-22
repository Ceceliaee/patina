use super::geometry::{CORNER_RADIUS, Monitor};
use crate::windows::placement::hwnd;
use gpui_kit::{Bounds, DisplayId, Pixels, Point, Size, Window, px, size};
use patina_activity_model::views::mini::{MonitorAffinity, Rect};
use windows::Win32::{
    Foundation::{HWND, LPARAM, POINT, RECT},
    Graphics::Gdi::{
        ClientToScreen, CombineRgn, CreateRectRgnIndirect, CreateRoundRectRgn, EnumDisplayMonitors,
        GetMonitorInfoW, HDC, HMONITOR, HRGN, MONITOR_DEFAULTTONEAREST, MONITOR_DEFAULTTOPRIMARY,
        MONITORINFOEXW, MonitorFromPoint, MonitorFromWindow, RGN_AND, SetWindowRgn,
    },
    UI::{
        HiDpi::{GetDpiForMonitor, GetDpiForWindow, MDT_EFFECTIVE_DPI},
        Input::KeyboardAndMouse::GetCapture,
        WindowsAndMessaging::{
            GetClientRect, GetCursorPos, GetWindowRect, SPI_GETCLIENTAREAANIMATION, SWP_NOACTIVATE,
            SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER, SWP_SHOWWINDOW, SetForegroundWindow,
            SetWindowPos, SystemParametersInfoW, WindowFromPoint,
        },
    },
};
use windows::core::Owned;

fn monitor(handle: HMONITOR) -> windows::core::Result<Monitor> {
    let mut info = MONITORINFOEXW::default();
    info.monitorInfo.cbSize = size_of::<MONITORINFOEXW>() as u32;
    let mut dpi = 96;
    let mut dpi_y = 96;
    unsafe {
        GetMonitorInfoW(handle, &raw mut info.monitorInfo).ok()?;
        GetDpiForMonitor(handle, MDT_EFFECTIVE_DPI, &mut dpi, &mut dpi_y)?;
    }
    let area = info.monitorInfo.rcWork;
    let end = info
        .szDevice
        .iter()
        .position(|c| *c == 0)
        .unwrap_or(info.szDevice.len());
    Ok(Monitor {
        affinity: MonitorAffinity {
            name: Some(String::from_utf16_lossy(&info.szDevice[..end])),
            work_area: Rect {
                x: area.left,
                y: area.top,
                width: area.right.abs_diff(area.left),
                height: area.bottom.abs_diff(area.top),
            },
        },
        scale: dpi as f32 / 96.,
    })
}

pub fn window_monitor(window: &Window) -> Result<Monitor, String> {
    monitor(unsafe { MonitorFromWindow(hwnd(window)?, MONITOR_DEFAULTTONEAREST) })
        .map_err(|e| e.to_string())
}

pub fn client_size(window: &Window) -> Option<Size<Pixels>> {
    let mut rect = RECT::default();
    unsafe { GetClientRect(hwnd(window).ok()?, &mut rect) }.ok()?;
    let scale = window.scale_factor();
    Some(size(
        px(rect.right as f32 / scale),
        px(rect.bottom as f32 / scale),
    ))
}

pub fn restore_monitor(saved: Option<&MonitorAffinity>) -> Result<Monitor, String> {
    if let Some(saved) = saved {
        unsafe extern "system" fn collect(
            handle: HMONITOR,
            _: HDC,
            _: *mut RECT,
            data: LPARAM,
        ) -> windows::core::BOOL {
            if let Ok(info) = monitor(handle) {
                unsafe {
                    (*(data.0 as *mut Vec<Monitor>)).push(info);
                }
            }
            true.into()
        }
        let mut monitors: Vec<Monitor> = Vec::new();
        unsafe {
            EnumDisplayMonitors(
                None,
                None,
                Some(collect),
                LPARAM((&raw mut monitors) as isize),
            )
            .ok()
        }
        .map_err(|e| e.to_string())?;
        let name = |s: &str| s.trim_start_matches(r"\\.\").to_ascii_lowercase();
        if let Some(found) = monitors
            .iter()
            .find(|m| {
                saved
                    .name
                    .as_ref()
                    .zip(m.affinity.name.as_ref())
                    .is_some_and(|(a, b)| name(a) == name(b))
            })
            .or_else(|| {
                monitors
                    .iter()
                    .find(|m| m.affinity.work_area == saved.work_area)
            })
        {
            return Ok(found.clone());
        }
    }
    monitor(unsafe { MonitorFromPoint(POINT::default(), MONITOR_DEFAULTTOPRIMARY) })
        .map_err(|e| e.to_string())
}

pub fn display_for(panel: Rect) -> DisplayId {
    let center = POINT {
        x: panel.x.saturating_add_unsigned(panel.width / 2),
        y: panel.y.saturating_add_unsigned(panel.height / 2),
    };
    DisplayId::new(unsafe { MonitorFromPoint(center, MONITOR_DEFAULTTONEAREST) }.0 as u64)
}

pub fn show(window: &Window, panel: Rect, focus: bool) -> Result<(), String> {
    let handle = hwnd(window)?;
    let scale = unsafe { GetDpiForWindow(handle) } as f32 / 96.;
    clip_client(
        handle,
        RECT {
            right: panel.width as i32,
            bottom: panel.height as i32,
            ..Default::default()
        },
        scale,
    )?;
    unsafe {
        SetWindowPos(
            handle,
            None,
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_SHOWWINDOW,
        )
        .map_err(|e| e.to_string())?;
    }
    if focus {
        activate(window);
    }
    Ok(())
}

pub fn activate(window: &Window) {
    if let Ok(handle) = hwnd(window) {
        let _ = unsafe { SetForegroundWindow(handle) };
    }
}

pub fn pointer_monitor(point: (i32, i32)) -> Result<Monitor, String> {
    monitor(unsafe {
        MonitorFromPoint(
            POINT {
                x: point.0,
                y: point.1,
            },
            MONITOR_DEFAULTTONEAREST,
        )
    })
    .map_err(|e| e.to_string())
}

pub fn captured(window: &Window) -> bool {
    hwnd(window).is_ok_and(|handle| unsafe { GetCapture() } == handle)
}

pub fn screen_point(window: &Window, local: Point<Pixels>) -> Result<(i32, i32), String> {
    let scale = window.scale_factor();
    let mut point = POINT {
        x: (f32::from(local.x) * scale).round() as i32,
        y: (f32::from(local.y) * scale).round() as i32,
    };
    unsafe { ClientToScreen(hwnd(window)?, &mut point).ok() }.map_err(|e| e.to_string())?;
    Ok((point.x, point.y))
}

pub fn place(window: &Window, bounds: Rect) -> Result<(), String> {
    let hwnd = hwnd(window)?;
    let dpi = unsafe { GetDpiForWindow(hwnd) };
    place_client(hwnd, bounds)?;
    // WM_DPICHANGED can replace the requested bounds and the invisible frame.
    if unsafe { GetDpiForWindow(hwnd) } != dpi {
        place_client(hwnd, bounds)?;
    }
    Ok(())
}

fn place_client(hwnd: HWND, bounds: Rect) -> Result<(), String> {
    unsafe {
        let mut outer = RECT::default();
        let mut client = RECT::default();
        let mut origin = POINT::default();
        GetWindowRect(hwnd, &mut outer).map_err(|e| e.to_string())?;
        GetClientRect(hwnd, &mut client).map_err(|e| e.to_string())?;
        ClientToScreen(hwnd, &mut origin)
            .ok()
            .map_err(|e| e.to_string())?;
        if (origin.x, origin.y, client.right, client.bottom)
            == (
                bounds.x,
                bounds.y,
                bounds.width as i32,
                bounds.height as i32,
            )
        {
            return Ok(());
        }
        SetWindowPos(
            hwnd,
            None,
            bounds.x - (origin.x - outer.left),
            bounds.y - (origin.y - outer.top),
            bounds.width as i32 + (outer.right - outer.left) - client.right,
            bounds.height as i32 + (outer.bottom - outer.top) - client.bottom,
            SWP_NOACTIVATE | SWP_NOZORDER,
        )
        .map_err(|e| e.to_string())
    }
}

pub fn animations_enabled() -> bool {
    let mut enabled = windows::core::BOOL::from(true);
    unsafe {
        let _ = SystemParametersInfoW(
            SPI_GETCLIENTAREAANIMATION,
            0,
            Some((&raw mut enabled).cast()),
            Default::default(),
        );
    }
    enabled.as_bool()
}

pub fn contains_cursor(window: &Window) -> bool {
    let Ok(hwnd) = hwnd(window) else {
        return window.is_window_hovered();
    };
    let mut cursor = POINT::default();
    unsafe { GetCursorPos(&mut cursor).is_ok() && WindowFromPoint(cursor) == hwnd }
}

/// The compositor and Windows hit testing use the same visible portion of a
/// fixed-size client surface. Changing this region does not resize the swap chain.
pub fn clip(window: &Window, bounds: Bounds<Pixels>) -> Result<(), String> {
    let scale = window.scale_factor();
    let physical = |v: Pixels| (f32::from(v) * scale).round() as i32;
    clip_client(
        hwnd(window)?,
        RECT {
            left: physical(bounds.origin.x),
            top: physical(bounds.origin.y),
            right: physical(bounds.right()),
            bottom: physical(bounds.bottom()),
        },
        scale,
    )
}

fn clip_client(hwnd: HWND, bounds: RECT, scale: f32) -> Result<(), String> {
    unsafe {
        let mut outer = RECT::default();
        let mut origin = POINT::default();
        GetWindowRect(hwnd, &mut outer).map_err(|e| e.to_string())?;
        ClientToScreen(hwnd, &mut origin)
            .ok()
            .map_err(|e| e.to_string())?;
        let x = origin.x - outer.left;
        let y = origin.y - outer.top;
        let region = window_region(
            RECT {
                left: x + bounds.left,
                top: y + bounds.top,
                right: x + bounds.right,
                bottom: y + bounds.bottom,
            },
            scale,
        )?;
        if SetWindowRgn(hwnd, Some(*region), false) == 0 {
            return Err("could not apply Mini region".into());
        }
        // On success Windows takes ownership of the region.
        std::mem::forget(region);
    }
    Ok(())
}

fn window_region(bounds: RECT, scale: f32) -> Result<Owned<HRGN>, String> {
    // GDI rounds the arc inward at its tangents. Let the compositor paint the
    // antialiased edge, while the straight sides retain their exact hit bounds.
    const FRINGE: i32 = 2;
    let diameter = (2. * CORNER_RADIUS * scale).round() as i32 + 2 * FRINGE;
    unsafe {
        let region = Owned::new(CreateRectRgnIndirect(&bounds));
        let arc = Owned::new(CreateRoundRectRgn(
            bounds.left - FRINGE,
            bounds.top - FRINGE,
            bounds.right + FRINGE + 1,
            bounds.bottom + FRINGE + 1,
            diameter,
            diameter,
        ));
        if region.is_invalid()
            || arc.is_invalid()
            || CombineRgn(Some(*region), Some(*region), Some(*arc), RGN_AND).0 == 0
        {
            return Err("could not build Mini window region".into());
        }
        Ok(region)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use windows::Win32::Graphics::Gdi::{GetRgnBox, PtInRegion};

    #[test]
    fn native_region_keeps_the_painted_arcs_inside_the_panel_and_handle_bounds() {
        for scale in [1_f32, 1.25, 1.5, 1.75, 2., 3.] {
            for (width, height) in [(320., 240.), (112., 24.), (24., 88.)] {
                let bounds = RECT {
                    left: 17,
                    top: 31,
                    right: 17 + (width * scale).round() as i32,
                    bottom: 31 + (height * scale).round() as i32,
                };
                let region = window_region(bounds, scale).unwrap();
                let mut actual = RECT::default();
                unsafe {
                    GetRgnBox(*region, &mut actual);
                }
                assert_eq!(actual, bounds);
                let radius = CORNER_RADIUS * scale;
                for y in 0..radius.ceil() as i32 {
                    for x in 0..radius.ceil() as i32 {
                        let distance = (radius - x as f32 - 0.5).hypot(radius - y as f32 - 0.5);
                        for (px, py) in [
                            (bounds.left + x, bounds.top + y),
                            (bounds.right - 1 - x, bounds.top + y),
                            (bounds.left + x, bounds.bottom - 1 - y),
                            (bounds.right - 1 - x, bounds.bottom - 1 - y),
                        ] {
                            let inside = unsafe { PtInRegion(*region, px, py) }.as_bool();
                            if distance <= radius + 0.5 {
                                assert!(inside, "trimmed arc at ({px},{py}), scale {scale}");
                            } else if x == 0 && y == 0 {
                                assert!(!inside, "transparent corner accepts pointer input");
                            }
                        }
                    }
                }
            }
        }
    }
}
