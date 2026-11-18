use std::cell::Cell;
use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};
use windows::{
    Win32::{
        Foundation::{HWND, LPARAM, LRESULT, POINT, WPARAM},
        Graphics::Gdi::*,
        System::LibraryLoader::GetModuleHandleW,
        UI::{HiDpi::*, WindowsAndMessaging::*},
    },
    core::{HSTRING, w},
};

pub(crate) struct Selection(Arc<AtomicBool>);
type PickResult = Result<Option<u32>, String>;

impl Drop for Selection {
    fn drop(&mut self) {
        self.0.store(true, Ordering::Release);
    }
}

pub(crate) fn start(
    owner: isize,
    title: String,
) -> Result<(Selection, async_channel::Receiver<PickResult>), String> {
    let cancelled = Arc::new(AtomicBool::new(false));
    let worker_cancelled = cancelled.clone();
    let (tx, rx) = async_channel::bounded(1);
    std::thread::Builder::new()
        .name("screen-color-picker".into())
        .spawn(move || {
            let result = unsafe { select(HWND(owner as *mut _), &title, &worker_cancelled) };
            let _ = tx.send_blocking(result.map_err(|e| e.to_string()));
        })
        .map_err(|e| e.to_string())?;
    Ok((Selection(cancelled), rx))
}

struct Snapshot {
    dc: HDC,
    bitmap: HBITMAP,
    previous: HGDIOBJ,
    x: i32,
    y: i32,
    width: i32,
    height: i32,
}

impl Snapshot {
    unsafe fn capture() -> windows::core::Result<Self> {
        unsafe {
            let screen = GetDC(None);
            if screen.is_invalid() {
                return Err(windows::core::Error::from_thread());
            }
            let width = GetSystemMetrics(SM_CXVIRTUALSCREEN);
            let height = GetSystemMetrics(SM_CYVIRTUALSCREEN);
            let dc = CreateCompatibleDC(Some(screen));
            let bitmap = CreateCompatibleBitmap(screen, width, height);
            if dc.is_invalid() || bitmap.is_invalid() {
                let error = windows::core::Error::from_thread();
                if !dc.is_invalid() {
                    let _ = DeleteDC(dc);
                }
                if !bitmap.is_invalid() {
                    let _ = DeleteObject(bitmap.into());
                }
                ReleaseDC(None, screen);
                return Err(error);
            }
            let snapshot = Self {
                dc,
                bitmap,
                previous: SelectObject(dc, bitmap.into()),
                x: GetSystemMetrics(SM_XVIRTUALSCREEN),
                y: GetSystemMetrics(SM_YVIRTUALSCREEN),
                width,
                height,
            };
            let result = BitBlt(
                dc,
                0,
                0,
                width,
                height,
                Some(screen),
                snapshot.x,
                snapshot.y,
                SRCCOPY | CAPTUREBLT,
            );
            ReleaseDC(None, screen);
            result?;
            Ok(snapshot)
        }
    }

    unsafe fn color(&self, x: i32, y: i32) -> Option<u32> {
        if x < 0 || y < 0 || x >= self.width || y >= self.height {
            return None;
        }
        let color = unsafe { GetPixel(self.dc, x, y) }.0;
        (color != 0xffff_ffff)
            .then_some(((color & 255) << 16) | (color & 0xff00) | ((color >> 16) & 255))
    }
}

impl Drop for Snapshot {
    fn drop(&mut self) {
        unsafe {
            SelectObject(self.dc, self.previous);
            let _ = DeleteObject(self.bitmap.into());
            let _ = DeleteDC(self.dc);
        }
    }
}

struct Picker {
    snapshot: Snapshot,
    done: Cell<bool>,
    color: Cell<Option<u32>>,
}

