#[path = "pages/category_manager.rs"]
mod category_manager;
#[path = "../../test-support/children.rs"]
mod children;
#[path = "pages/classification_color.rs"]
mod classification_color;
#[path = "pages/classification_delete.rs"]
mod classification_delete;
#[path = "pages/classification_web.rs"]
mod classification_web;
#[path = "pages/data_range.rs"]
mod data_range;
#[path = "../../test-support/windows.rs"]
mod desktop;
#[path = "pages/history_calendar.rs"]
mod history_calendar;
#[path = "pages/history_timeline.rs"]
mod history_timeline;
#[path = "pages/resident.rs"]
mod resident;
#[path = "pages/schemes.rs"]
mod schemes;
#[path = "pages/services.rs"]
mod services;
#[path = "pages/storage.rs"]
mod storage;
mod support;
#[path = "pages/tools.rs"]
mod tools;
#[path = "pages/trend_chart.rs"]
mod trend_chart;
use chrono::{Local, Utc};
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

fn classification_filter_counts(hwnd: HWND) -> Option<[usize; 3]> {
    let labels: Vec<_> = controls(hwnd)
        .ok()?
        .into_iter()
        .filter_map(|el| unsafe {
            (el.CurrentControlType().ok()? == UIA_RadioButtonControlTypeId)
                .then(|| el.CurrentName().ok().map(|name| name.to_string()))
                .flatten()
        })
        .collect();
    let count = |prefix: &str| {
        labels
            .iter()
            .find_map(|label| label.strip_prefix(prefix)?.strip_suffix(')')?.parse().ok())
    };
    Some([
        count("All (")?,
        count("Classified (")?,
        count("Unclassified (")?,
    ])
}

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
fn segment(hwnd: HWND, label: &str) -> Option<IUIAutomationElement> {
    controls(hwnd).ok()?.into_iter().find(|el| unsafe {
        el.CurrentControlType().ok() == Some(UIA_RadioButtonControlTypeId)
            && el.CurrentName().is_ok_and(|n| n == label)
    })
}
fn selected_segment(hwnd: HWND, label: &str) -> Option<()> {
    let el = segment(hwnd, label)?;
    unsafe {
        (el.CurrentIsEnabled().ok()?.as_bool()
            && el
                .GetCurrentPatternAs::<IUIAutomationSelectionItemPattern>(
                    UIA_SelectionItemPatternId,
                )
                .ok()?
                .CurrentIsSelected()
                .ok()?
                .as_bool())
        .then_some(())
    }
}
fn select_segment(hwnd: HWND, label: &str) -> Result<(), Error> {
    let el = wait(label, || segment(hwnd, label))?;
    activate_control(hwnd, &el, false)?;
    wait(
        &format!("selected segment remains enabled: {label}"),
        || selected_segment(hwnd, label),
    )
    .map_err(|e| format!("{e}; nodes {:?}", names(hwnd)))?;
    Ok(())
}
fn activate(hwnd: HWND, label: &str, keyboard: bool) -> Result<(), Error> {
    let el = wait(label, || {
        button(hwnd, label).filter(|el| unsafe { el.CurrentIsEnabled().is_ok_and(|b| b.as_bool()) })
    })
    .map_err(|e| format!("{e}; nodes {:?}", names(hwnd)))?;
    activate_control(hwnd, &el, keyboard)
}

