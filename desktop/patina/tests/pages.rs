#[path = "../../test-support/children.rs"]
mod children;
#[path = "../../test-support/windows.rs"]
mod desktop;
mod support;
#[path = "pages/tools.rs"]
mod tools;
use chrono::{Local, TimeZone, Utc};
use desktop::{ComApartment, Error, TestChild, controls, wait, window};
use sqlx::{Connection, SqliteConnection, sqlite::SqliteConnectOptions};
use std::{fs, path::Path, process::Command};
use support::*;
use windows::{
    Win32::{
        Foundation::{HWND, LPARAM, RECT, WPARAM},
        UI::{Accessibility::*, HiDpi::*, WindowsAndMessaging::*},
    },
    core::w,
};

use std::path::PathBuf;

fn button(hwnd: HWND, label: &str) -> Option<IUIAutomationElement> {
    controls(hwnd).ok()?.into_iter().rev().find(|el| unsafe {
        el.CurrentControlType().ok() == Some(UIA_ButtonControlTypeId)
            && el.CurrentName().is_ok_and(|n| n == label)
    })
}
fn click(hwnd: HWND, label: &str) -> Result<(), Error> {
    activate(hwnd, label, false)
}
fn press(hwnd: HWND, label: &str) -> Result<(), Error> {
    activate(hwnd, label, true)
}
fn activate(hwnd: HWND, label: &str, keyboard: bool) -> Result<(), Error> {
    let el = wait(label, || {
        button(hwnd, label).filter(|el| unsafe { el.CurrentIsEnabled().is_ok_and(|b| b.as_bool()) })
    })
    .map_err(|e| format!("{e}; nodes {:?}", names(hwnd)))?;
    // Bring lower cards in the scrolling page into view before invoking their button.
    for _ in 0..16 {
        let r = unsafe { el.CurrentBoundingRectangle()? };
        let mut window = RECT::default();
        unsafe {
            GetWindowRect(hwnd, &mut window)?;
        }
        let center = (r.top + r.bottom) / 2;
        if r.bottom > r.top && center > window.top + 60 && center < window.bottom - 20 {
            break;
        }
        let direction = if center >= window.bottom - 20 {
            -1i32
        } else {
            1
        };
        let x = window.left + (window.right - window.left) * 3 / 4;
        let y = window.top + (window.bottom - window.top) * 2 / 3;
        unsafe {
            PostMessageW(
                Some(hwnd),
                WM_MOUSEWHEEL,
                WPARAM(((direction * 120) as u32 as usize) << 16),
                LPARAM((y as isize) << 16 | x as isize),
            )?;
        }
        std::thread::sleep(std::time::Duration::from_millis(75));
    }
    if keyboard {
        unsafe {
            el.SetFocus()?;
        }
        key(hwnd, 13)?;
    } else {
        let position = client_center(hwnd, &el)?;
        unsafe {
            PostMessageW(Some(hwnd), WM_MOUSEMOVE, WPARAM(0), position)?;
            PostMessageW(Some(hwnd), WM_LBUTTONDOWN, WPARAM(1), position)?;
            PostMessageW(Some(hwnd), WM_LBUTTONUP, WPARAM(0), position)?;
        }
    }
    Ok(())
}
#[test]
#[ignore = "Windows desktop, isolated SQLite profile"]
fn sidebar_opens_empty_history() -> Result<(), Error> {
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
        let pool = patina_recorder::open_database(&db).await?;
        sqlx::query("INSERT OR REPLACE INTO settings(key,value) VALUES ('language','zh-CN'),('tracking_paused','1')")
            .execute(&pool).await?;
        pool.close().await;
        Ok::<_, Error>(())
    })?;
    let stderr = root.path().join("renderer.log");
    let mut host = TestChild(
        Command::new(env!("CARGO_BIN_EXE_patina-gpui"))
            .env("PATINA_GPUI_PROFILE_PARENT", root.path())
            .stderr(fs::File::create(&stderr)?)
            .arg("--today")
            .spawn()?,
    );
    let pid = host.0.id();
    let hwnd = wait("Today", || children::find(pid, |p| window(p, w!("Patina"))))?;
    click(hwnd, "数据")?;
    wait("data ready", || named(hwnd, "活动趋势"))?;
    click(hwnd, "历史")?;
    wait("empty history summary", || {
        (names(hwnd).iter().filter(|n| n.as_str() == "—").count() == 2).then_some(())
    })
    .map_err(|e| format!("{e}: {}", fs::read_to_string(&stderr).unwrap_or_default()))?;
    click(hwnd, "今天")?;
    wait("returned to Today", || named(hwnd, "今日活动"))?;
    command(window(pid, w!("Patina GPUI")).ok_or("missing tray")?, 2)?;
    assert!(wait("exit", || host.0.try_wait().ok().flatten())?.success());
    Ok(())
}

