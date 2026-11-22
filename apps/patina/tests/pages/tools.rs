use super::*;
use windows::core::{BSTR, Interface};

#[test]
#[ignore = "requires a Windows audio output device"]
fn rapid_sound_previews_can_replace_and_replay_the_default_tone() {
    use patina_activity::NoticeSound::{Bell, Clear, Default, None};
    use patina_windows_integration::windows::notification_sound::preview;

    for sound in [Bell, Default, Default, Clear, Default, None] {
        assert!(preview(sound), "WinMM rejected {sound:?}");
    }
}

fn choose_tool(hwnd: HWND, name: &str) -> Result<(), Error> {
    click(hwnd, "Plugin home")?;
    click(hwnd, name)
}

fn titlebar_shortcut(hwnd: HWND, label: &str) -> Result<IUIAutomationElement, Error> {
    let shortcut = wait(label, || button(hwnd, label))?;
    let adjacent = button(hwnd, "Open mini window").ok_or("Mini button")?;
    let bounds = unsafe { shortcut.CurrentBoundingRectangle()? };
    let reference = unsafe { adjacent.CurrentBoundingRectangle()? };
    let scale = f64::from(reference.bottom - reference.top) / 36.;
    let divider = wait("title bar shortcut divider", || {
        controls(hwnd).ok()?.into_iter().find_map(|el| unsafe {
            if el.CurrentControlType().ok()? != UIA_SeparatorControlTypeId {
                return None;
            }
            let rect = el.CurrentBoundingRectangle().ok()?;
            (rect.left >= bounds.right && rect.right <= reference.left).then_some(rect)
        })
    })?;
    assert!((bounds.top + bounds.bottom - reference.top - reference.bottom).abs() <= 2);
    assert!((f64::from(bounds.right - bounds.left) - 28. * scale).abs() <= 1.);
    assert!((f64::from(divider.right - divider.left) - scale).abs() <= 1.);
    assert!((f64::from(divider.bottom - divider.top) - 24. * scale).abs() <= 1.);
    assert!((divider.top + divider.bottom - reference.top - reference.bottom).abs() <= 2);
    for gap in [divider.left - bounds.right, reference.left - divider.right] {
        assert!(
            (f64::from(gap) - 4. * scale).abs() <= 1.,
            "gap={gap}, scale={scale}"
        );
    }
    Ok(shortcut)
}

fn picker(owner: HWND) -> Option<HWND> {
    let mut pid = 0;
    unsafe { GetWindowThreadProcessId(owner, Some(&mut pid)) };
    let mut previous = None;
    loop {
        let hwnd = unsafe { FindWindowExW(None, previous, w!("#32770"), None) }.ok()?;
        let mut dialog_pid = 0;
        unsafe { GetWindowThreadProcessId(hwnd, Some(&mut dialog_pid)) };
        if dialog_pid == pid && unsafe { IsWindowVisible(hwnd) }.as_bool() {
            return Some(hwnd);
        }
        previous = Some(hwnd);
    }
}

