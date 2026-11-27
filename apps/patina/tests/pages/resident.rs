use super::*;
use std::os::windows::process::CommandExt;
use windows::Win32::UI::Shell::{NOTIFYICONIDENTIFIER, Shell_NotifyIconGetRect};
#[path = "../../../../crates/test-support/login.rs"]
mod login;
use login::TestLoginEntry;

fn toggle(hwnd: HWND, name: &str) -> Result<IUIAutomationTogglePattern, Error> {
    wait(name, || {
        controls(hwnd).ok()?.into_iter().find_map(|el| unsafe {
            if el.CurrentName().ok()? != name {
                return None;
            }
            el.GetCurrentPatternAs(UIA_TogglePatternId).ok()
        })
    })
}

fn change(hwnd: HWND, name: &str, expected: ToggleState, keyboard: bool) -> Result<(), Error> {
    let control = wait(name, || {
        controls(hwnd).ok()?.into_iter().find(|el| unsafe {
            el.CurrentName().is_ok_and(|n| n == name)
                && el
                    .GetCurrentPatternAs::<IUIAutomationTogglePattern>(UIA_TogglePatternId)
                    .is_ok()
        })
    })?;
    activate_control(hwnd, &control, keyboard)?;
    wait(name, || unsafe {
        (control
            .GetCurrentPatternAs::<IUIAutomationTogglePattern>(UIA_TogglePatternId)
            .ok()?
            .CurrentToggleState()
            .ok()?
            == expected)
            .then_some(())
    })
    .map_err(|e| {
        format!(
            "{e}; toggle bounds {:?}, nodes {:?}",
            unsafe { control.CurrentBoundingRectangle() },
            names(hwnd)
        )
        .into()
    })
}

#[test]
#[ignore = "dedicated Windows session: system tray and login"]
fn resident_preferences() -> Result<(), Error> {
    patina_test_support::dedicated_session()?;
    exercise_resident_preferences(true)
}

#[test]
#[ignore = "isolated Win32 desktop and profile-specific login entry"]
fn settings_compensate_and_reopen() -> Result<(), Error> {
    if !patina_test_support::run_case()? {
        return Ok(());
    }
    exercise_resident_preferences(false)
}

