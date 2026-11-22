use gpui_kit::Window;
use raw_window_handle::{HasWindowHandle, RawWindowHandle};
use windows::Win32::{
    Foundation::{HWND, LPARAM, LRESULT, RECT, WPARAM},
    Graphics::Gdi::{GetMonitorInfoW, MONITOR_DEFAULTTONEAREST, MONITORINFO, MonitorFromWindow},
    UI::{
        Shell::{DefSubclassProc, RemoveWindowSubclass, SetWindowSubclass},
        WindowsAndMessaging::{
            GetWindowRect, PostMessageW, SWP_NOACTIVATE, SetWindowPos, WM_APP, WM_NCDESTROY,
        },
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

const FIT_NOTIFICATION: u32 = WM_APP + 72;

pub(crate) fn place_notification(
    window: &Window,
    client_height: Option<i32>,
) -> Result<(), String> {
    use windows::Win32::Graphics::Dwm::{
        DWMWA_BORDER_COLOR, DWMWA_COLOR_NONE, DwmSetWindowAttribute,
    };
    let handle = hwnd(window)?;
    unsafe {
        if client_height.is_none() {
            SetWindowSubclass(handle, Some(notice_proc), 1, 0)
                .ok()
                .map_err(|e| e.to_string())?;
            let color = DWMWA_COLOR_NONE;
            let _ = DwmSetWindowAttribute(
                handle,
                DWMWA_BORDER_COLOR,
                (&raw const color).cast(),
                size_of_val(&color) as u32,
            );
        }
        PostMessageW(
            Some(handle),
            FIT_NOTIFICATION,
            WPARAM(client_height.unwrap_or(0) as usize),
            LPARAM(0),
        )
        .map_err(|e| e.to_string())
    }
}

unsafe extern "system" fn notice_proc(
    handle: HWND,
    msg: u32,
    wp: WPARAM,
    lp: LPARAM,
    id: usize,
    _: usize,
) -> LRESULT {
    if msg == FIT_NOTIFICATION {
        if let Err(e) = fit_notification(handle, (wp.0 != 0).then_some(wp.0 as i32)) {
            eprintln!("Place notification: {e}");
        }
        return LRESULT(0);
    }
    if msg == WM_NCDESTROY {
        let _ = unsafe { RemoveWindowSubclass(handle, Some(notice_proc), id) };
    }
    unsafe { DefSubclassProc(handle, msg, wp, lp) }
}

// Resize outside the GPUI update so WM_SIZE can update the window and its renderer together.
fn fit_notification(handle: HWND, client_height: Option<i32>) -> Result<(), String> {
    use windows::Win32::UI::WindowsAndMessaging::{
        GetClientRect, GetForegroundWindow, HWND_TOPMOST,
    };
    unsafe {
        let mut info = MONITORINFO {
            cbSize: size_of::<MONITORINFO>() as u32,
            ..Default::default()
        };
        GetMonitorInfoW(
            MonitorFromWindow(
                if client_height.is_some() {
                    handle
                } else {
                    GetForegroundWindow()
                },
                MONITOR_DEFAULTTONEAREST,
            ),
            &mut info,
        )
        .ok()
        .map_err(|e| e.to_string())?;
        let mut bounds = RECT::default();
        GetWindowRect(handle, &mut bounds).map_err(|e| e.to_string())?;
        let gap =
            (16.0 * windows::Win32::UI::HiDpi::GetDpiForWindow(handle) as f32 / 96.).round() as i32;
        let width = bounds.right - bounds.left;
        let mut client = RECT::default();
        GetClientRect(handle, &mut client).map_err(|e| e.to_string())?;
        let frame_height = bounds.bottom - bounds.top - (client.bottom - client.top);
        let height = (client_height.unwrap_or(client.bottom - client.top) + frame_height)
            .clamp(1, (info.rcWork.bottom - info.rcWork.top - gap).max(1));
        let x = (info.rcWork.right - width - gap).max(info.rcWork.left);
        let y = (info.rcWork.bottom - height - gap).max(info.rcWork.top);
        if client_height.is_some()
            && bounds.left == x
            && bounds.top == y
            && bounds.bottom - bounds.top == height
        {
            return Ok(());
        }
        SetWindowPos(
            handle,
            Some(HWND_TOPMOST),
            x,
            y,
            width,
            height,
            SWP_NOACTIVATE,
        )
        .map_err(|e| e.to_string())
    }
}
