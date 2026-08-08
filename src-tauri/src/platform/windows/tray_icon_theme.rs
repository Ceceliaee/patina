use std::thread::JoinHandle;
use windows::{
    core::w,
    Win32::{
        Foundation::{CloseHandle, ERROR_SUCCESS, HANDLE, WAIT_OBJECT_0},
        System::{
            Registry::{
                RegCloseKey, RegGetValueW, RegNotifyChangeKeyValue, RegOpenKeyExW,
                HKEY_CURRENT_USER, KEY_NOTIFY, KEY_QUERY_VALUE, REG_NOTIFY_CHANGE_LAST_SET,
                RRF_RT_REG_DWORD,
            },
            Threading::{CreateEventW, SetEvent, WaitForMultipleObjects},
        },
    },
};

const PERSONALIZE_KEY: windows::core::PCWSTR =
    w!(r"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize");
const SYSTEM_USES_LIGHT_THEME: windows::core::PCWSTR = w!("SystemUsesLightTheme");
const INFINITE_WAIT_MS: u32 = u32::MAX;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum TaskbarTheme {
    Light,
    Dark,
    #[default]
    Unknown,
}

impl TaskbarTheme {
    fn from_registry_value(value: Option<u32>) -> Self {
        match value {
            Some(0) => Self::Dark,
            Some(_) => Self::Light,
            None => Self::Unknown,
        }
    }

    pub fn is_known(self) -> bool {
        self != Self::Unknown
    }
}

pub fn current_taskbar_theme() -> TaskbarTheme {
    let mut value = 0u32;
    let mut value_size = std::mem::size_of::<u32>() as u32;
    let status = unsafe {
        RegGetValueW(
            HKEY_CURRENT_USER,
            PERSONALIZE_KEY,
            SYSTEM_USES_LIGHT_THEME,
            RRF_RT_REG_DWORD,
            None,
            Some(&mut value as *mut _ as _),
            Some(&mut value_size),
        )
    };

    TaskbarTheme::from_registry_value((status == ERROR_SUCCESS).then_some(value))
}

pub struct TaskbarThemeWatcher {
    stop_event: isize,
    thread: Option<JoinHandle<()>>,
}

impl TaskbarThemeWatcher {
    pub fn start<F>(on_change: F) -> Result<Self, String>
    where
        F: Fn(TaskbarTheme) + Send + 'static,
    {
        let mut key = Default::default();
        let open_status = unsafe {
            RegOpenKeyExW(
                HKEY_CURRENT_USER,
                PERSONALIZE_KEY,
                None,
                KEY_NOTIFY | KEY_QUERY_VALUE,
                &mut key,
            )
        };
        if open_status != ERROR_SUCCESS {
            return Err(format!(
                "failed to open Windows Personalize registry key: {}",
                open_status.0
            ));
        }

        let change_event = match unsafe { CreateEventW(None, false, false, None) } {
            Ok(event) => event,
            Err(error) => {
                unsafe {
                    let _ = RegCloseKey(key);
                }
                return Err(format!("failed to create taskbar theme event: {error}"));
            }
        };
        let stop_event = match unsafe { CreateEventW(None, true, false, None) } {
            Ok(event) => event,
            Err(error) => {
                unsafe {
                    let _ = CloseHandle(change_event);
                    let _ = RegCloseKey(key);
                }
                return Err(format!(
                    "failed to create taskbar theme stop event: {error}"
                ));
            }
        };

        let key_raw = key.0 as isize;
        let change_event_raw = change_event.0 as isize;
        let stop_event_raw = stop_event.0 as isize;
        let thread = std::thread::Builder::new()
            .name("patina-taskbar-theme".into())
            .spawn(move || {
                let key = windows::Win32::System::Registry::HKEY(key_raw as *mut _);
                let change_event = HANDLE(change_event_raw as *mut _);
                let stop_event = HANDLE(stop_event_raw as *mut _);

                let arm_notification = || unsafe {
                    RegNotifyChangeKeyValue(
                        key,
                        false,
                        REG_NOTIFY_CHANGE_LAST_SET,
                        Some(change_event),
                        true,
                    )
                };
                let initial_status = arm_notification();
                if initial_status != ERROR_SUCCESS {
                    eprintln!(
                        "[tray] Windows taskbar theme notification failed: {}",
                        initial_status.0
                    );
                    unsafe {
                        let _ = CloseHandle(change_event);
                        let _ = CloseHandle(stop_event);
                        let _ = RegCloseKey(key);
                    }
                    return;
                }

                let mut previous = current_taskbar_theme();
                on_change(previous);
                loop {
                    let wait = unsafe {
                        WaitForMultipleObjects(&[stop_event, change_event], false, INFINITE_WAIT_MS)
                    };
                    if wait == WAIT_OBJECT_0 {
                        break;
                    }
                    if wait.0 != WAIT_OBJECT_0.0 + 1 {
                        eprintln!("[tray] Windows taskbar theme wait failed: {}", wait.0);
                        break;
                    }

                    // Registry notifications are one-shot. Re-arm before reading so a
                    // second change cannot fall into the read/re-registration gap.
                    let notify_status = arm_notification();
                    if notify_status != ERROR_SUCCESS {
                        eprintln!(
                            "[tray] Windows taskbar theme notification failed: {}",
                            notify_status.0
                        );
                        break;
                    }
                    let next = current_taskbar_theme();
                    if next != previous {
                        previous = next;
                        on_change(next);
                    }
                }

                unsafe {
                    let _ = CloseHandle(change_event);
                    let _ = CloseHandle(stop_event);
                    let _ = RegCloseKey(key);
                }
            })
            .map_err(|error| {
                unsafe {
                    let _ = CloseHandle(change_event);
                    let _ = CloseHandle(stop_event);
                    let _ = RegCloseKey(key);
                }
                format!("failed to start taskbar theme watcher: {error}")
            })?;

        Ok(Self {
            stop_event: stop_event_raw,
            thread: Some(thread),
        })
    }

    pub fn stop(&mut self) {
        if self.thread.is_none() {
            return;
        }
        let thread_is_running = self
            .thread
            .as_ref()
            .is_some_and(|thread| !thread.is_finished());
        if thread_is_running {
            if let Err(error) = unsafe { SetEvent(HANDLE(self.stop_event as *mut _)) } {
                eprintln!("[tray] failed to stop taskbar theme watcher: {error}");
                // Never turn a cosmetic watcher failure into a blocking app exit.
                // Dropping the JoinHandle detaches the already-failing watcher.
                self.thread.take();
                return;
            }
        }
        if let Some(thread) = self.thread.take() {
            if thread.join().is_err() {
                eprintln!("[tray] taskbar theme watcher panicked while stopping");
            }
        }
    }
}

impl Drop for TaskbarThemeWatcher {
    fn drop(&mut self) {
        self.stop();
    }
}

#[cfg(test)]
mod tests {
    use super::TaskbarTheme;

    #[test]
    fn registry_values_map_to_taskbar_theme_without_guessing() {
        assert_eq!(
            TaskbarTheme::from_registry_value(Some(0)),
            TaskbarTheme::Dark
        );
        assert_eq!(
            TaskbarTheme::from_registry_value(Some(1)),
            TaskbarTheme::Light
        );
        assert_eq!(
            TaskbarTheme::from_registry_value(Some(7)),
            TaskbarTheme::Light
        );
        assert_eq!(
            TaskbarTheme::from_registry_value(None),
            TaskbarTheme::Unknown
        );
    }
}
