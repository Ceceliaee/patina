use super::*;
use windows::core::{BSTR, Interface};

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
fn preference_segments_persist_and_support_keyboard() -> Result<(), Error> {
    if !patina_test_desktop::run_case()? {
        return Ok(());
    }
    let _com = ComApartment::init()?;
    let root = tempfile::tempdir()?;
    let profile = root.path().join(patina_gpui::APP_ID);
    fs::create_dir(&profile)?;
    seed(&profile.join("patina.db"))?;
    let mut app = TestChild(
        Command::new(env!("CARGO_BIN_EXE_patina-gpui"))
            .arg("--today")
            .env("PATINA_GPUI_PROFILE_PARENT", root.path())
            .spawn()?,
    );
    let pid = app.0.id();
    let hwnd = wait("main", || children::find(pid, |p| window(p, w!("Patina"))))?;
    click(hwnd, "Tools")?;
    let reminder = wait("default reminder section", || {
        selected_segment(hwnd, "Reminder")?;
        segment(hwnd, "Reminder")
    })?;
    let focus = wait("focus section", || segment(hwnd, "Focus"))?;
    let create = wait("reminder content", || button(hwnd, "New reminder"))?;
    unsafe {
        let top = reminder.CurrentBoundingRectangle()?;
        let bottom = focus.CurrentBoundingRectangle()?;
        assert!(top.bottom <= bottom.top && top.left == bottom.left);
        assert!(top.right <= create.CurrentBoundingRectangle()?.left);
        reminder.SetFocus()?;
    }
    key(hwnd, 40)?;
    wait("keyboard selects focus", || selected_segment(hwnd, "Focus"))?;
    wait("focus content", || button(hwnd, "New focus session"))?;
    click(hwnd, "Today")?;
    click(hwnd, "Tools")?;
    wait("focus section restored", || selected_segment(hwnd, "Focus"))?;
    click(hwnd, "Tools settings")?;
    select_segment(hwnd, "Reminder dialog")?;
    select_segment(hwnd, "Soft bell")?;
    unsafe {
        segment(hwnd, "Soft bell")
            .ok_or("sound segment")?
            .SetFocus()?;
    }
    key(hwnd, 39)?;
    wait("keyboard selects clear tone", || {
        selected_segment(hwnd, "Clear tone")
    })?;
    click(hwnd, "Tools settings")?;
    wait("preferences closed", || {
        segment(hwnd, "Clear tone").is_none().then_some(())
    })?;
    click(hwnd, "Tools settings")?;
    wait("delivery persisted", || {
        selected_segment(hwnd, "Reminder dialog")
    })?;
    wait("sound persisted", || selected_segment(hwnd, "Clear tone"))?;
    select_segment(hwnd, "App notification")?;
    select_segment(hwnd, "None")?;
    command(window(pid, w!("Patina GPUI")).ok_or("tray")?, 2)?;
    assert!(wait("exit", || app.0.try_wait().ok().flatten())?.success());
    Ok(())
}