#[test]
#[ignore = "isolated Win32 desktop"]
fn plugin_home_and_reminder_preferences_keep_keyboard_selections() -> Result<(), Error> {
    if !patina_test_support::run_case()? {
        return Ok(());
    }
    let _com = ComApartment::init()?;
    unsafe { SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2) };
    let root = tempfile::tempdir()?;
    let profile = root.path().join(patina::PROFILE_DIRECTORY);
    fs::create_dir(&profile)?;
    let db = profile.join("patina.db");
    seed(&db)?;
    super::history_timeline::seed_website_history(&db)?;
    let mut app = TestChild(
        Command::new(env!("CARGO_BIN_EXE_patina"))
            .arg("--today")
            .env("PATINA_PROFILE_PARENT", root.path())
            .spawn()?,
    );
    let pid = app.0.id();
    let hwnd = wait("main", || children::find(pid, |p| window(p, w!("Patina"))))?;
    let press_button = |label: &str| -> Result<(), Error> {
        wait(&format!("focus enabled {label} button"), || unsafe {
            let control = button(hwnd, label)?;
            control.CurrentIsEnabled().ok()?.as_bool().then_some(())?;
            control.SetFocus().ok()
        })?;
        key(hwnd, 13)?;
        Ok(())
    };
    press_button("Tools")?;
    wait("Reminder and Focus cards share the first row", || unsafe {
        let reminder = button(hwnd, "Reminder")?.CurrentBoundingRectangle().ok()?;
        let focus = button(hwnd, "Focus")?.CurrentBoundingRectangle().ok()?;
        (reminder.top == focus.top
            && reminder.bottom == focus.bottom
            && reminder.right < focus.left)
            .then_some(())
    })?;
    press_button("Reminder")?;
    wait("reminder content", || button(hwnd, "Create"))?;
    let field = |kind, name: &str| {
        controls(hwnd).ok()?.into_iter().find(|el| unsafe {
            el.CurrentControlType().ok() == Some(kind) && el.CurrentName().is_ok_and(|n| n == name)
        })
    };
    let frame_bounds = || unsafe {
        field(UIA_GroupControlTypeId, "Timed reminders")?
            .CurrentBoundingRectangle()
            .ok()
    };
    desktop::wait_observed("empty reminder list centered below the form", || unsafe {
        let frame = frame_bounds().ok_or("missing reminder list frame")?;
        let empty = named(hwnd, "No reminders")
            .ok_or("missing empty message")?
            .CurrentBoundingRectangle()
            .map_err(|e| e.to_string())?;
        let create = button(hwnd, "Create")
            .ok_or("missing Create button")?
            .CurrentBoundingRectangle()
            .map_err(|e| e.to_string())?;
        if frame.top > create.bottom
            && empty.top > frame.top
            && empty.bottom < frame.bottom
            && (empty.left + empty.right - frame.left - frame.right).abs() <= 2
            && (empty.top + empty.bottom - frame.top - frame.bottom).abs() <= 2
        {
            Ok(())
        } else {
            Err(format!(
                "frame={frame:?}, empty={empty:?}, create={create:?}"
            ))
        }
    })?;
    let (name, time, repeat) = wait("timed form fields and Create share a row", || unsafe {
        let name = field(UIA_EditControlTypeId, "Reminder")?
            .CurrentBoundingRectangle()
            .ok()?;
        let time = field(UIA_ComboBoxControlTypeId, "Remind at")?
            .CurrentBoundingRectangle()
            .ok()?;
        let repeat = field(UIA_ComboBoxControlTypeId, "Repeat")?
            .CurrentBoundingRectangle()
            .ok()?;
        let create = button(hwnd, "Create")?.CurrentBoundingRectangle().ok()?;
        (name.right > name.left
            && name.right <= time.left
            && time.right <= repeat.left
            && repeat.right <= create.left
            && name.top < create.bottom
            && create.top < name.bottom)
            .then_some((name, time, repeat))
    })?;
    // UIA measures the text editor inside the input's symmetric padding.
    let gap = repeat.left - time.right;
    let inset = time.left - gap - name.right;
    let content_width = name.right - name.left + 2 * inset;
    let schedule_width = repeat.right - time.left;
    let time_width = time.right - time.left;
    let repeat_width = repeat.right - repeat.left;
    assert!(
        inset >= 0
            && (content_width - schedule_width).abs() <= 3
            && (2 * time_width - 3 * repeat_width).abs() <= 5,
        "content={content_width}, schedule={schedule_width}, time={time_width}, repeat={repeat_width}, gap={gap}, inset={inset}"
    );
    let selected = |name: &str| unsafe {
        Some(
            field(UIA_ComboBoxControlTypeId, name)?
                .GetCurrentPatternAs::<IUIAutomationValuePattern>(UIA_ValuePatternId)
                .ok()?
                .CurrentValue()
                .ok()?
                .to_string(),
        )
    };
    assert!(field(UIA_ComboBoxControlTypeId, "Hour").is_none());
    assert!(field(UIA_ComboBoxControlTypeId, "Minute").is_none());
    let trigger = field(UIA_ComboBoxControlTypeId, "Remind at").ok_or("reminder time")?;
    activate_control(hwnd, &trigger, false)?;
    wait("date, hour and minute open side by side", || unsafe {
        let date = field(UIA_ComboBoxControlTypeId, "Select date")?
            .CurrentBoundingRectangle()
            .ok()?;
        let hour = field(UIA_ComboBoxControlTypeId, "Hour")?
            .CurrentBoundingRectangle()
            .ok()?;
        let minute = field(UIA_ComboBoxControlTypeId, "Minute")?
            .CurrentBoundingRectangle()
            .ok()?;
        (date.right <= hour.left
            && hour.right <= minute.left
            && date.top == hour.top
            && hour.top == minute.top)
            .then_some(())
    })?;
    let date = || chrono::NaiveDate::parse_from_str(&selected("Select date")?, "%Y-%m-%d").ok();
    let original_date = date().ok_or("initial reminder date")?;
    let trigger = field(UIA_ComboBoxControlTypeId, "Select date").ok_or("date selector")?;
    activate_control(hwnd, &trigger, true)?;
    wait("date dropdown calendar", || button(hwnd, "Next month"))?;
    key(hwnd, 39)?;
    key(hwnd, 13)?;
    wait("selected date and closed calendar", || {
        (date()? == original_date + chrono::Days::new(1) && button(hwnd, "Next month").is_none())
            .then_some(())
    })?;
    for (name, value) in [("Hour", "23"), ("Minute", "59")] {
        let trigger = field(UIA_ComboBoxControlTypeId, name).ok_or("time selector")?;
        activate_control(hwnd, &trigger, true)?;
        wait("time options", || field(UIA_ListControlTypeId, name))?;
        key(hwnd, 35)?;
        if name == "Hour" {
            key(hwnd, 13)?;
        } else {
            let option = wait("last minute", || field(UIA_ListItemControlTypeId, value))?;
            activate_control(hwnd, &option, false)?;
        }
        wait(&format!("{name} value selected"), || {
            (selected(name)? == value).then_some(())
        })
        .map_err(|e| {
            format!(
                "{e}; time {:?}, options {:?}",
                selected("Remind at"),
                names(hwnd)
            )
        })?;
    }
    assert_eq!(selected("Hour").as_deref(), Some("23"));
    assert_eq!(date(), Some(original_date + chrono::Days::new(1)));
    key(hwnd, 27)?;
    wait(
        "time field shows the chosen date and time after collapse",
        || {
            let expected = format!("{} 23:59", original_date + chrono::Days::new(1));
            (field(UIA_ComboBoxControlTypeId, "Hour").is_none()
                && selected("Remind at")? == expected)
                .then_some(())
        },
    )?;
    let repeat = field(UIA_ComboBoxControlTypeId, "Repeat").ok_or("repeat")?;
    activate_control(hwnd, &repeat, true)?;
    key(hwnd, 40)?;
    key(hwnd, 13)?;
    let interval = wait("interval field follows the selected recurrence", || {
        field(UIA_ComboBoxControlTypeId, "At intervals")
    })?;
    assert_eq!(selected("At intervals").as_deref(), Some("1h"));
    activate_control(hwnd, &interval, false)?;
    wait("interval opens the two duration selectors", || {
        (selected("Hour")? == "01"
            && selected("Minute")? == "00"
            && field(UIA_ComboBoxControlTypeId, "Select date").is_none())
        .then_some(())
    })?;
    let hour = field(UIA_ComboBoxControlTypeId, "Hour").ok_or("interval hours")?;
    activate_control(hwnd, &hour, true)?;
    key(hwnd, 35)?;
    let last_hour = wait("last interval hour scrolled into view", || {
        field(UIA_ListItemControlTypeId, "23")
    })?;
    activate_control(hwnd, &last_hour, false)?;
    wait("interval hours end at 23", || {
        (selected("At intervals")? == "23h").then_some(())
    })?;
    activate_control(hwnd, &hour, true)?;
    key(hwnd, 36)?;
    key(hwnd, 13)?;
    wait("shortest interval is one minute", || {
        (selected("Hour")? == "00" && selected("Minute")? == "01").then_some(())
    })?;
    let minute = field(UIA_ComboBoxControlTypeId, "Minute").ok_or("interval minutes")?;
    activate_control(hwnd, &minute, false)?;
    let three = wait("three-minute option", || {
        field(UIA_ListItemControlTypeId, "03")
    })?;
    activate_control(hwnd, &three, false)?;
    wait("interval updated independently of reminder time", || {
        (selected("Minute")? == "03" && selected("Remind at")?.ends_with("23:59")).then_some(())
    })?;
    key(hwnd, 27)?;
    wait("duration picker collapsed", || {
        (selected("Hour").is_none()).then_some(())
    })?;
    assert!(field(UIA_EditControlTypeId, "Weekly (1–7)").is_none());
    let timed = segment(hwnd, "Timed reminders").ok_or("timed reminders")?;
    unsafe { timed.SetFocus()? };
    key(hwnd, 39)?;
    wait("usage form replaces the timed form", || {
        selected_segment(hwnd, "Usage limits")?;
        field(UIA_ComboBoxControlTypeId, "Daily limit")?;
        field(UIA_ComboBoxControlTypeId, "Remind at")
            .is_none()
            .then_some(())
    })?;
    let limit = field(UIA_ComboBoxControlTypeId, "Daily limit").ok_or("daily limit picker")?;
    let target_bounds = unsafe {
        field(UIA_ComboBoxControlTypeId, "Target")
            .ok_or("usage target")?
            .CurrentBoundingRectangle()?
    };
    let limit_bounds = unsafe { limit.CurrentBoundingRectangle()? };
    let create_bounds = unsafe {
        button(hwnd, "Create")
            .ok_or("create usage reminder")?
            .CurrentBoundingRectangle()?
    };
    let target_width = target_bounds.right - target_bounds.left;
    let limit_width = limit_bounds.right - limit_bounds.left;
    assert!(
        (target_width - limit_width).abs() <= 1
            && target_bounds.top == limit_bounds.top
            && target_bounds.right < limit_bounds.left
            && limit_bounds.right < create_bounds.left,
        "target={target_bounds:?}, limit={limit_bounds:?}, create={create_bounds:?}"
    );
    activate_control(hwnd, &limit, false)?;
    wait("daily limit defaults to thirty minutes", || {
        (selected("Daily limit")? == "30m"
            && selected("Hour")? == "00"
            && selected("Minute")? == "30")
            .then_some(())
    })?;
    let hour = field(UIA_ComboBoxControlTypeId, "Hour").ok_or("daily limit hours")?;
    activate_control(hwnd, &hour, true)?;
    key(hwnd, 40)?;
    key(hwnd, 13)?;
    wait("daily limit shows both nonzero units", || {
        (selected("Daily limit")? == "1h 30m").then_some(())
    })?;
    activate_control(hwnd, &hour, true)?;
    key(hwnd, 36)?;
    key(hwnd, 13)?;
    wait("daily limit omits the zero hour", || {
        (selected("Daily limit")? == "30m").then_some(())
    })?;
    let minute = field(UIA_ComboBoxControlTypeId, "Minute").ok_or("daily limit minutes")?;
    activate_control(hwnd, &minute, true)?;
    key(hwnd, 35)?;
    key(hwnd, 13)?;
    wait("daily limit allows 59 minutes", || {
        (selected("Minute")? == "59").then_some(())
    })?;
    key(hwnd, 27)?;
    wait("daily limit collapsed", || {
        (selected("Daily limit")? == "59m" && selected("Hour").is_none()).then_some(())
    })?;
    let target = field(UIA_ComboBoxControlTypeId, "Target").ok_or("usage target")?;
    activate_control(hwnd, &target, true)?;
    let writer = "Writer · App";
    let studio = "Studio · App";
    let query = wait("empty target search opens without a result list", || {
        field(UIA_ListControlTypeId, "Target")
            .is_none()
            .then_some(())?;
        field(UIA_EditControlTypeId, "Target")
    })?;
    unsafe {
        query
            .GetCurrentPatternAs::<IUIAutomationValuePattern>(UIA_ValuePatternId)?
            .SetValue(&"WRITER.EXE".into())?;
    }
    let choice = wait("search filters by executable", || {
        field(UIA_ListItemControlTypeId, studio)
            .is_none()
            .then_some(())?;
        field(UIA_ListItemControlTypeId, writer)
    })?;
    activate_control(hwnd, &choice, false)?;
    wait("one selected target replaces the search", || {
        (selected("Target")? == "Writer" && field(UIA_EditControlTypeId, "Target").is_none())
            .then_some(())
    })?;
    activate_control(
        hwnd,
        &field(UIA_ComboBoxControlTypeId, "Target").ok_or("selected target")?,
        false,
    )?;
    let query = wait("target search reopens", || {
        field(UIA_EditControlTypeId, "Target")
    })?;
    let query_value =
        unsafe { query.GetCurrentPatternAs::<IUIAutomationValuePattern>(UIA_ValuePatternId)? };
    unsafe { query_value.SetValue(&"docs.example".into())? };
    let website = wait("website result", || {
        field(UIA_ListItemControlTypeId, "docs.example.com · Website")
    })?;
    assert_control_height(hwnd, &website, 28)?;
    let favicon = wait("website result shows its recorded favicon", || {
        field(UIA_ImageControlTypeId, "docs.example.com")
    })?;
    assert_control_height(hwnd, &favicon, 16)?;
    unsafe { query_value.SetValue(&"writer".into())? };
    wait("search shows the app again", || {
        field(UIA_ListItemControlTypeId, writer)
    })?;
    unsafe { query_value.SetValue(&"  ".into())? };
    wait("clearing the search hides its results", || {
        (field(UIA_ListControlTypeId, "Target").is_none()
            && field(UIA_ListItemControlTypeId, writer).is_none())
        .then_some(())
    })?;
    unsafe {
        query
            .GetCurrentPatternAs::<IUIAutomationValuePattern>(UIA_ValuePatternId)?
            .SetValue(&"development".into())?;
    }
    wait("same picker searches categories", || {
        field(UIA_ListItemControlTypeId, "Development · Category")
    })?;
    key(hwnd, 27)?;
    wait("Escape retains the previous target", || {
        (selected("Target")? == "Writer").then_some(())
    })?;
    unsafe {
        segment(hwnd, "Usage limits")
            .ok_or("usage tab")?
            .SetFocus()?
    };
    key(hwnd, 37)?;
    wait("timed recurrence draft restored", || {
        (selected("At intervals")? == "3m").then_some(())
    })?;
    press_button("Create")?;
    wait(
        "first reminder is inside the top of the list frame",
        || unsafe {
            let frame = frame_bounds()?;
            let action = button(hwnd, "Edit scheduled reminder ･ Time is up")?
                .CurrentBoundingRectangle()
                .ok()?;
            (action.top > frame.top
                && action.bottom < (frame.top + frame.bottom) / 2
                && action.right < frame.right
                && named(hwnd, "No reminders").is_none())
            .then_some(())
        },
    )?;
    press_button("Edit scheduled reminder ･ Time is up")?;
    wait("editing restores the saved interval", || {
        (selected("At intervals")? == "3m").then_some(())
    })?;
    let repeat = field(UIA_ComboBoxControlTypeId, "Repeat").ok_or("repeat")?;
    activate_control(hwnd, &repeat, true)?;
    let weekly = wait("weekly option", || {
        field(UIA_ListItemControlTypeId, "Weekly")
    })?;
    activate_control(hwnd, &weekly, false)?;
    wait("weekly uses only the selected reminder time", || {
        let value = unsafe {
            repeat
                .GetCurrentPatternAs::<IUIAutomationValuePattern>(UIA_ValuePatternId)
                .ok()?
                .CurrentValue()
                .ok()?
        };
        (value == "Weekly"
            && field(UIA_ComboBoxControlTypeId, "At intervals").is_none()
            && field(UIA_EditControlTypeId, "Weekly (1–7)").is_none())
        .then_some(())
    })?;
    wait("Plugin home and Plugin store are adjacent", || unsafe {
        let trigger = button(hwnd, "Plugin home")?
            .CurrentBoundingRectangle()
            .ok()?;
        let manage = button(hwnd, "Plugin store")?
            .CurrentBoundingRectangle()
            .ok()?;
        (trigger.right <= manage.left && trigger.top < manage.bottom && manage.top < trigger.bottom)
            .then_some(())
    })?;
    activate_control(
        hwnd,
        &segment(hwnd, "Usage limits").ok_or("usage tab")?,
        false,
    )?;
    wait("usage draft survives tab changes", || {
        (selected("Daily limit")? == "59m" && selected("Target")? == "Writer").then_some(())
    })?;
    press_button("Create")?;
    wait("usage rule uses the selected display name", || {
        button(hwnd, "Edit ･ Writer")
    })?;
    press_button("Plugin home")?;
    wait("installed reminder card", || button(hwnd, "Reminder"))?;
    press_button("Focus")?;
    wait("focus content", || named(hwnd, "New focus session"))?;
    activate_control(hwnd, &segment(hwnd, "Free focus").ok_or("free tab")?, false)?;
    wait("free focus selected", || {
        selected_segment(hwnd, "Free focus")
    })?;
    press_button("Today")?;
    wait("Today after leaving Tools", || named(hwnd, "Top Apps"))?;
    press_button("Tools")?;
    wait("Tools returns directly to the last plugin", || {
        named(hwnd, "New focus session")
    })?;
    press_button("Tools settings")?;
    wait("settings dialog opens above the current tool", || {
        button(hwnd, "Close")?;
        named(hwnd, "New focus session")?;
        selected_segment(hwnd, "App notification")
    })?;
    key(hwnd, 39)?;
    wait("keyboard changes the focused delivery option", || {
        selected_segment(hwnd, "Reminder dialog")
    })?;
    let sound_dropdown = || {
        controls(hwnd).ok()?.into_iter().find(|el| unsafe {
            el.CurrentControlType().ok() == Some(UIA_ComboBoxControlTypeId)
                && el.CurrentName().is_ok_and(|n| n == "Sound")
                && el.CurrentIsEnabled().is_ok_and(|v| v.as_bool())
        })
    };
    let sound_value = || unsafe {
        sound_dropdown()?
            .GetCurrentPatternAs::<IUIAutomationValuePattern>(UIA_ValuePatternId)
            .ok()?
            .CurrentValue()
            .ok()
    };
    let open_sound = || -> Result<(), Error> {
        let sound = wait("enabled sound dropdown", sound_dropdown)?;
        activate_control(hwnd, &sound, true)?;
        wait("sound options", || named(hwnd, "Soft bell"))?;
        Ok(())
    };
    open_sound()?;
    key(hwnd, 27)?;
    wait("Escape closes only the sound menu", || {
        named(hwnd, "Soft bell").is_none().then_some(())?;
        button(hwnd, "Close")
    })?;
    open_sound()?;
    let clear = wait("clear tone option", || named(hwnd, "Clear tone"))?;
    activate_control(hwnd, &clear, false)?;
    wait("selected sound saved", || {
        named(hwnd, "Soft bell").is_none().then_some(())?;
        (sound_value()? == "Clear tone").then_some(())
    })
    .map_err(|e| format!("{e}; sound {:?}, nodes {:?}", sound_value(), names(hwnd)))?;
    key(hwnd, 27)?;
    wait("preferences closed", || {
        segment(hwnd, "Reminder dialog").is_none().then_some(())?;
        named(hwnd, "New focus session")
    })?;
    key(hwnd, 13)?;
    wait("delivery persisted", || {
        selected_segment(hwnd, "Reminder dialog")
    })?;
    wait("sound persisted", || {
        (sound_value()? == "Clear tone").then_some(())
    })?;
    click(hwnd, "Close")?;
    wait("close button returns to the tool", || {
        segment(hwnd, "Reminder dialog").is_none().then_some(())?;
        named(hwnd, "New focus session")
    })?;
    let tray = window(pid, w!("Patina Tray")).ok_or("tray")?;
    let main = |pid| children::find(pid, |p| window(p, w!("Patina")));
    press(hwnd, "Close window")?;
    wait("main closed to tray", || main(pid).is_none().then_some(()))?;
    command(tray, 4)?;
    let hwnd = wait("main reopened", || main(pid))?;
    wait("same plugin after tray reopen", || {
        selected_segment(hwnd, "Free focus")
    })?;
    command(tray, 2)?;
    assert!(wait("exit", || app.0.try_wait().ok().flatten())?.success());
    let restart = || -> Result<_, Error> {
        let app = TestChild(
            Command::new(env!("CARGO_BIN_EXE_patina"))
                .arg("--main")
                .env("PATINA_PROFILE_PARENT", root.path())
                .spawn()?,
        );
        let hwnd = wait("main after restart", || main(app.0.id()))?;
        Ok((app, hwnd))
    };
    let (mut app, hwnd) = restart()?;
    wait("same plugin after full restart", || {
        selected_segment(hwnd, "Free focus")
    })?;
    choose_tool(hwnd, "Reminder")?;
    wait("reminder independently restores its last tab", || {
        selected_segment(hwnd, "Usage limits")
    })?;
    click(hwnd, "Plugin home")?;
    wait("home cards visible", || button(hwnd, "Reminder"))?;
    command(window(app.0.id(), w!("Patina Tray")).ok_or("tray")?, 2)?;
    assert!(wait("exit from home", || app.0.try_wait().ok().flatten())?.success());
    let (_app, hwnd) = restart()?;
    wait("home restored after restart", || button(hwnd, "Focus"))?;
    Ok(())
}