fn sample(dir: &Option<PathBuf>, pid: u32, name: &str) -> Result<(), Error> {
    if let Some(dir) = dir {
        let exe = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../src-tauri/target/debug/examples/windows-resource-sample.exe");
        let status = Command::new(exe)
            .arg(pid.to_string())
            .arg(dir.join(format!("{name}.jsonl")))
            .args(["30", "5", name])
            .status()?;
        assert!(status.success());
    }
    Ok(())
}
#[test]
#[ignore = "Windows desktop, isolated SQLite profile"]
fn history_navigation() -> Result<(), Error> {
    let _com = ComApartment::init()?;
    unsafe { SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2) };
    let root = tempfile::tempdir()?;
    let profile = root.path().join(patina_gpui::APP_ID);
    fs::create_dir(&profile)?;
    let db = profile.join("patina.db");
    seed(&db)?;
    let now = Local::now();
    let midnight = now
        .date_naive()
        .and_hms_opt(0, 0, 0)
        .unwrap()
        .and_local_timezone(Local)
        .earliest()
        .unwrap()
        .timestamp_millis();
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()?;
    rt.block_on(async{
        let mut c=SqliteConnection::connect_with(&SqliteConnectOptions::new().filename(db)).await?;
        sqlx::query("INSERT OR REPLACE INTO settings(key,value) VALUES ('min_session_secs','60')").execute(&mut c).await?;
        sqlx::query("INSERT INTO session_title_samples(session_id,title,start_time,end_time) SELECT id,'Design fixture',?,? FROM sessions WHERE exe_name='studio.exe'").bind(midnight).bind(midnight+120000).execute(&mut c).await?;
        sqlx::query("INSERT INTO sessions(exe_name,app_name,start_time,end_time,duration) VALUES('brief.exe','Brief',?,?,30000)").bind(midnight+71*60000).bind(midnight+71*60000+30000).execute(&mut c).await?;
        Ok::<_,Error>(())
    })?;
    let mut child = TestChild(
        Command::new(env!("CARGO_BIN_EXE_patina-gpui"))
            .env("PATINA_GPUI_PROFILE_PARENT", root.path())
            .arg("--today")
            .spawn()?,
    );
    let pid = child.0.id();
    let hwnd = wait("Today", || children::find(pid, |p| window(p, w!("Patina"))))?;
    let tray = wait("tray", || window(pid, w!("Patina GPUI")))?;
    let out = std::env::var_os("PATINA_MEASURE_HISTORY").map(|_| {
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../artifacts/runtime-smoke")
            .join(format!(
                "history-{}",
                Utc::now().format("%Y%m%dT%H%M%S%.3fZ")
            ))
    });
    if let Some(out) = &out {
        fs::create_dir_all(out)?;
        println!("Evidence {}", out.display());
    }
    click(hwnd, "History")?;
    let date = now.format("%Y-%m-%d").to_string();
    wait("history day", || named(hwnd, &date))?;
    let includes = |q: &str| names(hwnd).into_iter().any(|s| s.contains(q));
    wait("daily aggregate", || includes("1h 10m").then_some(()))?;
    click(hwnd, "Previous day")?;
    let previous = now.date_naive().pred_opt().unwrap().to_string();
    wait("previous date", || named(hwnd, &previous))?;
    wait("midnight clipping", || includes("30m").then_some(()))?;
    click(hwnd, "Next day")?;
    wait("today date", || named(hwnd, &date))?;
    click(hwnd, "Currently showing Apps; switch to Categories")?;
    click(hwnd, "Currently showing Categories; switch to Apps")?;
    click(hwnd, "Open timeline zoom")?;
    click(hwnd, "Decrease by one hour")?;
    wait("three hour viewport", || named(hwnd, "3.0 h"))?;
    click(hwnd, "Decrease display minutes by 1 minute")?;
    wait("short fragment visible", || {
        includes("Brief  0m").then_some(())
    })?;
    click(hwnd, "Increase display minutes by 1 minute")?;
    wait("only short fragment hidden", || {
        (!includes("Brief  0m")).then_some(())
    })?;
    key(hwnd, 27)?;
    click(hwnd, "View details for Studio")?;
    click(hwnd, "Title details")?;
    wait("recorded title", || {
        includes("Design fixture").then_some(())
    })?;
    click(hwnd, "Previous day")?;
    wait("detail yesterday", || named(hwnd, &previous))?;
    assert!(!includes("Design fixture"));
    click(hwnd, "Close")?;
    wait("history kept its date", || named(hwnd, &date))?;
    sample(&out, pid, "history")?;
    for _ in 0..5 {
        click(hwnd, "Today")?;
        wait("today ranking", || named(hwnd, "Top Apps"))?;
        click(hwnd, "History")?;
        wait("history loaded", || named(hwnd, &date))?;
    }
    click(hwnd, "Today")?;
    wait("today ranking", || named(hwnd, "Top Apps"))?;
    let studio = wait("ranked app", || button(hwnd, "View details for Studio"))?;
    let open: IUIAutomationInvokePattern =
        unsafe { studio.GetCurrentPatternAs(UIA_InvokePatternId)? };
    unsafe {
        open.Invoke()?;
    }
    click(hwnd, "Title details")?;
    wait("same detail from Today", || {
        includes("Design fixture").then_some(())
    })?;
    key(hwnd, 27)?;
    wait("return to Today", || {
        button(hwnd, "Close").is_none().then_some(())
    })?;
    sample(&out, pid, "today-after-history")?;
    let mut renderer = 0;
    unsafe {
        GetWindowThreadProcessId(hwnd, Some(&mut renderer));
        PostMessageW(Some(hwnd), WM_CLOSE, WPARAM(0), LPARAM(0))?;
    }
    wait("renderer exits", || {
        (!children::children(pid).ok()?.contains(&renderer)).then_some(())
    })?;
    sample(&out, pid, "tray-after-history")?;
    command(tray, 2)?;
    assert!(wait("exit", || child.0.try_wait().ok().flatten())?.success());
    Ok(())
}

