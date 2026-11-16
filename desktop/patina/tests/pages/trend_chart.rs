use super::*;

pub(super) fn check(hwnd: HWND) -> Result<(), Error> {
    let by_id = |id: &str| {
        controls(hwnd)
            .ok()?
            .into_iter()
            .find(|el| unsafe { el.CurrentAutomationId().is_ok_and(|value| value == id) })
    };
    let today = Local::now().date_naive();
    let first = wait("first trend column", || {
        by_id(&format!("overview-trend-{}", today - chrono::Days::new(6)))
    })?;
    let second = wait("second trend column", || {
        by_id(&format!("overview-trend-{}", today - chrono::Days::new(5)))
    })?;
    let last = wait("last trend column", || {
        by_id(&format!("overview-trend-{today}"))
    })?;
    let a = unsafe { first.CurrentBoundingRectangle()? };
    let b = unsafe { second.CurrentBoundingRectangle()? };
    assert!(a.bottom - a.top >= 160);
    assert!(((b.right - b.left) - 2 * (a.right - a.left)).abs() <= 2);
    let tooltip = || {
        controls(hwnd)
            .ok()?
            .into_iter()
            .find(|el| unsafe { el.CurrentControlType().ok() == Some(UIA_ToolTipControlTypeId) })
    };
    unsafe {
        PostMessageW(
            Some(hwnd),
            WM_MOUSEMOVE,
            WPARAM(0),
            client_center(hwnd, &last)?,
        )?;
    }
    let tip = wait("trend hover tooltip", || tooltip())?;
    assert!(
        unsafe { tip.CurrentName()? }
            .to_string()
            .starts_with(&today.to_string())
    );
    let tip_bounds = unsafe { tip.CurrentBoundingRectangle()? };
    let last_bounds = unsafe { last.CurrentBoundingRectangle()? };
    assert!(tip_bounds.right <= last_bounds.right && tip_bounds.right > last_bounds.left);
    let heading = named(hwnd, "Activity Trend").ok_or("trend heading")?;
    unsafe {
        PostMessageW(
            Some(hwnd),
            WM_MOUSEMOVE,
            WPARAM(0),
            client_center(hwnd, &heading)?,
        )?;
    }
    wait("trend pointer leaves", || tooltip().is_none().then_some(()))?;
    unsafe {
        last.SetFocus()?;
    }
    wait("trend keyboard tooltip", || tooltip())?;
    key(hwnd, 27)?;
    wait("trend Escape hides tooltip", || {
        tooltip().is_none().then_some(())
    })?;
    key(hwnd, 13)?;
    wait("trend Enter opens day", || button(hwnd, "Close"))?;
    key(hwnd, 27)?;
    wait("close day details", || {
        button(hwnd, "Close").is_none().then_some(())
    })?;
    Ok(())
}