#[test]
#[ignore = "isolated Win32 desktop"]
fn focus_modes_and_timer_settings() -> Result<(), Error> {
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
            .arg("--today")
            .env("PATINA_GPUI_PROFILE_PARENT", root.path())
            .spawn()?,
    );
    let pid = app.0.id();
    let hwnd = wait("main", || children::find(pid, |p| window(p, w!("Patina"))))?;
    click(hwnd, "Tools")?;
    choose_tool(hwnd, "Focus")?;
    let combo = |name: &str| {
        controls(hwnd).ok()?.into_iter().find(|e| unsafe {
            e.CurrentControlType().ok() == Some(UIA_ComboBoxControlTypeId)
                && e.CurrentName().is_ok_and(|n| n == name)
        })
    };
    let value = |name: &str| unsafe {
        combo(name)?
            .GetCurrentPatternAs::<IUIAutomationValuePattern>(UIA_ValuePatternId)
            .ok()?
            .CurrentValue()
            .ok()
    };
    wait("Pomodoro defaults", || {
        selected_segment(hwnd, "Pomodoro")?;
        named(hwnd, "No Pomodoro tasks")?;
        (value("Timer settings")? == "25 min focus ･ 4 rounds").then_some(())
    })?;
    let timing = combo("Timer settings").ok_or("timer settings picker")?;
    activate_control(hwnd, &timing, true)?;
    wait("timer settings in two rows and two columns", || {
        let elements = controls(hwnd).ok()?;
        let bounds = |name: &str| unsafe {
            elements
                .iter()
                .find(|e| {
                    e.CurrentControlType().ok() == Some(UIA_EditControlTypeId)
                        && e.CurrentName().is_ok_and(|n| n == name)
                })?
                .CurrentBoundingRectangle()
                .ok()
        };
        let focus = bounds("Focus duration")?;
        let short = bounds("Short break")?;
        let long = bounds("Long break")?;
        let rounds = bounds("Long break interval")?;
        (focus.top == short.top
            && long.top == rounds.top
            && focus.bottom < long.top
            && focus.left == long.left
            && short.left == rounds.left
            && focus.right < short.left
            && rounds.right > rounds.left)
            .then_some(())
    })?;
    key(hwnd, 27)?;
    let free = wait("free focus tab", || segment(hwnd, "Free focus"))?;
    activate_control(hwnd, &free, false)?;
    wait("free focus form", || named(hwnd, "No focus sessions"))?;
    let rest = combo("Break mode").ok_or("break mode picker")?;
    activate_control(hwnd, &rest, true)?;
    let ratio = wait("proportional break option", || {
        segment(hwnd, "Proportional")
    })?;
    activate_control(hwnd, &ratio, false)?;
    wait("ratio editor", || named(hwnd, "Focus-to-break ratio"))?;
    desktop::wait_observed("compact break options align to the left", || unsafe {
        let fixed = segment(hwnd, "Fixed duration")
            .ok_or("missing fixed option")?
            .CurrentBoundingRectangle()
            .map_err(|e| e.to_string())?;
        let ratio = segment(hwnd, "Proportional")
            .ok_or("missing ratio option")?
            .CurrentBoundingRectangle()
            .map_err(|e| e.to_string())?;
        let elements = controls(hwnd).map_err(|e| e.to_string())?;
        let bounds = |kind, name: &str| {
            elements
                .iter()
                .find(|e| {
                    e.CurrentControlType().ok() == Some(kind)
                        && e.CurrentName().is_ok_and(|n| n == name)
                })
                .ok_or_else(|| format!("missing {name} ({kind:?})"))?
                .CurrentBoundingRectangle()
                .map_err(|e| e.to_string())
        };
        let group = bounds(UIA_GroupControlTypeId, "Break mode")?;
        let caption = bounds(UIA_TextControlTypeId, "Focus-to-break ratio")?;
        let input = bounds(UIA_EditControlTypeId, "Focus-to-break ratio")?;
        if (group.left - caption.left).abs() <= 1
            && ((fixed.left - group.left) - (group.right - ratio.right)).abs() <= 2
            && (fixed.right - ratio.left).abs() <= 1
            && group.right < input.right
            && fixed.top == ratio.top
        {
            Ok(())
        } else {
            Err(format!(
                "group={group:?}, fixed={fixed:?}, ratio={ratio:?}, caption={caption:?}, input={input:?}"
            ))
        }
    })?;
    key(hwnd, 27)?;
    wait("collapsed ratio", || {
        (value("Break mode")? == "5:1").then_some(())
    })?;
    super::classification_color::set(hwnd, "Name", "Reading")?;
    press(hwnd, "Create")?;
    click(hwnd, "Start ･ Reading")?;
    wait("running free focus", || {
        button(hwnd, "Finish focus session ･ Reading")
    })?;
    titlebar_shortcut(hwnd, "Focus ･ Reading")?;
    click(hwnd, "Pause ･ Reading")?;
    click(hwnd, "Edit ･ Reading")?;
    wait("editing free task keeps break settings", || {
        named(hwnd, "Edit free focus")?;
        (value("Break mode")? == "5:1").then_some(())
    })?;
    press(hwnd, "Save")?;
    click(hwnd, "Task details ･ Reading")?;
    wait("free task history", || button(hwnd, "Reset"))?;
    key(hwnd, 27)?;
    click(hwnd, "Delete ･ Reading")?;
    wait("free task removed", || named(hwnd, "No focus sessions"))?;
    let pomodoro = segment(hwnd, "Pomodoro").ok_or("Pomodoro tab")?;
    activate_control(hwnd, &pomodoro, false)?;
    wait("Pomodoro form restored", || {
        named(hwnd, "No Pomodoro tasks")
    })?;
    command(window(pid, w!("Patina Tray")).ok_or("tray")?, 2)?;
    assert!(wait("exit", || app.0.try_wait().ok().flatten())?.success());
    Ok(())
}

