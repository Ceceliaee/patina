use super::*;

pub(super) async fn enable_web_history(db: &mut SqliteConnection) -> Result<(), Error> {
    let port = std::net::TcpListener::bind(("127.0.0.1", 0))?
        .local_addr()?
        .port();
    sqlx::query("INSERT OR REPLACE INTO settings(key,value) VALUES ('web_activity_enabled','1'),('web_activity_token','history-fixture'),('web_activity_port',?)")
        .bind(port.to_string()).execute(db).await?;
    Ok(())
}

pub(super) fn open_icon_details(hwnd: HWND, name: &str) -> Result<(), Error> {
    let icon = wait("detail icon", || {
        button(hwnd, &format!("View details for {name}"))
    })?;
    let rect = unsafe { icon.CurrentBoundingRectangle()? };
    assert!(rect.right - rect.left <= 40 && rect.bottom - rect.top <= 40);
    activate_control(hwnd, &icon, false)?;
    let deadline = std::time::Instant::now() + std::time::Duration::from_millis(600);
    while std::time::Instant::now() < deadline {
        assert!(
            button(hwnd, "Close").is_none(),
            "single icon click opened details"
        );
        std::thread::sleep(std::time::Duration::from_millis(20));
    }
    let label = wait("distribution name", || named(hwnd, name))?;
    activate_control(hwnd, &label, false)?;
    let deadline = std::time::Instant::now() + std::time::Duration::from_millis(600);
    while std::time::Instant::now() < deadline {
        assert!(button(hwnd, "Close").is_none(), "row name opened details");
        std::thread::sleep(std::time::Duration::from_millis(20));
    }
    let at = client_center(hwnd, &icon)?;
    unsafe {
        PostMessageW(Some(hwnd), WM_MOUSEMOVE, WPARAM(0), at)?;
        for _ in 0..2 {
            PostMessageW(Some(hwnd), WM_LBUTTONDOWN, WPARAM(1), at)?;
            PostMessageW(Some(hwnd), WM_LBUTTONUP, WPARAM(0), at)?;
        }
    }
    wait("double icon click opens details", || button(hwnd, "Close"))?;
    Ok(())
}

fn records_panel(hwnd: HWND) -> Option<IUIAutomationElement> {
    controls(hwnd).ok()?.into_iter().find(|el| unsafe {
        el.CurrentAutomationId()
            .is_ok_and(|id| id == "timeline-records-dialog")
    })
}

fn record_mode(hwnd: HWND, name: &str) -> Result<(), Error> {
    let tab = wait("record mode tab", || {
        controls(hwnd).ok()?.into_iter().rev().find(|el| unsafe {
            el.CurrentControlType().ok() == Some(UIA_RadioButtonControlTypeId)
                && el.CurrentName().is_ok_and(|n| n == name)
        })
    })?;
    activate_control(hwnd, &tab, false)
}

pub(super) fn check_records(hwnd: HWND) -> Result<(), Error> {
    let panel = wait("card timeline dialog", || records_panel(hwnd))?;
    let before = unsafe { panel.CurrentBoundingRectangle()? };
    wait("effective Studio group", || named(hwnd, "Studio ･ 45m"))?;
    press(hwnd, "Title details ･ Studio")?;
    wait("title popover", || {
        names(hwnd)
            .iter()
            .any(|s| s == "Design fixture")
            .then_some(())
    })?;
    key(hwnd, 27)?;
    wait("only title popover closes", || {
        (records_panel(hwnd).is_some() && !names(hwnd).iter().any(|s| s == "Design fixture"))
            .then_some(())
    })?;
    press(hwnd, "Title details ･ Studio")?;
    wait("title popover reopens", || named(hwnd, "Design fixture"))?;
    click(hwnd, "Title details ･ Studio")?;
    wait("title trigger collapses only the popover", || {
        (records_panel(hwnd).is_some() && !names(hwnd).iter().any(|s| s == "Design fixture"))
            .then_some(())
    })?;
    record_mode(hwnd, "Web")?;
    wait("empty web list", || {
        named(
            hwnd,
            &patina_activity::text(patina_activity::Locale::EnUs, "history.emptyDay"),
        )
    })?;
    let after = unsafe {
        records_panel(hwnd)
            .ok_or("records dialog disappeared")?
            .CurrentBoundingRectangle()?
    };
    assert_eq!(before.right - before.left, after.right - after.left);
    assert!(after.bottom - after.top < before.bottom - before.top);
    record_mode(hwnd, "Apps")?;
    wait("app records restored", || named(hwnd, "Studio ･ 45m"))?;
    click(hwnd, "Previous day")?;
    wait("dialog date changed", || named(hwnd, "Studio ･ 30m"))?;
    assert!(records_panel(hwnd).is_some());
    click(hwnd, "Next day")?;
    wait("dialog date restored", || named(hwnd, "Studio ･ 45m"))?;
    Ok(())
}