#[test]
fn history_exact_and_bucket_data() -> Result<(), Error> {
    let root = tempfile::tempdir()?;
    let db = root.path().join("patina.db");
    seed(&db)?;
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()?;
    let start = Local::now()
        .date_naive()
        .and_hms_opt(0, 0, 0)
        .unwrap()
        .and_local_timezone(Local)
        .earliest()
        .unwrap()
        .timestamp_millis();
    rt.block_on(async{
        let mut c=SqliteConnection::connect_with(&SqliteConnectOptions::new().filename(&db)).await?;
        sqlx::query("INSERT INTO import_time_buckets(batch_id,fingerprint,exe_name,app_name,bucket_start_time,duration) VALUES('test','bucket','bucket.exe','Bucket',?,120000)").bind(start+2*3600000).execute(&mut c).await?;
        Ok::<_,Error>(())
    })?;
    let r = patina_recorder::Recorder::start(&db, || {})?;
    let day = rt.block_on(r.history(start, None, false))?;
    assert_eq!(day.apps.iter().map(|a| a.2).sum::<i64>(), 72 * 60000);
    assert_eq!(
        day.records.iter().map(|r| r.end - r.start).sum::<i64>(),
        70 * 60000
    );
    assert!(!day.records.iter().any(|r| r.key == "bucket.exe"));
    let writer = rt.block_on(r.history(start, Some("writer.exe".into()), true))?;
    assert_eq!(
        writer.records.iter().map(|r| r.end - r.start).sum::<i64>(),
        20 * 60000
    );
    r.shutdown()?;
    Ok(())
}
#[test]
#[ignore = "Windows desktop, isolated SQLite profile"]
fn data_navigation() -> Result<(), Error> {
    let _com = ComApartment::init()?;
    unsafe { SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2) };
    let root = tempfile::tempdir()?;
    let profile = root.path().join(patina_gpui::APP_ID);
    fs::create_dir(&profile)?;
    seed(&profile.join("patina.db"))?;
    let mut host = TestChild(
        Command::new(env!("CARGO_BIN_EXE_patina-gpui"))
            .env("PATINA_GPUI_PROFILE_PARENT", root.path())
            .arg("--today")
            .spawn()?,
    );
    let pid = host.0.id();
    let hwnd = wait("Today", || children::find(pid, |p| window(p, w!("Patina"))))?;
    press(hwnd, "Data")?;
    wait("seven day cross-midnight total", || {
        named(hwnd, "Total · 1h 40m")
    })?;
    press(hwnd, "Studio")?;
    wait("selected app total", || named(hwnd, "Total · 1h 15m"))
        .map_err(|e| format!("{e}; {:?}", names(hwnd)))?;
    press(hwnd, "Select range")?;
    press(hwnd, "Week")?;
    wait("week range applied", || {
        button(hwnd, "Week").is_none().then_some(())
    })?;
    press(hwnd, "Select range")?;
    press(hwnd, "Last 30 days")?;
    wait("changed range preserves app", || {
        named(hwnd, "Total · 1h 15m")
    })?;
    press(hwnd, "Categories")?;
    press(hwnd, "Office")?;
    wait("category total", || named(hwnd, "Total · 20m"))?;
    press(hwnd, "Web")?;
    wait("empty websites", || named(hwnd, "Total · 0m"))?;
    press(hwnd, "Apps")?;
    press(hwnd, "Studio")?;
    let date = Local::now().date_naive().to_string();
    press(hwnd, &date)?;
    press(hwnd, "Previous day")?;
    wait("app detail yesterday", || {
        named(
            hwnd,
            &Local::now().date_naive().pred_opt().unwrap().to_string(),
        )
    })?;
    press(hwnd, "Close")?;
    wait("restored selection", || named(hwnd, "Total · 1h 15m"))?;
    let tray = window(pid, w!("Patina GPUI")).unwrap();
    command(tray, 2)?;
    assert!(wait("exit", || host.0.try_wait().ok().flatten())?.success());
    Ok(())
}

