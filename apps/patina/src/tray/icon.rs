use super::{HWND, icon_data};
use std::cell::Cell;
use windows::Win32::UI::{Shell::*, WindowsAndMessaging::*};
use windows::core::Result;
use winreg::{RegKey, enums::HKEY_CURRENT_USER};

#[derive(Clone, Copy, PartialEq, Eq)]
struct Appearance {
    light_taskbar: Option<bool>,
    paused: bool,
}

impl Appearance {
    fn png(self) -> &'static [u8] {
        match (self.light_taskbar, self.paused) {
            (Some(true), false) => include_bytes!("../../assets/icons/tray/on-light-active.png"),
            (Some(true), true) => include_bytes!("../../assets/icons/tray/on-light-paused.png"),
            (Some(false), false) => include_bytes!("../../assets/icons/tray/on-dark-active.png"),
            (Some(false), true) => include_bytes!("../../assets/icons/tray/on-dark-paused.png"),
            (None, _) => include_bytes!("../../assets/icons/32x32.png"),
        }
    }

    fn load(self) -> Result<HICON> {
        unsafe {
            CreateIconFromResourceEx(
                self.png(),
                true,
                0x30000,
                GetSystemMetrics(SM_CXSMICON),
                GetSystemMetrics(SM_CYSMICON),
                LR_DEFAULTCOLOR,
            )
        }
    }
}

pub(super) fn light_taskbar() -> Option<bool> {
    RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey(r"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize")
        .ok()?
        .get_value::<u32, _>("SystemUsesLightTheme")
        .ok()
        .map(|v| v != 0)
}

pub(super) struct TrayIcon {
    appearance: Cell<Appearance>,
    handle: Cell<HICON>,
}

impl TrayIcon {
    pub(super) fn new(paused: bool) -> Result<Self> {
        let appearance = Appearance {
            light_taskbar: light_taskbar(),
            paused,
        };
        Ok(Self {
            handle: Cell::new(appearance.load()?),
            appearance: Cell::new(appearance),
        })
    }

    pub(super) fn handle(&self) -> HICON {
        self.handle.get()
    }

    pub(super) fn update(
        &self,
        hwnd: HWND,
        visible: bool,
        light: Option<bool>,
        paused: bool,
    ) -> Result<()> {
        let old = self.appearance.get();
        let next = Appearance {
            light_taskbar: light.or(old.light_taskbar),
            paused,
        };
        if next == old {
            return Ok(());
        }
        let handle = next.load()?;
        unsafe {
            if visible {
                let mut entry = icon_data(hwnd, handle);
                entry.uFlags = NIF_ICON;
                if let Err(error) = Shell_NotifyIconW(NIM_MODIFY, &entry).ok() {
                    let _ = DestroyIcon(handle);
                    return Err(error);
                }
            }
            let _ = DestroyIcon(self.handle.replace(handle));
        }
        self.appearance.set(next);
        Ok(())
    }
}

impl Drop for TrayIcon {
    fn drop(&mut self) {
        unsafe {
            let _ = DestroyIcon(self.handle.get());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn each_taskbar_and_recording_state_loads_a_distinct_windows_icon() {
        let mut assets = std::collections::HashSet::new();
        for light_taskbar in [Some(false), Some(true)] {
            for paused in [false, true] {
                let appearance = Appearance {
                    light_taskbar,
                    paused,
                };
                assert!(assets.insert(appearance.png()));
                let handle = appearance.load().unwrap();
                unsafe {
                    DestroyIcon(handle).unwrap();
                }
            }
        }
        let icon = TrayIcon::new(false).unwrap();
        icon.update(HWND::default(), false, Some(false), false)
            .unwrap();
        icon.update(HWND::default(), false, None, true).unwrap();
        assert_eq!(icon.appearance.get().light_taskbar, Some(false));
        assert!(icon.appearance.get().paused);
    }
}
