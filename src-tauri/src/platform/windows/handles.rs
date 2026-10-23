use windows::Win32::Foundation::{CloseHandle, HANDLE, HWND};
use windows::Win32::Graphics::Gdi::{DeleteDC, DeleteObject, HBITMAP, HDC};
use windows::Win32::UI::WindowsAndMessaging::{DestroyIcon, HICON};

pub struct OwnedHandle(HANDLE);

impl OwnedHandle {
    pub fn new(handle: HANDLE) -> Option<Self> {
        if handle.is_invalid() {
            None
        } else {
            Some(Self(handle))
        }
    }

    pub fn raw(&self) -> HANDLE {
        self.0
    }
}

impl Drop for OwnedHandle {
    fn drop(&mut self) {
        unsafe {
            let _ = CloseHandle(self.0);
        }
    }
}

pub struct OwnedIcon(HICON);

impl OwnedIcon {
    pub fn new(icon: HICON) -> Option<Self> {
        if icon.is_invalid() {
            None
        } else {
            Some(Self(icon))
        }
    }

    pub fn raw(&self) -> HICON {
        self.0
    }
}

impl Drop for OwnedIcon {
    fn drop(&mut self) {
        unsafe {
            let _released = DestroyIcon(self.0).is_ok();
            #[cfg(test)]
            release_checks::record(0, _released);
        }
    }
}

pub struct OwnedBitmap(HBITMAP);

impl OwnedBitmap {
    pub fn new(bitmap: HBITMAP) -> Option<Self> {
        if bitmap.is_invalid() {
            None
        } else {
            Some(Self(bitmap))
        }
    }

    pub fn raw(&self) -> HBITMAP {
        self.0
    }
}

impl Drop for OwnedBitmap {
    fn drop(&mut self) {
        unsafe {
            let _released = DeleteObject(self.0.into()).as_bool();
            #[cfg(test)]
            release_checks::record(1, _released);
        }
    }
}

pub struct ScreenDcGuard {
    hwnd: Option<HWND>,
    hdc: HDC,
}

impl ScreenDcGuard {
    pub fn new(hwnd: Option<HWND>, hdc: HDC) -> Option<Self> {
        if hdc.is_invalid() {
            None
        } else {
            Some(Self { hwnd, hdc })
        }
    }

    pub fn raw(&self) -> HDC {
        self.hdc
    }
}

impl Drop for ScreenDcGuard {
    fn drop(&mut self) {
        unsafe {
            let _released = windows::Win32::Graphics::Gdi::ReleaseDC(self.hwnd, self.hdc) != 0;
            #[cfg(test)]
            release_checks::record(2, _released);
        }
    }
}

pub struct MemoryDcGuard(HDC);

impl MemoryDcGuard {
    pub fn new(hdc: HDC) -> Option<Self> {
        if hdc.is_invalid() {
            None
        } else {
            Some(Self(hdc))
        }
    }

    pub fn raw(&self) -> HDC {
        self.0
    }
}

impl Drop for MemoryDcGuard {
    fn drop(&mut self) {
        unsafe {
            let _released = DeleteDC(self.0).as_bool();
            #[cfg(test)]
            release_checks::record(3, _released);
        }
    }
}

#[cfg(test)]
pub(super) mod release_checks {
    use std::cell::Cell;
    thread_local! {
        static COUNTS: Cell<[[u64; 2]; 4]> = const { Cell::new([[0; 2]; 4]) };
    }
    pub(super) fn record(kind: usize, released: bool) {
        COUNTS.with(|counts| {
            let mut values = counts.get();
            values[kind][0] += 1;
            values[kind][1] += u64::from(!released);
            counts.set(values);
        });
    }
    pub(crate) fn counts() -> [[u64; 2]; 4] {
        COUNTS.with(Cell::get)
    }
}
