use super::*;
use windows::Win32::{
    Foundation::POINT,
    Graphics::Gdi::{
        ClientToScreen, GetMonitorInfoW, GetWindowRgnBox, MONITOR_DEFAULTTONEAREST, MONITORINFO,
        MonitorFromWindow,
    },
};

fn clip_size(hwnd: HWND) -> Option<(i32, i32)> {
    let mut region = RECT::default();
    (unsafe { GetWindowRgnBox(hwnd, &mut region) }.0 >= 2)
        .then_some((region.right - region.left, region.bottom - region.top))
}

#[test]
#[ignore = "isolated Win32 desktop"]
fn top_dock_pin_keyboard_and_reopen() -> Result<(), Error> {
    if !patina_test_support::run_case()? {
        return Ok(());
    }
    let _com = ComApartment::init()?;
    unsafe { SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2) };
    let root = tempfile::tempdir()?;
    let dir = root.path().join(patina::APP_ID);
    fs::create_dir(&dir)?;
    let db = dir.join("patina.db");
    seed(&db)?;
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()?;
    let sample =
        include_str!("../../../../crates/test-support/fixtures/mini-window-preferences.json");
    rt.block_on(async {
        let mut conn =
            SqliteConnection::connect_with(&SqliteConnectOptions::new().filename(&db)).await?;
        sqlx::query(
            "INSERT OR REPLACE INTO settings(key, value) VALUES ('mini_window_preferences', ?)",
        )
        .bind(sample)
        .execute(&mut conn)
        .await?;
        conn.close().await
    })?;
    let exe = std::env::var_os("PATINA_RESOURCE_BASELINE")
        .unwrap_or_else(|| env!("CARGO_BIN_EXE_patina").into());
    let mut host = TestChild(
        Command::new(exe)
            .arg("--mini")
            .env("PATINA_GPUI_PROFILE_PARENT", root.path())
            .spawn()?,
    );
    let owner = host.0.id();
    let mini = || {
        children::find(owner, |pid| {
            window(pid, w!("Patina Mini")).map(|hwnd| (pid, hwnd))
        })
    };
    let (pid, hwnd) = wait("Mini", mini)?;
    let tray = wait("tray", || window(owner, w!("Patina GPUI")))?;
    let dpi = unsafe { GetDpiForWindow(hwnd) };
    let dim = |width: i32, height: i32| {
        (
            (width as f64 * dpi as f64 / 96.).round() as i32,
            (height as f64 * dpi as f64 / 96.).round() as i32,
        )
    };
    let expanded = dim(320, 240);
    let collapsed = dim(112, 24);
    let dock = |hwnd: HWND| -> Option<(RECT, POINT)> {
        let mut monitor = MONITORINFO {
            cbSize: size_of::<MONITORINFO>() as u32,
            ..Default::default()
        };
        let mut origin = POINT::default();
        let mut client = RECT::default();
        unsafe {
            GetMonitorInfoW(
                MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST),
                &mut monitor,
            )
            .ok()
            .ok()?;
            ClientToScreen(hwnd, &mut origin).ok().ok()?;
            GetClientRect(hwnd, &mut client).ok()?;
        }
        let work = monitor.rcWork;
        (origin.y == work.top
            && (2 * (origin.x - work.left) + client.right - (work.right - work.left)).abs() <= 1
            && (client.right, client.bottom) == expanded
            && clip_size(hwnd) == Some(expanded))
        .then_some((work, origin))
    };
    let (work, origin) = wait("expanded Mini client flush with the work area", || {
        dock(hwnd)
    })?;
    println!(
        "Mini DPI={dpi} work={work:?} origin={origin:?} expanded={expanded:?} handle={collapsed:?}"
    );
    command(tray, 4)?;
    wait("main and Mini share a renderer", || {
        window(pid, w!("Patina"))
    })?;
    let toggle = || {
        named(hwnd, "Keep expanded").and_then(|el| unsafe {
            el.GetCurrentPatternAs::<IUIAutomationTogglePattern>(UIA_TogglePatternId)
                .ok()
        })
    };
    let pin = wait("expanded Mini pin", toggle)?;
    assert_eq!(unsafe { pin.CurrentToggleState()? }, ToggleState_Off);
    unsafe {
        pin.Toggle()?;
    }
    wait("pin enabled", || unsafe {
        (toggle()?.CurrentToggleState().ok()? == ToggleState_On).then_some(())
    })?;
    key(hwnd, 27)?;
    // A second access to the pin after Escape verifies the expanded control remains available.
    let pin = wait("pinned Mini stays expanded", || {
        (clip_size(hwnd) == Some(expanded)).then(toggle).flatten()
    })?;
    unsafe {
        pin.Toggle()?;
    }
    wait("pin disabled", || unsafe {
        (toggle()?.CurrentToggleState().ok()? == ToggleState_Off).then_some(())
    })?;
    key(hwnd, 27)?;
    wait("Escape collapses the native input region", || {
        (clip_size(hwnd) == Some(collapsed)).then_some(())
    })?;
    let hit = |x, y| unsafe {
        WindowFromPoint(POINT {
            x: origin.x + x,
            y: origin.y + y,
        }) == hwnd
    };
    wait("only the folded handle accepts pointer hits", || {
        (hit(expanded.0 / 2, collapsed.1 / 2) && !hit(expanded.0 / 8, collapsed.1 / 2))
            .then_some(())
    })?;
    wait("keyboard focuses the folded handle", || unsafe {
        controls(hwnd)
            .ok()?
            .into_iter()
            .find(|el| {
                el.CurrentName()
                    .is_ok_and(|n| n.to_string().starts_with("Open mini window"))
            })?
            .SetFocus()
            .ok()
    })?;
    key(hwnd, 13)?;
    wait("Enter restores the full Mini", || dock(hwnd))?;
    assert!(hit(expanded.0 / 8, collapsed.1 / 2));
    unsafe {
        PostMessageW(Some(hwnd), WM_CLOSE, WPARAM(0), LPARAM(0))?;
    }
    wait("Mini closed while main remains", || {
        (mini().is_none() && window(pid, w!("Patina")).is_some()).then_some(())
    })?;
    command(tray, 1)?;
    let (reopened_pid, reopened) = wait("Mini reopens at the same dock", || {
        let (pid, hwnd) = mini()?;
        dock(hwnd)?;
        Some((pid, hwnd))
    })?;
    assert_eq!(pid, reopened_pid);
    assert_eq!(dock(reopened), Some((work, origin)));
    command(tray, 2)?;
    assert!(wait("host exits", || host.0.try_wait().ok().flatten())?.success());
    let raw: String = rt.block_on(async {
        let mut conn = SqliteConnection::connect_with(
            &SqliteConnectOptions::new().filename(&db).read_only(true),
        )
        .await?;
        sqlx::query_scalar("SELECT value FROM settings WHERE key = 'mini_window_preferences'")
            .fetch_one(&mut conn)
            .await
    })?;
    assert_eq!(raw, sample);
    Ok(())
}
