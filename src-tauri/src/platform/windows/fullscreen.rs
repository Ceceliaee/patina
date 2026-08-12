use crate::domain::widget::WidgetPhysicalRect;
use std::mem::size_of;
use windows::Win32::Foundation::RECT;
use windows::Win32::Graphics::Gdi::{
    GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST,
};
use windows::Win32::UI::WindowsAndMessaging::{
    GetClassNameW, GetForegroundWindow, GetWindowRect, IsIconic, IsWindowVisible, IsZoomed,
};

const FULLSCREEN_EDGE_TOLERANCE_PX: i32 = 2;
const DESKTOP_WINDOW_CLASSES: [&str; 4] = [
    "Progman",
    "WorkerW",
    "Shell_TrayWnd",
    "Shell_SecondaryTrayWnd",
];

pub(crate) fn foreground_fullscreen_monitor(
    excluded_window_handle: Option<usize>,
) -> Option<WidgetPhysicalRect> {
    unsafe {
        let window = GetForegroundWindow();
        if window.0.is_null()
            || excluded_window_handle == Some(window.0 as usize)
            || !IsWindowVisible(window).as_bool()
            || IsIconic(window).as_bool()
            || is_desktop_window(window)
        {
            return None;
        }

        let mut window_rect = RECT::default();
        GetWindowRect(window, &mut window_rect).ok()?;

        let monitor = MonitorFromWindow(window, MONITOR_DEFAULTTONEAREST);
        if monitor.is_invalid() {
            return None;
        }

        let mut monitor_info = MONITORINFO {
            cbSize: size_of::<MONITORINFO>() as u32,
            ..Default::default()
        };
        if !GetMonitorInfoW(monitor, &mut monitor_info).as_bool() {
            return None;
        }

        let monitor_rect = physical_rect(monitor_info.rcMonitor)?;
        is_true_fullscreen(
            window_rect,
            monitor_info.rcMonitor,
            IsZoomed(window).as_bool(),
            FULLSCREEN_EDGE_TOLERANCE_PX,
        )
        .then_some(monitor_rect)
    }
}

unsafe fn is_desktop_window(window: windows::Win32::Foundation::HWND) -> bool {
    let mut buffer = [0u16; 128];
    let length = GetClassNameW(window, &mut buffer);
    if length <= 0 {
        return false;
    }

    let class_name = String::from_utf16_lossy(&buffer[..length as usize]);
    DESKTOP_WINDOW_CLASSES
        .iter()
        .any(|desktop_class| class_name.eq_ignore_ascii_case(desktop_class))
}

fn is_true_fullscreen(window: RECT, monitor: RECT, is_zoomed: bool, tolerance: i32) -> bool {
    if is_zoomed {
        return false;
    }

    let tolerance = tolerance.max(0);
    window.left <= monitor.left.saturating_add(tolerance)
        && window.top <= monitor.top.saturating_add(tolerance)
        && window.right >= monitor.right.saturating_sub(tolerance)
        && window.bottom >= monitor.bottom.saturating_sub(tolerance)
}

fn physical_rect(rect: RECT) -> Option<WidgetPhysicalRect> {
    let width = rect.right.checked_sub(rect.left)?;
    let height = rect.bottom.checked_sub(rect.top)?;
    (width > 0 && height > 0)
        .then(|| WidgetPhysicalRect::new(rect.left, rect.top, width as u32, height as u32))
}

#[cfg(test)]
mod tests {
    use super::{is_true_fullscreen, physical_rect};
    use crate::domain::widget::WidgetPhysicalRect;
    use windows::Win32::Foundation::RECT;

    #[test]
    fn fullscreen_geometry_requires_every_monitor_edge() {
        let monitor = RECT {
            left: 0,
            top: 0,
            right: 1920,
            bottom: 1080,
        };

        assert!(is_true_fullscreen(monitor, monitor, false, 2));
        assert!(is_true_fullscreen(
            RECT {
                left: -1,
                top: 1,
                right: 1921,
                bottom: 1079,
            },
            monitor,
            false,
            2,
        ));
        assert!(!is_true_fullscreen(
            RECT {
                left: 0,
                top: 0,
                right: 1920,
                bottom: 1040,
            },
            monitor,
            false,
            2,
        ));
        assert!(!is_true_fullscreen(
            RECT {
                left: 8,
                top: 0,
                right: 1920,
                bottom: 1080,
            },
            monitor,
            false,
            2,
        ));
        assert!(!is_true_fullscreen(monitor, monitor, true, 2));
    }

    #[test]
    fn monitor_rect_conversion_rejects_empty_geometry() {
        assert_eq!(
            physical_rect(RECT {
                left: -1920,
                top: 0,
                right: 0,
                bottom: 1080,
            }),
            Some(WidgetPhysicalRect::new(-1920, 0, 1920, 1080))
        );
        assert_eq!(physical_rect(RECT::default()), None);
    }
}
