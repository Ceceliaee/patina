use gpui_kit::Window;
use raw_window_handle::{HasWindowHandle, RawWindowHandle};
use windows::Win32::{
    Foundation::{HWND, RECT},
    Graphics::Gdi::{GetMonitorInfoW, MONITOR_DEFAULTTONEAREST, MONITORINFO, MonitorFromWindow},
    UI::WindowsAndMessaging::{GetWindowRect, SWP_NOACTIVATE, SetWindowPos},
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