pub(super) fn seed_website_history(db: &Path) -> Result<(), Error> {
    let start = Local::now()
        .date_naive()
        .and_hms_opt(0, 0, 37)
        .unwrap()
        .and_local_timezone(Local)
        .earliest()
        .unwrap()
        .timestamp_millis();
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()?;
    rt.block_on(async {
        let mut c = SqliteConnection::connect_with(&SqliteConnectOptions::new().filename(db)).await?;
        enable_web_history(&mut c).await?;
        for offset in [0, 420_000] {
            let from = start + offset;
            let to = from + 300_000;
            sqlx::query("INSERT INTO web_activity_segments(browser_client_id,browser_kind,browser_exe_name,domain,normalized_domain,title,start_time,end_time,duration,created_at,updated_at) VALUES('fixture','chromium','chrome.exe','docs.example.com','docs.example.com','Web fixture',?,?,300000,?,?)")
                .bind(from).bind(to).bind(from).bind(to).execute(&mut c).await?;
        }
        sqlx::query("INSERT INTO web_favicon_cache(normalized_domain,favicon_url,updated_at) VALUES('docs.example.com','data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEUlEQVR4nGNQSDjwH4QZYAwASvQI/dnllI8AAAAASUVORK5CYII=',?)")
            .bind(start).execute(&mut c).await?;
        Ok::<_, Error>(())
    })
}

