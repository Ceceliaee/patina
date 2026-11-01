use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_ALL, COINIT_APARTMENTTHREADED,
};
use windows::Win32::UI::Shell::{IShellDispatch, Shell};

struct Apartment;
impl Drop for Apartment {
    fn drop(&mut self) {
        unsafe { CoUninitialize() };
    }
}

pub fn show_desktop() -> Result<(), String> {
    unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED).ok() }.map_err(|e| e.to_string())?;
    let _apartment = Apartment;
    let shell: IShellDispatch =
        unsafe { CoCreateInstance(&Shell, None, CLSCTX_ALL) }.map_err(|e| e.to_string())?;
    unsafe { shell.MinimizeAll() }.map_err(|e| e.to_string())
}