#[test]
#[ignore = "isolated Win32 desktop"]
fn mini_opens_the_selected_tool_and_keeps_dirty_settings() -> Result<(), Error> {
    if !patina_test_support::run_case()? {
        return Ok(());
    }
    let _com = ComApartment::init()?;
    let root = tempfile::tempdir()?;
    let profile = root.path().join(patina::APP_ID);
    fs::create_dir(&profile)?;
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()?;
    rt.block_on(async{
        let pool=patina_activity::open_database(&profile.join("patina.db")).await?;
        sqlx::query("INSERT OR REPLACE INTO settings(key,value) VALUES ('language','en-US'),('show_tray_icon','0'),('tracking_paused','1')").execute(&pool).await?;
        let now=Utc::now().timestamp_millis();
        for (name,at) in [("Review",now+3_600_000),("Tomorrow",now+100_000_000)]{
            sqlx::query("INSERT INTO tool_reminders(label,scheduled_at,created_at,status) VALUES(?,?,?,'scheduled')").bind(name).bind(at).bind(now).execute(&pool).await?;
        }
        pool.close().await;Ok::<_,Error>(())
    })?;
    let mut app = TestChild(
        Command::new(env!("CARGO_BIN_EXE_patina"))
            .arg("--mini")
            .env("PATINA_GPUI_PROFILE_PARENT", root.path())
            .spawn()?,
    );
    let pid = app.0.id();
    let main = || children::find(pid, |p| window(p, w!("Patina UI")));
    let mini = wait("Mini", || {
        children::find(pid, |p| window(p, w!("Patina Mini")))
    })?;
    let pin = wait("Mini pin", || {
        controls(mini).ok()?.into_iter().find_map(|el| unsafe {
            el.GetCurrentPatternAs::<IUIAutomationTogglePattern>(UIA_TogglePatternId)
                .ok()
        })
    })?;
    if unsafe { pin.CurrentToggleState()? } == ToggleState_Off {
        unsafe {
            pin.Toggle()?;
        }
    }
    let shortcut = "Reminder · Review";
    assert!(main().is_none());
    press(mini, shortcut)?;
    let hwnd = wait("rebuilt main", main)?;
    wait("opened reminder panel", || button(hwnd, "New reminder"))?;
    assert!(button(mini, "Reminder · Tomorrow").is_none());
    click(hwnd, "Settings")?;
    let plus = wait("setting increment", || {
        controls(hwnd)
            .ok()?
            .into_iter()
            .filter_map(|el| unsafe { el.CurrentName().ok() })
            .map(|s| s.to_string())
            .find(|s| s.starts_with("+ "))
    })?;
    click(hwnd, &plus)?;
    press(mini, shortcut)?;
    wait("unsaved edits confirmation", || named(hwnd, "Save changes"))?;
    click(hwnd, "Cancel")?;
    wait("settings preserved", || button(hwnd, &plus))?;
    press(mini, shortcut)?;
    wait("save prompt", || named(hwnd, "Save changes"))?;
    click(hwnd, "Save")?;
    wait("requested reminder restored", || {
        button(hwnd, "New reminder")
    })?;
    click(hwnd, "Manage tools")?;
    click(hwnd, "Uninstall tool Reminder")?;
    click(hwnd, "Confirm")?;
    wait("old shortcut withdrawn", || {
        button(mini, shortcut).is_none().then_some(())
    })?;
    click(hwnd, "Uninstall tool Focus")?;
    click(hwnd, "Confirm")?;
    wait("both absent", || named(hwnd, "No tools installed"))?;
    command(window(pid, w!("Patina GPUI")).ok_or("tray")?, 2)?;
    assert!(wait("exit", || app.0.try_wait().ok().flatten())?.success());
    Ok(())
}