unsafe extern "system" fn procedure(
    hwnd: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    unsafe {
        if message == WM_NCCREATE {
            let create = &*(lparam.0 as *const CREATESTRUCTW);
            SetWindowLongPtrW(hwnd, GWLP_USERDATA, create.lpCreateParams as isize);
        }
        let state = GetWindowLongPtrW(hwnd, GWLP_USERDATA) as *mut Picker;
        if !state.is_null() {
            let picker = &*state;
            match message {
                WM_PAINT => {
                    let mut paint = PAINTSTRUCT::default();
                    let dc = BeginPaint(hwnd, &mut paint);
                    let _ = BitBlt(
                        dc,
                        0,
                        0,
                        picker.snapshot.width,
                        picker.snapshot.height,
                        Some(picker.snapshot.dc),
                        0,
                        0,
                        SRCCOPY,
                    );
                    let _ = EndPaint(hwnd, &paint);
                    return LRESULT(0);
                }
                WM_ERASEBKGND => return LRESULT(1),
                WM_LBUTTONUP => {
                    let x = lparam.0 as u16 as i16 as i32;
                    let y = (lparam.0 >> 16) as u16 as i16 as i32;
                    picker.color.set(picker.snapshot.color(x, y));
                    picker.done.set(true);
                    return LRESULT(0);
                }
                WM_KEYDOWN if wparam.0 == 13 => {
                    let mut point = POINT::default();
                    if GetCursorPos(&mut point).is_ok() {
                        picker.color.set(
                            picker
                                .snapshot
                                .color(point.x - picker.snapshot.x, point.y - picker.snapshot.y),
                        );
                    }
                    picker.done.set(true);
                    return LRESULT(0);
                }
                WM_KEYDOWN if wparam.0 == 27 => picker.done.set(true),
                WM_CLOSE | WM_RBUTTONUP => {
                    picker.done.set(true);
                    return LRESULT(0);
                }
                WM_ACTIVATE if wparam.0 & 0xffff == WA_INACTIVE as usize => picker.done.set(true),
                WM_DISPLAYCHANGE | WM_DESTROY => picker.done.set(true),
                _ => {}
            }
        }
        DefWindowProcW(hwnd, message, wparam, lparam)
    }
}

unsafe fn select(
    owner: HWND,
    title: &str,
    cancelled: &AtomicBool,
) -> windows::core::Result<Option<u32>> {
    unsafe {
        SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
        let snapshot = Snapshot::capture()?;
        select_snapshot(owner, title, cancelled, snapshot)
    }
}

unsafe fn select_snapshot(
    owner: HWND,
    title: &str,
    cancelled: &AtomicBool,
    snapshot: Snapshot,
) -> windows::core::Result<Option<u32>> {
    unsafe {
        if cancelled.load(Ordering::Acquire) {
            return Ok(None);
        }
        let instance = GetModuleHandleW(None)?;
        let class = w!("Patina.ScreenColorPicker");
        let descriptor = WNDCLASSW {
            lpfnWndProc: Some(procedure),
            hInstance: instance.into(),
            lpszClassName: class,
            hCursor: LoadCursorW(None, IDC_CROSS)?,
            ..Default::default()
        };
        RegisterClassW(&descriptor);
        let picker = Picker {
            snapshot,
            done: Cell::new(false),
            color: Cell::new(None),
        };
        let hwnd = CreateWindowExW(
            WS_EX_TOPMOST | WS_EX_TOOLWINDOW,
            class,
            &HSTRING::from(title),
            WS_POPUP,
            picker.snapshot.x,
            picker.snapshot.y,
            picker.snapshot.width,
            picker.snapshot.height,
            Some(owner),
            None,
            Some(instance.into()),
            Some((&picker as *const Picker).cast()),
        )?;
        if !cancelled.load(Ordering::Acquire) {
            let _ = ShowWindow(hwnd, SW_SHOW);
            let _ = SetForegroundWindow(hwnd);
            let _ = UpdateWindow(hwnd);
        }
        while !picker.done.get() && !cancelled.load(Ordering::Acquire) {
            let mut message = MSG::default();
            while PeekMessageW(&mut message, None, 0, 0, PM_REMOVE).as_bool() {
                if message.message == WM_QUIT {
                    picker.done.set(true);
                    break;
                }
                let _ = TranslateMessage(&message);
                DispatchMessageW(&message);
            }
            if !picker.done.get() {
                MsgWaitForMultipleObjectsEx(None, 50, QS_ALLINPUT, MWMO_INPUTAVAILABLE);
            }
        }
        let _ = DestroyWindow(hwnd);
        Ok(if cancelled.load(Ordering::Acquire) {
            None
        } else {
            picker.color.get()
        })
    }
}

#[cfg(test)]
mod tests {
    use super::Snapshot;
    #[cfg(feature = "native-tests")]
    use super::{Selection, select_snapshot};
    #[cfg(feature = "native-tests")]
    use std::{
        sync::{Arc, atomic::AtomicBool},
        time::{Duration, Instant},
    };
    use windows::Win32::{
        Foundation::COLORREF,
        Graphics::Gdi::*,
        System::Threading::{GR_GDIOBJECTS, GetCurrentProcess, GetGuiResources},
    };
    #[cfg(feature = "native-tests")]
    use windows::Win32::{
        Foundation::{HWND, LPARAM, WPARAM},
        UI::WindowsAndMessaging::*,
    };
    #[cfg(feature = "native-tests")]
    use windows::core::w;

