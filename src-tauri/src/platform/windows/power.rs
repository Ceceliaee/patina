use crate::engine::tracking::runtime as tracking_runtime;
use serde::{Deserialize, Serialize};
use std::sync::OnceLock;
use std::thread;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};
use windows::core::PCWSTR;
use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::System::RemoteDesktop::{
    WTSRegisterSessionNotification, WTSUnRegisterSessionNotification, NOTIFY_FOR_THIS_SESSION,
};
use windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DispatchMessageW, GetMessageW, PostQuitMessage,
    RegisterClassW, TranslateMessage, HWND_MESSAGE, MSG, PBT_APMRESUMEAUTOMATIC,
    PBT_APMRESUMESUSPEND, PBT_APMSUSPEND, WINDOW_EX_STYLE, WM_DESTROY, WM_POWERBROADCAST,
    WM_WTSSESSION_CHANGE, WNDCLASSW,
};

static APP_HANDLE: OnceLock<AppHandle> = OnceLock::new();

const WINDOW_CLASS_NAME: &str = "TimeTrackerPowerWatcherWindow";
const POWER_EVENT_SOURCE: &str = "power_lifecycle_v1";
const WTS_SESSION_LOCK_ID: u32 = 0x7;
const WTS_SESSION_UNLOCK_ID: u32 = 0x8;

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct PowerLifecycleEvent {
    pub state: String,
    pub timestamp_ms: u64,
    pub source: String,
}

pub fn start(app_handle: AppHandle) {
    if APP_HANDLE.set(app_handle.clone()).is_err() {
        return;
    }

    thread::spawn(move || unsafe {
        let instance = match GetModuleHandleW(None) {
            Ok(module) => module.into(),
            Err(_) => return,
        };

        let class_name: Vec<u16> = WINDOW_CLASS_NAME
            .encode_utf16()
            .chain(std::iter::once(0))
            .collect();

        let window_class = WNDCLASSW {
            lpfnWndProc: Some(power_watcher_window_proc),
            hInstance: instance,
            lpszClassName: PCWSTR(class_name.as_ptr()),
            ..Default::default()
        };

        let _ = RegisterClassW(&window_class);

        let hwnd = match CreateWindowExW(
            WINDOW_EX_STYLE::default(),
            PCWSTR(class_name.as_ptr()),
            PCWSTR(class_name.as_ptr()),
            Default::default(),
            0,
            0,
            0,
            0,
            Some(HWND_MESSAGE),
            None,
            Some(instance),
            None,
        ) {
            Ok(hwnd) => hwnd,
            Err(_) => return,
        };

        let _ = WTSRegisterSessionNotification(hwnd, NOTIFY_FOR_THIS_SESSION);

        let _ = app_handle.emit(
            "power-watcher-ready",
            PowerLifecycleEvent {
                state: "ready".into(),
                timestamp_ms: now_ms(),
                source: POWER_EVENT_SOURCE.into(),
            },
        );

        let mut msg = MSG::default();
        while GetMessageW(&mut msg, None, 0, 0).into() {
            let _ = TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }
    });
}

unsafe extern "system" fn power_watcher_window_proc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    match msg {
        WM_WTSSESSION_CHANGE => {
            match wparam.0 as u32 {
                WTS_SESSION_LOCK_ID => emit_power_event("lock"),
                WTS_SESSION_UNLOCK_ID => emit_power_event("unlock"),
                _ => {}
            }
            LRESULT(0)
        }
        WM_POWERBROADCAST => match wparam.0 as u32 {
            PBT_APMSUSPEND => {
                emit_power_event("suspend");
                LRESULT(1)
            }
            PBT_APMRESUMEAUTOMATIC | PBT_APMRESUMESUSPEND => {
                emit_power_event("resume");
                LRESULT(1)
            }
            _ => DefWindowProcW(hwnd, msg, wparam, lparam),
        },
        WM_DESTROY => {
            let _ = WTSUnRegisterSessionNotification(hwnd);
            PostQuitMessage(0);
            LRESULT(0)
        }
        _ => DefWindowProcW(hwnd, msg, wparam, lparam),
    }
}

fn emit_power_event(state: &str) {
    if let Some(app_handle) = APP_HANDLE.get() {
        let event = PowerLifecycleEvent {
            state: state.to_string(),
            timestamp_ms: now_ms(),
            source: POWER_EVENT_SOURCE.to_string(),
        };
        let _ = app_handle.emit("power-lifecycle-changed", &event);
        let app_handle = app_handle.clone();
        let event_state = event.state.clone();
        let timestamp_ms = event.timestamp_ms as i64;
        tauri::async_runtime::spawn(async move {
            if let Err(error) = tracking_runtime::handle_power_lifecycle_event(
                app_handle,
                &event_state,
                timestamp_ms,
            )
            .await
            {
                eprintln!("[tracker] power lifecycle handling failed: {error}");
            }
        });
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}