#[test]
#[ignore = "dedicated Windows session: file picker and native foreground focus"]
fn navigation_and_consent_keyboard() -> Result<(), Error> {
    patina_test_support::dedicated_session()?;
    let _com = ComApartment::init()?;
    unsafe { SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2) };
    let mut observed = std::collections::BTreeSet::new();
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()?;
    for (locale, theme, compat) in [("en-US", "dark", false), ("zh-CN", "light", true)] {
        let root = tempfile::tempdir()?;
        let profile = root.path().join(patina::APP_ID);
        fs::create_dir(&profile)?;
        let local = patina_activity::Locale::from_tag(Some(locale));
        let tr = |k| patina_activity::text(local, k);
        rt.block_on(async{
            let pool=patina_activity::open_database(&profile.join("patina.db")).await?;
            sqlx::query("INSERT OR REPLACE INTO settings(key,value) VALUES ('language',?),('theme_mode',?),('tracking_paused','1')")
                .bind(locale).bind(theme).execute(&pool).await?;pool.close().await;Ok::<_,Error>(())
        })?;
        let mut command_line = Command::new(env!("CARGO_BIN_EXE_patina"));
        command_line
            .env("PATINA_GPUI_PROFILE_PARENT", root.path())
            .arg("--today");
        if compat {
            command_line.env("__COMPAT_LAYER", "DPIUNAWARE");
        }
        let mut host = TestChild(command_line.spawn()?);
        let pid = host.0.id();
        let hwnd = wait("main window", || {
            children::find(pid, |p| window(p, w!("Patina UI")))
        })?;
        let dpi = unsafe { GetDpiForWindow(hwnd) };
        observed.insert(dpi);
        println!("Tool geometry: {locale} {theme} {dpi} DPI");
        if unsafe { GetForegroundWindow() } != hwnd {
            let tray = wait("tray", || window(pid, w!("Patina GPUI")))?;
            command(tray, 4)?;
            wait("main window activated from tray", || {
                (unsafe { GetForegroundWindow() } == hwnd).then_some(())
            })?;
        }
        press(hwnd, &tr("tools.title"))?;
        wait("tools page opened", || button(hwnd, &tr("tools.manager")))?;
        click(hwnd, &tr("accessibility.sidebar.navigationLabels"))?;
        wait("navigation labels enabled", || unsafe {
            let toggle = button(hwnd, &tr("accessibility.sidebar.navigationLabels"))?
                .GetCurrentPatternAs::<IUIAutomationTogglePattern>(UIA_TogglePatternId)
                .ok()?;
            (toggle.CurrentToggleState().ok()? == ToggleState_On).then_some(())
        })?;
        let rect = |name: &str| -> Result<RECT, Error> {
            let el = wait(name, || button(hwnd, name))?;
            Ok(unsafe { el.CurrentBoundingRectangle()? })
        };
        let above = rect(&tr("mapping.title"))?;
        let tool = rect(&tr("tools.title"))?;
        let below = rect(&tr("settings.title"))?;
        assert!(above.bottom <= tool.top && tool.bottom <= below.top && tool.right > tool.left);
        unsafe {
            button(hwnd, &tr("mapping.title"))
                .ok_or("classification button")?
                .SetFocus()?;
        }
        wait("classification received focus", || {
            button(hwnd, &tr("mapping.title"))
                .filter(|e| unsafe { e.CurrentHasKeyboardFocus().is_ok_and(|b| b.as_bool()) })
        })?;
        for target in ["tools.title", "settings.title"] {
            key(hwnd, 9)?;
            wait("sidebar tab order", || {
                button(hwnd, &tr(target))
                    .filter(|e| unsafe { e.CurrentHasKeyboardFocus().is_ok_and(|b| b.as_bool()) })
            })
            .map_err(|e| {
                let focused = controls(hwnd)
                    .unwrap_or_default()
                    .into_iter()
                    .find(|el| unsafe { el.CurrentHasKeyboardFocus().is_ok_and(|v| v.as_bool()) })
                    .and_then(|el| unsafe { el.CurrentName().ok() });
                format!("{e}: expected {target}, focus {focused:?}")
            })?;
        }
        press(hwnd, &tr("tools.manager"))?;
        press(hwnd, &tr("tools.install"))?;
        let file_dialog = wait("file picker", || picker(hwnd))?;
        unsafe {
            PostMessageW(Some(file_dialog), WM_COMMAND, WPARAM(2), LPARAM(0))?;
        }
        wait("picker cancelled", || picker(hwnd).is_none().then_some(()))?;
        let invalid = root.path().join("invalid.patina-tool");
        fs::write(&invalid, b"{}")?;
        press(hwnd, &tr("tools.install"))?;
        pick_file(hwnd, &invalid)?;
        wait("package error", || button(hwnd, &tr("common.retry")))?;
        press(hwnd, &tr("common.retry"))?;
        wait("manager recovered", || {
            button(hwnd, &tr("tools.install"))
                .filter(|e| unsafe { e.CurrentIsEnabled().is_ok_and(|v| v.as_bool()) })
        })?;
        let remove = format!("{} {}", tr("tools.uninstall"), tr("tools.pomodoroTitle"));
        press(hwnd, &remove)?;
        let cancel = wait("cancel", || button(hwnd, &tr("common.cancel")))?;
        unsafe {
            cancel.SetFocus()?;
        }
        key(hwnd, 27)?;
        wait("dismissed confirmation", || {
            button(hwnd, &tr("common.confirm")).is_none().then_some(())
        })?;
        wait("focus returned to manager", || {
            button(hwnd, &tr("tools.manager"))
                .filter(|e| unsafe { e.CurrentHasKeyboardFocus().is_ok_and(|v| v.as_bool()) })
        })?;
        press(hwnd, &remove)?;
        press(hwnd, &tr("common.confirm"))?;
        wait("focus tool removed", || {
            button(hwnd, &remove).is_none().then_some(())
        })?;
        wait("focus after uninstall", || {
            button(hwnd, &tr("tools.manager"))
                .filter(|e| unsafe { e.CurrentHasKeyboardFocus().is_ok_and(|v| v.as_bool()) })
        })?;
        command(window(pid, w!("Patina GPUI")).ok_or("tray")?, 2)?;
        wait("exit", || host.0.try_wait().ok().flatten())?;
    }
    assert!(observed.len() >= 2, "DPI values {observed:?}");
    Ok(())
}

