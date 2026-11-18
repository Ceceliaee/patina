//! Opt-in smoke check on a Windows desktop. Only sends actions to this process.
#[path = "../../../crates/test-support/children.rs"]
mod children;
use patina::Action;
use sqlx::{
    SqlitePool,
    sqlite::{SqliteConnectOptions, SqlitePoolOptions},
};
use std::{
    env,
    io::Write,
    path::Path,
    process,
    sync::mpsc,
    thread,
    time::{Duration, Instant},
};
use windows::{
    Win32::{
        Foundation::{HWND, LPARAM, POINT, RECT, WPARAM},
        Graphics::Gdi::{
            ClientToScreen, GetMonitorInfoW, GetWindowRgnBox, MONITOR_DEFAULTTONEAREST,
            MONITORINFO, MonitorFromWindow,
        },
        UI::{HiDpi::GetDpiForWindow, WindowsAndMessaging::*},
    },
    core::BOOL,
};

type Outcome = Result<(), Box<dyn std::error::Error + Send + Sync>>;

fn windows_for(pid: u32, title: &str) -> Vec<HWND> {
    struct Search<'a> {
        pid: u32,
        title: &'a str,
        found: Vec<HWND>,
    }
    unsafe extern "system" fn collect(hwnd: HWND, data: LPARAM) -> BOOL {
        let mut pid = 0;
        unsafe {
            GetWindowThreadProcessId(hwnd, Some(&mut pid));
        }
        let search = unsafe { &mut *(data.0 as *mut Search<'_>) };
        if pid == search.pid {
            let mut label = [0; 64];
            let len = unsafe { GetWindowTextW(hwnd, &mut label) } as usize;
            if String::from_utf16_lossy(&label[..len]) == search.title {
                search.found.push(hwnd);
            }
        }
        true.into()
    }
    let mut search = Search {
        pid,
        title,
        found: Vec::new(),
    };
    unsafe {
        EnumWindows(
            Some(collect),
            LPARAM(&mut search as *mut Search<'_> as isize),
        )
        .unwrap();
    }
    search.found
}

fn mini_windows() -> Vec<HWND> {
    children::find(process::id(), |pid| {
        let windows = windows_for(pid, "Patina Mini");
        (!windows.is_empty()).then_some(windows)
    })
    .unwrap_or_default()
}

fn tray_command(command: usize) -> Outcome {
    let windows = windows_for(process::id(), "Patina GPUI");
    let [tray] = windows[..] else {
        return Err("expected one tray owner".into());
    };
    unsafe {
        PostMessageW(Some(tray), WM_COMMAND, WPARAM(command), LPARAM(0))?;
    }
    Ok(())
}

fn verify_dock_motion(hwnd: HWND) -> Outcome {
    let mut client = RECT::default();
    unsafe {
        GetClientRect(hwnd, &mut client)?;
    }
    let folded = (24. * f64::from(unsafe { GetDpiForWindow(hwnd) }) / 96.).round() as i32;
    let height = || {
        let mut clip = RECT::default();
        let mut current = RECT::default();
        unsafe {
            GetClientRect(hwnd, &mut current).unwrap();
            assert_eq!(current, client, "dock motion resized the client");
            GetWindowRgnBox(hwnd, &mut clip);
        }
        clip.bottom - clip.top
    };
    let animated = {
        let mut enabled = BOOL::from(true);
        unsafe {
            SystemParametersInfoW(
                SPI_GETCLIENTAREAANIMATION,
                0,
                Some((&raw mut enabled).cast()),
                Default::default(),
            )?;
        }
        enabled.as_bool()
    };
    let collapse = || -> Outcome {
        unsafe {
            PostMessageW(Some(hwnd), WM_KEYDOWN, WPARAM(27), LPARAM(1))?;
            PostMessageW(
                Some(hwnd),
                WM_KEYUP,
                WPARAM(27),
                LPARAM(0xc0000001u32 as isize),
            )?;
        }
        Ok(())
    };
    let sample = |target: i32| -> Outcome {
        let mut previous = height();
        let start = Instant::now();
        let mut intermediate = 0;
        while previous != target {
            if start.elapsed() > Duration::from_secs(3) {
                return Err("dock transition timed out".into());
            }
            thread::sleep(Duration::from_millis(2));
            let next = height();
            if next != previous && next > folded && next < client.bottom {
                intermediate += 1;
            }
            previous = next;
        }
        if animated && intermediate < 2 {
            return Err("dock skipped intermediate frames".into());
        }
        println!("Mini dock: height={target}, observed intermediate sizes={intermediate}");
        Ok(())
    };
    collapse()?;
    sample(folded)?;
    tray_command(1)?;
    sample(client.bottom)?;
    if animated {
        collapse()?;
        let start = Instant::now();
        loop {
            let h = height();
            if h > folded && h < client.bottom {
                break;
            }
            if start.elapsed() > Duration::from_secs(3) {
                return Err("did not begin reversing transition".into());
            }
            thread::sleep(Duration::from_millis(2));
        }
        tray_command(1)?;
        wait("reversed transition reaches expanded size", || {
            height() == client.bottom
        })?;
    }
    Ok(())
}

/// Opt-in because this check moves the physical pointer across the Mini.
fn verify_pointer_leave(hwnd: HWND) -> Outcome {
    let mut origin = POINT::default();
    let mut original = POINT::default();
    let mut client = RECT::default();
    unsafe {
        ClientToScreen(hwnd, &mut origin).ok()?;
        GetClientRect(hwnd, &mut client)?;
        GetCursorPos(&mut original)?;
    }
    let scale = f64::from(unsafe { GetDpiForWindow(hwnd) }) / 96.;
    let folded = (24. * scale).round() as i32;
    let visible_height = || {
        let mut region = RECT::default();
        unsafe {
            GetWindowRgnBox(hwnd, &mut region);
        }
        region.bottom - region.top
    };
    let mut last = original;
    let mut move_to = |x: f64, y: f64| -> windows::core::Result<()> {
        last = POINT {
            x: origin.x + client.right / 2 + (x * scale).round() as i32,
            y: origin.y + (y * scale).round() as i32,
        };
        unsafe { SetCursorPos(last.x, last.y) }
    };
    let result = (|| -> Outcome {
        for (x, y) in [(0., 110.), (84., 16.), (148., 16.)] {
            move_to(0., 9.)?;
            wait("hover expands Mini", || visible_height() == client.bottom)?;
            move_to(x, y)?;
            thread::sleep(Duration::from_millis(75));
            move_to(0., 252.)?;
            let start = Instant::now();
            wait("pointer leave collapses Mini", || {
                visible_height() == folded
            })?;
            if start.elapsed() > Duration::from_millis(650) {
                return Err("late auto-collapse".into());
            }
        }
        move_to(0., 9.)?;
        wait("re-entry opens Mini", || visible_height() == client.bottom)?;
        move_to(0., 252.)?;
        thread::sleep(Duration::from_millis(60));
        move_to(0., 9.)?;
        thread::sleep(Duration::from_millis(450));
        if visible_height() != client.bottom {
            return Err("re-entry did not cancel collapse".into());
        }
        Ok(())
    })();
    let mut current = POINT::default();
    unsafe {
        if GetCursorPos(&mut current).is_ok() && current == last {
            SetCursorPos(original.x, original.y)?;
        }
    }
    result
}

fn wait(label: &str, mut ready: impl FnMut() -> bool) -> Outcome {
    let start = Instant::now();
    while !ready() {
        if start.elapsed() > Duration::from_secs(20) {
            return Err(format!("timed out: {label}").into());
        }
        thread::sleep(Duration::from_millis(75));
    }
    Ok(())
}

fn check_rejected_start(cmd: &mut process::Command, label: &str) -> Outcome {
    let mut child = cmd.spawn()?;
    if let Err(error) = wait(label, || child.try_wait().ok().flatten().is_some()) {
        child.kill()?;
        child.wait()?;
        return Err(error);
    }
    if !child.wait()?.success() {
        return Err(label.to_owned().into());
    }
    Ok(())
}

fn fixture(root: &Path, exe: &str) -> Outcome {
    let mut out = tempfile::NamedTempFile::new_in(root)?;
    let path = format!("C:\\fixture\\{exe}");
    let value = serde_json::json!({"foreground": {"hwnd":"0x42","root_owner_hwnd":"0x42","process_id":42,
        "window_class":"Fixture","title":"Fixture","exe_name":exe,"process_path":path,"is_afk":false,"idle_time_ms":0},
        "names":{(path):exe}});
    out.write_all(&serde_json::to_vec(&value)?)?;
    out.persist(root.join("native-probe-fixture.json"))?;
    Ok(())
}

fn open_read_only(path: &Path, rt: &tokio::runtime::Runtime) -> Result<SqlitePool, sqlx::Error> {
    rt.block_on(
        SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(SqliteConnectOptions::new().filename(path).read_only(true)),
    )
}

fn exercise(
    root: &Path,
    tx: &async_channel::Sender<Action>,
    exited: mpsc::Receiver<()>,
) -> Outcome {
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()?;
    let path = root.join(patina::APP_ID).join("patina.db");
    wait("database", || path.is_file())?;
    let pool = open_read_only(&path, &rt)?;
    let active = |exe: &str| {
        rt.block_on(
            sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*) FROM sessions WHERE exe_name=? AND end_time IS NULL",
            )
            .bind(exe)
            .fetch_one(&pool),
        )
        .ok()
            == Some(1)
    };
    wait("recording in tray", || active("first.exe"))?;
    assert!(mini_windows().is_empty());
    check_rejected_start(
        process::Command::new(env::current_exe()?)
            .arg("--invalid-root")
            .env("PATINA_GPUI_PROFILE_PARENT", "relative"),
        "relative profile parent rejected",
    )?;
    check_rejected_start(
        process::Command::new(env::current_exe()?).arg("--duplicate"),
        "duplicate writer rejected",
    )?;
    for cycle in 1..=15 {
        let start = Instant::now();
        tx.send_blocking(Action::Mini { focus: false })?;
        tx.send_blocking(Action::Mini { focus: false })?;
        wait("one Mini", || mini_windows().len() == 1)?;
        let hwnd = mini_windows()[0];
        wait("Mini visible", || unsafe {
            IsWindowVisible(hwnd).as_bool()
        })?;
        let shown = start.elapsed().as_millis();
        if cycle == 1 {
            let mut client = RECT::default();
            unsafe {
                GetClientRect(hwnd, &mut client)?;
                let mut monitor = MONITORINFO {
                    cbSize: size_of::<MONITORINFO>() as u32,
                    ..Default::default()
                };
                GetMonitorInfoW(
                    MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST),
                    &mut monitor,
                )
                .ok()?;
                wait("client flush with work area", || {
                    let mut origin = POINT::default();
                    ClientToScreen(hwnd, &mut origin).as_bool() && origin.y == monitor.rcWork.top
                })?;
            }
            let scale = f64::from(unsafe { GetDpiForWindow(hwnd) }) / 96.0;
            assert!(
                (client.right
                    - (f64::from(patina_ui::MINI_PANEL_SIZE_DIP.0) * scale).round() as i32)
                    .abs()
                    <= 1
            );
            assert!(
                (client.bottom
                    - (f64::from(patina_ui::MINI_PANEL_SIZE_DIP.1) * scale).round() as i32)
                    .abs()
                    <= 1
            );
            assert_ne!(
                unsafe { GetForegroundWindow() },
                hwnd,
                "passive open took focus"
            );
            println!(
                "Mini client={}x{} scale={scale}",
                client.right, client.bottom
            );
        }
        // The title and PID check above restricts WM_CLOSE to our own Mini.
        unsafe {
            PostMessageW(Some(hwnd), WM_CLOSE, WPARAM(0), LPARAM(0))?;
        }
        wait("Mini destroyed", || mini_windows().is_empty())?;
        if matches!(cycle, 1 | 3 | 8 | 15) {
            println!("Mini cycle={cycle} show_ms={shown}");
        }
    }
    fixture(root, "second.exe")?;
    wait("recording continues after close", || active("second.exe"))?;
    tray_command(3)?;
    wait("pause seals session", || {
        rt.block_on(
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM sessions WHERE end_time IS NULL")
                .fetch_one(&pool),
        )
        .ok()
            == Some(0)
    })?;
    fixture(root, "third.exe")?;
    thread::sleep(Duration::from_secs(3));
    assert_eq!(
        rt.block_on(
            sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*) FROM sessions WHERE exe_name='third.exe'"
            )
            .fetch_one(&pool)
        )?,
        0
    );
    tray_command(3)?;
    wait("resumed recording", || active("third.exe"))?;
    tray_command(1)?;
    wait("reopen after resume", || mini_windows().len() == 1)?;
    verify_dock_motion(mini_windows()[0])?;
    if env::args_os().any(|a| a == "--pointer") {
        verify_pointer_leave(mini_windows()[0])?;
    }
    rt.block_on(pool.close());
    tray_command(2)?;
    exited.recv_timeout(Duration::from_secs(20))?;
    Ok(())
}

