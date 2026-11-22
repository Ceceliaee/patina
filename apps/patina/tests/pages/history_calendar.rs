use super::*;
use chrono::{Datelike, Days, Months};

fn calendar(hwnd: HWND) -> Option<IUIAutomationElement> {
    controls(hwnd).ok()?.into_iter().find(|el| unsafe {
        el.CurrentName().is_ok_and(|n| n == "Select date")
            && el.CurrentControlType().ok() == Some(UIA_GroupControlTypeId)
    })
}

fn day_cell(hwnd: HWND, date: &str) -> Option<IUIAutomationElement> {
    controls(hwnd).ok()?.into_iter().find(|el| unsafe {
        el.CurrentName().is_ok_and(|n| n == date)
            && el.CurrentControlType().ok() != Some(UIA_ButtonControlTypeId)
    })
}

#[test]
#[ignore = "isolated Win32 desktop"]
fn anchored_calendar() -> Result<(), Error> {
    if !patina_test_support::run_case()? {
        return Ok(());
    }
    let _com = ComApartment::init()?;
    unsafe { SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2) };
    let root = tempfile::tempdir()?;
    let profile = root.path().join(patina::PROFILE_DIRECTORY);
    fs::create_dir(&profile)?;
    seed(&profile.join("patina.db"))?;
    let mut app = TestChild(
        Command::new(env!("CARGO_BIN_EXE_patina"))
            .env("PATINA_PROFILE_PARENT", root.path())
            .arg("--today")
            .spawn()?,
    );
    let hwnd = wait("main window", || {
        children::find(app.0.id(), |pid| window(pid, w!("Patina")))
    })?;
    click(hwnd, "History")?;
    wait("loaded history", || named(hwnd, "Day Timeline"))?;
    let today = Local::now().date_naive();
    let today_name = today.to_string();
    let trigger = wait("date trigger", || button(hwnd, &today_name))?;
    let trigger_bounds = unsafe { trigger.CurrentBoundingRectangle()? };
    let scale = unsafe { GetDpiForWindow(hwnd) } as f64 / 96.;
    assert!(((trigger_bounds.bottom - trigger_bounds.top) as f64 / scale - 32.).abs() <= 1.);
    for name in ["Previous day", "Next day"] {
        let arrow = wait(name, || button(hwnd, name))?;
        let bounds = unsafe { arrow.CurrentBoundingRectangle()? };
        assert!(((bounds.right - bounds.left) as f64 / scale - 32.).abs() <= 1.);
        assert!((bounds.top - trigger_bounds.top).abs() <= 1);
        assert!((bounds.bottom - trigger_bounds.bottom).abs() <= 1);
    }
    let group = wait("distribution switch", || {
        named(hwnd, "Select time destination type")
    })?;
    let group_bounds = unsafe { group.CurrentBoundingRectangle()? };
    assert!(((group_bounds.bottom - group_bounds.top) as f64 / scale - 28.).abs() <= 1.);
    let option = wait("Apps option", || segment(hwnd, "Apps"))?;
    let option_bounds = unsafe { option.CurrentBoundingRectangle()? };
    assert_control_height(hwnd, &option, 28)?;
    assert!((option_bounds.top - group_bounds.top).abs() <= 1);
    assert!((group_bounds.bottom - option_bounds.bottom).abs() <= 1);
    let close = || wait("closed calendar", || calendar(hwnd).is_none().then_some(()));
    // Isolated desktops cannot report foreground HasKeyboardFocus. A fresh Enter
    // without SetFocus proves that dismissal restored the trigger's keyboard target.
    let focus_returned = |_date: &str| -> Result<(), Error> {
        key(hwnd, 13)?;
        wait("reopen using returned focus", || calendar(hwnd))?;
        key(hwnd, 27)?;
        close()?;
        Ok(())
    };
    press(hwnd, &today_name)?;
    let popup = wait("calendar", || calendar(hwnd))?;
    let rect = unsafe { popup.CurrentBoundingRectangle()? };
    assert!(((rect.right - rect.left) as f64 / scale - 228.).abs() <= 1.);
    assert!((rect.left + rect.right - trigger_bounds.left - trigger_bounds.right).abs() <= 2);
    assert!(((rect.top - trigger_bounds.bottom) as f64 / scale - 4.).abs() <= 1.);
    let cell = wait("today cell", || day_cell(hwnd, &today_name))?;
    let cell_rect = unsafe { cell.CurrentBoundingRectangle()? };
    assert!(((cell_rect.bottom - cell_rect.top) as f64 / scale - 28.).abs() <= 1.);
    assert!(((cell_rect.right - cell_rect.left) as f64 / scale - 28.).abs() <= 1.);
    assert!(!unsafe {
        button(hwnd, "Next month")
            .ok_or("next month")?
            .CurrentIsEnabled()?
            .as_bool()
    });
    let tomorrow = today + Days::new(1);
    if tomorrow.month() == today.month() {
        assert!(!unsafe {
            day_cell(hwnd, &tomorrow.to_string())
                .ok_or("future cell")?
                .CurrentIsEnabled()?
                .as_bool()
        });
    }
    key(hwnd, 27)?;
    close()?;
    focus_returned(&today_name)?;

    // Keyboard navigation crosses a month boundary and commits only on Enter.
    press(hwnd, &today_name)?;
    wait("reopen", || calendar(hwnd))?;
    key(hwnd, 36)?; // Home: start of week.
    key(hwnd, 33)?; // PageUp: previous month.
    let chosen =
        (today - Days::new(today.weekday().num_days_from_monday().into())) - Months::new(1);
    wait("keyboard target", || day_cell(hwnd, &chosen.to_string()))?;
    key(hwnd, 13)?;
    close()?;
    wait("chosen day", || button(hwnd, &chosen.to_string()))?;
    focus_returned(&chosen.to_string())?;
    let chosen_bounds = unsafe {
        button(hwnd, &chosen.to_string())
            .unwrap()
            .CurrentBoundingRectangle()?
    };
    assert_eq!(
        trigger_bounds.right - trigger_bounds.left,
        chosen_bounds.right - chosen_bounds.left
    );

    press(hwnd, &chosen.to_string())?;
    let previous_rect =
        unsafe { wait("previous calendar", || calendar(hwnd))?.CurrentBoundingRectangle()? };
    assert_eq!(
        rect.bottom - rect.top,
        previous_rect.bottom - previous_rect.top
    );
    click(hwnd, "Previous month")?;
    wait("previous month label", || {
        named(
            hwnd,
            &format!(
                "{} / {}",
                (chosen - Months::new(1)).month(),
                (chosen - Months::new(1)).year()
            ),
        )
    })?;
    click(hwnd, "Next month")?;
    // The target day can also exist as a trailing cell in the previous month.
    // Wait for the month switch before taking its clickable bounds.
    wait("selected month label", || {
        named(hwnd, &format!("{} / {}", chosen.month(), chosen.year()))
    })?;
    let pick = chosen.with_day(1).unwrap().to_string();
    let cell = wait("first day", || day_cell(hwnd, &pick))?;
    activate_control(hwnd, &cell, false)?;
    close()?;
    wait("first day selected", || button(hwnd, &pick))?;
    press(hwnd, &pick)?;
    wait("calendar to return today", || calendar(hwnd))?;
    for _ in 0..3 {
        if day_cell(hwnd, &today_name).is_some() {
            break;
        }
        let old = controls(hwnd)?
            .into_iter()
            .filter_map(|el| unsafe { el.CurrentName().ok().map(|n| n.to_string()) })
            .collect::<Vec<_>>();
        click(hwnd, "Next month")?;
        wait("month changed", || (names(hwnd) != old).then_some(()))?;
    }
    let cell = day_cell(hwnd, &today_name).ok_or("today cell")?;
    activate_control(hwnd, &cell, false)?;
    close()?;
    wait("today restored", || button(hwnd, &today_name))?;

    press(hwnd, &today_name)?;
    wait("calendar for outside click", || calendar(hwnd))?;
    let point = client_center(
        hwnd,
        &wait("timeline heading", || named(hwnd, "Day Timeline"))?,
    )?;
    unsafe {
        PostMessageW(Some(hwnd), WM_LBUTTONDOWN, WPARAM(1), point)?;
        PostMessageW(Some(hwnd), WM_LBUTTONUP, WPARAM(0), point)?;
    }
    close()?;
    // Existing previous/next day navigation still works after dismissal.
    click(hwnd, "Previous day")?;
    wait("yesterday", || {
        button(hwnd, &(today - Days::new(1)).to_string())
    })?;
    click(hwnd, "Next day")?;
    wait("today again", || button(hwnd, &today_name))?;
    let tray = window(app.0.id(), w!("Patina Tray")).ok_or("tray")?;
    command(tray, 2)?;
    assert!(wait("exit", || app.0.try_wait().ok().flatten())?.success());
    Ok(())
}
