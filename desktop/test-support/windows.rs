use std::{
    process::Child,
    thread,
    time::{Duration, Instant},
};
use windows::{
    Win32::{
        Foundation::HWND,
        System::Com::*,
        UI::{Accessibility::*, WindowsAndMessaging::*},
    },
    core::PCWSTR,
};

pub type Error = Box<dyn std::error::Error>;

pub struct TestChild(pub Child);

impl Drop for TestChild {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

pub fn wait<T>(label: &str, mut read: impl FnMut() -> Option<T>) -> Result<T, Error> {
    let start = Instant::now();
    while start.elapsed() < Duration::from_secs(25) {
        if let Some(value) = read() {
            return Ok(value);
        }
        thread::sleep(Duration::from_millis(100));
    }
    Err(format!("Timed out waiting for {label}").into())
}

pub fn window(pid: u32, title: PCWSTR) -> Option<HWND> {
    let mut previous = None;
    loop {
        let hwnd = unsafe { FindWindowExW(None, previous, None, title) }.ok()?;
        let mut owner = 0;
        unsafe {
            GetWindowThreadProcessId(hwnd, Some(&mut owner));
        }
        if owner == pid {
            return Some(hwnd);
        }
        previous = Some(hwnd);
    }
}

pub struct ComApartment;
impl ComApartment {
    pub fn init() -> windows::core::Result<Self> {
        unsafe {
            CoInitializeEx(None, COINIT_MULTITHREADED).ok()?;
        }
        Ok(Self)
    }
}
impl Drop for ComApartment {
    fn drop(&mut self) {
        unsafe { CoUninitialize() };
    }
}

pub fn controls(hwnd: HWND) -> windows::core::Result<Vec<IUIAutomationElement>> {
    unsafe {
        let ui: IUIAutomation = CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER)?;
        let root = ui.ElementFromHandle(hwnd)?;
        let elements = root.FindAll(TreeScope_Descendants, &ui.CreateTrueCondition()?)?;
        (0..elements.Length()?)
            .map(|i| elements.GetElement(i))
            .collect()
    }
}