    #[test]
    fn sampled_rgb_and_gdi_cleanup() {
        unsafe {
            let sample = || {
                let screen = GetDC(None);
                let dc = CreateCompatibleDC(Some(screen));
                let bitmap = CreateCompatibleBitmap(screen, 2, 2);
                ReleaseDC(None, screen);
                assert!(!dc.is_invalid() && !bitmap.is_invalid());
                Snapshot {
                    dc,
                    bitmap,
                    previous: SelectObject(dc, bitmap.into()),
                    x: -100,
                    y: -50,
                    width: 2,
                    height: 2,
                }
            };
            drop(sample());
            let before = GetGuiResources(GetCurrentProcess(), GR_GDIOBJECTS);
            for _ in 0..16 {
                let bitmap = sample();
                assert!(SetPixelV(bitmap.dc, 1, 1, COLORREF(0xC06020)).as_bool());
                assert_eq!(bitmap.color(1, 1), Some(0x2060C0));
                assert_eq!(bitmap.color(-1, 1), None);
                assert_eq!(bitmap.color(2, 0), None);
            }
            assert_eq!(GetGuiResources(GetCurrentProcess(), GR_GDIOBJECTS), before);
        }
    }

    #[test]
    #[cfg(feature = "native-tests")]
    #[ignore = "isolated Win32 desktop"]
    fn native_screen_selection_and_cancellation() -> Result<(), Box<dyn std::error::Error>> {
        if !patina_test_desktop::run_case()? {
            return Ok(());
        }
        for action in [WM_LBUTTONUP, WM_KEYDOWN, WM_RBUTTONUP, WM_CLOSE] {
            let flag = Arc::new(AtomicBool::new(false));
            let selection = Selection(flag.clone());
            let (tx, rx) = std::sync::mpsc::channel();
            let worker = std::thread::spawn(move || unsafe {
                let screen = GetDC(None);
                let dc = CreateCompatibleDC(Some(screen));
                let bitmap = CreateCompatibleBitmap(screen, 64, 64);
                ReleaseDC(None, screen);
                let image = Snapshot {
                    dc,
                    bitmap,
                    previous: SelectObject(dc, bitmap.into()),
                    x: -32,
                    y: -32,
                    width: 64,
                    height: 64,
                };
                SetPixelV(dc, 40, 40, COLORREF(0xC06020)).ok().unwrap();
                let result = select_snapshot(HWND::default(), "Patina test picker", &flag, image);
                tx.send(result.map_err(|e| e.to_string())).unwrap();
            });
            let started = Instant::now();
            let hwnd = loop {
                if let Ok(hwnd) =
                    unsafe { FindWindowW(w!("Patina.ScreenColorPicker"), w!("Patina test picker")) }
                {
                    break hwnd;
                }
                if started.elapsed() > Duration::from_secs(5) {
                    return Err("picker did not open".into());
                }
                std::thread::sleep(Duration::from_millis(10));
            };
            if action == WM_CLOSE {
                drop(selection);
            } else {
                unsafe {
                    PostMessageW(
                        Some(hwnd),
                        action,
                        WPARAM(if action == WM_KEYDOWN { 27 } else { 0 }),
                        LPARAM((40 << 16) | 40),
                    )?;
                }
            }
            let result = rx.recv_timeout(Duration::from_secs(5))??;
            worker.join().unwrap();
            assert_eq!(
                result,
                if action == WM_LBUTTONUP {
                    Some(0x2060C0)
                } else {
                    None
                }
            );
            assert!(!unsafe { IsWindow(Some(hwnd)) }.as_bool());
        }
        Ok(())
    }

    #[test]
    #[cfg(feature = "native-tests")]
    #[ignore = "reads desktop pixels in memory without opening windows or sending input"]
    fn desktop_screen_capture_is_readable() {
        let snapshot = unsafe { Snapshot::capture() }.expect("capture current desktop");
        assert!(snapshot.width > 0 && snapshot.height > 0);
        assert!(unsafe { snapshot.color(snapshot.width / 2, snapshot.height / 2) }.is_some());
    }
}
