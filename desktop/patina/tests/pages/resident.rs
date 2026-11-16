use super::*;
use std::os::windows::process::CommandExt;
use windows::Win32::UI::Shell::{NOTIFYICONIDENTIFIER, Shell_NotifyIconGetRect};
use winreg::{
    RegKey,
    enums::{HKEY_CURRENT_USER, KEY_QUERY_VALUE, KEY_SET_VALUE},
};

struct TestLoginEntry {
    key: RegKey,
    name: String,
}

impl TestLoginEntry {
    fn for_profile(hwnd: HWND) -> Result<Self, Error> {
        let mut class = [0u16; 256];
        let n = unsafe { GetClassNameW(hwnd, &mut class) };
        let name = String::from_utf16(&class[..n as usize])?;
        assert!(name.starts_with(patina_gpui::APP_ID));
        let key = RegKey::predef(HKEY_CURRENT_USER).open_subkey_with_flags(
            r"Software\Microsoft\Windows\CurrentVersion\Run",
            KEY_QUERY_VALUE | KEY_SET_VALUE,
        )?;
        assert_eq!(
            key.get_raw_value(&name).unwrap_err().kind(),
            std::io::ErrorKind::NotFound
        );
        Ok(Self { key, name })
    }
}

impl Drop for TestLoginEntry {
    fn drop(&mut self) {
        let _ = self.key.delete_value(&self.name);
    }
}

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
    patina_test_desktop::dedicated_session()?;
    let _com = ComApartment::init()?;
    unsafe { SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2) };
    let root = tempfile::tempdir()?;
    let dir = root.path().join(patina_gpui::APP_ID);
    fs::create_dir(&dir)?;
    let db = dir.join("patina.db");
    seed_profile(&db, true)?;
    let launch = || {
        let mut cmd = Command::new(env!("CARGO_BIN_EXE_patina-gpui"));
        cmd.env("PATINA_GPUI_PROFILE_PARENT", root.path());
        cmd
    };
    let mut host = TestChild(launch().spawn()?);
    let pid = host.0.id();
    let main = || children::find(pid, |p| window(p, w!("Patina")));
    let tray = wait("silent startup", || window(pid, w!("Patina GPUI")))?;
    let icon = NOTIFYICONIDENTIFIER {
        cbSize: std::mem::size_of::<NOTIFYICONIDENTIFIER>() as u32,
        hWnd: tray,
        uID: 1,
        ..Default::default()
    };
    wait("registered shell icon", || unsafe {
        Shell_NotifyIconGetRect(&icon).ok()
    })?;
    let entry = TestLoginEntry::for_profile(tray)?;
    assert!(main().is_none());
    assert!(launch().status()?.success());
    let hwnd = wait("relaunch opens original host", main)?;
    click(hwnd, "Settings")?;
    let login = toggle(hwnd, "Launch at login")?;
    unsafe {
        assert_eq!(login.CurrentToggleState()?, ToggleState_Off);
    }
    change(hwnd, "Launch at login", ToggleState_On, true)?;
    click(hwnd, "Cancel")?;
    wait("cancelled login change", || unsafe {
        (login.CurrentToggleState().ok()? == ToggleState_Off).then_some(())
    })?;
    change(hwnd, "Show tray icon", ToggleState_Off, false)?;
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
    assert!(unsafe { Shell_NotifyIconGetRect(&icon) }.is_ok());
    assert_eq!(
        entry.key.get_raw_value(&entry.name).unwrap_err().kind(),
        std::io::ErrorKind::NotFound
    );
    rt.block_on(sqlx::query("DROP TRIGGER reject_login").execute(&mut conn))?;
    click(hwnd, "Save")?;
    wait("saved resident settings", || named(hwnd, "Saved"))?;
    let login_command: String = entry.key.get_value(&entry.name)?;
    assert!(
        login_command.contains("--autostart")
            && login_command.contains(root.path().to_str().unwrap())
    );
    assert!(unsafe { Shell_NotifyIconGetRect(&icon) }.is_err());
    unsafe { PostMessageW(Some(hwnd), WM_CLOSE, WPARAM(0), LPARAM(0))? };
    wait("closed to background", || main().is_none().then_some(()))?;
    assert!(host.0.try_wait()?.is_none());
    assert!(launch().status()?.success());
    let reopened = wait("reopened without tray icon", main)?;
    click(reopened, "Settings")?;
    assert_eq!(
        unsafe { toggle(reopened, "Show tray icon")?.CurrentToggleState()? },
        ToggleState_Off
    );
    command(tray, 2)?;
    assert!(wait("tray exit", || host.0.try_wait().ok().flatten())?.success());

    let mut registered = Command::new(env!("CARGO_BIN_EXE_patina-gpui"));
    let command = login_command
        .strip_prefix('"')
        .ok_or("unquoted login executable")?;
    let (exe, args) = command.split_once('"').ok_or("missing login arguments")?;
    assert_eq!(
        Path::new(exe).canonicalize()?,
        Path::new(env!("CARGO_BIN_EXE_patina-gpui")).canonicalize()?
    );
    registered
        .raw_arg(args.trim_start())
        .env_remove("PATINA_GPUI_PROFILE_PARENT");
    let mut next = TestChild(registered.spawn()?);
    let next_pid = next.0.id();
    let hwnd = wait("foreground startup", || {
        children::find(next_pid, |p| window(p, w!("Patina")))
    })?;
    click(hwnd, "Settings")?;
    assert_eq!(
        unsafe { toggle(hwnd, "Launch silently")?.CurrentToggleState()? },
        ToggleState_Off
    );
    change(hwnd, "Hide on close", ToggleState_Off, true)?;
    change(hwnd, "Launch at login", ToggleState_Off, true)?;
    click(hwnd, "Save")?;
    wait("saved close behavior", || named(hwnd, "Saved"))?;
    assert_eq!(
        entry.key.get_raw_value(&entry.name).unwrap_err().kind(),
        std::io::ErrorKind::NotFound
    );
    click(hwnd, "Close window")?;
    assert!(wait("close exits recorder", || next.0.try_wait().ok().flatten())?.success());
    Ok(())
}
