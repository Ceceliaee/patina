use super::*;

pub(super) fn check(hwnd: HWND, db: &Path) -> Result<(), Error> {
    wait("compact duration and percentage", || {
        named(hwnd, "45m ･ 64%")
    })?;
    let count_badge = wait("ranking count badge", || {
        controls(hwnd).ok()?.into_iter().find(|el| unsafe {
            el.CurrentAutomationId()
                .is_ok_and(|id| id == "today-ranking-count")
        })
    })?;
    unsafe {
        assert!(count_badge.CurrentName()?.to_string().starts_with("Top "));
        assert!(!count_badge.CurrentIsKeyboardFocusable()?.as_bool());
        let bounds = count_badge.CurrentBoundingRectangle()?;
        let scale = f64::from(GetDpiForWindow(hwnd)) / 96.;
        assert!((f64::from(bounds.bottom - bounds.top) / scale - 20.).abs() <= 1.);
    }
    let anonymous = wait("anonymous activity indicator", || {
        controls(hwnd).ok()?.into_iter().find(|el| unsafe {
            el.CurrentControlType().ok() == Some(UIA_ImageControlTypeId)
                && el.CurrentName().is_ok_and(|s| s == "Anonymous")
        })
    })?;
    assert!(!unsafe { anonymous.CurrentIsKeyboardFocusable()? }.as_bool());
    assert!(named(hwnd, "View details for Anonymous").is_none());
    let at = client_center(hwnd, &anonymous)?;
    unsafe {
        for _ in 0..2 {
            PostMessageW(Some(hwnd), WM_LBUTTONDOWN, WPARAM(1), at)?;
            PostMessageW(Some(hwnd), WM_LBUTTONUP, WPARAM(0), at)?;
        }
    }
    context_menu(hwnd, &anonymous)?;
    let deadline = std::time::Instant::now() + std::time::Duration::from_millis(600);
    while std::time::Instant::now() < deadline {
        assert!(named(hwnd, "Close").is_none());
        assert!(named(hwnd, "Change name").is_none());
        std::thread::sleep(std::time::Duration::from_millis(20));
    }
    let comparison = |direction: &str| {
        let id = format!("today-comparison-{direction}");
        controls(hwnd)
            .ok()?
            .into_iter()
            .find(|el| unsafe { el.CurrentAutomationId().is_ok_and(|value| value == id) })
    };
    wait("increased since yesterday", || comparison("increase"))?;
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()?;
    let midnight = chrono::Local::now()
        .date_naive()
        .and_hms_opt(0, 0, 0)
        .unwrap()
        .and_local_timezone(chrono::Local)
        .earliest()
        .unwrap()
        .timestamp_millis();
    for (minutes, direction) in [(70, "same"), (90, "decrease"), (30, "increase")] {
        rt.block_on(async {
            let mut c =
                SqliteConnection::connect_with(&SqliteConnectOptions::new().filename(db)).await?;
            sqlx::query(
                "UPDATE sessions SET start_time=?,duration=end_time-? WHERE exe_name='studio.exe'",
            )
            .bind(midnight - minutes * 60_000)
            .bind(midnight - minutes * 60_000)
            .execute(&mut c)
            .await?;
            Ok::<_, Error>(())
        })?;
        for (page, ready) in [("History", "Day Timeline"), ("Today", "Top Apps")] {
            let target = named(hwnd, page).ok_or("navigation button")?;
            let invoke: IUIAutomationInvokePattern =
                unsafe { target.GetCurrentPatternAs(UIA_InvokePatternId)? };
            unsafe {
                invoke.Invoke()?;
            }
            wait("navigation complete", || named(hwnd, ready))?;
        }
        wait("comparison direction refreshed", || comparison(direction))?;
    }
    wait("comparison total restored", || {
        named(hwnd, "Up 40m from yesterday")
    })?;
    Ok(())
}
