use super::*;

#[path = "../../../../crates/test-support/recording.rs"]
mod fixture;
pub(super) use fixture::{seed, seed_profile};

pub(super) fn names(hwnd: HWND) -> Vec<String> {
    controls(hwnd)
        .unwrap_or_default()
        .iter()
        .filter_map(|el| unsafe { el.CurrentName().ok().map(|s| s.to_string()) })
        .collect()
}

pub(super) fn named(hwnd: HWND, name: &str) -> Option<IUIAutomationElement> {
    controls(hwnd)
        .ok()?
        .into_iter()
        .find(|el| unsafe { el.CurrentName().is_ok_and(|s| s == name) })
}

pub(super) fn key(hwnd: HWND, code: usize) -> windows::core::Result<()> {
    unsafe {
        PostMessageW(Some(hwnd), WM_KEYDOWN, WPARAM(code), LPARAM(1))?;
        PostMessageW(
            Some(hwnd),
            WM_KEYUP,
            WPARAM(code),
            LPARAM(0xc0000001u32 as isize),
        )
    }
}

pub(super) fn client_center(hwnd: HWND, trigger: &IUIAutomationElement) -> Result<LPARAM, Error> {
    use windows::Win32::{Foundation::POINT, Graphics::Gdi::ScreenToClient};
    let r = unsafe { trigger.CurrentBoundingRectangle()? };
    let mut p = POINT {
        x: (r.left + r.right) / 2,
        y: (r.top + r.bottom) / 2,
    };
    unsafe {
        ScreenToClient(hwnd, &mut p).ok()?;
    }
    Ok(LPARAM(((p.y as isize) << 16) | p.x as isize))
}

pub(super) fn command(tray: HWND, id: usize) -> windows::core::Result<()> {
    unsafe { PostMessageW(Some(tray), WM_COMMAND, WPARAM(id), LPARAM(0)) }
}
