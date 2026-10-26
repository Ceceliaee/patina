use windows::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LBUTTON, VK_RBUTTON};
use windows::Win32::UI::WindowsAndMessaging::{GetSystemMetrics, SM_SWAPBUTTON};

pub fn is_primary_mouse_button_down() -> bool {
    // GetAsyncKeyState addresses physical buttons, independent of the user's mapping.
    unsafe {
        let button = if GetSystemMetrics(SM_SWAPBUTTON) != 0 {
            VK_RBUTTON
        } else {
            VK_LBUTTON
        };
        (GetAsyncKeyState(button.0 as i32) as u16 & 0x8000) != 0
    }
}