fn pick_file(hwnd: HWND, path: &Path) -> Result<(), Error> {
    let dialog = wait("tool file picker", || picker(hwnd))?;
    let edit = wait("file name field", || {
        controls(dialog).ok()?.into_iter().find(|el| unsafe {
            el.CurrentControlType().ok() == Some(UIA_EditControlTypeId)
                && el.CurrentAutomationId().is_ok_and(|id| id == "1148")
        })
    })?;
    let value: IUIAutomationValuePattern =
        unsafe { edit.GetCurrentPattern(UIA_ValuePatternId)?.cast()? };
    unsafe {
        edit.SetFocus()?;
        value.SetValue(&BSTR::from(
            path.to_str().ok_or("non-Unicode fixture path")?,
        ))?;
    }
    let name = path.to_str().ok_or("invalid fixture path")?;
    let ok = unsafe { GetDlgItem(Some(dialog), 1)? };
    wait("file picker closed", || {
        if picker(hwnd).is_none() {
            return Some(());
        }
        unsafe {
            if !value.CurrentValue().is_ok_and(|v| v == name) {
                value.SetValue(&BSTR::from(name)).ok()?;
            }
            PostMessageW(Some(dialog), WM_COMMAND, WPARAM(1), LPARAM(ok.0 as isize)).ok()?;
        }
        None
    })
}

#[test]
#[ignore = "isolated Win32 desktop"]
fn bundled_tools_can_be_removed_independently() -> Result<(), Error> {
    if !patina_test_support::run_case()? {
        return Ok(());
    }
    let _com = ComApartment::init()?;
    unsafe { SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2) };
    let root = tempfile::tempdir()?;
    let profile = root.path().join(patina::APP_ID);
    fs::create_dir(&profile)?;
    let db = profile.join("patina.db");
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()?;
    rt.block_on(async {
        let pool=patina_activity::open_database(&db).await?;
        sqlx::query("INSERT OR REPLACE INTO settings(key,value) VALUES ('language','en-US'),('show_tray_icon','0'),('tracking_paused','1')")
            .execute(&pool).await?;
        pool.close().await;
        Ok::<_,Error>(())
    })?;
    let launch = || -> Result<_, Error> {
        let app = TestChild(
            Command::new(env!("CARGO_BIN_EXE_patina"))
                .env("PATINA_GPUI_PROFILE_PARENT", root.path())
                .arg("--today")
                .spawn()?,
        );
        let pid = app.0.id();
        let hwnd = wait("main window", || {
            children::find(pid, |p| window(p, w!("Patina UI")))
        })?;
        click(hwnd, "Tools")?;
        Ok((app, hwnd, pid))
    };
    let quit = |mut app: TestChild, pid| -> Result<(), Error> {
        command(window(pid, w!("Patina GPUI")).ok_or("no tray")?, 2)?;
        assert!(wait("exit", || app.0.try_wait().ok().flatten())?.success());
        Ok(())
    };
    let remove = |hwnd, name: &str| -> Result<(), Error> {
        click(hwnd, &format!("Uninstall tool {name}"))?;
        click(hwnd, "Confirm")?;
        wait("uninstalled", || {
            button(hwnd, &format!("Uninstall tool {name}"))
                .is_none()
                .then_some(())
        })?;
        Ok(())
    };
    let (app, hwnd, pid) = launch()?;
    choose_tool(hwnd, "Focus")?;
    press(hwnd, "New focus session")?;
    click(hwnd, "Start")?;
    wait("running focus", || button(hwnd, "Pause"))?;
    choose_tool(hwnd, "Reminder")?;
    press(hwnd, "New reminder")?;
    wait("scheduled", || button(hwnd, "Pause"))?;
    click(hwnd, "Manage tools")?;
    remove(hwnd, "Reminder")?;
    choose_tool(hwnd, "Focus")?;
    wait("focus still running", || button(hwnd, "Pause"))?;
    click(hwnd, "Manage tools")?;
    remove(hwnd, "Focus")?;
    wait("empty tools", || named(hwnd, "No tools installed"))?;
    quit(app, pid)?;
    let (app, hwnd, pid) = launch()?;
    wait("removals survived restart", || {
        named(hwnd, "No tools installed")
    })?;
    click(hwnd, "Reinstall · Reminder")?;
    wait("old reminder paused", || button(hwnd, "Start"))?;
    click(hwnd, "Manage tools")?;
    click(hwnd, "Reinstall · Focus")?;
    wait("focus retained and paused", || button(hwnd, "Start"))?;
    assert!(button(hwnd, "Pause").is_none());
    quit(app, pid)?;
    rt.block_on(async {
        let pool = patina_activity::open_database(&db).await?;
        let focus: String = sqlx::query_scalar("SELECT status FROM tool_pomodoro_runs")
            .fetch_one(&pool)
            .await?;
        let reminder: String = sqlx::query_scalar("SELECT status FROM tool_reminders")
            .fetch_one(&pool)
            .await?;
        assert_eq!((focus.as_str(), reminder.as_str()), ("paused", "paused"));
        let active: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM focus_history_spans WHERE ended_at IS NULL")
                .fetch_one(&pool)
                .await?;
        assert_eq!(active, 0);
        pool.close().await;
        Ok::<_, Error>(())
    })
}

