use tauri::{Runtime, WebviewWindow};
use windows::Win32::{
    Foundation::RECT,
    UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowRect, ShowWindow, SW_SHOWNOACTIVATE},
};

pub(crate) fn foreground_point() -> Option<(f64, f64)> {
    unsafe {
        let hwnd = GetForegroundWindow();
        let mut rect = RECT::default();
        GetWindowRect(hwnd, &mut rect).ok()?;
        Some((
            (f64::from(rect.left) + f64::from(rect.right)) / 2.0,
            (f64::from(rect.top) + f64::from(rect.bottom)) / 2.0,
        ))
    }
}

pub(crate) fn show_without_activation<R: Runtime>(window: &WebviewWindow<R>) -> Result<(), String> {
    let hwnd = window.hwnd().map_err(|e| e.to_string())?;
    unsafe {
        let _ = ShowWindow(windows::Win32::Foundation::HWND(hwnd.0), SW_SHOWNOACTIVATE);
    }
    if !crate::platform::windows::window_activation::is_native_window_visible(window)? {
        return Err("Notification window did not become visible".into());
    }
    Ok(())
}
