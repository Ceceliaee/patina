use async_channel::Sender;
use patina_recorder::Recorder;
use std::cell::RefCell;
use std::rc::Rc;
use windows::Win32::System::RemoteDesktop::{
    NOTIFY_FOR_THIS_SESSION, WTSRegisterSessionNotification, WTSUnRegisterSessionNotification,
};
use windows::{
    Win32::{
        Foundation::{HINSTANCE, HWND, LPARAM, LRESULT, POINT, WPARAM},
        System::LibraryLoader::GetModuleHandleW,
        UI::{Shell::*, WindowsAndMessaging::*},
    },
    core::{Error, Result, w},
};

#[derive(Clone, Copy, Debug)]
pub enum Action {
    Mini { focus: bool },
    Today,
    SetPaused(bool),
    Refresh,
    ToolNotice { dialog: bool },
    ToolChanged { background: bool },
    WakeTools,
    Exit,
}

const CALLBACK: u32 = WM_APP + 1;
const NIN_KEYSELECT: u32 = NIN_SELECT | NINF_KEY;
const TODAY: usize = 4;
const OPEN: usize = 1;
const EXIT: usize = 2;
const TOGGLE: usize = 3;
const CLASS: windows::core::PCWSTR = w!("Patina.GPUI.Tray");

// Windows dispatches this class on GPUI's UI thread, including while the
// native menu is tracking. Never hold a RefCell borrow across menu dispatch.
thread_local! {
    static STATE: RefCell<Option<Dispatch>> = const { RefCell::new(None) };
}

#[derive(Clone)]
struct Dispatch {
    send: Sender<Action>,
    icon: HICON,
    restart: u32,
    recorder: Rc<Recorder>,
}

pub struct Tray {
    hwnd: HWND,
    icon: HICON,
    instance: HINSTANCE,
}

fn data(hwnd: HWND, icon: HICON) -> NOTIFYICONDATAW {
    let mut d = NOTIFYICONDATAW {
        cbSize: std::mem::size_of::<NOTIFYICONDATAW>() as u32,
        hWnd: hwnd,
        uID: 1,
        uFlags: NIF_ICON | NIF_MESSAGE | NIF_TIP | NIF_SHOWTIP,
        uCallbackMessage: CALLBACK,
        hIcon: icon,
        ..Default::default()
    };
    for (slot, ch) in d.szTip.iter_mut().zip("Patina · GPUI".encode_utf16()) {
        *slot = ch;
    }
    d
}

fn register_icon(hwnd: HWND, icon: HICON) -> Result<()> {
    let mut d = data(hwnd, icon);
    unsafe {
        Shell_NotifyIconW(NIM_ADD, &d).ok()?;
        d.Anonymous.uVersion = NOTIFYICON_VERSION_4;
        Shell_NotifyIconW(NIM_SETVERSION, &d).ok()
    }
}

impl Tray {
    pub fn new(sender: Sender<Action>, recorder: Rc<Recorder>) -> Result<Self> {
        unsafe {
            let instance: HINSTANCE = GetModuleHandleW(None)?.into();
            let class = WNDCLASSW {
                hInstance: instance,
                lpszClassName: CLASS,
                lpfnWndProc: Some(dispatch),
                ..Default::default()
            };
            if RegisterClassW(&class) == 0 {
                return Err(Error::from_thread());
            }
            let hwnd = match CreateWindowExW(
                WS_EX_TOOLWINDOW,
                CLASS,
                w!("Patina GPUI"),
                WS_POPUP,
                0,
                0,
                0,
                0,
                None,
                None,
                Some(instance),
                None,
            ) {
                Ok(hwnd) => hwnd,
                Err(e) => {
                    let _ = UnregisterClassW(CLASS, Some(instance));
                    return Err(e);
                }
            };
            let icon = match CreateIconFromResourceEx(
                include_bytes!("../../../src-tauri/icons/32x32.png"),
                true,
                0x30000,
                GetSystemMetrics(SM_CXSMICON),
                GetSystemMetrics(SM_CYSMICON),
                LR_DEFAULTCOLOR,
            ) {
                Ok(icon) => icon,
                Err(e) => {
                    let _ = DestroyWindow(hwnd);
                    let _ = UnregisterClassW(CLASS, Some(instance));
                    return Err(e);
                }
            };
            let tray = Self {
                hwnd,
                icon,
                instance,
            };
            let restart = RegisterWindowMessageW(w!("TaskbarCreated"));
            if restart == 0 {
                return Err(Error::from_thread());
            }
            register_icon(hwnd, icon)?;
            WTSRegisterSessionNotification(hwnd, NOTIFY_FOR_THIS_SESSION)?;
            STATE.with(|state| {
                *state.borrow_mut() = Some(Dispatch {
                    send: sender,
                    icon,
                    restart,
                    recorder,
                })
            });
            Ok(tray)
        }
    }
}