#[test]
#[ignore = "isolated Win32 desktop"]
fn website_history_navigation() -> Result<(), Error> {
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
    seed_website_history(&db)?;
    let mut child = TestChild(
        Command::new(env!("CARGO_BIN_EXE_patina"))
            .env("PATINA_PROFILE_PARENT", root.path())
            .arg("--today")
            .spawn()?,
    );
    let pid = child.0.id();
    let hwnd = wait("Today", || children::find(pid, |p| window(p, w!("Patina"))))?;
    let tray = wait("tray", || window(pid, w!("Patina Tray")))?;
    click(hwnd, "History")?;
    assert!(
        !controls(hwnd)?
            .iter()
            .any(|el| unsafe { el.CurrentControlType().ok() == Some(UIA_ComboBoxControlTypeId) })
    );
    select_segment(hwnd, "Web")?;
    wait("website distribution", || named(hwnd, "example.com"))?;
    wait("application summary is unchanged", || named(hwnd, "1h 10m"))?;
    wait("website icon loaded", || {
        controls(hwnd).ok()?.into_iter().find(|el| unsafe {
            el.CurrentControlType().ok() == Some(UIA_ImageControlTypeId)
                && el.CurrentName().is_ok_and(|n| n == "example.com")
        })
    })?;
    click(hwnd, "Currently showing Apps; switch to Categories")?;
    click(hwnd, "Currently showing Categories; switch to Web")?;
    wait("web timeline selected", || {
        button(hwnd, "Currently showing Web; switch to Apps")
    })?;
    assert!(button(hwnd, "View details for Studio").is_none());
    click(hwnd, "Open timeline zoom")?;
    wait("website lanes", || named(hwnd, "Web lanes"))?;
    pan_to_start(hwnd, "zoom-overview")?;
    wait("website lane duration", || named(hwnd, "example.com ･ 10m"))?;
    key(hwnd, 27)?;
    press(hwnd, "Open timeline")?;
    wait("timeline cards", || records_panel(hwnd))?;
    record_mode(hwnd, "Web")?;
    wait("website record card", || named(hwnd, "example.com ･ 10m"))?;
    press(hwnd, "Title details ･ example.com")?;
    wait("website record title", || named(hwnd, "Web fixture"))?;
    key(hwnd, 27)?;
    wait("website title closes", || {
        named(hwnd, "Web fixture").is_none().then_some(())
    })?;
    key(hwnd, 27)?;
    wait("website records closes", || {
        records_panel(hwnd).is_none().then_some(())
    })?;
    open_icon_details(hwnd, "example.com")?;
    let slider = wait("detail slider", || named(hwnd, "Time window in hours"))?;
    unsafe { slider.SetFocus()? };
    key(hwnd, 36)?;
    wait("one hour detail viewport", || named(hwnd, "1.0 h"))?;
    pan_to_start(hwnd, "detail-timeline-track")?;
    wait("detail at midnight", || named(hwnd, "00:00 – 01:00"))?;
    let track = wait("detail track", || {
        controls(hwnd).ok()?.into_iter().find(|el| unsafe {
            el.CurrentAutomationId()
                .is_ok_and(|id| id == "detail-timeline-track")
        })
    })?;
    hover_track(hwnd, &track, 0.1)?;
    wait(
        "hovering the gap shows the merged span and actual active time",
        || {
            controls(hwnd).ok()?.into_iter().find(|el| unsafe {
                el.CurrentControlType().ok() == Some(UIA_ToolTipControlTypeId)
                    && el
                        .CurrentName()
                        .is_ok_and(|name| name == "example.com ･ 00:00:37–00:12:37 ･ 10m")
            })
        },
    )
    .map_err(|e| format!("{e}; {:?}", names(hwnd)))?;
    wait("record card shows hours and minutes", || {
        named(hwnd, "00:00 – 00:12")
    })?;
    press(hwnd, "Title details ･ example.com")?;
    wait("website detail title", || named(hwnd, "Web fixture"))?;
    let elements = controls(hwnd)?;
    let label_bounds = |label: &str| {
        elements
            .iter()
            .filter(|element| unsafe { element.CurrentName().is_ok_and(|name| name == label) })
            .filter_map(|element| unsafe { element.CurrentBoundingRectangle().ok() })
            .collect::<Vec<_>>()
    };
    let durations = label_bounds("10m");
    assert!(
        label_bounds("00:00 – 00:12").iter().any(|time| {
            durations.iter().any(|duration| {
                (duration.bottom - time.top).abs() <= 1 && (duration.right - time.right).abs() <= 1
            })
        }),
        "duration should sit above the minute range and align with its right edge"
    );
    key(hwnd, 27)?;
    key(hwnd, 27)?;
    click(hwnd, "Previous day")?;
    wait("empty website day", || {
        button(hwnd, "View details for example.com")
            .is_none()
            .then_some(())
    })?;
    click(hwnd, "Next day")?;
    wait("website date restored", || {
        button(hwnd, "View details for example.com")
    })?;
    select_segment(hwnd, "Apps")?;
    wait("application distribution restored", || {
        button(hwnd, "View details for Studio")
    })?;
    assert!(button(hwnd, "View details for example.com").is_none());
    command(tray, 2)?;
    assert!(wait("exit", || child.0.try_wait().ok().flatten())?.success());
    Ok(())
}

pub(super) fn pan_to_start(hwnd: HWND, track_id: &str) -> Result<(), Error> {
    let track = wait("timeline track", || {
        controls(hwnd)
            .ok()?
            .into_iter()
            .find(|element| unsafe { element.CurrentAutomationId().is_ok_and(|id| id == track_id) })
    })?;
    unsafe {
        track.SetFocus()?;
    }
    key(hwnd, 36)?;
    Ok(())
}

fn hover_track(hwnd: HWND, track: &IUIAutomationElement, fraction: f64) -> Result<(), Error> {
    let rect = unsafe { track.CurrentBoundingRectangle()? };
    let mut point = windows::Win32::Foundation::POINT {
        x: rect.left + (f64::from(rect.right - rect.left) * fraction).round() as i32,
        y: (rect.top + rect.bottom) / 2,
    };
    unsafe {
        windows::Win32::Graphics::Gdi::ScreenToClient(hwnd, &mut point).ok()?;
        PostMessageW(
            Some(hwnd),
            WM_MOUSEMOVE,
            WPARAM(0),
            LPARAM(((point.y as isize) << 16) | point.x as isize),
        )?;
    }
    Ok(())
}