#[test]
#[ignore = "Windows desktop, isolated SQLite profile"]
fn classification_navigation() -> Result<(), Error> {
    let _com = ComApartment::init()?;
    unsafe { SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2) };
    let root = tempfile::tempdir()?;
    let dir = root.path().join(patina_gpui::APP_ID);
    fs::create_dir(&dir)?;
    let db = dir.join("patina.db");
    seed(&db)?;
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()?;
    rt.block_on(async {
        let mut conn = SqliteConnection::connect_with(&SqliteConnectOptions::new().filename(&db)).await?;
        sqlx::query("INSERT INTO sessions(exe_name,app_name,start_time,end_time,duration) VALUES ('Studio.EXE','Studio',0,1,1), ('sample.exe','sample.exe',2,3,1), ('single.exe','S',4,5,1)")
            .execute(&mut conn).await?;
        Ok::<_, Error>(())
    })?;
    let stderr = root.path().join("classification.log");
    let mut host = TestChild(
        Command::new(env!("CARGO_BIN_EXE_patina-gpui"))
            .env("PATINA_GPUI_PROFILE_PARENT", root.path())
            .stderr(fs::File::create(&stderr)?)
            .arg("--today")
            .spawn()?,
    );
    let pid = host.0.id();
    let hwnd = wait("Today", || children::find(pid, |p| window(p, w!("Patina"))))?;
    click(hwnd, "Classification")?;
    wait("one card for Studio", || {
        (names(hwnd)
            .iter()
            .filter(|n| n.as_str() == "Category · Studio")
            .count()
            == 1)
            .then_some(())
    })
    .map_err(|e| format!("{e}: {}", fs::read_to_string(&stderr).unwrap_or_default()))?;
    click(hwnd, "Category · Studio")?;
    click(hwnd, "Office")?;
    click(hwnd, "Apply")?;
    click(hwnd, "Cancel")?;
    click(hwnd, "Category · Studio")?;
    click(hwnd, "Office")?;
    let field = wait("rename input", || {
        controls(hwnd).ok()?.into_iter().find(|el| unsafe {
            el.CurrentControlType().ok() == Some(UIA_EditControlTypeId)
                && el.CurrentName().is_ok_and(|s| s == "Edit app name")
        })
    })?;
    let input: IUIAutomationValuePattern =
        unsafe { field.GetCurrentPatternAs(UIA_ValuePatternId)? };
    unsafe {
        input.SetValue(&"Studio Review".into())?;
    }
    click(hwnd, "Apply")?;
    click(hwnd, "Save")?;
    wait("saved app", || {
        named(hwnd, "Saved").and_then(|_| named(hwnd, "Studio Review"))
    })
    .map_err(|e| format!("{e}; nodes {:?}", names(hwnd)))?;
    click(hwnd, "Today")?;
    wait("renamed app in Today", || {
        button(hwnd, "View details for Studio Review")
    })
    .map_err(|e| format!("{e}; nodes {:?}", names(hwnd)))?;
    click(hwnd, "Classification")?;
    wait("stored category", || {
        button(hwnd, "Category · Studio Review")
    })?;
    click(hwnd, "Manage categories")?;
    let entry = wait("category name field", || {
        controls(hwnd).ok()?.into_iter().find(|el| unsafe {
            el.CurrentControlType().ok() == Some(UIA_EditControlTypeId)
                && el.CurrentName().is_ok_and(|s| s == "New category name")
        })
    })?;
    let input: IUIAutomationValuePattern =
        unsafe { entry.GetCurrentPatternAs(UIA_ValuePatternId)? };
    unsafe {
        input.SetValue(&"Research".into())?;
    }
    click(hwnd, "Apply")?;
    click(hwnd, "Save")?;
    wait("category save completes", || {
        button(hwnd, "Save").filter(|b| unsafe { b.CurrentIsEnabled().is_ok_and(|v| !v.as_bool()) })
    })?;
    click(hwnd, "Category · Studio Review")?;
    click(hwnd, "Research")?;
    click(hwnd, "Apply")?;
    click(hwnd, "Save")?;
    wait("assigned new category", || {
        button(hwnd, "Save").filter(|b| unsafe { b.CurrentIsEnabled().is_ok_and(|v| !v.as_bool()) })
    })?;
    command(window(pid, w!("Patina GPUI")).unwrap(), 2)?;
    assert!(wait("exit", || host.0.try_wait().ok().flatten())?.success());
    Ok(())
}

