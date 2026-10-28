use tauri::{Runtime, WebviewWindow};
use windows::Win32::Foundation::{
    GetLastError, SetLastError, ERROR_SUCCESS, HWND, LPARAM, LRESULT, RECT, WPARAM,
};
use windows::Win32::Graphics::Gdi::{
    CreateRectRgn, DeleteObject, GetWindowRgnBox, SetWindowRgn, HRGN, SIMPLEREGION,
};
use windows::Win32::UI::Shell::{DefSubclassProc, RemoveWindowSubclass, SetWindowSubclass};
use windows::Win32::UI::WindowsAndMessaging::{
    BringWindowToTop, GetWindowLongPtrW, IsIconic, IsWindow, IsWindowVisible, SetForegroundWindow,
    SetWindowLongPtrW, SetWindowPos, ShowWindow, ShowWindowAsync, GWL_STYLE, HWND_TOP, STYLESTRUCT,
    SWP_FRAMECHANGED, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOOWNERZORDER, SWP_NOSIZE, SWP_NOZORDER,
    SWP_SHOWWINDOW, SW_RESTORE, SW_SHOW, WM_NCACTIVATE, WM_NCDESTROY, WM_NCPAINT, WM_STYLECHANGING,
    WS_CAPTION,
};

const CAPTIONLESS_SUBCLASS_ID: usize = 1;

pub(crate) fn install_captionless_frame<R: Runtime>(
    window: &WebviewWindow<R>,
) -> Result<(), String> {
    let hwnd = native_hwnd(window)?.0 as usize;
    let (send, receive) = std::sync::mpsc::sync_channel(1);
    // Subclass installation must run on the thread that owns the HWND, before show().
    window
        .run_on_main_thread(move || {
            let _ = send.send(install_caption_guard(HWND(hwnd as *mut _)));
        })
        .map_err(|error| error.to_string())?;
    receive.recv().map_err(|error| error.to_string())?
}

fn install_caption_guard(hwnd: HWND) -> Result<(), String> {
    unsafe {
        if !SetWindowSubclass(
            hwnd,
            Some(captionless_frame_proc),
            CAPTIONLESS_SUBCLASS_ID,
            0,
        )
        .as_bool()
        {
            return Err("failed to install captionless frame handler".into());
        }
        if let Err(error) = clear_caption(hwnd) {
            let _ =
                RemoveWindowSubclass(hwnd, Some(captionless_frame_proc), CAPTIONLESS_SUBCLASS_ID);
            return Err(error);
        }
    }
    Ok(())
}

unsafe extern "system" fn captionless_frame_proc(
    hwnd: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    subclass_id: usize,
    _data: usize,
) -> LRESULT {
    unsafe {
        if message == WM_STYLECHANGING && wparam.0 as i32 == GWL_STYLE.0 && lparam.0 != 0 {
            // Tao rebuilds the native style on show/hide and other flag changes.
            // Keep its visibility and input flags, but never restore the caption.
            let style = &mut *(lparam.0 as *mut STYLESTRUCT);
            style.styleNew &= !WS_CAPTION.0;
        } else if message == WM_NCACTIVATE {
            // Preserve Tao's activation/focus handling; -1 tells DefWindowProc
            // not to paint the system caption beneath the transparent WebView.
            return DefSubclassProc(hwnd, message, wparam, LPARAM(-1));
        } else if message == WM_NCPAINT {
            return LRESULT(0);
        } else if message == WM_NCDESTROY {
            let _ = RemoveWindowSubclass(hwnd, Some(captionless_frame_proc), subclass_id);
        }
        DefSubclassProc(hwnd, message, wparam, lparam)
    }
}