pub(super) fn check_zoom(hwnd: HWND) -> Result<(), Error> {
    press(hwnd, "Open timeline zoom")?;
    wait("app timeline lanes", || named(hwnd, "App lanes"))?;
    let today = Local::now().date_naive();
    let date = today.to_string();
    let previous = today.pred_opt().unwrap().to_string();
    let zoom_actions = [
        "Increase by one hour",
        "Previous day",
        &date,
        "Next day",
        "Currently showing Apps; switch to Categories",
    ];
    let mut last: Option<RECT> = None;
    for name in zoom_actions {
        let action = wait(name, || button(hwnd, name))?;
        assert_control_height(hwnd, &action, 28)?;
        let rect = unsafe { action.CurrentBoundingRectangle()? };
        if let Some(prev) = last {
            assert!(
                prev.right <= rect.left + 1 && (prev.top - rect.top).abs() <= 1,
                "zoom header control out of order or off row: {name}"
            );
        }
        last = Some(rect);
    }
    let close = wait("close zoom", || button(hwnd, "Close"))?;
    assert!(unsafe { close.CurrentBoundingRectangle()? }.bottom <= last.unwrap().top);
    press(hwnd, &date)?;
    wait("zoom date picker", || named(hwnd, "Select date"))?;
    key(hwnd, 27)?;
    wait("Escape keeps zoom open", || {
        (named(hwnd, "Select date").is_none() && named(hwnd, "App lanes").is_some()).then_some(())
    })?;
    key(hwnd, 13)?;
    wait("zoom date trigger regains focus", || {
        named(hwnd, "Select date")
    })?;
    key(hwnd, 37)?;
    key(hwnd, 13)?;
    wait("previous day loaded in zoom", || {
        button(hwnd, &previous).filter(|_| named(hwnd, "App lanes").is_some())
    })?;
    wait("previous day track", || named(hwnd, "Time window in hours"))?;
    let track = wait("previous day timeline", || {
        controls(hwnd).ok()?.into_iter().find(|el| unsafe {
            el.CurrentAutomationId()
                .is_ok_and(|id| id == "zoom-overview")
        })
    })?;
    unsafe { track.SetFocus()? };
    key(hwnd, 35)?;
    wait("previous day lane totals", || named(hwnd, "Studio ･ 30m"))?;
    click(hwnd, "Next day")?;
    wait("today loaded in zoom", || {
        button(hwnd, &date).filter(|_| named(hwnd, "App lanes").is_some())
    })?;
    click(hwnd, "Decrease by one hour")?;
    wait("three hour viewport", || named(hwnd, "3.0 h"))?;
    let slider = wait("zoom slider", || named(hwnd, "Time window in hours"))?;
    let range: IUIAutomationRangeValuePattern =
        unsafe { slider.GetCurrentPatternAs(UIA_RangeValuePatternId)? };
    let point = unsafe { slider.CurrentBoundingRectangle()? };
    let mut at = windows::Win32::Foundation::POINT {
        x: point.right - 2,
        y: (point.top + point.bottom) / 2,
    };
    unsafe {
        windows::Win32::Graphics::Gdi::ScreenToClient(hwnd, &mut at).ok()?;
        let pos = LPARAM(((at.y as isize) << 16) | at.x as isize);
        PostMessageW(Some(hwnd), WM_MOUSEMOVE, WPARAM(0), pos)?;
        PostMessageW(Some(hwnd), WM_LBUTTONDOWN, WPARAM(1), pos)?;
        PostMessageW(Some(hwnd), WM_LBUTTONUP, WPARAM(0), pos)?;
    }
    wait("pointer moves slider", || named(hwnd, "24.0 h"))?;
    unsafe {
        slider.SetFocus()?;
    }
    key(hwnd, 36)?;
    wait("slider home", || named(hwnd, "1.0 h"))?;
    for _ in 0..35 {
        key(hwnd, 39)?;
    }
    wait("slider updates window", || named(hwnd, "8.0 h"))?;
    unsafe {
        slider.SetFocus()?;
    }
    key(hwnd, 39)?;
    wait("keyboard adjusts slider", || named(hwnd, "8.2 h"))?;
    key(hwnd, 37)?;
    wait("slider reset", || named(hwnd, "8.0 h"))?;
    assert!((unsafe { range.CurrentValue()? } - 8.).abs() < 0.01);
    click(hwnd, "Currently showing Apps; switch to Categories")?;
    wait("category timeline lanes", || named(hwnd, "Category lanes"))?;
    click(hwnd, "Currently showing Categories; switch to Web")?;
    click(hwnd, "Currently showing Web; switch to Apps")?;
    wait("app lanes restored", || named(hwnd, "App lanes"))?;
    let track = wait("overview timeline", || {
        controls(hwnd).ok()?.into_iter().find(|el| unsafe {
            el.CurrentAutomationId()
                .is_ok_and(|id| id == "zoom-overview")
        })
    })?;
    unsafe {
        track.SetFocus()?;
    }
    key(hwnd, 36)?;
    wait("eight hour range", || named(hwnd, "00:00 – 08:00"))?;
    key(hwnd, 39)?;
    wait("keyboard pans window", || named(hwnd, "04:00 – 12:00"))?;
    wait("empty visible range", || {
        named(hwnd, "No records in this time range")
    })?;
    key(hwnd, 37)?;
    wait("keyboard restores range", || named(hwnd, "00:00 – 08:00"))?;
    let (lane, overview) = unsafe {
        (
            wait("visible lane total", || named(hwnd, "Studio ･ 45m"))?
                .CurrentBoundingRectangle()?,
            track.CurrentBoundingRectangle()?,
        )
    };
    assert!(
        (lane.left - overview.left).abs() <= 1 && (lane.right - overview.right).abs() <= 1,
        "zoom lane should span the overview width: lane {lane:?}, overview {overview:?}"
    );
    key(hwnd, 27)?;
    wait("zoom dismissed", || {
        named(hwnd, "App lanes").is_none().then_some(())
    })?;
    key(hwnd, 13)?;
    wait("zoom trigger regains focus", || named(hwnd, "App lanes"))?;
    click(hwnd, "Close")?;
    wait("close button dismisses zoom", || {
        named(hwnd, "App lanes").is_none().then_some(())
    })?;
    Ok(())
}

