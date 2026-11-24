#[path = "pages/category_manager.rs"]
mod category_manager;
#[path = "../../../crates/test-support/children.rs"]
mod children;
#[path = "pages/classification_color.rs"]
mod classification_color;
#[path = "pages/classification_delete.rs"]
mod classification_delete;
#[path = "pages/classification_web.rs"]
mod classification_web;
#[path = "pages/data_range.rs"]
mod data_range;
#[path = "../../../crates/test-support/windows.rs"]
mod desktop;
#[path = "pages/foreground_resources.rs"]
mod foreground_resources;
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
#[path = "pages/window_scale.rs"]
mod window_scale;
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
fn select_list_option(option: &IUIAutomationElement) -> Result<(), Error> {
    unsafe {
        option
            .GetCurrentPatternAs::<IUIAutomationSelectionItemPattern>(UIA_SelectionItemPatternId)?
            .Select()?;
    }
    Ok(())
}
fn assert_control_height(
    hwnd: HWND,
    el: &IUIAutomationElement,
    expected: i32,
) -> Result<(), Error> {
    let bounds = unsafe { el.CurrentBoundingRectangle()? };
    let scale = unsafe { GetDpiForWindow(hwnd) } as f64 / 96.;
    let height = f64::from(bounds.bottom - bounds.top) / scale;
    assert!(
        (height - f64::from(expected)).abs() <= 1.,
        "{}: expected {expected} px, got {height} px",
        unsafe { el.CurrentName()? },
    );
    Ok(())
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
    let el = wait(label, || {
        segment(hwnd, label).filter(|option| unsafe {
            option.CurrentIsEnabled().is_ok_and(|value| value.as_bool())
        })
    })?;
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
    if keyboard {
        unsafe {
            el.SetFocus()?;
        }
        // UIA HasKeyboardFocus also requires host foreground focus, unavailable on
        // the non-input desktop. The caller observes this key's resulting state.
        return Ok(key(hwnd, 13)?);
    }
    reveal_control(hwnd, el, 20)?;
    let position = client_center(hwnd, el)?;
    unsafe {
        PostMessageW(Some(hwnd), WM_MOUSEMOVE, WPARAM(0), position)?;
        PostMessageW(Some(hwnd), WM_LBUTTONDOWN, WPARAM(1), position)?;
        PostMessageW(Some(hwnd), WM_LBUTTONUP, WPARAM(0), position)?;
    }
    Ok(())
}

fn reveal_control(hwnd: HWND, el: &IUIAutomationElement, bottom_inset: i32) -> Result<(), Error> {
    for attempt in 0..=16 {
        let r = unsafe { el.CurrentBoundingRectangle()? };
        let mut window = RECT::default();
        unsafe {
            GetWindowRect(hwnd, &mut window)?;
        }
        let center = (r.top + r.bottom) / 2;
        if r.bottom > r.top && center > window.top + 60 && center < window.bottom - bottom_inset {
            break;
        }
        if attempt == 16 {
            return Err(format!(
                "control remains outside viewport: control={r:?}, window={window:?}"
            )
            .into());
        }
        let direction = if center >= window.bottom - bottom_inset {
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
    Ok(())
}

fn reveal_language_selector(hwnd: HWND, language: &IUIAutomationElement) -> Result<(), Error> {
    reveal_control(
        hwnd,
        language,
        64 * unsafe { GetDpiForWindow(hwnd) } as i32 / 96,
    )
}
#[test]
#[ignore = "isolated Win32 desktop"]
fn sidebar_opens_empty_history() -> Result<(), Error> {
    if !patina_test_support::run_case()? {
        return Ok(());
    }
    let _com = ComApartment::init()?;
    unsafe { SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2) };
    let root = tempfile::tempdir()?;
    let profile = root.path().join(patina::PROFILE_DIRECTORY);
    fs::create_dir(&profile)?;
    let db = profile.join("patina.db");
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()?;
    rt.block_on(async {
        let pool = patina_activity::open_database(&db).await?;
        sqlx::query("INSERT OR REPLACE INTO settings(key,value) VALUES ('language','zh-CN'),('tracking_paused','1'),('show_tray_icon','0')")
            .execute(&pool).await?;
        pool.close().await;
        Ok::<_, Error>(())
    })?;
    let stderr = root.path().join("renderer.log");
    let mut host = TestChild(
        Command::new(env!("CARGO_BIN_EXE_patina"))
            .env("PATINA_PROFILE_PARENT", root.path())
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
        let labels = names(hwnd);
        (["时长", "起止", "高峰"]
            .into_iter()
            .all(|label| labels.iter().any(|n| n == label))
            && labels.iter().filter(|n| n.as_str() == "—").count() == 2)
            .then_some(())
    })
    .map_err(|e| format!("{e}: {}", fs::read_to_string(&stderr).unwrap_or_default()))?;
    click(hwnd, "今天")?;
    wait("returned to Today", || named(hwnd, "今日活动"))?;
    command(window(pid, w!("Patina Tray")).ok_or("missing tray")?, 2)?;
    assert!(wait("exit", || host.0.try_wait().ok().flatten())?.success());
    Ok(())
}

fn sample(dir: &Option<PathBuf>, pid: u32, name: &str) -> Result<(), Error> {
    if let Some(dir) = dir {
        let exe = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../target/debug/examples/windows-resource-sample.exe");
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
    if !patina_test_support::run_case()? {
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
    let profile = root.path().join(patina::PROFILE_DIRECTORY);
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
    let locale = patina_activity::Locale::from_tag(Some(tag));
    let stderr = root.path().join("renderer.log");
    let mut host = TestChild(
        Command::new(env!("CARGO_BIN_EXE_patina"))
            .env("PATINA_PROFILE_PARENT", root.path())
            .env_remove("PATINA_DEV_SESSION")
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
        navigate_sidebar(hwnd, locale, "settings.title")?;
        let language_name = patina_activity::text(locale, "settings.languageLabel");
        let language = wait("language selector", || {
            controls(hwnd).ok()?.into_iter().find(|el| unsafe {
                el.CurrentControlType().ok() == Some(UIA_ComboBoxControlTypeId)
                    && el.CurrentIsEnabled().is_ok_and(|enabled| enabled.as_bool())
                    && el.CurrentName().is_ok_and(|n| n == language_name.as_str())
            })
        })
        .map_err(|e| {
            format!(
                "{e}; expected {language_name:?}; Settings nodes {:?}",
                names(hwnd)
            )
        })?;
        reveal_language_selector(hwnd, &language)?;
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
        })
        .map_err(|e| {
            let bounds = unsafe { language.CurrentBoundingRectangle() };
            format!(
                "{e}; language control {bounds:?}; Settings nodes {:?}",
                names(hwnd)
            )
        })?;
        activate_control(hwnd, &option, false)?;
        let next_locale = patina_activity::Locale::from_tag(Some(next_tag));
        wait("language immediately previewed", || {
            named(hwnd, &patina_activity::text(next_locale, "settings.title"))
        })?;
        press(hwnd, &patina_activity::text(next_locale, "common.save"))?;
        wait("saved language applied", || {
            named(hwnd, &patina_activity::text(next_locale, "settings.title"))
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
                &patina_activity::text(next_locale, "settings.themeModeLabel"),
            )
        })?;
        command(window(pid, w!("Patina Tray")).ok_or("missing tray")?, 2)?;
        assert!(wait("exit", || host.0.try_wait().ok().flatten())?.success());
        Ok(())
    })();
    outcome.map_err(|e| format!("{e}\n{}", fs::read_to_string(stderr).unwrap_or_default()).into())
}

