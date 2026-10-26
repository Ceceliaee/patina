use tauri::{Runtime, WebviewWindow};
use windows::Win32::Foundation::{HWND, RECT};
use windows::Win32::Graphics::Gdi::{
    CreateRectRgn, DeleteObject, GetWindowRgnBox, SetWindowRgn, HRGN, SIMPLEREGION,
};
use windows::Win32::UI::WindowsAndMessaging::{
    BringWindowToTop, IsIconic, IsWindow, IsWindowVisible, SetForegroundWindow, SetWindowPos,
    ShowWindow, ShowWindowAsync, HWND_TOP, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOOWNERZORDER,
    SWP_NOSIZE, SWP_NOZORDER, SWP_SHOWWINDOW, SW_RESTORE, SW_SHOW,
};

pub(crate) fn position_without_activation<R: Runtime>(
    window: &WebviewWindow<R>,
    rect: crate::domain::window_geometry::PhysicalRect,
) -> Result<(), String> {
    let hwnd = native_hwnd(window)?;
    unsafe {
        SetWindowPos(
            hwnd,
            None,
            rect.x,
            rect.y,
            rect.width as i32,
            rect.height as i32,
            SWP_NOACTIVATE | SWP_NOZORDER | SWP_NOOWNERZORDER,
        )
        .map_err(|error| format!("failed to position window: {error}"))
    }
}

pub(crate) fn clip_without_activation<R: Runtime>(
    window: &WebviewWindow<R>,
    region: crate::domain::window_geometry::PhysicalRect,
) -> Result<(), String> {
    set_region(native_hwnd(window)?, region)
}

fn set_region(
    hwnd: HWND,
    region: crate::domain::window_geometry::PhysicalRect,
) -> Result<(), String> {
    let desired = RECT {
        left: region.x,
        top: region.y,
        right: region.x + region.width as i32,
        bottom: region.y + region.height as i32,
    };
    unsafe {
        let mut current = RECT::default();
        if GetWindowRgnBox(hwnd, &mut current) == SIMPLEREGION && current == desired {
            return Ok(());
        }
        let handle = CreateRectRgn(desired.left, desired.top, desired.right, desired.bottom);
        if handle.is_invalid() {
            return Err("failed to create window region".into());
        }
        let mut owned = WindowRegion(Some(handle));
        if SetWindowRgn(hwnd, Some(handle), true) == 0 {
            return Err("failed to apply window region".into());
        }
        // Windows owns a successfully applied region, including its replacement
        // and destruction. Failed calls leave ownership with the guard.
        owned.0 = None;
        Ok(())
    }
}

struct WindowRegion(Option<HRGN>);
impl Drop for WindowRegion {
    fn drop(&mut self) {
        if let Some(region) = self.0 {
            unsafe {
                let _ = DeleteObject(region.into());
            }
        }
    }
}

pub(crate) fn is_native_window_alive<R: Runtime>(
    window: &WebviewWindow<R>,
) -> Result<bool, String> {
    let hwnd = native_hwnd(window)?;
    Ok(unsafe { !hwnd.0.is_null() && IsWindow(Some(hwnd)).as_bool() })
}

pub(crate) fn is_native_window_visible<R: Runtime>(
    window: &WebviewWindow<R>,
) -> Result<bool, String> {
    let hwnd = native_hwnd(window)?;
    Ok(unsafe {
        !hwnd.0.is_null() && IsWindow(Some(hwnd)).as_bool() && IsWindowVisible(hwnd).as_bool()
    })
}

pub(crate) fn restore_to_foreground<R: Runtime>(window: &WebviewWindow<R>) -> Result<(), String> {
    let hwnd = native_hwnd(window)?;

    unsafe {
        if hwnd.0.is_null() || !IsWindow(Some(hwnd)).as_bool() {
            return Err("window handle is no longer valid".to_string());
        }

        let show_command = if IsIconic(hwnd).as_bool() {
            SW_RESTORE
        } else {
            SW_SHOW
        };

        let _ = ShowWindowAsync(hwnd, show_command);
        let _ = ShowWindow(hwnd, show_command);

        SetWindowPos(
            hwnd,
            Some(HWND_TOP),
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW,
        )
        .map_err(|error| format!("failed to bring window to top: {error}"))?;

        if !SetForegroundWindow(hwnd).as_bool() {
            BringWindowToTop(hwnd)
                .map_err(|error| format!("failed to bring window to foreground: {error}"))?;
        }

        if !IsWindowVisible(hwnd).as_bool() {
            return Err("native window stayed hidden after restore".to_string());
        }
    }

    Ok(())
}

fn native_hwnd<R: Runtime>(window: &WebviewWindow<R>) -> Result<HWND, String> {
    let hwnd = window
        .hwnd()
        .map_err(|error| format!("failed to read native window handle: {error}"))?;

    Ok(HWND(hwnd.0.cast()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::window_geometry::PhysicalRect;
    use windows::core::w;
    use windows::Win32::System::Threading::{GetCurrentProcess, GetGuiResources, GR_GDIOBJECTS};
    use windows::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, DestroyWindow, GetWindowRect, WINDOW_EX_STYLE, WS_POPUP,
    };

    struct HiddenWindow(HWND);
    impl Drop for HiddenWindow {
        fn drop(&mut self) {
            unsafe {
                let _ = DestroyWindow(self.0);
            }
        }
    }

    #[test]
    fn region_changes_preserve_canvas_and_release_gdi_on_success_and_failure() {
        unsafe {
            let window = HiddenWindow(
                CreateWindowExW(
                    WINDOW_EX_STYLE::default(),
                    w!("STATIC"),
                    w!("Patina region test"),
                    WS_POPUP,
                    100,
                    100,
                    304,
                    240,
                    None,
                    None,
                    None,
                    None,
                )
                .unwrap(),
            );
            let mut before = RECT::default();
            GetWindowRect(window.0, &mut before).unwrap();
            let full = PhysicalRect::new(0, 0, 304, 240);
            let bar = PhysicalRect::new(96, 0, 112, 24);
            set_region(window.0, bar).unwrap();
            let baseline = GetGuiResources(GetCurrentProcess(), GR_GDIOBJECTS);
            for _ in 0..200 {
                set_region(window.0, full).unwrap();
                set_region(window.0, bar).unwrap();
                set_region(window.0, bar).unwrap();
                assert!(set_region(HWND::default(), bar).is_err());
            }
            let mut after = RECT::default();
            GetWindowRect(window.0, &mut after).unwrap();
            assert_eq!(before, after);
            let mut clip = RECT::default();
            assert_eq!(GetWindowRgnBox(window.0, &mut clip), SIMPLEREGION);
            assert_eq!(
                clip,
                RECT {
                    left: 96,
                    top: 0,
                    right: 208,
                    bottom: 24
                }
            );
            // Other parallel Rust tests may allocate resources in this process;
            // a leaked region per call would exceed this small allowance.
            assert!(GetGuiResources(GetCurrentProcess(), GR_GDIOBJECTS) <= baseline + 16);
        }
    }
}