fn exercise_resident_preferences(check_shell_icon: bool) -> Result<(), Error> {
    let _com = ComApartment::init()?;
    unsafe { SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2) };
    let root = tempfile::Builder::new()
        .prefix("Patina login test ")
        .tempdir()?;
    let dir = root.path().join(patina::PROFILE_DIRECTORY);
    fs::create_dir(&dir)?;
    let db = dir.join("patina.db");
    seed_profile(&db, check_shell_icon)?;
    let launch = || {
        let mut cmd = Command::new(env!("CARGO_BIN_EXE_patina"));
        cmd.env("PATINA_PROFILE_PARENT", root.path());
        cmd
    };
    let mut host = TestChild(launch().spawn()?);
    let pid = host.0.id();
    let main = || children::find(pid, |p| window(p, w!("Patina")));
    let tray = wait("silent startup", || window(pid, w!("Patina Tray")))?;
    let icon = NOTIFYICONIDENTIFIER {
        cbSize: std::mem::size_of::<NOTIFYICONIDENTIFIER>() as u32,
        hWnd: tray,
        uID: 1,
        ..Default::default()
    };
    if check_shell_icon {
        wait("registered shell icon", || unsafe {
            Shell_NotifyIconGetRect(&icon).ok()
        })?;
    }
    let entry = TestLoginEntry::for_profile(&dir)?;
    assert!(main().is_none());
    assert!(launch().status()?.success());
    let hwnd = wait("relaunch opens original host", main)?;
    click(hwnd, "Settings")?;
    let login = toggle(hwnd, "Launch at login")?;
    unsafe {
        assert_eq!(login.CurrentToggleState()?, ToggleState_Off);
    }
    change(hwnd, "Launch at login", ToggleState_On, true)?;
    unsafe {
        let _ = ShowWindow(hwnd, SW_MINIMIZE);
    }
    command(tray, 4)?;
    wait("tray restored the existing window", || unsafe {
        (!IsIconic(hwnd).as_bool()).then_some(())
    })?;
    assert_eq!(unsafe { login.CurrentToggleState()? }, ToggleState_On);
    click(hwnd, "Cancel")?;
    wait("cancelled login change", || unsafe {
        (login.CurrentToggleState().ok()? == ToggleState_Off).then_some(())
    })?;
    if check_shell_icon {
        change(hwnd, "Show tray icon", ToggleState_Off, false)?;
    }
    change(hwnd, "Launch silently", ToggleState_Off, true)?;
    change(hwnd, "Launch at login", ToggleState_On, true)?;
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()?;
    let mut conn = rt.block_on(SqliteConnection::connect_with(
        &SqliteConnectOptions::new().filename(&db),
    ))?;
    rt.block_on(
        sqlx::query(
            "CREATE TRIGGER reject_login BEFORE INSERT ON settings WHEN NEW.key='launch_at_login'
         BEGIN SELECT RAISE(ABORT,'test write failure'); END",
        )
        .execute(&mut conn),
    )?;
    click(hwnd, "Save")?;
    wait("failed save keeps draft", || named(hwnd, "Retry"))?;
    if check_shell_icon {
        assert!(unsafe { Shell_NotifyIconGetRect(&icon) }.is_ok());
    }
    assert_eq!(
        entry.key.get_raw_value(&entry.name).unwrap_err().kind(),
        std::io::ErrorKind::NotFound
    );
    rt.block_on(sqlx::query("DROP TRIGGER reject_login").execute(&mut conn))?;
    click(hwnd, "Retry")?;
    wait("saved resident settings", || named(hwnd, "Saved"))?;
    let login_command: String = entry.key.get_value(&entry.name)?;
    assert!(
        login_command.contains(" -a ") && login_command.contains(root.path().to_str().unwrap())
    );
    if check_shell_icon {
        assert!(unsafe { Shell_NotifyIconGetRect(&icon) }.is_err());
    }
    unsafe { PostMessageW(Some(hwnd), WM_CLOSE, WPARAM(0), LPARAM(0))? };
    wait("closed to background", || main().is_none().then_some(()))?;
    assert!(host.0.try_wait()?.is_none());
    assert!(launch().status()?.success());
    let reopened = wait("reopened without tray icon", main)?;
    assert_eq!(
        unsafe { toggle(reopened, "Show tray icon")?.CurrentToggleState()? },
        ToggleState_Off
    );
    command(tray, 2)?;
    assert!(wait("tray exit", || host.0.try_wait().ok().flatten())?.success());

    let previous = TestLoginEntry::new(format!(
        "{}.{}",
        patina::APP_ID,
        TestLoginEntry::profile_digest(&dir)?
    ))?;
    let previous_command = login_command.replace(" -a \"", " --autostart --profile-parent \"");
    entry.key.delete_value(&entry.name)?;
    previous.key.set_value(&previous.name, &previous_command)?;
    let disabled = winreg::RegValue {
        vtype: winreg::enums::REG_BINARY,
        bytes: [3, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0].as_slice().into(),
    };
    let mut registered = Command::new(env!("CARGO_BIN_EXE_patina"));
    let quoted = previous_command
        .strip_prefix('"')
        .ok_or("unquoted login executable")?;
    let (exe, args) = quoted.split_once('"').ok_or("missing login arguments")?;
    assert_eq!(
        Path::new(exe).canonicalize()?,
        Path::new(env!("CARGO_BIN_EXE_patina")).canonicalize()?
    );
    registered
        .raw_arg(args.trim_start())
        .env_remove("PATINA_PROFILE_PARENT");
    let mut from_login = TestChild(registered.spawn()?);
    let login_pid = from_login.0.id();
    let login_tray = wait("host started from the previous login entry", || {
        window(login_pid, w!("Patina Tray"))
    })?;
    assert_eq!(
        previous.key.get_value::<String, _>(&previous.name)?,
        previous_command
    );
    assert_eq!(
        entry.key.get_raw_value(&entry.name).unwrap_err().kind(),
        std::io::ErrorKind::NotFound
    );
    let login_window = wait("login settings window", || {
        children::find(login_pid, |p| window(p, w!("Patina")))
    })?;
    wait("login settings loaded", || {
        named(login_window, "Launch at login")
    })?;
    assert!(named(login_window, "This startup item is missing in Windows.").is_none());
    change(login_window, "Launch at login", ToggleState_Off, true)?;
    click(login_window, "Save")?;
    wait("disabled the previous login entry", || {
        named(login_window, "Saved")
    })?;
    for item in [&entry, &previous] {
        assert_eq!(
            item.key.get_raw_value(&item.name).unwrap_err().kind(),
            std::io::ErrorKind::NotFound
        );
    }
    change(login_window, "Launch at login", ToggleState_On, true)?;
    click(login_window, "Save")?;
    wait("explicit enable registers the current item", || {
        (entry.key.get_value::<String, _>(&entry.name).ok()? == login_command).then_some(())
    })?;
    command(login_tray, 2)?;
    assert!(
        wait("login host exited", || from_login
            .0
            .try_wait()
            .ok()
            .flatten())?
        .success()
    );
    entry.key.delete_value(&entry.name)?;
    previous.key.set_value(&previous.name, &previous_command)?;
    previous.approval.set_raw_value(&previous.name, &disabled)?;
    let mut next = TestChild(launch().spawn()?);
    let next_pid = next.0.id();
    let hwnd = wait("foreground startup", || {
        children::find(next_pid, |p| window(p, w!("Patina")))
    })?;
    assert_eq!(
        entry.key.get_value::<String, _>(&entry.name)?,
        login_command
    );
    assert_eq!(
        previous
            .key
            .get_raw_value(&previous.name)
            .unwrap_err()
            .kind(),
        std::io::ErrorKind::NotFound
    );
    assert_eq!(
        unsafe { toggle(hwnd, "Launch silently")?.CurrentToggleState()? },
        ToggleState_Off
    );
    wait("migrated system decision", || {
        named(hwnd, "Disabled in Windows.")
    })?;
    assert_eq!(
        entry.approval.get_raw_value(&entry.name)?.bytes,
        disabled.bytes
    );
    assert!(button(hwnd, "Open Windows startup settings").is_some());
    let refresh = || -> Result<(), Error> {
        click(hwnd, "History")?;
        wait("history page opened before returning to settings", || {
            button(hwnd, "Previous day")
        })?;
        click(hwnd, "Settings")
    };
    unsafe {
        PostMessageW(
            Some(hwnd),
            WM_ACTIVATE,
            WPARAM(WA_INACTIVE as usize),
            LPARAM(0),
        )?;
    }
    entry.approval.delete_value(&entry.name)?;
    unsafe {
        PostMessageW(
            Some(hwnd),
            WM_ACTIVATE,
            WPARAM(WA_ACTIVE as usize),
            LPARAM(0),
        )?;
    }
    wait("return from Windows settings rereads approval", || {
        (named(hwnd, "Disabled in Windows.").is_none() && named(hwnd, "Launch at login").is_some())
            .then_some(())
    })?;
    entry.key.delete_value(&entry.name)?;
    refresh()?;
    wait("missing login entry", || {
        named(hwnd, "This startup item is missing in Windows.")
    })?;
    press(hwnd, "Repair startup item")?;
    wait("explicit repair writes original command", || {
        (entry.key.get_value::<String, _>(&entry.name).ok()? == login_command).then_some(())
    })?;
    entry.key.set_value(&entry.name, &"different.exe")?;
    refresh()?;
    wait("foreign command", || {
        named(
            hwnd,
            "The startup item points to another command. Check Windows startup settings.",
        )
    })?;
    assert_eq!(
        entry.key.get_value::<String, _>(&entry.name)?,
        "different.exe"
    );
    entry.key.set_value(&entry.name, &login_command)?;
    entry.approval.set_value(&entry.name, &"unknown")?;
    refresh()?;
    wait("unknown system state", || {
        named(hwnd, "Could not verify the Windows startup item.")
    })?;
    entry.approval.delete_value(&entry.name)?;
    press(hwnd, "Retry")?;
    wait("state refreshed", || {
        named(hwnd, "Could not verify the Windows startup item.")
            .is_none()
            .then_some(())
    })?;
    change(hwnd, "Hide on close", ToggleState_Off, true)?;
    change(hwnd, "Launch at login", ToggleState_Off, true)?;
    click(hwnd, "Save")?;
    wait("saved close behavior", || named(hwnd, "Saved"))?;
    assert_eq!(
        entry.key.get_raw_value(&entry.name).unwrap_err().kind(),
        std::io::ErrorKind::NotFound
    );
    press(hwnd, "Close window")?;
    assert!(wait("close exits recorder", || next.0.try_wait().ok().flatten())?.success());
    entry.key.set_value(&entry.name, &login_command)?;
    let mut stale = TestChild(registered.spawn()?);
    assert!(
        wait("queued launch honors the saved opt-out", || stale
            .0
            .try_wait()
            .ok()
            .flatten())?
        .success()
    );
    assert_eq!(
        entry.key.get_value::<String, _>(&entry.name)?,
        login_command
    );
    Ok(())
}