fn navigate_sidebar(hwnd: HWND, locale: patina_activity::Locale, key: &str) -> Result<(), Error> {
    let page = patina_activity::text(locale, key);
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
            (el.CurrentControlType().ok()? == UIA_ToolTipControlTypeId
                && el.CurrentAutomationId().ok()? == "history-hour-tooltip")
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
        let pressed = unsafe {
            toggle
                .GetCurrentPatternAs::<IUIAutomationTogglePattern>(UIA_TogglePatternId)?
                .CurrentToggleState()?
        };
        assert_eq!(
            pressed,
            if grouped {
                ToggleState_On
            } else {
                ToggleState_Off
            }
        );
        let hour = wait("history first active hour", || {
            controls(hwnd).ok()?.into_iter().find(|el| unsafe {
                el.CurrentName()
                    .is_ok_and(|s| s.to_string().starts_with("00:00 ･ Active "))
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
            tooltip().filter(|s| s.starts_with("00:00 ･ Active "))
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
        let icon_tip = wait("history icon hover tooltip", || {
            controls(hwnd).ok()?.into_iter().find(|el| unsafe {
                el.CurrentControlType().ok() == Some(UIA_ToolTipControlTypeId)
                    && el.CurrentName().is_ok_and(|name| name == mode)
            })
        })?;
        let (button_rect, tip_rect) = unsafe {
            (
                toggle.CurrentBoundingRectangle()?,
                icon_tip.CurrentBoundingRectangle()?,
            )
        };
        assert!(tip_rect.bottom <= button_rect.top);
        let button_center = (button_rect.left + button_rect.right) / 2;
        assert!(tip_rect.left <= button_center && button_center <= tip_rect.right);
        unsafe {
            hour.SetFocus()?;
        }
        wait("history hour focus tooltip", &tooltip)?;
        key(hwnd, 27)?;
        wait("history hour Escape", || tooltip().is_none().then_some(()))?;
        unsafe {
            toggle.SetFocus()?;
        }
        let empty = named(hwnd, "02:00 ･ Active 0s").ok_or("missing empty history hour")?;
        assert!(!unsafe { empty.CurrentIsKeyboardFocusable()? }.as_bool());
        activate_control(hwnd, &toggle, false)?;
    }
    let locale = patina_activity::Locale::EnUs;
    navigate_sidebar(hwnd, locale, "dashboard.title")?;
    let total_mode = wait("Today inherits total mode from History", || {
        button(hwnd, "Show by category")
    })?;
    activate_control(hwnd, &total_mode, false)?;
    navigate_sidebar(hwnd, locale, "history.title")?;
    let category_mode = wait("History inherits category mode from Today", || {
        button(hwnd, "Show total activity")
    })?;
    activate_control(hwnd, &category_mode, false)?;
    navigate_sidebar(hwnd, locale, "dashboard.title")?;
    wait("Today follows the change back to total in History", || {
        button(hwnd, "Show by category")
    })?;
    navigate_sidebar(hwnd, locale, "history.title")?;
    Ok(())
}

#[test]
#[ignore = "isolated Win32 desktop"]
fn history_navigation() -> Result<(), Error> {
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
        history_timeline::enable_web_history(&mut c).await?;
        sqlx::query("INSERT OR REPLACE INTO settings(key,value) VALUES ('min_session_secs','60')").execute(&mut c).await?;
        sqlx::query("INSERT INTO session_title_samples(session_id,title,start_time,end_time) SELECT id,'Design fixture',?,? FROM sessions WHERE exe_name='studio.exe'").bind(midnight).bind(midnight+120000).execute(&mut c).await?;
        sqlx::query("INSERT INTO sessions(exe_name,app_name,start_time,end_time,duration) VALUES('brief.exe','Brief',?,?,30000)").bind(midnight+71*60000).bind(midnight+71*60000+30000).execute(&mut c).await?;
        Ok::<_,Error>(())
    })?;
    let mut child = TestChild(
        Command::new(env!("CARGO_BIN_EXE_patina"))
            .env("PATINA_PROFILE_PARENT", root.path())
            .arg("--today")
            .spawn()?,
    );
    let pid = child.0.id();
    let hwnd = wait("Today", || children::find(pid, |p| window(p, w!("Patina"))))?;
    let tray = wait("tray", || window(pid, w!("Patina Tray")))?;
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
    let segment = wait("timeline segment", || {
        controls(hwnd)
            .ok()?
            .into_iter()
            .filter(|el| unsafe {
                el.CurrentAutomationId()
                    .is_ok_and(|id| id.to_string().starts_with("overview-segment-"))
            })
            .max_by_key(|el| unsafe {
                el.CurrentBoundingRectangle()
                    .map_or(0, |rect| rect.right - rect.left)
            })
    })?;
    unsafe {
        PostMessageW(
            Some(hwnd),
            WM_MOUSEMOVE,
            WPARAM(0),
            client_center(hwnd, &segment)?,
        )?;
    }
    let tip = wait("timeline segment tooltip above", || {
        controls(hwnd)
            .ok()?
            .into_iter()
            .find(|el| unsafe { el.CurrentControlType().ok() == Some(UIA_ToolTipControlTypeId) })
    })?;
    assert_eq!(
        unsafe { tip.CurrentName()?.to_string() },
        "Studio ･ 00:00:00–00:45:00 ･ 45m"
    );
    let (segment_rect, tip_rect) = unsafe {
        (
            segment.CurrentBoundingRectangle()?,
            tip.CurrentBoundingRectangle()?,
        )
    };
    assert!(tip_rect.bottom <= segment_rect.top);
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
    wait("short fragment visible", || named(hwnd, "Brief ･ 30s"))?;
    click(hwnd, "Increase display minutes by 1 minute")?;
    wait("only short fragment hidden", || {
        named(hwnd, "Brief ･ 30s").is_none().then_some(())
    })?;
    key(hwnd, 27)?;
    history_timeline::open_icon_details(hwnd, "Studio")?;
    history_timeline::check_app_detail(hwnd)?;
    press(hwnd, "Title details ･ Studio")?;
    wait("recorded title", || {
        includes("Design fixture").then_some(())
    })?;
    key(hwnd, 27)?;
    click(hwnd, "Previous day")?;
    wait("detail yesterday", || named(hwnd, &previous))?;
    assert!(!includes("Design fixture"));
    click(hwnd, "Close")?;
    wait("detail closed on the original history date", || {
        (button(hwnd, "Close").is_none() && named(hwnd, &date).is_some()).then_some(())
    })?;
    sample(&out, pid, "history")?;
    for _ in 0..5 {
        navigate_sidebar(hwnd, patina_activity::Locale::EnUs, "dashboard.title")?;
        wait("today ranking", || named(hwnd, "Top Apps"))?;
        click(hwnd, "History")?;
        wait("history loaded", || named(hwnd, &date))?;
    }
    navigate_sidebar(hwnd, patina_activity::Locale::EnUs, "dashboard.title")?;
    wait("today ranking", || named(hwnd, "Top Apps"))?;
    wait("sub-minute ranked duration", || named(hwnd, "30s ･ 1%"))?;
    let studio = wait("ranked app", || button(hwnd, "View details for Studio"))?;
    let open: IUIAutomationInvokePattern =
        unsafe { studio.GetCurrentPatternAs(UIA_InvokePatternId)? };
    unsafe {
        open.Invoke()?;
    }
    wait("detail remembers zoom", || named(hwnd, "23.0 h"))?;
    history_timeline::pan_to_start(hwnd, "detail-timeline-track")?;
    wait("restored detail starts at midnight", || {
        named(hwnd, "00:00 – 23:00")
    })?;
    press(hwnd, "Title details ･ Studio")?;
    wait("same detail from Today", || {
        includes("Design fixture").then_some(())
    })?;
    key(hwnd, 27)?;
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
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()?
        .block_on(async {
            let mut conn =
                SqliteConnection::connect_with(&SqliteConnectOptions::new().filename(db)).await?;
            history_timeline::enable_web_history(&mut conn).await
        })?;
    let mut host = TestChild(
        Command::new(env!("CARGO_BIN_EXE_patina"))
            .env("PATINA_PROFILE_PARENT", root.path())
            .arg("--today")
            .spawn()?,
    );
    let pid = host.0.id();
    let hwnd = wait("Today", || children::find(pid, |p| window(p, w!("Patina"))))?;
    press(hwnd, "Data")?;
    let total = wait("seven day cross-midnight total", || {
        named(hwnd, "Total ･ 1h 40m")
    })?;
    let by_id = |id: &str| {
        controls(hwnd)
            .ok()?
            .into_iter()
            .find(|el| unsafe { el.CurrentAutomationId().is_ok_and(|value| value == id) })
    };
    let average = wait("seven day average", || named(hwnd, "Daily avg. ･ 14m"))?;
    let overview_chart = wait("overview chart", || by_id("overview-trend"))?;
    let total = unsafe { total.CurrentBoundingRectangle()? };
    let average = unsafe { average.CurrentBoundingRectangle()? };
    let chart = unsafe { overview_chart.CurrentBoundingRectangle()? };
    assert!(total.right < average.left);
    assert!(
        (total.left + average.right - chart.left - chart.right).abs() <= 2,
        "trend metrics must be centered above the chart: {total:?}, {average:?}, {chart:?}"
    );
    assert!(selected_segment(hwnd, "Overview").is_some());
    assert!(
        button(hwnd, "Studio").is_none(),
        "details must not be exposed in Overview"
    );
    trend_chart::check(hwnd)?;
    select_segment(hwnd, "Details")?;
    assert!(
        named(hwnd, "Total ･ 1h 40m").is_none(),
        "overview must be hidden"
    );
    press(hwnd, "Studio")?;
    wait("selected app total", || named(hwnd, "Total ･ 1h 15m"))
        .map_err(|e| format!("{e}; {:?}", names(hwnd)))?;
    wait("trend metrics", || named(hwnd, "Active days ･ 2"))?;
    let list = unsafe {
        wait("trend object list", || by_id("trend-objects"))?.CurrentBoundingRectangle()?
    };
    let chart =
        unsafe { wait("trend plot", || by_id("selection-trend"))?.CurrentBoundingRectangle()? };
    assert!(chart.right < list.left && list.right - list.left < chart.right - chart.left);
    let range = unsafe {
        wait("app trend range", || named(hwnd, "Select app trend range"))?
            .CurrentBoundingRectangle()?
    };
    let search =
        unsafe { wait("trend search", || named(hwnd, "Search apps"))?.CurrentBoundingRectangle()? };
    assert!(
        (range.right - chart.right).abs() <= 1 && range.bottom <= chart.top,
        "date range should align with the chart's right edge: {range:?}, {chart:?}"
    );
    assert!(
        search.left >= list.left
            && search.top < range.bottom
            && search.bottom > range.top
            && search.bottom <= list.top,
        "search should share the header row above the list: {search:?}, {range:?}, {list:?}"
    );
    press(hwnd, "Writer")?;
    wait("single selection replaces Studio", || {
        named(hwnd, "Total ･ 20m")
    })?;
    press(hwnd, "Studio")?;
    let search = wait("trend search", || named(hwnd, "Search apps"))?;
    let edit: IUIAutomationValuePattern =
        unsafe { search.GetCurrentPatternAs(UIA_ValuePatternId)? };
    unsafe {
        edit.SetValue(&windows::core::BSTR::from("no-such-app"))?;
    }
    wait("no matching apps", || named(hwnd, "No matching apps"))?;
    assert!(named(hwnd, "Total ･ 1h 15m").is_some());
    select_segment(hwnd, "Overview")?;
    assert!(named(hwnd, "Search apps").is_none());
    select_segment(hwnd, "Details")?;
    wait("retained search", || named(hwnd, "No matching apps"))?;
    assert!(named(hwnd, "Total ･ 1h 15m").is_some());
    let search = wait("retained search input", || named(hwnd, "Search apps"))?;
    let edit: IUIAutomationValuePattern =
        unsafe { search.GetCurrentPatternAs(UIA_ValuePatternId)? };
    unsafe {
        edit.SetValue(&windows::core::BSTR::from(""))?;
    }
    wait("cleared search", || button(hwnd, "Studio"))?;
    select_segment(hwnd, "Overview")?;
    activate_control(
        hwnd,
        &data_range::range_button(hwnd, "Select trend range", "Expand trend range")
            .ok_or("overview range")?,
        true,
    )?;
    wait("expanded trend loaded", || {
        named(
            hwnd,
            &format!("{} ･ 0s", Local::now().date_naive() - chrono::Days::new(29)),
        )
    })?;
    select_segment(hwnd, "Details")?;
    wait("changed range preserves app", || {
        named(hwnd, "Total ･ 1h 15m")
    })?;
    select_segment(hwnd, "Categories")?;
    press(hwnd, "Office")?;
    wait("category total", || named(hwnd, "Total ･ 20m"))?;
    select_segment(hwnd, "Web")?;
    wait("empty websites", || named(hwnd, "Total ･ 0s"))?;
    select_segment(hwnd, "Apps")?;
    press(hwnd, "Studio")?;
    history_timeline::open_icon_details(hwnd, "Studio")?;
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
    wait("restored selection", || named(hwnd, "Total ･ 1h 15m"))?;
    select_segment(hwnd, "Overview")?;
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
    select_segment(hwnd, "Details")?;
    let yesterday = Local::now().date_naive() - chrono::Days::new(1);
    let heat = wait("detailed heatmap date", || {
        button(hwnd, &yesterday.to_string())
    })?;
    trend_chart::double_click_day(hwnd, &heat, yesterday)?;
    press(hwnd, "Data")?;
    select_segment(hwnd, "Details")?;
    let column = wait("selected app trend date", || {
        controls(hwnd).ok()?.into_iter().find(|el| unsafe {
            el.CurrentAutomationId()
                .is_ok_and(|id| id == format!("selection-trend-{yesterday}"))
        })
    })?;
    trend_chart::double_click_day(hwnd, &column, yesterday)?;
    let tray = window(pid, w!("Patina Tray")).unwrap();
    command(tray, 2)?;
    assert!(wait("exit", || host.0.try_wait().ok().flatten())?.success());
    Ok(())
}

#[test]
#[ignore = "isolated Win32 desktop"]
fn classification_navigation() -> Result<(), Error> {
    if !patina_test_support::run_case()? {
        return Ok(());
    }
    let _com = ComApartment::init()?;
    unsafe { SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2) };
    let root = tempfile::tempdir()?;
    let dir = root.path().join(patina::PROFILE_DIRECTORY);
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
        sqlx::query("INSERT INTO icon_cache(exe_name,icon_base64,last_updated) VALUES ('STUDIO.EXE',?,1)")
            .bind("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEUlEQVR4nGNQSDjwH4QZYAwASvQI/dnllI8AAAAASUVORK5CYII=")
            .execute(&mut conn).await?;
        Ok::<_, Error>(())
    })?;
    let stderr = root.path().join("classification.log");
    let mut host = TestChild(
        Command::new(env!("CARGO_BIN_EXE_patina"))
            .env("PATINA_PROFILE_PARENT", root.path())
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
            .filter(|n| n.as_str() == "Category ･ Studio")
            .count()
            == 1)
            .then_some(())
    })
    .map_err(|e| format!("{e}: {}", fs::read_to_string(&stderr).unwrap_or_default()))?;
    let classification_counts = || classification_filter_counts(hwnd);
    let initial_counts = wait("classification totals displayed", classification_counts)?;
    assert_eq!(initial_counts[0], initial_counts[1] + initial_counts[2]);
    assert_eq!(
        initial_counts[0],
        names(hwnd)
            .iter()
            .filter(|name| name.starts_with("Category ･ "))
            .count()
    );
    let app_image = |name: &str| {
        controls(hwnd).ok()?.into_iter().find(|el| unsafe {
            el.CurrentControlType().ok() == Some(UIA_ImageControlTypeId)
                && el.CurrentName().is_ok_and(|n| n == name)
        })
    };
    let image = wait("cached application icon", || app_image("Studio")).map_err(|e| {
        format!(
            "{e}; nodes {:?}; renderer: {}",
            names(hwnd),
            fs::read_to_string(&stderr).unwrap_or_default()
        )
    })?;
    let rect = unsafe { image.CurrentBoundingRectangle()? };
    assert!(rect.right > rect.left && rect.bottom > rect.top);
    let category_control = |name: &str| {
        controls(hwnd).ok()?.into_iter().find(|el| unsafe {
            el.CurrentControlType().ok() == Some(UIA_ComboBoxControlTypeId)
                && el.CurrentName().is_ok_and(|n| n == name)
        })
    };
    let category_option = |name: &str| {
        controls(hwnd).ok()?.into_iter().find(|el| unsafe {
            el.CurrentControlType().ok() == Some(UIA_ListItemControlTypeId)
                && el.CurrentName().is_ok_and(|n| n == name)
        })
    };
    let search = wait("application search input", || {
        controls(hwnd).ok()?.into_iter().find(|el| unsafe {
            el.CurrentControlType().ok() == Some(UIA_EditControlTypeId)
                && el.CurrentName().is_ok_and(|name| name == "Search apps")
        })
    })?;
    let search_value: IUIAutomationValuePattern =
        unsafe { search.GetCurrentPatternAs(UIA_ValuePatternId)? };
    let other_app = names(hwnd)
        .into_iter()
        .find(|name| name.starts_with("Category ･ ") && name != "Category ･ Studio")
        .ok_or("fixture needs an app besides Studio")?;
    unsafe {
        search.SetFocus()?;
        search_value.SetValue(&"Studio".into())?;
    }
    wait("search filters application cards", || {
        (category_control("Category ･ Studio").is_some() && category_control(&other_app).is_none())
            .then_some(())
    })?;
    assert_eq!(classification_counts(), Some(initial_counts));
    click(hwnd, "Clear search")?;
    wait("clear restores application cards", || unsafe {
        (search_value.CurrentValue().ok()?.is_empty() && category_control(&other_app).is_some())
            .then_some(())
    })?;
    unsafe { PostMessageW(Some(hwnd), WM_CHAR, WPARAM('s' as usize), LPARAM(1))? };
    wait("typing resumes after clear without refocusing", || unsafe {
        (search_value.CurrentValue().ok()? == "s").then_some(())
    })?;
    click(hwnd, "Clear search")?;
    wait("second clear restores cards", || unsafe {
        (search_value.CurrentValue().ok()?.is_empty() && category_control(&other_app).is_some())
            .then_some(())
    })?;
    let outside = LPARAM(client_center(hwnd, &search)?.0 - (48 << 16));
    unsafe {
        PostMessageW(Some(hwnd), WM_LBUTTONDOWN, WPARAM(1), outside)?;
        PostMessageW(Some(hwnd), WM_LBUTTONUP, WPARAM(0), outside)?;
        // GPUI updates the native text-input handler when the focus change is painted.
        PostMessageW(Some(hwnd), WM_PAINT, WPARAM(0), LPARAM(0))?;
        PostMessageW(Some(hwnd), WM_CHAR, WPARAM('x' as usize), LPARAM(1))?;
    }
    activate_control(hwnd, &search, false)?;
    unsafe {
        PostMessageW(Some(hwnd), WM_PAINT, WPARAM(0), LPARAM(0))?;
        PostMessageW(Some(hwnd), WM_CHAR, WPARAM('s' as usize), LPARAM(1))?;
    }
    wait(
        "outside click blurs search and clicking inside resumes input",
        || unsafe { (search_value.CurrentValue().ok()? == "s").then_some(()) },
    )
    .map_err(|e| {
        format!("{e}; search value {:?}", unsafe {
            search_value.CurrentValue()
        })
    })?;
    click(hwnd, "Clear search")?;
    wait("search restored after blur check", || {
        category_control(&other_app)
    })?;
    let category = wait("application category dropdown", || {
        category_control("Category ･ Studio")
    })?;
    assert_control_height(hwnd, &category, 28)?;
    for (label, height) in [("Cancel", 32), ("Save", 32), ("Manage", 28)] {
        assert_control_height(hwnd, &wait(label, || button(hwnd, label))?, height)?;
    }
    activate_control(hwnd, &category, true)?;
    wait("category options open", || category_option("Office"))?;
    assert!(
        button(hwnd, "Apply").is_none(),
        "classification must not open the rule editor"
    );
    key(hwnd, 0x1b)?;
    wait("Escape dismisses category options", || {
        category_option("Office").is_none().then_some(())
    })?;
    assert!(!unsafe { button(hwnd, "Save").unwrap().CurrentIsEnabled()? }.as_bool());
    activate_control(hwnd, &category, false)?;
    let office = wait("Office option", || category_option("Office"))?;
    activate_control(hwnd, &office, false)?;
    wait("category selected without a dialog", || {
        (category_option("Office").is_none()
            && button(hwnd, "Apply").is_none()
            && unsafe { button(hwnd, "Cancel")?.CurrentIsEnabled().ok()?.as_bool() })
        .then_some(())
    })?;
    wait("category draft updates totals", || {
        (classification_counts() == Some(initial_counts)).then_some(())
    })?;
    let toast = wait("classification unsaved toast", || {
        named(hwnd, "Unsaved changes")
    })?;
    let toast_bounds = unsafe { toast.CurrentBoundingRectangle()? };
    let mut window_bounds = RECT::default();
    unsafe { GetWindowRect(hwnd, &mut window_bounds)? };
    let scale = unsafe { GetDpiForWindow(hwnd) } as f32 / 96.;
    assert!((toast_bounds.top - window_bounds.top) as f32 <= 64. * scale);
    assert!((window_bounds.right - toast_bounds.right) as f32 <= 24. * scale);
    click(hwnd, "Cancel")?;
    wait("category draft cancelled", || unsafe {
        (!button(hwnd, "Cancel")?.CurrentIsEnabled().ok()?.as_bool()).then_some(())
    })?;
    wait("cancel restores classification totals", || {
        (classification_counts() == Some(initial_counts)).then_some(())
    })?;
    wait("cancel removes unsaved toast", || {
        named(hwnd, "Unsaved changes").is_none().then_some(())
    })?;
    activate_control(hwnd, &category, true)?;
    let office = wait("Office after cancel", || category_option("Office"))?;
    assert!(
        !unsafe {
            office
                .GetCurrentPatternAs::<IUIAutomationSelectionItemPattern>(
                    UIA_SelectionItemPatternId,
                )?
                .CurrentIsSelected()?
        }
        .as_bool()
    );
    select_list_option(&office)?;
    wait("category menu closed", || {
        category_option("Office").is_none().then_some(())
    })?;
    unsafe {
        search_value.SetValue(&"Studio".into())?;
    }
    wait("Studio isolated for rename", || {
        category_control(&other_app).is_none().then_some(())
    })?;
    click(hwnd, "Edit app name")?;
    let field = wait("rename input", || {
        controls(hwnd).ok()?.into_iter().find(|el| unsafe {
            el.CurrentControlType().ok() == Some(UIA_EditControlTypeId)
                && el.CurrentName().is_ok_and(|s| s == "Edit app name")
        })
    })?;
    let input: IUIAutomationValuePattern =
        unsafe { field.GetCurrentPatternAs(UIA_ValuePatternId)? };
    assert!(button(hwnd, "Apply").is_none(), "rename must remain inline");
    assert!(!controls(hwnd)?.iter().any(|el| unsafe {
        el.CurrentControlType().ok() == Some(UIA_WindowControlTypeId)
            && el.CurrentName().is_ok_and(|n| n == "Edit app name")
    }));
    let name_bounds = unsafe { field.CurrentBoundingRectangle()? };
    let pencil_bounds = unsafe {
        button(hwnd, "Edit app name")
            .unwrap()
            .CurrentBoundingRectangle()?
    };
    assert!(
        name_bounds.right <= pencil_bounds.left
            && name_bounds.bottom > pencil_bounds.top
            && name_bounds.top < pencil_bounds.bottom,
        "name input stays beside its pencil"
    );
    unsafe {
        input.SetValue(&"Discard this name".into())?;
    }
    key(hwnd, 0x1b)?;
    let rename_field = || {
        controls(hwnd).ok()?.into_iter().find(|el| unsafe {
            el.CurrentControlType().ok() == Some(UIA_EditControlTypeId)
                && el.CurrentName().is_ok_and(|s| s == "Edit app name")
        })
    };
    wait("Escape discards only the name edit", || {
        (rename_field().is_none() && category_control("Category ･ Studio").is_some()).then_some(())
    })?;
    key(hwnd, 13)?;
    let field = wait("Enter on restored pencil reopens name input", rename_field)?;
    let input: IUIAutomationValuePattern =
        unsafe { field.GetCurrentPatternAs(UIA_ValuePatternId)? };
    unsafe {
        input.SetValue(&"  Studio Review  ".into())?;
    }
    key(hwnd, 13)?;
    wait("renamed draft applied", || {
        category_control("Category ･ Studio Review")
    })?;
    click(hwnd, "Edit app name")?;
    let field = wait("name input for blur", rename_field)?;
    unsafe {
        field
            .GetCurrentPatternAs::<IUIAutomationValuePattern>(UIA_ValuePatternId)?
            .SetValue(&"Studio Temporary".into())?;
    }
    activate_control(hwnd, &search, false)?;
    wait("blur applies only the name", || {
        (rename_field().is_none() && category_control("Category ･ Studio Temporary").is_some())
            .then_some(())
    })?;
    click(hwnd, "Edit app name")?;
    let field = wait("name input before outside click", rename_field)?;
    unsafe {
        field
            .GetCurrentPatternAs::<IUIAutomationValuePattern>(UIA_ValuePatternId)?
            .SetValue(&"Studio Outside".into())?;
    }
    let filename = wait("application identity trigger", || named(hwnd, "studio.exe"))?;
    activate_control(hwnd, &filename, false)?;
    wait("clicking identity commits and closes rename", || {
        (rename_field().is_none() && category_control("Category ･ Studio Outside").is_some())
            .then_some(())
    })?;
    wait("identity opens application links", || {
        button(hwnd, "Add application")
    })?;
    key(hwnd, 0x1b)?;
    click(hwnd, "Edit app name")?;
    let field = wait("name input before card action", rename_field)?;
    unsafe {
        field
            .GetCurrentPatternAs::<IUIAutomationValuePattern>(UIA_ValuePatternId)?
            .SetValue(&"Studio Card Action".into())?;
    }
    let titles = wait("title recording control", || named(hwnd, "Record titles"))?;
    let title_state = || unsafe {
        named(hwnd, "Record titles")?
            .GetCurrentPatternAs::<IUIAutomationTogglePattern>(UIA_TogglePatternId)
            .ok()?
            .CurrentToggleState()
            .ok()
    };
    let original_titles = title_state().ok_or("title state")?;
    unsafe {
        PostMessageW(
            Some(hwnd),
            WM_MOUSEMOVE,
            WPARAM(0),
            client_center(hwnd, &titles)?,
        )?;
    }
    let title_tip = wait("classification policy tooltip", || {
        controls(hwnd).ok()?.into_iter().find(|el| unsafe {
            el.CurrentControlType().ok() == Some(UIA_ToolTipControlTypeId)
                && el.CurrentName().is_ok_and(|name| name == "Record titles")
        })
    })?;
    assert!(unsafe {
        title_tip.CurrentBoundingRectangle()?.bottom <= titles.CurrentBoundingRectangle()?.top
    });
    activate_control(hwnd, &titles, false)?;
    wait("outside card action retains committed name", || {
        (rename_field().is_none()
            && category_control("Category ･ Studio Card Action").is_some()
            && title_state().is_some_and(|state| state != original_titles))
        .then_some(())
    })?;
    activate_control(hwnd, &titles, false)?;
    wait("restore title recording", || {
        (title_state() == Some(original_titles)).then_some(())
    })?;
    click(hwnd, "Edit app name")?;
    let field = wait("name input reopened after blur", rename_field)?;
    unsafe {
        field
            .GetCurrentPatternAs::<IUIAutomationValuePattern>(UIA_ValuePatternId)?
            .SetValue(&"Studio Review".into())?;
    }
    key(hwnd, 13)?;
    wait("final name draft", || {
        category_control("Category ･ Studio Review")
    })?;
    click(hwnd, "Clear search")?;
    press(hwnd, "Save")?;
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
        category_control("Category ･ Studio Review")
    })?;
    wait("icon survives rename and page reload", || {
        app_image("Studio Review")
    })?;
    let category_filter = wait("category filter dropdown", || {
        controls(hwnd).ok()?.into_iter().find(|el| unsafe {
            el.CurrentControlType().ok() == Some(UIA_ComboBoxControlTypeId)
                && el
                    .CurrentName()
                    .is_ok_and(|name| name == "Filter by category")
        })
    })?;
    let card_count = || {
        names(hwnd)
            .iter()
            .filter(|n| n.starts_with("Category ･ "))
            .count()
    };
    let all_card_count = card_count();
    activate_control(hwnd, &category_filter, false)?;
    let office = wait("Office filter option", || category_option("Office"))?;
    select_list_option(&office)?;
    wait("category dropdown filters applications", || {
        (category_control("Category ･ Studio Review").is_some()
            && card_count() < all_card_count
            && category_option("Office").is_none())
        .then_some(())
    })?;
    activate_control(hwnd, &category_filter, true)?;
    let office = wait("selected Office option", || category_option("Office"))?;
    assert!(unsafe {
        office
            .GetCurrentPatternAs::<IUIAutomationSelectionItemPattern>(UIA_SelectionItemPatternId)?
            .CurrentIsSelected()?
            .as_bool()
    });
    key(hwnd, 0x1b)?;
    wait("Escape closes category menu", || {
        category_option("Office").is_none().then_some(())
    })?;
    activate_control(hwnd, &category_filter, true)?;
    wait("category menu reopened", || category_option("All"))?;
    key(hwnd, 0x24)?;
    key(hwnd, 13)?;
    wait("keyboard restores all categories", || {
        (card_count() == all_card_count).then_some(())
    })?;
    let segment = |name: &str| {
        controls(hwnd).ok()?.into_iter().find(|el| unsafe {
            el.CurrentControlType().ok() == Some(UIA_RadioButtonControlTypeId)
                && el.CurrentName().is_ok_and(|n| n == name)
        })
    };
    let anonymous = wait("anonymous filter icon", || segment("Track anonymously"))?;
    activate_control(hwnd, &anonymous, false)?;
    wait("anonymous filter excludes the tracked app", || unsafe {
        let selection = anonymous
            .GetCurrentPatternAs::<IUIAutomationSelectionItemPattern>(UIA_SelectionItemPatternId)
            .ok()?;
        (selection.CurrentIsSelected().ok()?.as_bool()
            && category_control("Category ･ Studio Review").is_none())
        .then_some(())
    })?;
    let unclassified = wait("Unclassified segment", || {
        segment(&format!("Unclassified ({})", classification_counts()?[2]))
    })?;
    activate_control(hwnd, &unclassified, false)?;
    wait("unclassified filter hides the Office app", || unsafe {
        let selection = unclassified
            .GetCurrentPatternAs::<IUIAutomationSelectionItemPattern>(UIA_SelectionItemPatternId)
            .ok()?;
        (selection.CurrentIsSelected().ok()?.as_bool()
            && category_control("Category ･ Studio Review").is_none())
        .then_some(())
    })?;
    unsafe { unclassified.SetFocus()? };
    key(hwnd, 0x25)?;
    wait(
        "Left selects Classified and restores the Office app",
        || category_control("Category ･ Studio Review"),
    )?;
    click(hwnd, "Manage")?;
    click(hwnd, "New category")?;
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
    wait("category editor closed", || {
        button(hwnd, "Apply").is_none().then_some(())
    })?;
    click(hwnd, "Close")?;
    press(hwnd, "Save")?;
    let category = wait("renamed app category ready after save", || {
        named(hwnd, "Saved")?;
        category_control("Category ･ Studio Review")
            .filter(|el| unsafe { el.CurrentIsEnabled().is_ok_and(|v| v.as_bool()) })
    })?;
    activate_control(hwnd, &category, true)
        .map_err(|e| format!("open category after save: {e}"))?;
    let research = wait("custom category option", || category_option("Research"))?;
    select_list_option(&research)?;
    wait("custom category assigned", || {
        category_option("Research").is_none().then_some(())
    })?;
    click(hwnd, "Save")?;
    wait("assigned new category", || {
        button(hwnd, "Save").filter(|b| unsafe { b.CurrentIsEnabled().is_ok_and(|v| !v.as_bool()) })
    })?;
    let before = rt.block_on(async {
        let mut conn =
            SqliteConnection::connect_with(&SqliteConnectOptions::new().filename(&db)).await?;
        let raw: String =
            sqlx::query_scalar("SELECT value FROM settings WHERE key='__app_override::studio.exe'")
                .fetch_one(&mut conn)
                .await?;
        Ok::<_, Error>(serde_json::from_str::<serde_json::Value>(&raw)?)
    })?;
    let search = wait("search before final rename", || {
        controls(hwnd).ok()?.into_iter().find(|el| unsafe {
            el.CurrentControlType().ok() == Some(UIA_EditControlTypeId)
                && el.CurrentName().is_ok_and(|n| n == "Search apps")
        })
    })?;
    unsafe {
        search
            .GetCurrentPatternAs::<IUIAutomationValuePattern>(UIA_ValuePatternId)?
            .SetValue(&"Studio".into())?;
    }
    wait("one application before final rename", || {
        (names(hwnd)
            .iter()
            .filter(|n| n.starts_with("Category ･ "))
            .count()
            == 1)
            .then_some(())
    })?;
    click(hwnd, "Edit app name")?;
    let field = wait("final inline editor", rename_field)?;
    unsafe {
        field
            .GetCurrentPatternAs::<IUIAutomationValuePattern>(UIA_ValuePatternId)?
            .SetValue(&"Studio Cancelled".into())?;
    }
    click(hwnd, "Cancel")?;
    wait("page Cancel discards inline draft", || {
        (rename_field().is_none() && category_control("Category ･ Studio Review").is_some())
            .then_some(())
    })?;
    click(hwnd, "Edit app name")?;
    let field = wait("inline editor for direct save", rename_field)?;
    unsafe {
        field
            .GetCurrentPatternAs::<IUIAutomationValuePattern>(UIA_ValuePatternId)?
            .SetValue(&"Studio 新名称".into())?;
    }
    press(hwnd, "Save")?;
    wait(
        "direct Save persists inline name without other changes",
        || {
            rt.block_on(async {
                let mut conn =
                    SqliteConnection::connect_with(&SqliteConnectOptions::new().filename(&db))
                        .await
                        .ok()?;
                let raw: String = sqlx::query_scalar(
                    "SELECT value FROM settings WHERE key='__app_override::studio.exe'",
                )
                .fetch_one(&mut conn)
                .await
                .ok()?;
                let after: serde_json::Value = serde_json::from_str(&raw).ok()?;
                (after["displayName"] == "Studio 新名称"
                    && ["category", "color", "track", "captureTitle"]
                        .iter()
                        .all(|key| after[key] == before[key]))
                .then_some(())
            })
        },
    )?;
    command(window(pid, w!("Patina Tray")).unwrap(), 2)?;
    assert!(wait("exit", || host.0.try_wait().ok().flatten())?.success());
    Ok(())
}