#[test]
#[ignore = "isolated Win32 desktop"]
fn mini_opens_the_selected_tool_and_keeps_dirty_settings() -> Result<(), Error> {
    if !patina_test_desktop::run_case()? {
        return Ok(());
    }
    let _com = ComApartment::init()?;
    let root = tempfile::tempdir()?;
    let profile = root.path().join(patina_gpui::APP_ID);
    fs::create_dir(&profile)?;
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()?;
    rt.block_on(async{
        let pool=patina_recorder::open_database(&profile.join("patina.db")).await?;
        sqlx::query("INSERT OR REPLACE INTO settings(key,value) VALUES ('language','en-US'),('show_tray_icon','0'),('tracking_paused','1')").execute(&pool).await?;
        let now=Utc::now().timestamp_millis();
        for (name,at) in [("Review",now+3_600_000),("Tomorrow",now+100_000_000)]{
            sqlx::query("INSERT INTO tool_reminders(label,scheduled_at,created_at,status) VALUES(?,?,?,'scheduled')").bind(name).bind(at).bind(now).execute(&pool).await?;
        }
        pool.close().await;Ok::<_,Error>(())
    })?;
    let mut app = TestChild(
        Command::new(env!("CARGO_BIN_EXE_patina-gpui"))
            .arg("--mini")
            .env("PATINA_GPUI_PROFILE_PARENT", root.path())
            .spawn()?,
    );
    let pid = app.0.id();
    let main = || children::find(pid, |p| window(p, w!("Patina")));
    let mini = wait("Mini", || {
        children::find(pid, |p| window(p, w!("Patina GPUI Mini")))
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
    patina_test_desktop::dedicated_session()?;
    let _com = ComApartment::init()?;
    unsafe { SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2) };
    let mut observed = std::collections::BTreeSet::new();
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()?;
    for (locale, theme, compat) in [("en-US", "dark", false), ("zh-CN", "light", true)] {
        let root = tempfile::tempdir()?;
        let profile = root.path().join(patina_gpui::APP_ID);
        fs::create_dir(&profile)?;
        let local = patina_recorder::Locale::from_tag(Some(locale));
        let tr = |k| patina_recorder::text(local, k);
        rt.block_on(async{
            let pool=patina_recorder::open_database(&profile.join("patina.db")).await?;
            sqlx::query("INSERT OR REPLACE INTO settings(key,value) VALUES ('language',?),('theme_mode',?),('tracking_paused','1')")
                .bind(locale).bind(theme).execute(&pool).await?;pool.close().await;Ok::<_,Error>(())
        })?;
        let mut command_line = Command::new(env!("CARGO_BIN_EXE_patina-gpui"));
        command_line
            .env("PATINA_GPUI_PROFILE_PARENT", root.path())
            .arg("--today");
        if compat {
            command_line.env("__COMPAT_LAYER", "DPIUNAWARE");
        }
        let mut host = TestChild(command_line.spawn()?);
        let pid = host.0.id();
        let hwnd = wait("main window", || {
            children::find(pid, |p| window(p, w!("Patina")))
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
    if !patina_test_desktop::run_case()? {
        return Ok(());
    }
    let _com = ComApartment::init()?;
    unsafe { SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2) };
    let root = tempfile::tempdir()?;
    let profile = root.path().join(patina_gpui::APP_ID);
    fs::create_dir(&profile)?;
    let db = profile.join("patina.db");
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()?;
    rt.block_on(async {
        let pool=patina_recorder::open_database(&db).await?;
        sqlx::query("INSERT OR REPLACE INTO settings(key,value) VALUES ('language','en-US'),('show_tray_icon','0'),('tracking_paused','1')")
            .execute(&pool).await?;
        pool.close().await;
        Ok::<_,Error>(())
    })?;
    let launch = || -> Result<_, Error> {
        let app = TestChild(
            Command::new(env!("CARGO_BIN_EXE_patina-gpui"))
                .env("PATINA_GPUI_PROFILE_PARENT", root.path())
                .arg("--today")
                .spawn()?,
        );
        let pid = app.0.id();
        let hwnd = wait("main window", || {
            children::find(pid, |p| window(p, w!("Patina")))
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
    select_segment(hwnd, "Focus")?;
    press(hwnd, "New focus session")?;
    click(hwnd, "Start")?;
    wait("running focus", || button(hwnd, "Pause"))?;
    select_segment(hwnd, "Reminder")?;
    press(hwnd, "New reminder")?;
    wait("scheduled", || button(hwnd, "Pause"))?;
    click(hwnd, "Manage tools")?;
    remove(hwnd, "Reminder")?;
    select_segment(hwnd, "Focus")?;
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
        let pool = patina_recorder::open_database(&db).await?;
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
    patina_test_desktop::dedicated_session()?;
    verify_reminder_delivery(false)
}

#[test]
#[ignore = "isolated Win32 desktop"]
fn in_window_reminder_uses_the_selected_delivery() -> Result<(), Error> {
    if !patina_test_desktop::run_case()? {
        return Ok(());
    }
    verify_reminder_delivery(true)
}

fn verify_reminder_delivery(dialog: bool) -> Result<(), Error> {
    let _com = ComApartment::init()?;
    let root = tempfile::tempdir()?;
    let profile = root.path().join(patina_gpui::APP_ID);
    fs::create_dir(&profile)?;
    let db = profile.join("patina.db");
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()?;
    let pool = rt.block_on(patina_recorder::open_database(&db))?;
    let deadline = Utc::now().timestamp_millis() + 12_000;
    rt.block_on(async{
        sqlx::query("INSERT OR REPLACE INTO settings(key,value) VALUES ('language','en-US'),('show_tray_icon','0'),('tracking_paused','1'),('tools_notification_preferences',?)")
            .bind(serde_json::json!({"delivery":if dialog{"dialog"}else{"notification"},"sound":"none"}).to_string()).execute(&pool).await?;
        sqlx::query("INSERT INTO tool_reminders(label,scheduled_at,created_at,status) VALUES('Tray deadline',?,?,'scheduled')").bind(deadline).bind(deadline-60000).execute(&pool).await?;
        Ok::<_,Error>(())
    })?;
    let mut app = TestChild(
        Command::new(env!("CARGO_BIN_EXE_patina-gpui"))
            .env("PATINA_GPUI_PROFILE_PARENT", root.path())
            .arg("--today")
            .spawn()?,
    );
    let pid = app.0.id();
    let main = wait("main window", || {
        children::find(pid, |p| window(p, w!("Patina")))
    })?;
    press(main, "Close window")?;
    wait("main released before expiry", || {
        children::find(pid, |p| window(p, w!("Patina")))
            .is_none()
            .then_some(())
    })?;
    let notice = wait("assigned expiry notification", || {
        children::find(pid, |p| {
            window(
                p,
                if dialog {
                    w!("Patina")
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
        assert!(children::find(pid, |p| window(p, w!("Patina"))).is_none());
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
    patina_test_desktop::dedicated_session()?;
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
    let profile = root.path().join(patina_gpui::APP_ID);
    fs::create_dir(&profile)?;
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()?;
    let pool = rt.block_on(patina_recorder::open_database(&profile.join("patina.db")))?;
    rt.block_on(sqlx::query("INSERT OR REPLACE INTO settings(key,value) VALUES ('language','en-US'),('tracking_paused','0')").execute(&pool))?;
    let exe = r"C:\fixture\fixture.exe";
    fs::write(
        root.path().join("native-probe-fixture.json"),
        serde_json::to_vec(&serde_json::json!({
        "foreground":{"hwnd":"0x42","root_owner_hwnd":"0x42","process_id":42,"window_class":"Fixture","title":"Fixture",
            "exe_name":"fixture.exe","process_path":exe,"is_afk":false,"idle_time_ms":0},"names":{(exe):"Fixture"}}))?,
    )?;
    let mut app = TestChild(
        Command::new(env!("CARGO_BIN_EXE_patina-gpui"))
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
        let hwnd = wait("main", || children::find(pid, |p| window(p, w!("Patina"))))?;
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
            children::find(pid, |p| window(p, w!("Patina")))
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
        wait("restored tool", || selected_segment(hwnd, "Reminder"))?;
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
    if !patina_test_desktop::run_case()? {
        return Ok(());
    }
    let _com = ComApartment::init()?;
    let root = tempfile::tempdir()?;
    let profile = root.path().join(patina_gpui::APP_ID);
    fs::create_dir(&profile)?;
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()?;
    let pool = rt.block_on(patina_recorder::open_database(&profile.join("patina.db")))?;
    rt.block_on(sqlx::query("INSERT OR REPLACE INTO settings(key,value) VALUES ('language','en-US'),('show_tray_icon','0'),('tracking_paused','1'),('tools_notification_preferences','{\"delivery\":\"notification\",\"sound\":\"none\"}')").execute(&pool))?;
    let mut app = TestChild(
        Command::new(env!("CARGO_BIN_EXE_patina-gpui"))
            .env("PATINA_GPUI_PROFILE_PARENT", root.path())
            .arg("--today")
            .spawn()?,
    );
    let pid = app.0.id();
    let main = || children::find(pid, |p| window(p, w!("Patina")));
    let hwnd = wait("main", main)?;
    click(hwnd, "Tools")?;
    select_segment(hwnd, "Focus")?;
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
    select_segment(hwnd, "Focus")?;
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
    if !patina_test_desktop::run_case()? {
        return Ok(());
    }
    let _com = ComApartment::init()?;
    unsafe { SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2) };
    let root = tempfile::tempdir()?;
    let profile = root.path().join(patina_gpui::APP_ID);
    fs::create_dir(&profile)?;
    tokio::runtime::Builder::new_current_thread().enable_all().build()?.block_on(async {
        let pool = patina_recorder::open_database(&profile.join("patina.db")).await?;
        sqlx::query("INSERT OR REPLACE INTO settings(key,value) VALUES ('language','en-US'),('show_tray_icon','0'),('tracking_paused','1')").execute(&pool).await?;
        pool.close().await;
        Ok::<_, Error>(())
    })?;
    let mut host = TestChild(
        Command::new(env!("CARGO_BIN_EXE_patina-gpui"))
            .env("PATINA_GPUI_PROFILE_PARENT", root.path())
            .arg("--today")
            .spawn()?,
    );
    let pid = host.0.id();
    let hwnd = wait("Today", || children::find(pid, |p| window(p, w!("Patina"))))?;
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
    wait("tool registry", || segment(hwnd, "Focus"))?;
    click(hwnd, "Manage tools")?;
    install(&file("PATINA_COUNTER_PACKAGE")?)?;
    click(hwnd, "Add one")?;
    wait("counter after click", || named(hwnd, "1"))?;
    press(hwnd, "Add one")?;
    wait("counter after keyboard", || named(hwnd, "2"))?;
    click(hwnd, "Today")?;
    click(hwnd, "Tools")?;
    select_segment(hwnd, "Counter")?;
    wait("saved counter", || named(hwnd, "2"))?;
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
