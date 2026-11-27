use async_channel::Sender;
mod icon;
use icon::TrayIcon;
use patina_activity::{Locale, RecordingControl};
use std::cell::{Cell, RefCell};
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
    Main,
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
const MAIN: usize = 4;
const TODAY: usize = 5;
const OPEN: usize = 1;
const EXIT: usize = 2;
const TOGGLE: usize = 3;
pub(super) fn reopen(
    profile_id: &str,
    previous_ids: &[String],
    actions: &async_channel::Receiver<Action>,
) -> Result<()> {
    let class = windows::core::HSTRING::from(profile_id);
    let previous_classes: Vec<_> = previous_ids
        .iter()
        .map(|id| windows::core::HSTRING::from(id.as_str()))
        .collect();
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(4);
    let hwnd = loop {
        match unsafe { FindWindowW(&class, None) }.or_else(|error| {
            previous_classes
                .iter()
                .find_map(|class| unsafe { FindWindowW(class, None) }.ok())
                .ok_or(error)
        }) {
            Ok(hwnd) => break hwnd,
            Err(_) if std::time::Instant::now() < deadline => {
                std::thread::sleep(std::time::Duration::from_millis(40))
            }
            Err(error) => return Err(error),
        }
    };
    unsafe {
        let mut pid = 0;
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
        let _ = AllowSetForegroundWindow(pid);
        let mut action = actions.try_recv().unwrap_or(Action::Main);
        loop {
            let id = match action {
                Action::Mini { .. } => OPEN,
                Action::Today => TODAY,
                _ => MAIN,
            };
            PostMessageW(Some(hwnd), WM_COMMAND, WPARAM(id), LPARAM(0))?;
            let Ok(next) = actions.try_recv() else { break };
            action = next;
        }
    }
    Ok(())
}

// Windows dispatches this class on the resident thread, including while the
// native menu is tracking. Never hold a RefCell borrow across menu dispatch.
thread_local! {
    static STATE: RefCell<Option<Dispatch>> = const { RefCell::new(None) };
}

#[derive(Clone)]
struct Dispatch {
    send: Sender<Action>,
    icon: Rc<TrayIcon>,
    restart: u32,
    recorder: RecordingControl,
    locale: Rc<Cell<Locale>>,
    registration: Rc<IconRegistration>,
}

pub struct Tray {
    class: windows::core::HSTRING,
    registration: Rc<IconRegistration>,
    pub(super) behavior: Cell<patina_activity::DesktopBehaviorSettings>,
    silent_start: Cell<bool>,
    hwnd: HWND,
    icon: Rc<TrayIcon>,
    instance: HINSTANCE,
}

fn icon_data(hwnd: HWND, icon: HICON) -> NOTIFYICONDATAW {
    let mut entry = NOTIFYICONDATAW {
        cbSize: std::mem::size_of::<NOTIFYICONDATAW>() as u32,
        hWnd: hwnd,
        uID: 1,
        uFlags: NIF_ICON | NIF_MESSAGE | NIF_TIP | NIF_SHOWTIP,
        uCallbackMessage: CALLBACK,
        hIcon: icon,
        ..Default::default()
    };
    for (slot, ch) in entry.szTip.iter_mut().zip("Patina".encode_utf16()) {
        *slot = ch;
    }
    entry
}

#[cfg(test)]
#[test]
fn shell_tooltip_shows_the_product_name() {
    let entry = icon_data(HWND::default(), HICON::default());
    assert!(entry.uFlags.contains(NIF_TIP | NIF_SHOWTIP));
    let end = entry.szTip.iter().position(|ch| *ch == 0).unwrap();
    assert_eq!(String::from_utf16(&entry.szTip[..end]).unwrap(), "Patina");
}