#[test]
#[ignore = "isolated Win32 desktop"]
fn classification_totals() -> Result<(), Error> {
    if !patina_test_support::run_case()? {
        return Ok(());
    }
    let _com = ComApartment::init()?;
    unsafe { SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2) };
    let root = tempfile::tempdir()?;
    let dir = root.path().join(patina::PROFILE_DIRECTORY);
    fs::create_dir(&dir)?;
    seed(&dir.join("patina.db"))?;
    let mut host = TestChild(
        Command::new(env!("CARGO_BIN_EXE_patina"))
            .env("PATINA_PROFILE_PARENT", root.path())
            .env_remove("PATINA_DEV_SESSION")
            .arg("--today")
            .spawn()?,
    );
    let pid = host.0.id();
    let hwnd = wait("Today", || children::find(pid, |p| window(p, w!("Patina"))))?;
    click(hwnd, "Classification")?;
    let totals = |expected| -> Result<(), Error> {
        wait("classification counts match current records", || {
            (classification_filter_counts(hwnd) == Some(expected)).then_some(())
        })
        .map_err(|err| {
            format!(
                "{err}: expected {expected:?}, observed {:?}",
                classification_filter_counts(hwnd)
            )
        })?;
        Ok(())
    };
    totals([2, 2, 0])?;
    classification_color::set(hwnd, "Search apps", "Studio")?;
    totals([2, 2, 0])?;
    let unclassify = || -> Result<(), Error> {
        let category = wait("Studio category", || named(hwnd, "Category ･ Studio"))?;
        activate_control(hwnd, &category, false)?;
        let option = wait("Unclassified option", || {
            controls(hwnd).ok()?.into_iter().find(|el| unsafe {
                el.CurrentControlType().ok() == Some(UIA_ListItemControlTypeId)
                    && el.CurrentName().is_ok_and(|name| name == "Unclassified")
            })
        })?;
        select_list_option(&option)?;
        totals([2, 1, 1])
    };
    unclassify()?;
    click(hwnd, "Cancel")?;
    totals([2, 2, 0])?;
    unclassify()?;
    click(hwnd, "Save")?;
    wait("classification saved", || unsafe {
        (!button(hwnd, "Save")?.CurrentIsEnabled().ok()?.as_bool()).then_some(())
    })?;
    totals([2, 1, 1])?;
    select_segment(hwnd, "Unclassified (1)")?;
    wait("unclassified application shown", || {
        named(hwnd, "Category ･ Studio")
    })?;
    click(hwnd, "Delete application")?;
    wait("deletion confirmation ready", || {
        named(hwnd, "Studio ･ studio.exe")?;
        button(hwnd, "Delete application")
            .filter(|b| unsafe { b.CurrentIsEnabled().is_ok_and(|v| v.as_bool()) })
    })?;
    click(hwnd, "Delete application")?;
    totals([1, 1, 0])?;
    command(window(pid, w!("Patina Tray")).ok_or("missing host")?, 2)?;
    assert!(wait("exit", || host.0.try_wait().ok().flatten())?.success());
    Ok(())
}

