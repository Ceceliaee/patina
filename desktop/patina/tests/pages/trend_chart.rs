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
    history_day(hwnd, today)?;
    press(hwnd, "Data")?;
    wait("return to overview", || named(hwnd, "Total · 1h 40m"))?;
    let yesterday = today - chrono::Days::new(1);
    let column = wait("yesterday trend column", || {
        by_id(&format!("overview-trend-{yesterday}"))
    })?;
    double_click_day(hwnd, &column, yesterday)?;
    press(hwnd, "Data")?;
    let heat = wait("overview heatmap date", || {
        button(hwnd, &format!("{yesterday} · 30m"))
    })?;
    heatmap_geometry(hwnd)?;
    unsafe {
        PostMessageW(
            Some(hwnd),
            WM_MOUSEMOVE,
            WPARAM(0),
            client_center(hwnd, &heat)?,
        )?;
    }
    let tip = wait("heatmap hover tooltip", || tooltip())?;
    assert!(
        unsafe { tip.CurrentName()? }
            .to_string()
            .contains(&yesterday.to_string())
    );
    unsafe {
        PostMessageW(
            Some(hwnd),
            WM_MOUSEMOVE,
            WPARAM(0),
            client_center(hwnd, &named(hwnd, "Activity Trend").ok_or("trend heading")?)?,
        )?;
        heat.SetFocus()?;
    }
    wait("heatmap keyboard tooltip", || tooltip())?;
    key(hwnd, 27)?;
    wait("heatmap Escape hides tooltip", || {
        tooltip().is_none().then_some(())
    })?;
    double_click_day(hwnd, &heat, yesterday)?;
    press(hwnd, "Data")?;
    wait("return to overview", || named(hwnd, "Total · 1h 40m"))?;
    Ok(())
}

pub(super) fn heatmap_geometry(hwnd: HWND) -> Result<(), Error> {
    let elements = controls(hwnd)?;
    let panel = elements
        .iter()
        .find(|el| unsafe {
            el.CurrentAutomationId()
                .is_ok_and(|id| id == "overview-heatmap")
        })
        .ok_or("heatmap panel")?;
    let panel = unsafe { panel.CurrentBoundingRectangle()? };
    let mut right = panel.left;
    let mut count = 0;
    for cell in elements.iter().filter(|el| unsafe {
        el.CurrentAutomationId()
            .is_ok_and(|id| id.to_string().starts_with("heat-"))
    }) {
        let bounds = unsafe { cell.CurrentBoundingRectangle()? };
        assert!(
            bounds.left >= panel.left && bounds.right <= panel.right,
            "heatmap cell clipped horizontally: cell={bounds:?}, panel={panel:?}"
        );
        assert!(
            bounds.top >= panel.top && bounds.bottom <= panel.bottom,
            "heatmap cell clipped vertically"
        );
        assert!(
            ((bounds.right - bounds.left) - (bounds.bottom - bounds.top)).abs() <= 1,
            "heatmap cell is not square"
        );
        right = right.max(bounds.right);
        count += 1;
    }
    assert!(count >= 350, "missing year cells: {count}");
    let scale = unsafe { GetDpiForWindow(hwnd) } as f32 / 96.;
    assert!(
        (panel.right - right) as f32 <= 24. * scale,
        "unused space at heatmap right edge"
    );
    Ok(())
}

pub(super) fn history_day(hwnd: HWND, day: chrono::NaiveDate) -> Result<(), Error> {
    wait("history selected date", || named(hwnd, &day.to_string()))?;
    wait("history page replaces data", || {
        button(hwnd, "Previous day").filter(|_| segment(hwnd, "Overview").is_none())
    })?;
    assert!(button(hwnd, "Close").is_none(), "date opened a modal");
    assert!(button(hwnd, "History").is_some());
    Ok(())
}

pub(super) fn double_click_day(
    hwnd: HWND,
    element: &IUIAutomationElement,
    day: chrono::NaiveDate,
) -> Result<(), Error> {
    activate_control(hwnd, element, false)?;
    let deadline = std::time::Instant::now() + std::time::Duration::from_millis(600);
    while std::time::Instant::now() < deadline {
        assert!(
            segment(hwnd, "Overview").is_some(),
            "single click navigated"
        );
        assert!(
            button(hwnd, "Close").is_none(),
            "single click opened a modal"
        );
        std::thread::sleep(std::time::Duration::from_millis(20));
    }
    let at = client_center(hwnd, element)?;
    unsafe {
        PostMessageW(Some(hwnd), WM_MOUSEMOVE, WPARAM(0), at)?;
        for _ in 0..2 {
            PostMessageW(Some(hwnd), WM_LBUTTONDOWN, WPARAM(1), at)?;
            PostMessageW(Some(hwnd), WM_LBUTTONUP, WPARAM(0), at)?;
        }
    }
    history_day(hwnd, day)
}