#[test]
#[ignore = "Windows desktop, isolated SQLite profile"]
fn settings_navigation() -> Result<(), Error> {
    let _com = ComApartment::init()?;
    unsafe { SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2) };
    let root = tempfile::tempdir()?;
    let dir = root.path().join(patina_gpui::APP_ID);
    fs::create_dir(&dir)?;
    let path = dir.join("patina.db");
    seed(&path)?;
    let mut host = TestChild(
        Command::new(env!("CARGO_BIN_EXE_patina-gpui"))
            .env("PATINA_GPUI_PROFILE_PARENT", root.path())
            .arg("--today")
            .spawn()?,
    );
    let pid = host.0.id();
    let hwnd = wait("Today", || children::find(pid, |p| window(p, w!("Patina"))))?;
    click(hwnd, "Settings")?;
    click(hwnd, "+ Activity hold time")?;
    wait("updated stepper", || named(hwnd, "4 min"))?;
    click(hwnd, "Cancel")?;
    wait("cancel restored value", || named(hwnd, "3 min"))?;
    click(hwnd, "+ Activity hold time")?;
    click(hwnd, "Dark")?;
    click(hwnd, "Save")?;
    wait("saved preferences", || {
        button(hwnd, "Save").filter(|b| unsafe { b.CurrentIsEnabled().is_ok_and(|s| !s.as_bool()) })
    })?;
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()?;
    rt.block_on(async {
        let mut c = SqliteConnection::connect_with(
            &SqliteConnectOptions::new().filename(path).read_only(true),
        )
        .await?;
        let value: String =
            sqlx::query_scalar("SELECT value FROM settings WHERE key='timeline_merge_gap_secs'")
                .fetch_one(&mut c)
                .await?;
        assert_eq!(value, "240");
        let theme: String = sqlx::query_scalar("SELECT value FROM settings WHERE key='theme_mode'")
            .fetch_one(&mut c)
            .await?;
        assert_eq!(theme, "dark");
        Ok::<_, Error>(())
    })?;
    click(hwnd, "Today")?;
    click(hwnd, "Settings")?;
    wait("persisted stepper", || named(hwnd, "4 min"))?;
    command(window(pid, w!("Patina GPUI")).unwrap(), 2)?;
    assert!(wait("exit", || host.0.try_wait().ok().flatten())?.success());
    Ok(())
}

