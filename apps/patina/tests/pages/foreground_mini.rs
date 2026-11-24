use super::*;
use serde::Serialize;
use windows::Win32::Foundation::{GetLastError, SetLastError, WIN32_ERROR};
use windows::Win32::Graphics::Gdi::GetWindowRgnBox;

#[derive(Clone, Copy, Debug)]
pub(super) enum MiniState {
    Closed,
    Folded(HWND),
    Pinned(HWND),
}

pub(super) fn find(host: u32) -> Option<HWND> {
    children::find(host, |p| window(p, w!("Patina Mini")))
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Observation {
    hwnd: usize,
    owner_pid: u32,
    visible: bool,
    dpi: u32,
    region_type: i32,
    region_error: Option<u32>,
    size_dip: Option<[i32; 2]>,
}

fn observe(hwnd: HWND) -> Observation {
    unsafe {
        let mut owner_pid = 0;
        GetWindowThreadProcessId(hwnd, Some(&mut owner_pid));
        let visible = IsWindowVisible(hwnd).as_bool();
        let dpi = GetDpiForWindow(hwnd);
        let mut area = RECT::default();
        SetLastError(WIN32_ERROR(0));
        let region_type = GetWindowRgnBox(hwnd, &mut area).0;
        let region_error = (region_type == 0)
            .then(|| GetLastError().0)
            .filter(|e| *e != 0);
        let size_dip = (visible && region_type >= 2 && dpi > 0).then(|| {
            [area.right - area.left, area.bottom - area.top]
                .map(|n| (f64::from(n) * 96. / f64::from(dpi)).round() as i32)
        });
        Observation {
            hwnd: hwnd.0 as usize,
            owner_pid,
            visible,
            dpi,
            region_type,
            region_error,
            size_dip,
        }
    }
}

pub(super) fn dimensions(hwnd: HWND) -> Option<[i32; 2]> {
    observe(hwnd).size_dip
}

impl MiniState {
    pub(super) fn verify(
        self,
        host: u32,
        renderer: u32,
        driver: &mut Driver,
    ) -> Result<Option<[i32; 2]>, Error> {
        let (hwnd, expected) = match self {
            Self::Closed => {
                if let Some(hwnd) = find(host) {
                    let actual = observe(hwnd);
                    driver.event("unexpected-mini", json!(actual))?;
                    return Err(format!("expected no Mini, found {actual:?}").into());
                }
                return Ok(None);
            }
            Self::Folded(hwnd) => (hwnd, [112, 24]),
            Self::Pinned(hwnd) => (hwnd, [320, 240]),
        };
        // The window opened at the transition must survive this entire phase.
        let matches =
            |value: &Observation| value.owner_pid == renderer && value.size_dip == Some(expected);
        let first = observe(hwnd);
        if matches(&first) {
            return Ok(first.size_dip);
        }
        driver.event("mini-observation-mismatch", json!({"expected":expected,"renderer":renderer,"rendererPresent":children::children(host).ok().map(|pids| pids.contains(&renderer)),"direct":first,"discovered":find(host).map(observe)}))?;
        // Never accept a measured size change, a hidden window or a replaced owner.
        // A failed geometry read on a still-visible owned window gets one independent reread.
        if first.owner_pid == renderer && first.visible && first.size_dip.is_none() {
            thread::sleep(Duration::from_millis(30));
            let next = observe(hwnd);
            driver.event("mini-observation-retry", json!(next))?;
            if matches(&next) {
                return Ok(next.size_dip);
            }
        }
        Err(format!("expected {expected:?} on renderer {renderer}, observed {first:?}").into())
    }
}

pub(super) fn expand_and_pin(hwnd: HWND) -> Result<(), Error> {
    let handle = wait("folded Mini handle", || {
        controls(hwnd).ok()?.into_iter().find(|el| unsafe {
            el.CurrentName()
                .is_ok_and(|n| n.to_string().starts_with("Open mini window"))
        })
    })?;
    unsafe { handle.SetFocus()? };
    key(hwnd, 13)?;
    let pin = wait("expanded Mini pin", || {
        named(hwnd, "Keep expanded").and_then(|el| unsafe {
            el.GetCurrentPatternAs::<IUIAutomationTogglePattern>(UIA_TogglePatternId)
                .ok()
        })
    })?;
    unsafe {
        if pin.CurrentToggleState()? == ToggleState_Off {
            pin.Toggle()?;
        }
        wait("pinned full Mini", || {
            (pin.CurrentToggleState().ok()? == ToggleState_On
                && dimensions(hwnd) == Some([320, 240]))
            .then_some(())
        })?;
    }
    Ok(())
}