#[test]
#[ignore = "dedicated Windows session: passive notification foreground"]
fn timed_reminder_survives_window_release() -> Result<(), Error> {
    patina_test_support::dedicated_session()?;
    verify_reminder_delivery(false)
}

#[test]
#[ignore = "isolated Win32 desktop"]
fn separate_reminder_survives_window_release() -> Result<(), Error> {
    if !patina_test_support::run_case()? {
        return Ok(());
    }
    verify_reminder_delivery(false)
}

#[test]
#[ignore = "isolated Win32 desktop"]
fn in_window_reminder_uses_the_selected_delivery() -> Result<(), Error> {
    if !patina_test_support::run_case()? {
        return Ok(());
    }
    verify_reminder_delivery(true)
}

fn verify_reminder_delivery(dialog: bool) -> Result<(), Error> {
    let _com = ComApartment::init()?;
    let root = tempfile::tempdir()?;
    let profile = root.path().join(patina::APP_ID);
    fs::create_dir(&profile)?;
    let db = profile.join("patina.db");
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()?;
    let pool = rt.block_on(patina_activity::open_database(&db))?;
    let deadline = Utc::now().timestamp_millis() + 12_000;
    rt.block_on(async{
        sqlx::query("INSERT OR REPLACE INTO settings(key,value) VALUES ('language','en-US'),('show_tray_icon','0'),('tracking_paused','1'),('tools_notification_preferences',?)")
            .bind(serde_json::json!({"delivery":if dialog{"dialog"}else{"notification"},"sound":"none"}).to_string()).execute(&pool).await?;
        sqlx::query("INSERT INTO tool_reminders(label,scheduled_at,created_at,status) VALUES('Tray deadline',?,?,'scheduled')").bind(deadline).bind(deadline-60000).execute(&pool).await?;
        Ok::<_,Error>(())
    })?;
    let mut app = TestChild(
        Command::new(env!("CARGO_BIN_EXE_patina"))
            .env("PATINA_GPUI_PROFILE_PARENT", root.path())
            .arg("--today")
            .spawn()?,
    );
    let pid = app.0.id();
    let main = wait("main window", || {
        children::find(pid, |p| window(p, w!("Patina UI")))
    })?;
    press(main, "Close window")?;
    wait("main released before expiry", || {
        children::find(pid, |p| window(p, w!("Patina UI")))
            .is_none()
            .then_some(())
    })?;
    let notice = wait("assigned expiry notification", || {
        children::find(pid, |p| {
            window(
                p,
                if dialog {
                    w!("Patina UI")
                } else {
                    w!("Patina · Tools")
                },
            )
        })
    })?;
    wait("correct notification", || named(notice, "Tray deadline"))?;
    if dialog {
        assert!(children::find(pid, |p| window(p, w!("Patina · Tools"))).is_none());
    } else {
        assert_ne!(unsafe { GetForegroundWindow() }, notice);
        assert!(children::find(pid, |p| window(p, w!("Patina UI"))).is_none());
    }
    click(notice, "Confirm")?;
    wait("notification released", || {
        if dialog {
            return named(notice, "Tray deadline").is_none().then_some(());
        }
        children::find(pid, |p| window(p, w!("Patina · Tools")))
            .is_none()
            .then_some(())
    })?;
    let status: String = rt.block_on(
        sqlx::query_scalar("SELECT status FROM tool_reminders WHERE label='Tray deadline'")
            .fetch_one(&pool),
    )?;
    assert_eq!(status, "fired");
    command(window(pid, w!("Patina GPUI")).ok_or("no tray")?, 2)?;
    assert!(wait("exit", || app.0.try_wait().ok().flatten())?.success());
    rt.block_on(pool.close());
    Ok(())
}

#[test]
#[ignore = "dedicated Windows session: tray resource samples"]
fn tool_tray_resources() -> Result<(), Error> {
    patina_test_support::dedicated_session()?;
    use windows::Win32::System::Threading::{
        GetProcessHandleCount, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION,
    };
    let _com = ComApartment::init()?;
    let root = tempfile::tempdir()?;
    let out = PathBuf::from(
        std::env::var_os("PATINA_TOOL_SAMPLES")
            .ok_or("Set PATINA_TOOL_SAMPLES to the run output directory")?,
    );
    fs::create_dir_all(&out)?;
    let profile = root.path().join(patina::APP_ID);
    fs::create_dir(&profile)?;
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()?;
    let pool = rt.block_on(patina_activity::open_database(&profile.join("patina.db")))?;
    rt.block_on(sqlx::query("INSERT OR REPLACE INTO settings(key,value) VALUES ('language','en-US'),('tracking_paused','0')").execute(&pool))?;
    let exe = r"C:\fixture\fixture.exe";
    fs::write(
        root.path().join("native-probe-fixture.json"),
        serde_json::to_vec(&serde_json::json!({
        "foreground":{"hwnd":"0x42","root_owner_hwnd":"0x42","process_id":42,"window_class":"Fixture","title":"Fixture",
            "exe_name":"fixture.exe","process_path":exe,"is_afk":false,"idle_time_ms":0},"names":{(exe):"Fixture"}}))?,
    )?;
    let mut app = TestChild(
        Command::new(env!("CARGO_BIN_EXE_patina"))
            .env("PATINA_GPUI_PROFILE_PARENT", root.path())
            .env("PATINA_E2E_DATA_ROOT", root.path())
            .env("PATINA_E2E", "1")
            .env("PATINA_E2E_NATIVE_FIXTURE", "1")
            .spawn()?,
    );
    let pid = app.0.id();
    let tray = wait("tray", || window(pid, w!("Patina GPUI")))?;
    let recording = || {
        rt.block_on(sqlx::query_as::<_,(i64,i64)>("SELECT s.id,CAST(t.value AS INTEGER) FROM sessions s JOIN settings t ON t.key='__tracker_last_successful_sample_ms' WHERE s.exe_name='fixture.exe' AND s.end_time IS NULL").fetch_optional(&pool)).ok().flatten()
    };
    wait("fixture activity", recording)?;
    let measure = |name: &str| -> Result<(), Error> {
        let before = recording().ok_or("recording stopped")?;
        sample(&Some(out.clone()), pid, name)?;
        let after = recording().ok_or("recording stopped")?;
        assert_eq!(after.0, before.0);
        assert!(after.1 > before.1);
        let mut processes = children::children(pid)?;
        processes.push(pid);
        let mut handles = 0;
        for p in processes {
            unsafe {
                if let Ok(h) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, p) {
                    let mut n = 0;
                    let result = GetProcessHandleCount(h, &mut n);
                    let _ = windows::Win32::Foundation::CloseHandle(h);
                    result?;
                    handles += n;
                }
            }
        }
        fs::write(
            out.join(format!("{name}-activity.json")),
            serde_json::to_vec(
                &serde_json::json!({"before":before,"after":after,"handles":handles}),
            )?,
        )?;
        Ok(())
    };
    let open = || -> Result<_, Error> {
        command(tray, 4)?;
        let hwnd = wait("main", || {
            children::find(pid, |p| window(p, w!("Patina UI")))
        })?;
        click(hwnd, "Tools")?;
        wait("tools loaded", || {
            button(hwnd, "Manage tools")
                .filter(|el| unsafe { el.CurrentIsEnabled().is_ok_and(|b| b.as_bool()) })
        })?;
        Ok(hwnd)
    };
    let close = |hwnd| -> Result<(), Error> {
        click(hwnd, "Close window")?;
        wait("renderer exited", || {
            children::find(pid, |p| window(p, w!("Patina UI")))
                .is_none()
                .then_some(())
        })?;
        Ok(())
    };
    measure("idle")?;
    let hwnd = open()?;
    press(hwnd, "New focus session")?;
    click(hwnd, "Start")?;
    wait("running", || button(hwnd, "Pause"))?;
    close(hwnd)?;
    measure("timing")?;
    let hwnd = open()?;
    click(hwnd, "Manage tools")?;
    for name in ["Focus", "Reminder"] {
        click(hwnd, &format!("Uninstall tool {name}"))?;
        click(hwnd, "Confirm")?;
        wait("removed", || {
            button(hwnd, &format!("Uninstall tool {name}"))
                .is_none()
                .then_some(())
        })?;
    }
    close(hwnd)?;
    measure("empty")?;
    let hwnd = open()?;
    for _ in 0..5 {
        click(hwnd, "Reinstall · Reminder")?;
        wait("restored tool", || button(hwnd, "New reminder"))?;
        click(hwnd, "Manage tools")?;
        click(hwnd, "Uninstall tool Reminder")?;
        click(hwnd, "Confirm")?;
        wait("removed", || {
            button(hwnd, "Uninstall tool Reminder")
                .is_none()
                .then_some(())
        })?;
    }
    close(hwnd)?;
    measure("cycled")?;
    command(tray, 2)?;
    assert!(wait("exit", || app.0.try_wait().ok().flatten())?.success());
    rt.block_on(pool.close());
    Ok(())
}