impl Drop for Tray {
    fn drop(&mut self) {
        STATE.with(|state| state.borrow_mut().take());
        unsafe {
            let _ = WTSUnRegisterSessionNotification(self.hwnd);
            let _ = Shell_NotifyIconW(NIM_DELETE, &data(self.hwnd, self.icon));
            let _ = DestroyWindow(self.hwnd);
            let _ = DestroyIcon(self.icon);
            let _ = UnregisterClassW(CLASS, Some(self.instance));
        }
    }
}

fn menu(hwnd: HWND, at: WPARAM, recorder: &Recorder) -> Result<()> {
    unsafe {
        let paused = recorder.paused();
        let popup = CreatePopupMenu()?;
        let selected = (|| -> Result<_> {
            for (id, key) in [
                (TODAY, "native.tray.showMain"),
                (OPEN, "miniWindow.open"),
                (
                    TOGGLE,
                    if paused {
                        "native.tray.resume"
                    } else {
                        "native.tray.pause"
                    },
                ),
                (EXIT, "native.tray.quit"),
            ] {
                let label =
                    windows::core::HSTRING::from(patina_recorder::text(recorder.locale.get(), key));
                AppendMenuW(popup, MF_STRING, id, &label)?;
            }
            let mut pt = POINT {
                x: at.0 as i16 as i32,
                y: (at.0 >> 16) as i16 as i32,
            };
            if pt.x == -1 && pt.y == -1 {
                GetCursorPos(&mut pt)?;
            }
            let _ = SetForegroundWindow(hwnd);
            let _ = TrackPopupMenu(popup, TPM_RIGHTBUTTON, pt.x, pt.y, None, hwnd, None);
            let _ = PostMessageW(Some(hwnd), WM_NULL, WPARAM(0), LPARAM(0));
            Ok(())
        })();
        let _ = DestroyMenu(popup);
        selected
    }
}

unsafe extern "system" fn dispatch(hwnd: HWND, msg: u32, w: WPARAM, l: LPARAM) -> LRESULT {
    if let Some(Dispatch {
        send: tx,
        icon,
        restart,
        recorder,
    }) = STATE.with(|s| s.borrow().clone())
    {
        let power = match (msg, w.0 as u32) {
            (WM_WTSSESSION_CHANGE, 7) => Some("lock"),
            (WM_WTSSESSION_CHANGE, 8) => Some("unlock"),
            (WM_POWERBROADCAST, PBT_APMSUSPEND) => Some("suspend"),
            (WM_POWERBROADCAST, PBT_APMRESUMEAUTOMATIC | PBT_APMRESUMESUSPEND) => Some("resume"),
            _ => None,
        };
        if let Some(event) = power {
            recorder.power(event);
            if matches!(event, "resume" | "unlock") {
                let _ = tx.try_send(Action::WakeTools);
            }
            return LRESULT(1);
        }
        if msg == WM_TIMECHANGE {
            let _ = tx.try_send(Action::WakeTools);
        }
        if msg == restart {
            if let Err(e) = register_icon(hwnd, icon) {
                eprintln!("tray restore: {e}");
                let _ = tx.try_send(Action::Exit);
            }
            return LRESULT(0);
        }
        if msg == CALLBACK {
            match (l.0 & 0xffff) as u32 {
                NIN_SELECT | NIN_KEYSELECT => {
                    let _ = tx.try_send(Action::Today);
                }
                WM_CONTEXTMENU => {
                    if let Err(error) = menu(hwnd, w, &recorder) {
                        eprintln!("tray menu: {error}");
                    }
                }
                _ => {}
            }
            return LRESULT(0);
        }
        let action = match (msg, w.0, l.0) {
            (WM_COMMAND, TODAY, 0) => Some(Action::Today),
            (WM_COMMAND, OPEN, 0) => Some(Action::Mini { focus: true }),
            (WM_COMMAND, TOGGLE, 0) => Some(Action::SetPaused(!recorder.paused())),
            (WM_COMMAND, EXIT, 0) | (WM_CLOSE, _, _) => Some(Action::Exit),
            _ => None,
        };
        if let Some(action) = action {
            let _ = tx.try_send(action);
            return LRESULT(0);
        }
    }
    unsafe { DefWindowProcW(hwnd, msg, w, l) }
}
