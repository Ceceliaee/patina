use gpui_kit::{Bounds, Pixels, Window};
use patina_activity_model::{MiniRect, Placement, mini_bounds};
use raw_window_handle::{HasWindowHandle, RawWindowHandle};
use windows::Win32::{
    Foundation::{HWND, POINT, RECT},
    Graphics::Gdi::{
        ClientToScreen, CreateRoundRectRgn, DeleteObject, GetMonitorInfoW,
        MONITOR_DEFAULTTONEAREST, MONITORINFO, MonitorFromWindow, SetWindowRgn,
    },
    UI::WindowsAndMessaging::{
        GetClientRect, GetCursorPos, GetWindowRect, SPI_GETCLIENTAREAANIMATION, SWP_NOACTIVATE,
        SWP_NOZORDER, SetWindowPos, SystemParametersInfoW, WindowFromPoint,
    },
};

pub(crate) use patina_windows_integration::enable_monitor_dpi;

pub(crate) fn hwnd(window: &Window) -> Result<HWND, String> {
    let raw = HasWindowHandle::window_handle(window).map_err(|e| e.to_string())?;
    let RawWindowHandle::Win32(raw) = raw.as_raw() else {
        return Err("expected a Windows window".into());
    };
    Ok(HWND(raw.hwnd.get() as _))
}

pub(crate) fn place_notification(window: &Window) -> Result<(), String> {
    use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, HWND_TOPMOST, SWP_NOSIZE};
    let handle = hwnd(window)?;
    unsafe {
        let mut info = MONITORINFO {
            cbSize: size_of::<MONITORINFO>() as u32,
            ..Default::default()
        };
        GetMonitorInfoW(
            MonitorFromWindow(GetForegroundWindow(), MONITOR_DEFAULTTONEAREST),
            &mut info,
        )
        .ok()
        .map_err(|e| e.to_string())?;
        let mut bounds = RECT::default();
        GetWindowRect(handle, &mut bounds).map_err(|e| e.to_string())?;
        let gap = (16.0 * window.scale_factor()).round() as i32;
        let x = (info.rcWork.right - (bounds.right - bounds.left) - gap).max(info.rcWork.left);
        let y = (info.rcWork.bottom - (bounds.bottom - bounds.top) - gap).max(info.rcWork.top);
        SetWindowPos(
            handle,
            Some(HWND_TOPMOST),
            x,
            y,
            0,
            0,
            SWP_NOSIZE | SWP_NOACTIVATE,
        )
        .map_err(|e| e.to_string())
    }
}

/// Place the fixed Mini canvas without moving keyboard focus away from the editor.
pub fn place(window: &Window) -> Result<(), String> {
    let hwnd = hwnd(window)?;
    unsafe {
        let mut info = MONITORINFO {
            cbSize: size_of::<MONITORINFO>() as u32,
            ..Default::default()
        };
        GetMonitorInfoW(MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST), &mut info)
            .ok()
            .map_err(|e| e.to_string())?;
        let work = info.rcWork;
        let r = mini_bounds(
            &Placement::default(),
            true,
            MiniRect::new(
                work.left,
                work.top,
                (work.right - work.left) as u32,
                (work.bottom - work.top) as u32,
            ),
            window.scale_factor().into(),
        );
        // The shared bounds describe the clickable client area, whereas
        // SetWindowPos includes the invisible Windows frame.
        let mut outer = RECT::default();
        let mut client = RECT::default();
        let mut origin = POINT::default();
        GetWindowRect(hwnd, &mut outer).map_err(|e| e.to_string())?;
        GetClientRect(hwnd, &mut client).map_err(|e| e.to_string())?;
        ClientToScreen(hwnd, &mut origin)
            .ok()
            .map_err(|e| e.to_string())?;
        SetWindowPos(
            hwnd,
            None,
            r.x - (origin.x - outer.left),
            r.y - (origin.y - outer.top),
            r.width as i32 + (outer.right - outer.left) - client.right,
            r.height as i32 + (outer.bottom - outer.top) - client.bottom,
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
    let hwnd = hwnd(window)?;
    let scale = window.scale_factor();
    let physical = |v: Pixels| (f32::from(v) * scale).round() as i32;
    unsafe {
        let mut outer = RECT::default();
        let mut origin = POINT::default();
        GetWindowRect(hwnd, &mut outer).map_err(|e| e.to_string())?;
        ClientToScreen(hwnd, &mut origin)
            .ok()
            .map_err(|e| e.to_string())?;
        let x = origin.x - outer.left;
        let y = origin.y - outer.top;
        let radius = (16. * scale).round() as i32;
        let region = CreateRoundRectRgn(
            x + physical(bounds.origin.x),
            y + physical(bounds.origin.y),
            x + physical(bounds.right()) + 1,
            y + physical(bounds.bottom()) + 1,
            radius,
            radius,
        );
        if region.is_invalid() {
            return Err("could not allocate Mini region".into());
        }
        if SetWindowRgn(hwnd, Some(region), false) == 0 {
            let _ = DeleteObject(region.into());
            return Err("could not apply Mini region".into());
        }
        // On success Windows takes ownership of the region.
    }
    Ok(())
}