fn register_icon(hwnd: HWND, icon: HICON) -> Result<()> {
    let mut entry = icon_data(hwnd, icon);
    unsafe {
        Shell_NotifyIconW(NIM_ADD, &entry).ok()?;
        entry.Anonymous.uVersion = NOTIFYICON_VERSION_4;
        if let Err(error) = Shell_NotifyIconW(NIM_SETVERSION, &entry).ok() {
            let _ = Shell_NotifyIconW(NIM_DELETE, &entry);
            return Err(error);
        }
        Ok(())
    }
}

const RETRY_ICON: usize = 1;

#[derive(Default)]
struct IconRegistration {
    wanted: Cell<bool>,
    present: Cell<bool>,
    retries: Cell<u32>,
}

impl IconRegistration {
    fn cancel_retry(&self, hwnd: HWND) {
        unsafe {
            let _ = KillTimer(Some(hwnd), RETRY_ICON);
        }
    }

    fn add(&self, hwnd: HWND, icon: HICON) {
        self.cancel_retry(hwnd);
        if let Some(delay) = self.try_register(|| register_icon(hwnd, icon)) {
            unsafe {
                SetTimer(Some(hwnd), RETRY_ICON, delay, None);
            }
        }
    }

    fn try_register(&self, register: impl FnOnce() -> Result<()>) -> Option<u32> {
        if !self.wanted.get() || self.present.get() {
            return None;
        }
        if let Err(error) = register() {
            let attempt = self.retries.get();
            if attempt == 0 {
                eprintln!("register tray icon: {error}");
            }
            if attempt < 4 {
                self.retries.set(attempt + 1);
                return Some(1000 << attempt);
            }
        } else {
            self.present.set(true);
            self.retries.set(0);
        }
        None
    }

    fn set(&self, hwnd: HWND, icon: HICON, wanted: bool) -> Result<()> {
        if self.wanted.get() == wanted {
            return Ok(());
        }
        if !wanted && self.present.get() {
            unsafe {
                if let Err(error) = Shell_NotifyIconW(NIM_DELETE, &icon_data(hwnd, icon)).ok()
                    && FindWindowW(w!("Shell_TrayWnd"), None).is_ok()
                {
                    return Err(error);
                }
            }
            self.present.set(false);
        }
        self.wanted.set(wanted);
        self.retries.set(0);
        self.add(hwnd, icon);
        Ok(())
    }
}

#[cfg(test)]
#[test]
fn tray_registration_waits_for_explorer_and_respects_current_visibility() {
    let icon = IconRegistration::default();
    icon.wanted.set(true);
    for delay in [Some(1000), Some(2000), Some(4000), Some(8000), None] {
        assert_eq!(icon.try_register(|| Err(Error::from_thread())), delay);
        assert!(!icon.present.get());
    }
    assert_eq!(icon.try_register(|| Ok(())), None);
    assert!(icon.present.get());
    icon.try_register(|| panic!("duplicate registration"));
    icon.present.set(false);
    icon.wanted.set(false);
    icon.try_register(|| panic!("hidden icon registered"));
}