fn activate_control(hwnd: HWND, el: &IUIAutomationElement, keyboard: bool) -> Result<(), Error> {
    // Bring lower cards in the scrolling page into view before invoking their button.
    for attempt in 0..=16 {
        let r = unsafe { el.CurrentBoundingRectangle()? };
        let mut window = RECT::default();
        unsafe {
            GetWindowRect(hwnd, &mut window)?;
        }
        let center = (r.top + r.bottom) / 2;
        if r.bottom > r.top && center > window.top + 60 && center < window.bottom - 20 {
            break;
        }
        if attempt == 16 {
            return Err(format!(
                "control remains outside viewport: control={r:?}, window={window:?}"
            )
            .into());
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
        desktop::wait_observed("scroll moves target control", || {
            let next = unsafe { el.CurrentBoundingRectangle() }.map_err(|e| e.to_string())?;
            if next.top != r.top || next.bottom != r.bottom {
                Ok(())
            } else {
                Err(format!("control={next:?}, window={window:?}"))
            }
        })?;
    }
    if keyboard {
        unsafe {
            el.SetFocus()?;
        }
        // UIA HasKeyboardFocus also requires host foreground focus, unavailable on
        // the non-input desktop. The caller observes this key's resulting state.
        key(hwnd, 13)?;
    } else {
        let position = client_center(hwnd, el)?;
        unsafe {
            PostMessageW(Some(hwnd), WM_MOUSEMOVE, WPARAM(0), position)?;
            PostMessageW(Some(hwnd), WM_LBUTTONDOWN, WPARAM(1), position)?;
            PostMessageW(Some(hwnd), WM_LBUTTONUP, WPARAM(0), position)?;
        }
    }
    Ok(())
}
#[test]
#[ignore = "isolated Win32 desktop"]
fn sidebar_opens_empty_history() -> Result<(), Error> {
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
        let pool = patina_recorder::open_database(&db).await?;
        sqlx::query("INSERT OR REPLACE INTO settings(key,value) VALUES ('language','zh-CN'),('tracking_paused','1'),('show_tray_icon','0')")
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
#[ignore = "isolated Win32 desktop"]
fn repeated_sidebar_navigation_keeps_window_alive() -> Result<(), Error> {
    if !patina_test_desktop::run_case()? {
        return Ok(());
    }
    let _com = ComApartment::init()?;
    unsafe { SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2) };
    for tag in ["es", "ru-RU", "zh-CN", "en-US"] {
        navigate_in_locale(tag).map_err(|e| format!("{tag}: {e}"))?;
    }
    Ok(())
}

fn navigate_in_locale(tag: &str) -> Result<(), Error> {
    let root = tempfile::tempdir()?;
    let profile = root.path().join(patina_gpui::APP_ID);
    fs::create_dir(&profile)?;
    seed(&profile.join("patina.db"))?;
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()?;
    rt.block_on(async {
        let mut db = SqliteConnection::connect_with(
            &SqliteConnectOptions::new().filename(profile.join("patina.db")),
        )
        .await?;
        sqlx::query("UPDATE settings SET value=? WHERE key='language'")
            .bind(tag)
            .execute(&mut db)
            .await?;
        Ok::<_, Error>(())
    })?;
    let locale = patina_recorder::Locale::from_tag(Some(tag));
    let stderr = root.path().join("renderer.log");
    let mut host = TestChild(
        Command::new(env!("CARGO_BIN_EXE_patina-gpui"))
            .env("PATINA_GPUI_PROFILE_PARENT", root.path())
            .env_remove("PATINA_GPUI_DEV_SESSION")
            .env("RUST_BACKTRACE", "1")
            .stderr(fs::File::create(&stderr)?)
            .arg("--today")
            .spawn()?,
    );
    let pid = host.0.id();
    let outcome = (|| -> Result<(), Error> {
        let hwnd = wait("Today", || children::find(pid, |p| window(p, w!("Patina"))))?;
        for (width, height) in [(1200, 800), (810, 540)] {
            let dpi = unsafe { GetDpiForWindow(hwnd) } as i32;
            unsafe {
                SetWindowPos(
                    hwnd,
                    None,
                    0,
                    0,
                    width * dpi / 96,
                    height * dpi / 96,
                    SWP_NOMOVE | SWP_NOACTIVATE | SWP_NOZORDER,
                )?;
            }
            for round in 0..20 {
                for key in [
                    "history.title",
                    "data.title",
                    "mapping.title",
                    "tools.title",
                    "settings.title",
                    "about.title",
                    "dashboard.title",
                ] {
                    navigate_sidebar(hwnd, locale, key)?;
                    assert!(
                        unsafe { IsWindow(Some(hwnd)).as_bool() },
                        "window lost in round {round}: {key}"
                    );
                }
            }
        }
        click(hwnd, &patina_recorder::text(locale, "settings.title"))?;
        let language_name = patina_recorder::text(locale, "settings.languageLabel");
        let language = wait("language selector", || {
            controls(hwnd).ok()?.into_iter().find(|el| unsafe {
                el.CurrentControlType().ok() == Some(UIA_ComboBoxControlTypeId)
                    && el.CurrentName().is_ok_and(|n| n == language_name.as_str())
            })
        })?;
        activate_control(hwnd, &language, false)?;
        let (next_tag, next_name) = match tag {
            "es" => ("ru-RU", "Русский"),
            "ru-RU" => ("zh-CN", "简体中文"),
            "zh-CN" => ("en-US", "English"),
            _ => ("es", "Español"),
        };
        let option = wait(next_name, || {
            controls(hwnd).ok()?.into_iter().find(|el| unsafe {
                el.CurrentControlType().ok() == Some(UIA_ListItemControlTypeId)
                    && el.CurrentName().is_ok_and(|n| n == next_name)
            })
        })?;
        activate_control(hwnd, &option, false)?;
        press(hwnd, &patina_recorder::text(locale, "common.save"))?;
        let next_locale = patina_recorder::Locale::from_tag(Some(next_tag));
        wait("saved language applied", || {
            named(hwnd, &patina_recorder::text(next_locale, "settings.title"))
        })?;
        for key in [
            "history.title",
            "data.title",
            "mapping.title",
            "tools.title",
            "about.title",
            "dashboard.title",
            "settings.title",
        ] {
            navigate_sidebar(hwnd, next_locale, key)?;
        }
        wait("translated preferences ready", || {
            named(
                hwnd,
                &patina_recorder::text(next_locale, "settings.themeModeLabel"),
            )
        })?;
        command(window(pid, w!("Patina GPUI")).ok_or("missing tray")?, 2)?;
        assert!(wait("exit", || host.0.try_wait().ok().flatten())?.success());
        Ok(())
    })();
    outcome.map_err(|e| format!("{e}\n{}", fs::read_to_string(stderr).unwrap_or_default()).into())
}

fn navigate_sidebar(hwnd: HWND, locale: patina_recorder::Locale, key: &str) -> Result<(), Error> {
    let page = patina_recorder::text(locale, key);
    // The sidebar precedes page controls that may have the same translated name.
    let button = wait(&page, || {
        controls(hwnd).ok()?.into_iter().find(|el| unsafe {
            el.CurrentControlType().ok() == Some(UIA_ButtonControlTypeId)
                && el.CurrentName().is_ok_and(|n| n == page.as_str())
        })
    })?;
    activate_control(hwnd, &button, false)?;
    wait(&page, || {
        controls(hwnd).ok()?.into_iter().find(|el| unsafe {
            el.CurrentAutomationId().is_ok_and(|id| id == "page-title")
                && el.CurrentName().is_ok_and(|n| n == page.as_str())
        })
    })
    .map_err(|e| format!("{key}: {e}; nodes {:?}", names(hwnd)))?;
    Ok(())
}
fn check_history_hourly(hwnd: HWND) -> Result<(), Error> {
    let tooltip = || -> Option<String> {
        controls(hwnd).ok()?.into_iter().find_map(|el| unsafe {
            (el.CurrentControlType().ok()? == UIA_ToolTipControlTypeId)
                .then(|| el.CurrentName().ok().map(|s| s.to_string()))
                .flatten()
        })
    };
    for grouped in [false, true] {
        let mode = if grouped {
            "Show total activity"
        } else {
            "Show by category"
        };
        let toggle = wait("history hourly mode", || named(hwnd, mode))?;
        let hour = wait("history first active hour", || {
            controls(hwnd).ok()?.into_iter().find(|el| unsafe {
                el.CurrentName()
                    .is_ok_and(|s| s.to_string().starts_with("00:00 · Active "))
                    && el.CurrentControlType().ok() != Some(UIA_ToolTipControlTypeId)
            })
        })?;
        unsafe {
            PostMessageW(
                Some(hwnd),
                WM_MOUSEMOVE,
                WPARAM(0),
                client_center(hwnd, &hour)?,
            )?;
        }
        let tip = wait("history hour hover tooltip", || {
            tooltip().filter(|s| s.starts_with("00:00 · Active "))
        })?;
        assert_eq!(tip.contains('\n'), grouped, "{tip}");
        unsafe {
            PostMessageW(
                Some(hwnd),
                WM_MOUSEMOVE,
                WPARAM(0),
                client_center(hwnd, &toggle)?,
            )?;
        }
        wait("history hour pointer leaves", || {
            tooltip().is_none().then_some(())
        })?;
        unsafe {
            hour.SetFocus()?;
        }
        wait("history hour focus tooltip", || tooltip())?;
        key(hwnd, 27)?;
        wait("history hour Escape", || tooltip().is_none().then_some(()))?;
        unsafe {
            toggle.SetFocus()?;
        }
        let empty = named(hwnd, "02:00 · Active 0m").ok_or("missing empty history hour")?;
        assert!(!unsafe { empty.CurrentIsKeyboardFocusable()? }.as_bool());
        click(hwnd, mode)?;
    }
    Ok(())
}

#[test]
#[ignore = "isolated Win32 desktop"]
fn history_navigation() -> Result<(), Error> {
    if !patina_test_desktop::run_case()? {
        return Ok(());
    }
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
    check_history_hourly(hwnd)?;
    select_segment(hwnd, "Categories")?;
    wait("category distribution", || named(hwnd, "Office"))?;
    select_segment(hwnd, "Apps")?;
    click(hwnd, "Previous day")?;
    let previous = now.date_naive().pred_opt().unwrap().to_string();
    wait("previous date", || named(hwnd, &previous))?;
    wait("midnight clipping", || includes("30m").then_some(()))?;
    click(hwnd, "Next day")?;
    wait("today date", || named(hwnd, &date))?;
    click(hwnd, "Currently showing Apps; switch to Categories")?;
    click(hwnd, "Currently showing Categories; switch to Web")?;
    click(hwnd, "Currently showing Web; switch to Apps")?;
    history_timeline::check_zoom(hwnd)?;
    click(hwnd, "Open timeline")?;
    history_timeline::check_records(hwnd)?;
    click(hwnd, "Decrease display minutes by 1 minute")?;
    wait("short fragment visible", || named(hwnd, "Brief · 30s"))?;
    click(hwnd, "Increase display minutes by 1 minute")?;
    wait("only short fragment hidden", || {
        named(hwnd, "Brief · 30s").is_none().then_some(())
    })?;
    key(hwnd, 27)?;
    history_timeline::open_icon_details(hwnd, "Studio")?;
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
#[ignore = "isolated Win32 desktop"]
fn data_navigation() -> Result<(), Error> {
    if !patina_test_desktop::run_case()? {
        return Ok(());
    }
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
    trend_chart::check(hwnd)?;
    press(hwnd, "Studio")?;
    wait("selected app total", || named(hwnd, "Total · 1h 15m"))
        .map_err(|e| format!("{e}; {:?}", names(hwnd)))?;
    wait("trend metrics", || named(hwnd, "Active days · 2"))?;
    let by_id = |id: &str| {
        controls(hwnd)
            .ok()?
            .into_iter()
            .find(|el| unsafe { el.CurrentAutomationId().is_ok_and(|value| value == id) })
    };
    let list = unsafe {
        wait("trend object list", || by_id("trend-objects"))?.CurrentBoundingRectangle()?
    };
    let chart =
        unsafe { wait("trend plot", || by_id("selection-trend"))?.CurrentBoundingRectangle()? };
    assert!(list.right < chart.left && list.right - list.left < chart.right - chart.left);
    press(hwnd, "Writer")?;
    wait("single selection replaces Studio", || {
        named(hwnd, "Total · 20m")
    })?;
    press(hwnd, "Studio")?;
    let search = wait("trend search", || named(hwnd, "Search apps"))?;
    let edit: IUIAutomationValuePattern =
        unsafe { search.GetCurrentPatternAs(UIA_ValuePatternId)? };
    unsafe {
        edit.SetValue(&windows::core::BSTR::from("no-such-app"))?;
    }
    wait("no matching apps", || named(hwnd, "No matching apps"))?;
    assert!(named(hwnd, "Total · 1h 15m").is_some());
    unsafe {
        edit.SetValue(&windows::core::BSTR::from(""))?;
    }
    wait("cleared search", || button(hwnd, "Studio"))?;
    activate_control(
        hwnd,
        &data_range::range_button(hwnd, "Select trend range", "Expand trend range")
            .ok_or("overview range")?,
        true,
    )?;
    wait("expanded trend loaded", || {
        named(
            hwnd,
            &format!("{} · 0m", Local::now().date_naive() - chrono::Days::new(29)),
        )
    })?;
    wait("changed range preserves app", || {
        named(hwnd, "Total · 1h 15m")
    })?;
    select_segment(hwnd, "Categories")?;
    press(hwnd, "Office")?;
    wait("category total", || named(hwnd, "Total · 20m"))?;
    select_segment(hwnd, "Web")?;
    wait("empty websites", || named(hwnd, "Total · 0m"))?;
    select_segment(hwnd, "Apps")?;
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
    click(hwnd, "Close")?;
    wait("data detail dismissed", || {
        button(hwnd, "Close").is_none().then_some(())
    })?;
    wait("restored selection", || named(hwnd, "Total · 1h 15m"))?;
    activate_control(
        hwnd,
        &segment(hwnd, "Weekly").ok_or("weekly segment")?,
        true,
    )?;
    wait("weekly heatmap selected", || {
        selected_segment(hwnd, "Weekly")
    })?;
    unsafe {
        segment(hwnd, "Weekly")
            .ok_or("weekly segment")?
            .SetFocus()?;
    }
    key(hwnd, 37)?;
    wait("heatmap keyboard selection", || {
        selected_segment(hwnd, "Daily")
    })?;
    press(hwnd, "Previous month")?;
    press(hwnd, "Next month")?;
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