#[test]
#[ignore = "isolated Win32 desktop"]
fn settings_navigation() -> Result<(), Error> {
    if !patina_test_support::run_case()? {
        return Ok(());
    }
    let _com = ComApartment::init()?;
    unsafe { SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2) };
    let root = tempfile::tempdir()?;
    let dir = root.path().join(patina::PROFILE_DIRECTORY);
    fs::create_dir(&dir)?;
    let path = dir.join("patina.db");
    seed(&path)?;
    let mut host = TestChild(
        Command::new(env!("CARGO_BIN_EXE_patina"))
            .env("PATINA_PROFILE_PARENT", root.path())
            .arg("--today")
            .spawn()?,
    );
    let pid = host.0.id();
    let hwnd = wait("Today", || children::find(pid, |p| window(p, w!("Patina"))))?;
    click(hwnd, "Settings")?;
    let titles = wait("Global titles switch", || button(hwnd, "Global titles"))?;
    unsafe {
        let bounds = titles.CurrentBoundingRectangle()?;
        let dpi = GetDpiForWindow(hwnd) as i32;
        let heading = wait("Recording options heading", || {
            named(hwnd, "Recording options")
        })?
        .CurrentBoundingRectangle()?;
        let previous = wait("last time-rule control", || {
            button(hwnd, "+ Continue counting")
        })?
        .CurrentBoundingRectangle()?;
        let first = wait("first time-rule control", || {
            button(hwnd, "+ Activity hold time")
        })?
        .CurrentBoundingRectangle()?;
        assert!(((previous.top - first.top) as f32 - 48. * dpi as f32 / 96.).abs() <= 1.);
        let row_half_height = 24. * dpi as f32 / 96.;
        let group_gap =
            heading.top as f32 - (previous.top + previous.bottom) as f32 / 2. - row_half_height;
        let heading_gap =
            (bounds.top + bounds.bottom) as f32 / 2. - row_half_height - heading.bottom as f32;
        assert!(
            (group_gap - 12. * dpi as f32 / 96.).abs() <= 1.,
            "between settings groups: {group_gap}"
        );
        assert!(
            (heading_gap - 8. * dpi as f32 / 96.).abs() <= 1.,
            "heading to settings row: {heading_gap}"
        );
        let width = (36 * dpi + 48) / 96;
        let height = (28 * dpi + 48) / 96;
        assert!((bounds.right - bounds.left - width).abs() <= 1);
        assert!((bounds.bottom - bounds.top - height).abs() <= 1);
        let state =
            titles.GetCurrentPatternAs::<IUIAutomationTogglePattern>(UIA_TogglePatternId)?;
        let initial = state.CurrentToggleState()?;
        let center = client_center(hwnd, &titles)?.0;
        // Click the blank space to the left, then the face. Exactly one click must toggle.
        for offset in [width * 2, 0] {
            let point = LPARAM((center & !0xffff) | ((center - offset as isize) & 0xffff));
            PostMessageW(Some(hwnd), WM_MOUSEMOVE, WPARAM(0), point)?;
            PostMessageW(Some(hwnd), WM_LBUTTONDOWN, WPARAM(1), point)?;
            PostMessageW(Some(hwnd), WM_LBUTTONUP, WPARAM(0), point)?;
        }
        wait("switch face toggled", || {
            (state.CurrentToggleState().ok()? != initial).then_some(())
        })?;
        click(hwnd, "Cancel")?;
        wait("switch restored", || {
            (state.CurrentToggleState().ok()? == initial).then_some(())
        })?;
    }
    let language = wait("language selector", || {
        controls(hwnd).ok()?.into_iter().find(|el| unsafe {
            el.CurrentControlType().ok() == Some(UIA_ComboBoxControlTypeId)
                && el.CurrentName().is_ok_and(|s| s == "Language")
        })
    })?;
    let option = |name: &str| {
        controls(hwnd).ok()?.into_iter().find(|el| unsafe {
            el.CurrentControlType().ok() == Some(UIA_ListItemControlTypeId)
                && el.CurrentName().is_ok_and(|s| s == name)
        })
    };
    reveal_language_selector(hwnd, &language)?;
    let initial = unsafe { language.CurrentBoundingRectangle()? };
    assert_control_height(hwnd, &language, 28)?;
    activate_control(hwnd, &language, false)?;
    let spanish = wait("Spanish option", || option("Español"))?;
    let menu = unsafe { spanish.CurrentBoundingRectangle()? };
    assert!(menu.top >= initial.bottom || menu.bottom <= initial.top);
    activate_control(hwnd, &spanish, false)?;
    wait("language draft", || {
        button(
            hwnd,
            &patina_activity::text(patina_activity::Locale::Es, "common.save"),
        )
        .filter(|b| unsafe { b.CurrentIsEnabled().is_ok_and(|v| v.as_bool()) })
    })?;
    let changed = unsafe { language.CurrentBoundingRectangle()? };
    assert!((changed.right - initial.right).abs() <= 1);
    assert!(
        changed.right - changed.left > initial.right - initial.left,
        "the language trigger should fit the longer Español label"
    );
    click(
        hwnd,
        &patina_activity::text(patina_activity::Locale::Es, "common.cancel"),
    )?;
    wait("language preview cancelled", || named(hwnd, "Language"))?;
    activate_control(hwnd, &language, true)?;
    let english = wait("English restored", || option("English"))?;
    assert!(unsafe {
        english
            .GetCurrentPatternAs::<IUIAutomationSelectionItemPattern>(UIA_SelectionItemPatternId)?
            .CurrentIsSelected()?
            .as_bool()
    });
    key(hwnd, 0x28)?;
    key(hwnd, 0x1b)?;
    wait("language menu dismissed", || {
        option("English").is_none().then_some(())
    })?;
    click(hwnd, "+ Activity hold time")?;
    wait("updated stepper", || named(hwnd, "4 min"))?;
    click(hwnd, "Cancel")?;
    wait("cancel restored value", || named(hwnd, "3 min"))?;
    click(hwnd, "+ Activity hold time")?;
    let radio = |name: &str| {
        controls(hwnd).ok()?.into_iter().find(|el| unsafe {
            el.CurrentControlType().ok() == Some(UIA_RadioButtonControlTypeId)
                && el.CurrentName().is_ok_and(|n| n == name)
        })
    };
    let is_selected = |name: &str| unsafe {
        radio(name)?
            .GetCurrentPatternAs::<IUIAutomationSelectionItemPattern>(UIA_SelectionItemPatternId)
            .ok()?
            .CurrentIsSelected()
            .ok()?
            .as_bool()
            .then_some(())
    };
    let dark = wait("Dark radio", || radio("Dark"))?;
    let theme_mode = wait("Theme mode group", || {
        controls(hwnd).ok()?.into_iter().find(|el| unsafe {
            el.CurrentControlType().ok() == Some(UIA_GroupControlTypeId)
                && el.CurrentName().is_ok_and(|n| n == "Theme mode")
        })
    })?;
    assert_control_height(hwnd, &theme_mode, 28)?;
    assert_control_height(hwnd, &dark, 28)?;
    activate_control(hwnd, &dark, false)?;
    wait("Dark selected by mouse", || is_selected("Dark"))?;
    unsafe { dark.SetFocus()? };
    key(hwnd, 0x25)?;
    wait("Left selected Light", || is_selected("Light"))?;
    key(hwnd, 0x27)?;
    wait("Right selected Dark", || is_selected("Dark"))?;
    click(hwnd, "Save")?;
    wait("saved preferences", || {
        button(hwnd, "Save").filter(|b| unsafe { b.CurrentIsEnabled().is_ok_and(|s| !s.as_bool()) })
    })?;
    let toast = wait("save toast", || named(hwnd, "Saved"))?;
    let bounds = unsafe { toast.CurrentBoundingRectangle()? };
    assert!(bounds.right > bounds.left && bounds.bottom > bounds.top);
    let scale = unsafe { GetDpiForWindow(hwnd) } as f32 / 96.;
    assert!(((bounds.bottom - bounds.top) as f32 - 32. * scale).abs() <= 2.);
    let mut window_bounds = RECT::default();
    unsafe { GetWindowRect(hwnd, &mut window_bounds)? };
    assert!(bounds.top > window_bounds.top);
    assert!((bounds.top - window_bounds.top) as f32 <= 64. * scale);
    assert!((window_bounds.right - bounds.right) as f32 <= 24. * scale);
    wait("save toast expires", || {
        named(hwnd, "Saved").is_none().then_some(())
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
    command(window(pid, w!("Patina Tray")).unwrap(), 2)?;
    assert!(wait("exit", || host.0.try_wait().ok().flatten())?.success());
    Ok(())
}

#[test]
#[ignore = "isolated Win32 desktop"]
fn about_navigation() -> Result<(), Error> {
    if !patina_test_support::run_case()? {
        return Ok(());
    }
    let _com = ComApartment::init()?;
    unsafe { SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2) };
    let root = tempfile::tempdir()?;
    let mut config: serde_json::Value =
        serde_json::from_slice(include_bytes!("../../../crates/updater/config.json"))?;
    config["endpoints"] = serde_json::json!(["https://fixture.invalid/manifest"]);
    fs::write(
        root.path().join("config.json"),
        serde_json::to_vec(&config)?,
    )?;
    let dir = root.path().join(patina::PROFILE_DIRECTORY);
    fs::create_dir(&dir)?;
    seed(&dir.join("patina.db"))?;
    let mut host = TestChild(
        Command::new(env!("CARGO_BIN_EXE_patina"))
            .env("PATINA_PROFILE_PARENT", root.path())
            .env("PATINA_UPDATE_FIXTURE", root.path())
            .arg("--today")
            .spawn()?,
    );
    let pid = host.0.id();
    let hwnd = wait("Today", || children::find(pid, |p| window(p, w!("Patina"))))?;
    click(hwnd, "About")?;
    wait("binary version", || {
        named(hwnd, concat!("v", env!("CARGO_PKG_VERSION")))
    })?;
    let update_card = wait("update card", || {
        controls(hwnd).ok()?.into_iter().find(|el| unsafe {
            el.CurrentAutomationId()
                .is_ok_and(|id| id == "about-update-card")
        })
    })?;
    assert_control_height(hwnd, &update_card, 64)?;
    let update_heading = wait("update heading", || {
        controls(hwnd).ok()?.into_iter().find(|el| unsafe {
            el.CurrentName().is_ok_and(|name| name == "App updates")
                && el
                    .CurrentAutomationId()
                    .is_ok_and(|id| id != "about-update-card")
        })
    })?;
    let heading_bounds = unsafe { update_heading.CurrentBoundingRectangle()? };
    let status = wait("initial update status", || named(hwnd, "Not checked"))?;
    let status_bounds = unsafe { status.CurrentBoundingRectangle()? };
    assert!(status_bounds.left > heading_bounds.right);
    assert!(status_bounds.top < heading_bounds.bottom && status_bounds.bottom > heading_bounds.top);
    for (open, qr, link, action) in [
        ("Feedback", "QQ Channel", "GitHub Issues", "GitHub Issues"),
        ("Sponsor", "WeChat reward code", "Ko-fi", "Open Ko-fi"),
    ] {
        click(hwnd, open)?;
        let heading_bounds = |title| {
            wait(title, || {
                controls(hwnd).ok()?.into_iter().find_map(|el| unsafe {
                    (el.CurrentName().ok()? == title
                        && el.CurrentControlType().ok()? != UIA_ButtonControlTypeId)
                        .then(|| el.CurrentBoundingRectangle().ok())
                        .flatten()
                })
            })
        };
        let qr_bounds = heading_bounds(qr)?;
        let link_bounds = heading_bounds(link)?;
        let action = wait(action, || button(hwnd, action))?;
        let action_bounds = unsafe { action.CurrentBoundingRectangle()? };
        assert_control_height(hwnd, &action, 52)?;
        assert!(qr_bounds.bottom < link_bounds.top && link_bounds.bottom <= action_bounds.top);
        assert_eq!(qr_bounds.left, link_bounds.left);
        let scale = unsafe { GetDpiForWindow(hwnd) } as f32 / 96.;
        let badge_top_gap = (action_bounds.top - link_bounds.bottom) as f32 / scale + 8.;
        assert!(
            (badge_top_gap - 12.).abs() <= 1.,
            "{open}: badge gap {badge_top_gap}"
        );
        let mark_and_gap = (link_bounds.left - action_bounds.left) as f32 / scale;
        assert!((mark_and_gap - 24.).abs() <= 1., "{open}: {mark_and_gap}");
        let close = wait("dialog close button", || button(hwnd, "Close"))?;
        let bounds = unsafe { close.CurrentBoundingRectangle()? };
        assert!(bounds.bottom <= qr_bounds.top && bounds.right >= action_bounds.right);
        activate_control(hwnd, &close, false)?;
        wait("dialog closed by mouse", || {
            named(hwnd, qr).is_none().then_some(())
        })?;
        key(hwnd, 13)?;
        wait("dialog reopened from returned focus", || named(hwnd, qr))?;
        key(hwnd, 27)?;
        wait("return", || button(hwnd, "Close").is_none().then_some(()))?;
    }
    click(hwnd, "Check updates")?;
    wait("offline check failed", || {
        named(hwnd, "Could not check updates")
    })?;
    click(hwnd, "Later")?;
    wait("update dialog closed", || {
        button(hwnd, "Later").is_none().then_some(())
    })?;
    for (name, height) in [
        ("GitHub Star", 32),
        ("Release notes", 32),
        ("Feedback", 32),
        ("Sponsor", 32),
        ("Check updates", 32),
        ("Manual download", 32),
    ] {
        let control = wait(name, || button(hwnd, name))?;
        assert_control_height(hwnd, &control, height)?;
    }
    fs::write(
        root.path().join("manifest.json"),
        serde_json::to_vec(&serde_json::json!({
            "schema": 1, "application": "patina-desktop", "version": "0.1.0", "platforms": {}
        }))?,
    )?;
    click(hwnd, "Check updates")?;
    wait("current version on update card", || {
        named(hwnd, "You are up to date")
    })?;
    assert!(button(hwnd, "Later").is_none() && button(hwnd, "Confirm").is_none());
    command(window(pid, w!("Patina Tray")).unwrap(), 2)?;
    assert!(wait("exit", || host.0.try_wait().ok().flatten())?.success());
    Ok(())
}