pub(super) fn check_app_detail(hwnd: HWND) -> Result<(), Error> {
    wait("default full-day detail", || named(hwnd, "24.0 h"))?;
    assert!(button(hwnd, "Title details").is_none());
    let slider = wait("detail slider", || named(hwnd, "Time window in hours"))?;
    unsafe {
        slider.SetFocus()?;
    }
    key(hwnd, 36)?;
    wait("detail minimum zoom", || named(hwnd, "1.0 h"))?;
    let track = wait("detail timeline", || {
        controls(hwnd).ok()?.into_iter().find(|el| unsafe {
            el.CurrentAutomationId()
                .is_ok_and(|id| id == "detail-timeline-track")
        })
    })?;
    unsafe {
        track.SetFocus()?;
    }
    key(hwnd, 35)?;
    wait("detail pans to day end", || named(hwnd, "23:00 – 24:00"))?;
    wait("records follow viewport", || {
        named(hwnd, "No activity for this item in the current time window")
    })?;
    assert!(button(hwnd, "Title details ･ Studio").is_none());
    key(hwnd, 36)?;
    wait("detail pans to day start", || named(hwnd, "00:00 – 01:00"))?;
    wait("records restored", || named(hwnd, "Studio ･ 45m"))?;
    hover_track(hwnd, &track, 0.25)?;
    wait("detail segment hover", || {
        controls(hwnd).ok()?.into_iter().find(|el| unsafe {
            el.CurrentControlType().ok() == Some(UIA_ToolTipControlTypeId)
                && el
                    .CurrentName()
                    .is_ok_and(|name| name.to_string().contains("Studio"))
        })
    })?;
    unsafe {
        slider.SetFocus()?;
    }
    key(hwnd, 35)?;
    wait("full-day restored", || named(hwnd, "24.0 h"))?;
    click(hwnd, "Decrease by one hour")?;
    wait("detail zoom saved", || named(hwnd, "23.0 h"))?;
    unsafe {
        track.SetFocus()?;
    }
    key(hwnd, 36)?;
    wait("saved zoom at day start", || named(hwnd, "00:00 – 23:00"))?;
    Ok(())
}
