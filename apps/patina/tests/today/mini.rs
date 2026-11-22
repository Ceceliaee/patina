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

fn launch(
    root: &Path,
    sample: &str,
    rt: &tokio::runtime::Runtime,
) -> Result<(TestChild, std::path::PathBuf), Error> {
    let dir = root.join(patina::PROFILE_DIRECTORY);
    fs::create_dir(&dir)?;
    let db = dir.join("patina.db");
    seed(&db)?;
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
    let host = TestChild(
        Command::new(exe)
            .arg("--mini")
            .env("PATINA_PROFILE_PARENT", root)
            .spawn()?,
    );
    Ok((host, db))
}

#[test]
#[ignore = "isolated Win32 desktop"]
fn legacy_profile_restores_floating_window_and_pin() -> Result<(), Error> {
    if !patina_test_support::run_case()? {
        return Ok(());
    }
    let _com = ComApartment::init()?;
    unsafe { SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2) };
    let root = tempfile::tempdir()?;
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()?;
    let sample =
        include_str!("../../../../crates/test-support/fixtures/mini-window-preferences.json");
    let (mut host, _) = launch(root.path(), sample, &rt)?;
    let owner = host.0.id();
    let started = std::time::Instant::now();
    let hwnd = loop {
        if let Ok(hwnd) = unsafe { FindWindowW(None, w!("Patina Mini")) }
            && unsafe { IsWindowVisible(hwnd) }.as_bool()
        {
            break hwnd;
        }
        if started.elapsed() > std::time::Duration::from_secs(25) {
            return Err("Mini did not become visible".into());
        }
        std::thread::sleep(std::time::Duration::from_millis(1));
    };
    unsafe {
        let mut info = MONITORINFO {
            cbSize: size_of::<MONITORINFO>() as u32,
            ..Default::default()
        };
        GetMonitorInfoW(MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST), &mut info).ok()?;
        let work = info.rcWork;
        let mut client = RECT::default();
        GetClientRect(hwnd, &mut client)?;
        let mut origin = POINT::default();
        ClientToScreen(hwnd, &mut origin).ok()?;
        let x = work.left
            + (420. / 1616. * f64::from(work.right - work.left - client.right)).round() as i32;
        let y = if (work.left, work.top, work.right, work.bottom) == (-1920, 0, 0, 1040) {
            200.min(work.bottom - client.bottom)
        } else {
            work.top
                + (200. / 800. * f64::from(work.bottom - work.top - client.bottom)).round() as i32
        };
        assert_eq!((origin.x, origin.y), (x, y), "first visible Mini position");
        assert_eq!(
            clip_size(hwnd),
            Some((client.right, client.bottom)),
            "first visible Mini region"
        );
    }
    wait("restored pin", || unsafe {
        let toggle: IUIAutomationTogglePattern = named(hwnd, "Keep expanded")?
            .GetCurrentPatternAs(UIA_TogglePatternId)
            .ok()?;
        (toggle.CurrentToggleState().ok()? == ToggleState_On).then_some(())
    })?;
    command(wait("tray", || window(owner, w!("Patina Tray")))?, 2)?;
    assert!(wait("host exits", || host.0.try_wait().ok().flatten())?.success());
    Ok(())
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
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()?;
    let (mut host, db) = launch(root.path(), r#"{"page":"tools"}"#, &rt)?;
    let owner = host.0.id();
    let mini = || {
        children::find(owner, |pid| {
            window(pid, w!("Patina Mini")).map(|hwnd| (pid, hwnd))
        })
    };
    let (pid, hwnd) = wait("Mini", mini)?;
    let tray = wait("tray", || window(owner, w!("Patina Tray")))?;
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
    let origin_of = |hwnd| {
        let mut point = POINT::default();
        unsafe { ClientToScreen(hwnd, &mut point).ok().ok()? };
        Some((point.x, point.y))
    };
    let drag = |hwnd: HWND, grab: (i32, i32), target: (i32, i32)| -> Result<(), Error> {
        let (x, y) = origin_of(hwnd).unwrap();
        let at = |x: i32, y: i32| LPARAM(((y as u16 as u32) << 16 | x as u16 as u32) as isize);
        unsafe {
            PostMessageW(Some(hwnd), WM_MOUSEMOVE, WPARAM(0), at(grab.0, grab.1))?;
            PostMessageW(Some(hwnd), WM_LBUTTONDOWN, WPARAM(1), at(grab.0, grab.1))?;
            PostMessageW(
                Some(hwnd),
                WM_MOUSEMOVE,
                WPARAM(1),
                at(grab.0 + target.0 - x, grab.1 + target.1 - y),
            )?;
        }
        wait("Mini follows the captured pointer before release", || {
            (origin_of(hwnd) == Some(target) && clip_size(hwnd) == Some(expanded)).then_some(())
        })?;
        unsafe {
            PostMessageW(Some(hwnd), WM_LBUTTONUP, WPARAM(0), at(grab.0, grab.1))?;
        }
        Ok(())
    };
    let floating = (
        origin.x,
        work.top + (work.bottom - work.top - expanded.1) / 2,
    );
    drag(reopened, dim(60, 15), floating)?;
    key(reopened, 27)?;
    wait("floating Mini stays expanded after Escape", || {
        (clip_size(reopened) == Some(expanded) && origin_of(reopened) == Some(floating))
            .then_some(())
    })?;
    let left = (work.left, floating.1);
    drag(reopened, dim(60, 15), (left.0 + dim(12, 0).0, left.1))?;
    wait("release snaps to the left work-area edge", || {
        (origin_of(reopened) == Some(left)).then_some(())
    })?;
    key(reopened, 27)?;
    wait("left dock folds vertically", || {
        (clip_size(reopened) == Some(dim(24, 88))).then_some(())
    })?;
    let right = (work.right - expanded.0, left.1);
    drag(
        reopened,
        (dim(12, 0).0, expanded.1 / 2),
        (right.0 - dim(12, 0).0, right.1),
    )?;
    wait("dragging the folded handle docks on the right", || {
        (origin_of(reopened) == Some(right)).then_some(())
    })?;
    unsafe {
        PostMessageW(Some(reopened), WM_CLOSE, WPARAM(0), LPARAM(0))?;
    }
    wait("docked Mini closes", || mini().is_none().then_some(()))?;
    command(tray, 1)?;
    wait("reopened Mini restores its right edge and anchor", || {
        (origin_of(mini()?.1) == Some(right)).then_some(())
    })?;
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
    let stored: serde_json::Value = serde_json::from_str(&raw)?;
    assert_eq!(stored["page"], "tools");
    assert_eq!(stored["placement"]["edge"], "right");
    assert_eq!(stored["held"], false);
    Ok(())
}