#[test]
#[ignore = "isolated Win32 desktop"]
fn page_header_layout() -> Result<(), Error> {
    if !patina_test_support::run_case()? {
        return Ok(());
    }
    let _com = ComApartment::init()?;
    unsafe { SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2) };
    let root = tempfile::tempdir()?;
    let dir = root.path().join(patina::PROFILE_DIRECTORY);
    fs::create_dir(&dir)?;
    seed(&dir.join("patina.db"))?;
    let mut host = TestChild(
        Command::new(env!("CARGO_BIN_EXE_patina"))
            .env("PATINA_PROFILE_PARENT", root.path())
            .arg("--today")
            .spawn()?,
    );
    let pid = host.0.id();
    let hwnd = wait("Today", || children::find(pid, |p| window(p, w!("Patina"))))?;
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
        if page == "Data" {
            for name in ["Overview", "Details"] {
                let option = wait(name, || segment(hwnd, name))?;
                let rect = unsafe { option.CurrentBoundingRectangle()? };
                assert!(rect.left >= end && rect.right > rect.left);
                assert!((rect.top + rect.bottom - title.top - title.bottom).abs() <= 2);
                end = rect.right;
            }
            // The segmented control has four logical pixels of padding on each side.
            end += (4 * unsafe { GetDpiForWindow(hwnd) } as i32 + 48) / 96;
        }
        assert!(
            (end - today.right).abs() <= 1,
            "{page} right edge: {end} vs {}",
            today.right
        );
        Ok(())
    };
    click(hwnd, "Tools")?;
    check_header("Tools", &["Plugin store", "Tools settings"])?;
    for page in ["History", "Data", "Classification", "Settings", "About"] {
        click(hwnd, page)?;
        let actions: &[&str] = match page {
            "History" => &["Previous day", "Next day"],
            "Classification" | "Settings" => &["Cancel", "Save"],
            _ => &[],
        };
        check_header(page, actions)?;
    }
    command(window(pid, w!("Patina Tray")).unwrap(), 2)?;
    assert!(wait("exit", || host.0.try_wait().ok().flatten())?.success());
    Ok(())
}