#[test]
#[ignore = "Windows desktop, isolated SQLite profile"]
fn about_navigation() -> Result<(), Error> {
    let _com = ComApartment::init()?;
    unsafe { SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2) };
    let root = tempfile::tempdir()?;
    let dir = root.path().join(patina_gpui::APP_ID);
    fs::create_dir(&dir)?;
    seed(&dir.join("patina.db"))?;
    let mut host = TestChild(
        Command::new(env!("CARGO_BIN_EXE_patina-gpui"))
            .env("PATINA_GPUI_PROFILE_PARENT", root.path())
            .arg("--today")
            .spawn()?,
    );
    let pid = host.0.id();
    let hwnd = wait("Today", || children::find(pid, |p| window(p, w!("Patina"))))?;
    click(hwnd, "About")?;
    wait("binary version", || {
        named(hwnd, concat!("GPUI v", env!("CARGO_PKG_VERSION")))
    })?;
    for (open, qr, action) in [
        ("Feedback", "QQ Channel", "GitHub Issues"),
        ("Sponsor", "WeChat reward code", "Open Ko-fi"),
    ] {
        click(hwnd, open)?;
        wait("QR card", || named(hwnd, qr))?;
        assert!(button(hwnd, action).is_some());
        press(hwnd, "Close")?;
        wait("return", || button(hwnd, "Close").is_none().then_some(()))?;
    }
    assert!(button(hwnd, "Release notes").is_some() && button(hwnd, "Check updates").is_some());
    command(window(pid, w!("Patina GPUI")).unwrap(), 2)?;
    assert!(wait("exit", || host.0.try_wait().ok().flatten())?.success());
    Ok(())
}