fn clear_caption(hwnd: HWND) -> Result<(), String> {
    unsafe {
        if !IsWindow(Some(hwnd)).as_bool() {
            return Err("window handle is no longer valid".into());
        }
        let style = GetWindowLongPtrW(hwnd, GWL_STYLE);
        let captionless = style & !(WS_CAPTION.0 as isize);
        if style == captionless {
            return Ok(());
        }
        // Tao retains WS_CAPTION on undecorated top-level windows. Mini has no
        // native frame; activation must not repaint it under transparent pixels.
        SetLastError(ERROR_SUCCESS);
        if SetWindowLongPtrW(hwnd, GWL_STYLE, captionless) == 0 && GetLastError() != ERROR_SUCCESS {
            return Err(format!(
                "failed to remove native caption: {}",
                GetLastError().0
            ));
        }
        SetWindowPos(
            hwnd,
            None,
            0,
            0,
            0,
            0,
            SWP_FRAMECHANGED | SWP_NOACTIVATE | SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER,
        )
        .map_err(|error| format!("failed to refresh captionless frame: {error}"))
    }
}

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
    use std::cell::Cell;
    use windows::core::w;
    use windows::Win32::System::Threading::{GetCurrentProcess, GetGuiResources, GR_GDIOBJECTS};
    use windows::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, DestroyWindow, GetForegroundWindow, GetWindowRect, SendMessageW,
        WINDOW_EX_STYLE, WM_SETFOCUS, WS_DISABLED, WS_POPUP, WS_SYSMENU,
    };

    struct HiddenWindow(HWND);
    impl Drop for HiddenWindow {
        fn drop(&mut self) {
            unsafe {
                let _ = DestroyWindow(self.0);
            }
        }
    }

    #[derive(Default)]
    struct FrameMessages {
        activations: Cell<usize>,
        paints: Cell<usize>,
        focus: Cell<usize>,
    }

    unsafe extern "system" fn observe_frame_messages(
        hwnd: HWND,
        message: u32,
        wparam: WPARAM,
        lparam: LPARAM,
        id: usize,
        data: usize,
    ) -> LRESULT {
        unsafe {
            let observed = &*(data as *const FrameMessages);
            match message {
                WM_NCACTIVATE => {
                    observed.activations.set(observed.activations.get() + 1);
                    if lparam.0 != -1 {
                        observed.paints.set(observed.paints.get() + 1);
                    }
                }
                WM_NCPAINT => observed.paints.set(observed.paints.get() + 1),
                WM_SETFOCUS => observed.focus.set(observed.focus.get() + 1),
                WM_NCDESTROY => {
                    let _ = RemoveWindowSubclass(hwnd, Some(observe_frame_messages), id);
                }
                _ => {}
            }
            DefSubclassProc(hwnd, message, wparam, lparam)
        }
    }

    #[test]
    fn captionless_frame_preserves_focus_without_requesting_native_paint() {
        unsafe {
            let observed = Box::<FrameMessages>::default();
            let window = HiddenWindow(
                CreateWindowExW(
                    WINDOW_EX_STYLE::default(),
                    w!("STATIC"),
                    w!("Patina frame test"),
                    WS_POPUP | WS_CAPTION | WS_SYSMENU,
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
            assert!(SetWindowSubclass(
                window.0,
                Some(observe_frame_messages),
                1,
                &*observed as *const FrameMessages as usize
            )
            .as_bool());
            install_caption_guard(window.0).unwrap();
            observed.activations.set(0);
            observed.paints.set(0);
            observed.focus.set(0);
            for active in [1, 0, 1] {
                SendMessageW(
                    window.0,
                    WM_NCACTIVATE,
                    Some(WPARAM(active)),
                    Some(LPARAM(0)),
                );
            }
            SendMessageW(window.0, WM_NCPAINT, Some(WPARAM(1)), None);
            SendMessageW(window.0, WM_SETFOCUS, None, None);
            assert_eq!(
                observed.activations.get(),
                3,
                "framework must observe activation changes"
            );
            assert_eq!(
                observed.focus.get(),
                1,
                "framework must still deliver keyboard focus"
            );
            assert_eq!(
                observed.paints.get(),
                0,
                "custom frame must not request default titlebar painting"
            );
        }
    }

    #[test]
    fn captionless_overlay_keeps_geometry_and_activation_without_a_native_frame() {
        unsafe {
            let window = HiddenWindow(
                CreateWindowExW(
                    WINDOW_EX_STYLE::default(),
                    w!("STATIC"),
                    w!("Patina caption test"),
                    WS_POPUP | WS_CAPTION | WS_SYSMENU,
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
            let style = GetWindowLongPtrW(window.0, GWL_STYLE);
            assert_ne!(style & WS_CAPTION.0 as isize, 0);
            install_caption_guard(window.0).unwrap();
            install_caption_guard(window.0).unwrap();
            for active in [1, 0, 1] {
                // Tao rebuilds GWL_STYLE when visibility or other flags change.
                let next = style
                    | if active == 0 {
                        WS_DISABLED.0 as isize
                    } else {
                        0
                    };
                SetWindowLongPtrW(window.0, GWL_STYLE, next);
                SendMessageW(
                    window.0,
                    WM_NCACTIVATE,
                    Some(windows::Win32::Foundation::WPARAM(active)),
                    None,
                );
                assert_eq!(
                    GetWindowLongPtrW(window.0, GWL_STYLE),
                    next & !(WS_CAPTION.0 as isize)
                );
            }
            let mut after = RECT::default();
            GetWindowRect(window.0, &mut after).unwrap();
            assert_eq!(before, after);
            assert_ne!(GetForegroundWindow(), window.0);
            assert!(!IsWindowVisible(window.0).as_bool());
            assert!(clear_caption(HWND::default()).is_err());
            assert!(install_caption_guard(HWND::default()).is_err());
            let hwnd = window.0;
            drop(window);
            assert!(!IsWindow(Some(hwnd)).as_bool());
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