#[test]
#[ignore = "isolated Win32 desktop and one-minute timer"]
fn focus_completes_in_tray_and_starts_break_from_notice() -> Result<(), Error> {
    if !patina_test_support::run_case()? {
        return Ok(());
    }
    let _com = ComApartment::init()?;
    let root = tempfile::tempdir()?;
    let profile = root.path().join(patina::APP_ID);
    fs::create_dir(&profile)?;
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()?;
    let pool = rt.block_on(patina_activity::open_database(&profile.join("patina.db")))?;
    rt.block_on(sqlx::query("INSERT OR REPLACE INTO settings(key,value) VALUES ('language','en-US'),('show_tray_icon','0'),('tracking_paused','1'),('tools_notification_preferences','{\"delivery\":\"notification\",\"sound\":\"none\"}')").execute(&pool))?;
    let mut app = TestChild(
        Command::new(env!("CARGO_BIN_EXE_patina"))
            .env("PATINA_GPUI_PROFILE_PARENT", root.path())
            .arg("--today")
            .spawn()?,
    );
    let pid = app.0.id();
    let main = || children::find(pid, |p| window(p, w!("Patina UI")));
    let hwnd = wait("main", main)?;
    click(hwnd, "Tools")?;
    choose_tool(hwnd, "Focus")?;
    wait("focus duration set to one minute", || {
        let field = controls(hwnd).ok()?.into_iter().find_map(|e| unsafe {
            if e.CurrentControlType().ok()? != UIA_EditControlTypeId
                || e.CurrentName().ok()? != "Focus duration"
            {
                return None;
            }
            e.GetCurrentPatternAs::<IUIAutomationValuePattern>(UIA_ValuePatternId)
                .ok()
        })?;
        unsafe {
            if field.CurrentValue().ok()? == "1" {
                return Some(());
            }
            field.SetValue(&BSTR::from("1")).ok()?;
        }
        None
    })?;
    press(hwnd, "New focus session")?;
    click(hwnd, "Start")?;
    wait("running timer", || button(hwnd, "Pause"))?;
    click(hwnd, "Close window")?;
    wait("main released", || main().is_none().then_some(()))?;
    let until = std::time::Instant::now() + std::time::Duration::from_secs(80);
    let notice = loop {
        if let Some(h) = children::find(pid, |p| window(p, w!("Patina · Tools"))) {
            break h;
        }
        if std::time::Instant::now() > until {
            return Err("No notification for elapsed focus session".into());
        }
        std::thread::sleep(std::time::Duration::from_millis(150));
    };
    assert!(main().is_none());
    click(notice, "Start")?;
    wait("focus notification dismissed", || {
        children::find(pid, |p| window(p, w!("Patina · Tools")))
            .is_none()
            .then_some(())
    })?;
    let tray = window(pid, w!("Patina GPUI")).ok_or("tray")?;
    command(tray, 4)?;
    let hwnd = wait("main rebuilt", main)?;
    click(hwnd, "Tools")?;
    choose_tool(hwnd, "Focus")?;
    wait("break running", || button(hwnd, "Pause"))?;
    let state: (String, String, i64) = rt.block_on(
        sqlx::query_as("SELECT status,phase,completed_focus_count FROM tool_pomodoro_runs")
            .fetch_one(&pool),
    )?;
    assert_eq!(state, ("running".into(), "short_break".into(), 1));
    command(tray, 2)?;
    assert!(wait("exit", || app.0.try_wait().ok().flatten())?.success());
    rt.block_on(pool.close());
    Ok(())
}

#[test]
#[ignore = "isolated Win32 desktop and compiled counter packages"]
fn install_update_uninstall_counter() -> Result<(), Error> {
    if !patina_test_support::run_case()? {
        return Ok(());
    }
    let _com = ComApartment::init()?;
    unsafe { SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2) };
    let root = tempfile::tempdir()?;
    let profile = root.path().join(patina::APP_ID);
    fs::create_dir(&profile)?;
    tokio::runtime::Builder::new_current_thread().enable_all().build()?.block_on(async {
        let pool = patina_activity::open_database(&profile.join("patina.db")).await?;
        sqlx::query("INSERT OR REPLACE INTO settings(key,value) VALUES ('language','en-US'),('show_tray_icon','0'),('tracking_paused','1')").execute(&pool).await?;
        pool.close().await;
        Ok::<_, Error>(())
    })?;
    let mut host = TestChild(
        Command::new(env!("CARGO_BIN_EXE_patina"))
            .env("PATINA_GPUI_PROFILE_PARENT", root.path())
            .arg("--today")
            .spawn()?,
    );
    let pid = host.0.id();
    let hwnd = wait("Today", || {
        children::find(pid, |p| window(p, w!("Patina UI")))
    })?;
    click(hwnd, "Tools")?;
    let file = |name| -> Result<PathBuf, Error> {
        Ok(std::path::absolute(PathBuf::from(
            std::env::var_os(name).ok_or("Missing counter package")?,
        ))?)
    };
    let install = |path: &Path| -> Result<(), Error> {
        click(hwnd, "Install from file")?;
        pick_file(hwnd, path)?;
        click(hwnd, "Confirm")
    };
    wait("tool registry", || tool_dropdown(hwnd))?;
    click(hwnd, "Manage tools")?;
    install(&file("PATINA_COUNTER_PACKAGE")?)?;
    click(hwnd, "Add one")?;
    wait("counter after click", || named(hwnd, "1"))?;
    press(hwnd, "Add one")?;
    wait("counter after keyboard", || named(hwnd, "2"))?;
    click(hwnd, "Today")?;
    wait("Today after leaving the counter", || {
        named(hwnd, "Top Apps")
    })?;
    click(hwnd, "Tools")?;
    wait("restored counter panel and saved value", || {
        named(hwnd, "Counter")?;
        button(hwnd, "Add one")?;
        named(hwnd, "2")
    })?;
    click(hwnd, "Manage tools")?;
    install(&file("PATINA_COUNTER_UPDATE")?)?;
    press(hwnd, "Increment")?;
    wait("updated counter", || named(hwnd, "3"))?;
    click(hwnd, "Manage tools")?;
    click(hwnd, "Uninstall tool Counter")?;
    click(hwnd, "Confirm")?;
    wait("counter removed", || {
        button(hwnd, "Uninstall tool Counter")
            .is_none()
            .then_some(())
    })?;
    command(window(pid, w!("Patina GPUI")).ok_or("missing tray")?, 2)?;
    assert!(wait("exit", || host.0.try_wait().ok().flatten())?.success());
    Ok(())
}