impl Tray {
    pub fn new(
        sender: Sender<Action>,
        recorder: RecordingControl,
        locale: Rc<Cell<Locale>>,
        behavior: patina_activity::DesktopBehaviorSettings,
        profile_id: &str,
        silent: bool,
    ) -> Result<Self> {
        unsafe {
            let name = windows::core::HSTRING::from(profile_id);
            let instance: HINSTANCE = GetModuleHandleW(None)?.into();
            let class = WNDCLASSW {
                hInstance: instance,
                lpszClassName: windows::core::PCWSTR(name.as_ptr()),
                lpfnWndProc: Some(dispatch),
                ..Default::default()
            };
            if RegisterClassW(&class) == 0 {
                return Err(Error::from_thread());
            }
            let hwnd = match CreateWindowExW(
                WS_EX_TOOLWINDOW,
                &name,
                w!("Patina Tray"),
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
                    let _ = UnregisterClassW(&name, Some(instance));
                    return Err(e);
                }
            };
            let icon = match TrayIcon::new(recorder.paused()) {
                Ok(icon) => Rc::new(icon),
                Err(e) => {
                    let _ = DestroyWindow(hwnd);
                    let _ = UnregisterClassW(&name, Some(instance));
                    return Err(e);
                }
            };
            let tray = Self {
                class: name,
                registration: Rc::default(),
                behavior: Cell::new(behavior),
                silent_start: Cell::new(silent),
                hwnd,
                icon: icon.clone(),
                instance,
            };
            let restart = RegisterWindowMessageW(w!("TaskbarCreated"));
            if restart == 0 {
                return Err(Error::from_thread());
            }
            WTSRegisterSessionNotification(hwnd, NOTIFY_FOR_THIS_SESSION)?;
            STATE.with(|state| {
                *state.borrow_mut() = Some(Dispatch {
                    send: sender,
                    icon,
                    restart,
                    recorder,
                    locale,
                    registration: tray.registration.clone(),
                })
            });
            tray.apply_visibility(behavior)?;
            Ok(tray)
        }
    }

    pub(super) fn main_opened(&self) -> Result<()> {
        self.silent_start.set(false);
        self.apply_visibility(self.behavior.get())
    }

    pub(super) fn update_recording(&self, paused: bool) -> Result<()> {
        self.icon
            .update(self.hwnd, self.registration.present.get(), None, paused)
    }

    pub(super) fn apply_visibility(
        &self,
        behavior: patina_activity::DesktopBehaviorSettings,
    ) -> Result<()> {
        let visible = behavior.should_keep_tray_visible()
            || (self.silent_start.get() && behavior.show_tray_icon);
        self.registration
            .set(self.hwnd, self.icon.handle(), visible)
    }
}

impl Drop for Tray {
    fn drop(&mut self) {
        STATE.with(|state| state.borrow_mut().take());
        self.registration.cancel_retry(self.hwnd);
        unsafe {
            let _ = WTSUnRegisterSessionNotification(self.hwnd);
            let _ = Shell_NotifyIconW(NIM_DELETE, &icon_data(self.hwnd, self.icon.handle()));
            let _ = DestroyWindow(self.hwnd);
            let _ = UnregisterClassW(&self.class, Some(self.instance));
        }
    }
}

fn menu(hwnd: HWND, at: WPARAM, recorder: &RecordingControl, locale: Locale) -> Result<()> {
    unsafe {
        let paused = recorder.paused();
        let popup = CreatePopupMenu()?;
        let selected = (|| -> Result<_> {
            for (id, key) in [
                (MAIN, "native.tray.showMain"),
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
                let label = windows::core::HSTRING::from(patina_activity::text(locale, key));
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
        locale,
        registration,
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
        if (matches!(msg, WM_SETTINGCHANGE | WM_THEMECHANGED) || msg == restart)
            && let Err(e) = icon.update(
                hwnd,
                registration.present.get() && msg != restart,
                icon::light_taskbar(),
                recorder.paused(),
            )
        {
            eprintln!("tray appearance: {e}");
        }
        if msg == restart {
            registration.present.set(false);
            registration.retries.set(0);
            registration.add(hwnd, icon.handle());
            return LRESULT(0);
        }
        if msg == WM_TIMER && w.0 == RETRY_ICON {
            registration.add(hwnd, icon.handle());
            return LRESULT(0);
        }
        if msg == CALLBACK {
            match (l.0 & 0xffff) as u32 {
                NIN_SELECT | NIN_KEYSELECT => {
                    let _ = tx.try_send(Action::Main);
                }
                WM_CONTEXTMENU => {
                    if let Err(error) = menu(hwnd, w, &recorder, locale.get()) {
                        eprintln!("tray menu: {error}");
                    }
                }
                _ => {}
            }
            return LRESULT(0);
        }
        let action = match (msg, w.0, l.0) {
            (WM_COMMAND, MAIN, 0) => Some(Action::Main),
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