#[test]
#[ignore = "requires saved Tauri page layout and interactive Windows desktop"]
fn page_layout_comparison() -> Result<(), Error> {
    let _com = ComApartment::init()?;
    unsafe { SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2) };
    let root = tempfile::tempdir()?;
    let dir = root.path().join(patina_gpui::APP_ID);
    fs::create_dir(&dir)?;
    let base = PathBuf::from(
        std::env::var_os("PATINA_PAGE_BASELINE")
            .ok_or("set PATINA_PAGE_BASELINE to the original-pages.json file")?,
    );
    let fixture = base.with_file_name("fixture.db");
    fs::copy(&fixture, dir.join("patina.db"))?;
    let source: Vec<serde_json::Value> = serde_json::from_slice(&fs::read(&base)?)?;
    let mut host = TestChild(
        Command::new(env!("CARGO_BIN_EXE_patina-gpui"))
            .env("PATINA_GPUI_PROFILE_PARENT", root.path())
            .arg("--today")
            .spawn()?,
    );
    let pid = host.0.id();
    let hwnd = wait("Today", || children::find(pid, |p| window(p, w!("Patina"))))?;
    let mut origin = windows::Win32::Foundation::POINT::default();
    unsafe {
        windows::Win32::Graphics::Gdi::ClientToScreen(hwnd, &mut origin).ok()?;
    }
    let mut client = RECT::default();
    unsafe {
        GetClientRect(hwnd, &mut client)?;
    }
    let mut comparisons = Vec::new();
    let dpi = unsafe { GetDpiForWindow(hwnd) };
    let original_window: serde_json::Value =
        serde_json::from_slice(&fs::read(base.with_file_name("tauri.json"))?)?;
    assert_eq!(
        original_window["client"],
        serde_json::json!([client.right, client.bottom])
    );
    assert_eq!(original_window["dpi"], dpi);
    assert_eq!(original_window["fixtureHash"], hash(&fixture)?);
    let title_bounds = |page: &str| {
        wait(page, || {
            controls(hwnd).ok()?.into_iter().find_map(|el| unsafe {
                (el.CurrentAutomationId().ok()? == "page-title" && el.CurrentName().ok()? == page)
                    .then(|| el.CurrentBoundingRectangle().ok())
                    .flatten()
            })
        })
    };
    let today = title_bounds("Today")?;
    let check_header = |page: &str, actions: &[&str]| -> Result<(), Error> {
        if let Some(last) = actions.last() {
            wait(last, || button(hwnd, last))?;
        }
        let title = title_bounds(page)?;
        assert_eq!(
            (title.left, title.top, title.bottom),
            (today.left, today.top, today.bottom),
            "{page} title alignment"
        );
        let mut end = title.right;
        for name in actions {
            let control = wait(name, || button(hwnd, name))?;
            let rect = unsafe { control.CurrentBoundingRectangle()? };
            assert!(
                rect.left >= end && rect.right > rect.left,
                "{page}/{name} action overlaps"
            );
            assert!(
                (rect.top + rect.bottom - title.top - title.bottom).abs() <= 2,
                "{page}/{name} vertical alignment"
            );
            end = rect.right;
        }
        assert!((end - today.right).abs() <= 1, "{page} right edge");
        Ok(())
    };
    click(hwnd, "Tools")?;
    check_header("Tools", &["Manage tools", "Tools settings"])?;
    for (page, labels) in [
        (
            "History",
            vec![
                "History",
                "Day Timeline",
                "Day Summary",
                "Daily Activity",
                "Day Distribution",
            ],
        ),
        (
            "Data",
            vec!["Data", "Activity Trend", "Activity Heatmap", "App Trends"],
        ),
        ("Classification", vec!["Classification", "Studio", "Writer"]),
        (
            "Settings",
            vec![
                "Settings",
                "Tracking",
                "Time rules",
                "Recording options",
                "Appearance",
            ],
        ),
        (
            "About",
            vec![
                "About",
                "Patina",
                "A local-first time tracker",
                "App updates",
            ],
        ),
    ] {
        click(hwnd, page)?;
        let actions: &[&str] = match page {
            "History" => &["Previous day", "Next day"],
            "Classification" | "Settings" => &["Cancel", "Save"],
            _ => &[],
        };
        check_header(page, actions)?;

        let original = &source
            .iter()
            .find(|v| v["page"] == page)
            .ok_or("missing original page")?["nodes"];
        let nodes = original.as_array().ok_or("missing original nodes")?;
        for name in labels {
            let old = nodes
                .iter()
                .filter(|r| {
                    r[0] == name
                        && r[1].as_i64().is_some_and(|x| x > 150)
                        && r[2].as_i64().is_some_and(|y| y > 80)
                })
                .min_by_key(|r| r[3].as_i64().unwrap_or(i64::MAX))
                .ok_or_else(|| format!("missing original {page}/{name}"))?;
            let current = wait(name, || {
                controls(hwnd).ok()?.into_iter().find_map(|el| unsafe {
                    let rect = el.CurrentBoundingRectangle().ok()?;
                    let n = el.CurrentName().ok()?;
                    (n == name
                        && rect.left - origin.x > 150
                        && rect.top - origin.y > 80
                        && rect.right > rect.left)
                        .then_some([
                            rect.left - origin.x,
                            rect.top - origin.y,
                            rect.right - rect.left,
                            rect.bottom - rect.top,
                        ])
                })
            })?;
            comparisons.push(
                serde_json::json!({"page":page,"label":name,"original":old,"native":current}),
            );
        }
    }
    let path = base.with_file_name("native-layout-comparison.json");
    fs::write(
        &path,
        serde_json::to_vec_pretty(
            &serde_json::json!({"client":[client.right,client.bottom],"dpi":dpi,"fixtureHash":hash(&fixture)?,"comparisons":comparisons}),
        )?,
    )?;
    command(window(pid, w!("Patina GPUI")).unwrap(), 2)?;
    assert!(wait("exit", || host.0.try_wait().ok().flatten())?.success());
    Ok(())
}