fn main() -> Outcome {
    if let Some(result) = patina::run_child_if_requested() {
        return result.map_err(|error| error.to_string().into());
    }
    patina_test_support::dedicated_session()?;

    if env::args().any(|a| a == "--invalid-root") {
        let (tx, rx) = async_channel::unbounded();
        let e = patina::run(tx, rx).expect_err("relative profile parent");
        assert!(e.to_string().contains("absolute directory"));
        return Ok(());
    }
    if env::args().any(|a| a == "--duplicate") {
        let (tx, rx) = async_channel::unbounded();
        let e = patina::run(tx, rx).expect_err("second recorder unexpectedly started");
        assert_eq!(
            e.downcast_ref::<std::io::Error>()
                .and_then(|v| v.raw_os_error()),
            Some(32)
        );
        return Ok(());
    }
    let root = tempfile::Builder::new()
        .prefix("patina-gpui-smoke-")
        .tempdir()?;
    fixture(root.path(), "first.exe")?;
    // This standalone executable sets the environment before starting any threads.
    unsafe {
        env::set_var("PATINA_GPUI_PROFILE_PARENT", root.path());
        env::set_var("PATINA_E2E_DATA_ROOT", root.path());
        env::set_var("PATINA_E2E", "1");
        env::set_var("PATINA_E2E_NATIVE_FIXTURE", "1");
    }
    let (tx, rx) = async_channel::unbounded();
    let (stopped, exited) = mpsc::channel();
    let thread = {
        let root = root.path().to_owned();
        let tx = tx.clone();
        thread::spawn(move || {
            let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                exercise(&root, &tx, exited)
            }));
            let _ = tx.send_blocking(Action::Exit);
            result.unwrap_or_else(|_| Err("native smoke assertion failed".into()))
        })
    };
    patina::run(tx, rx).map_err(|e| e.to_string())?;
    let _ = stopped.send(());
    thread.join().expect("smoke thread")?;
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()?;
    let pool = open_read_only(&root.path().join(patina::APP_ID).join("patina.db"), &rt)?;
    assert_eq!(
        rt.block_on(
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM sessions WHERE end_time IS NULL")
                .fetch_one(&pool)
        )?,
        0
    );
    rt.block_on(pool.close());
    println!(
        "PASS: tray recording, single writer, native Mini reopen, pause/resume and clean exit"
    );
    Ok(())
}