#[test]
fn edits_are_atomic_and_detect_stale_inputs() -> Result<(), Error> {
    let root = tempfile::tempdir()?;
    let db = root.path().join("patina.db");
    seed(&db)?;
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()?;
    let recorder = patina_recorder::Recorder::start(&db, || {})?;
    rt.block_on(async {
        let rules = recorder.rules().await?;
        let mut studio = rules
            .apps
            .iter()
            .find(|r| r.exe == "studio.exe")
            .unwrap()
            .clone();
        let mut writer = rules
            .apps
            .iter()
            .find(|r| r.exe == "writer.exe")
            .unwrap()
            .clone();
        studio.name = "Draft".into();
        writer.category = "missing-category".into();
        assert!(
            recorder
                .save_rules(vec![studio.clone(), writer], vec![])
                .await
                .is_err()
        );
        assert!(
            recorder
                .rules()
                .await?
                .apps
                .iter()
                .any(|a| a.name == "Studio")
        );
        recorder.save_rules(vec![studio.clone()], vec![]).await?;
        studio.name = "Stale".into();
        assert!(recorder.save_rules(vec![studio], vec![]).await.is_err());
        let old = recorder.preferences().await?;
        let mut p = old;
        p.gap = 240;
        recorder.save_preferences(old, p).await?;
        p.gap = 60;
        p.theme = patina_recorder::Theme::Dark;
        assert!(recorder.save_preferences(old, p).await.is_err());
        let saved = recorder.preferences().await?;
        assert_eq!(saved.gap, 240);
        assert_eq!(saved.theme, old.theme);
        Ok::<_, Error>(())
    })?;
    recorder.shutdown()?;
    Ok(())
}
