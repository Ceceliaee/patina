use super::*;
use chrono::{Datelike, Days};

use windows::Win32::System::Com::{CLSCTX_INPROC_SERVER, CoCreateInstance};

pub(super) fn range_button(hwnd: HWND, scope: &str, name: &str) -> Option<IUIAutomationElement> {
    let group = controls(hwnd).ok()?.into_iter().find(|el| unsafe {
        el.CurrentControlType().ok() == Some(UIA_GroupControlTypeId)
            && el.CurrentName().is_ok_and(|value| value == scope)
    })?;
    unsafe {
        let ui: IUIAutomation =
            CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER).ok()?;
        let children = group
            .FindAll(TreeScope_Descendants, &ui.CreateTrueCondition().ok()?)
            .ok()?;
        (0..children.Length().ok()?)
            .filter_map(|i| children.GetElement(i).ok())
            .find(|el| {
                el.CurrentControlType().ok() == Some(UIA_ButtonControlTypeId)
                    && el.CurrentName().is_ok_and(|value| value == name)
            })
    }
}

fn button(hwnd: HWND, name: &str) -> Option<IUIAutomationElement> {
    range_button(hwnd, "Select trend range", name).or_else(|| super::button(hwnd, name))
}

fn press(hwnd: HWND, name: &str) -> Result<(), Error> {
    activate_control(hwnd, &wait(name, || button(hwnd, name))?, true)
}

fn popup(hwnd: HWND) -> Option<IUIAutomationElement> {
    controls(hwnd).ok()?.into_iter().find(|el| unsafe {
        el.CurrentName().is_ok_and(|n| n == "Select range")
            && el.CurrentControlType().ok() == Some(UIA_GroupControlTypeId)
    })
}

fn day(hwnd: HWND, date: chrono::NaiveDate) -> Option<IUIAutomationElement> {
    controls(hwnd).ok()?.into_iter().find(|el| unsafe {
        el.CurrentName().is_ok_and(|n| n == date.to_string())
            && el.CurrentControlType().ok() != Some(UIA_ButtonControlTypeId)
    })
}

#[test]
#[ignore = "isolated Win32 desktop"]
fn range_draft_apply_and_dismiss() -> Result<(), Error> {
    if !patina_test_support::run_case()? {
        return Ok(());
    }
    let _com = ComApartment::init()?;
    unsafe { SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2) };
    let root = tempfile::tempdir()?;
    let profile = root.path().join(patina::APP_ID);
    fs::create_dir(&profile)?;
    seed(&profile.join("patina.db"))?;
    let mut host = TestChild(
        Command::new(env!("CARGO_BIN_EXE_patina"))
            .env("PATINA_GPUI_PROFILE_PARENT", root.path())
            .arg("--today")
            .spawn()?,
    );
    let hwnd = wait("main", || {
        children::find(host.0.id(), |p| window(p, w!("Patina")))
    })?;
    click(hwnd, "Data")?;
    wait("data loaded", || named(hwnd, "Total ･ 1h 40m"))?;
    let today = Local::now().date_naive();
    let scale = unsafe { GetDpiForWindow(hwnd) } as f64 / 96.;
    for name in ["Select range", "Shorten trend range", "Expand trend range"] {
        let rect = unsafe {
            button(hwnd, name)
                .ok_or("range control")?
                .CurrentBoundingRectangle()?
        };
        assert!(
            ((rect.bottom - rect.top) as f64 / scale - 28.).abs() <= 1.,
            "{name}: {rect:?}"
        );
    }
    let close = || wait("range closed", || popup(hwnd).is_none().then_some(()));
    press(hwnd, "Select range")?;
    let bounds = unsafe { wait("range popup", || popup(hwnd))?.CurrentBoundingRectangle()? };
    assert!(((bounds.right - bounds.left) as f64 / scale - 228.).abs() <= 1.);
    let cell = wait("today", || day(hwnd, today))?;
    let cell_bounds = unsafe { cell.CurrentBoundingRectangle()? };
    assert!(((cell_bounds.right - cell_bounds.left) as f64 / scale - 28.).abs() <= 1.);
    assert!(((cell_bounds.bottom - cell_bounds.top) as f64 / scale - 28.).abs() <= 1.);
    let other_week = if today.day() > 7 {
        today - Days::new(7)
    } else {
        today + Days::new(7)
    };
    let other_bounds = unsafe {
        day(hwnd, other_week)
            .ok_or("adjacent week")?
            .CurrentBoundingRectangle()?
    };
    assert!(((cell_bounds.top - other_bounds.top).abs() as f64 / scale - 28.).abs() <= 1.);
    if today.day() < 28 {
        assert!(!unsafe {
            day(hwnd, today + Days::new(1))
                .ok_or("future date")?
                .CurrentIsEnabled()?
                .as_bool()
        });
    }
    // Reversed endpoints are normalized; incomplete selections cannot be applied.
    activate_control(hwnd, &cell, false)?;
    wait("incomplete draft", || {
        button(hwnd, "Apply")
            .filter(|el| unsafe { el.CurrentIsEnabled().is_ok_and(|v| !v.as_bool()) })
    })?;
    let earlier = today - Days::new(2);
    if earlier.month() != today.month() {
        click(hwnd, "Previous month")?;
    }
    let cell = wait("earlier date", || day(hwnd, earlier))?;
    activate_control(hwnd, &cell, false)?;
    wait("ordered draft", || {
        named(hwnd, &format!("{earlier} – {today}"))
    })?;
    assert!(named(hwnd, "Total ･ 1h 40m").is_some());
    press(hwnd, "Cancel")?;
    close()?;
    press(hwnd, "Select range")?;
    wait("fresh custom draft", || named(hwnd, "Start date"))?;
    click(hwnd, "Next range mode")?;
    wait("week mode", || named(hwnd, "Select date"))?;
    assert!(popup(hwnd).is_some());
    key(hwnd, 27)?;
    close()?;
    key(hwnd, 13)?;
    wait("reopened by keyboard", || popup(hwnd))?;
    // Keyboard selection supports a single-day range and leaves commit to Apply.
    let grid = wait("range grid", || {
        controls(hwnd)
            .ok()?
            .into_iter()
            .find(|el| unsafe { el.CurrentControlType().ok() == Some(UIA_DataGridControlTypeId) })
    })?;
    unsafe {
        grid.SetFocus()?;
    }
    key(hwnd, 13)?;
    wait("end selection", || named(hwnd, "End date"))?;
    key(hwnd, 13)?;
    wait("single day draft", || {
        named(hwnd, &format!("{today} – {today}"))
    })?;
    press(hwnd, "Apply")?;
    close()?;
    wait("today data", || named(hwnd, "Total ･ 1h 10m"))
        .map_err(|e| format!("{e}; {:?}", names(hwnd)))?;
    press(hwnd, "Select range")?;
    click(hwnd, "Next range mode")?;
    let outside = client_center(hwnd, &named(hwnd, "Activity Trend").ok_or("heading")?)?;
    unsafe {
        PostMessageW(Some(hwnd), WM_LBUTTONDOWN, WPARAM(1), outside)?;
        PostMessageW(Some(hwnd), WM_LBUTTONUP, WPARAM(0), outside)?;
    }
    close()?;
    press(hwnd, "Select range")?;
    wait("outside discarded draft", || named(hwnd, "Start date"))?;
    click(hwnd, "Next range mode")?;
    activate_control(hwnd, &wait("period date", || day(hwnd, today))?, false)?;
    wait("period apply", || {
        button(hwnd, "Apply")
            .filter(|el| unsafe { el.CurrentIsEnabled().is_ok_and(|v| v.as_bool()) })
    })?;
    press(hwnd, "Apply")?;
    close()?;
    wait("reset available", || button(hwnd, "Reset to last 7 days"))?;
    press(hwnd, "Reset to last 7 days")?;
    wait("range restored", || named(hwnd, "Total ･ 1h 40m"))?;
    press(hwnd, "Expand trend range")?;
    wait("expanded range data", || named(hwnd, "Total ･ 1h 40m"))?;
    press(hwnd, "Shorten trend range")?;
    wait("shortened range data", || named(hwnd, "Total ･ 1h 40m"))?;
    select_segment(hwnd, "Details")?;
    // Destination range commits affect only the selected object's metrics and curve.
    let destination = wait("destination range", || {
        range_button(hwnd, "Select app trend range", "Select range")
    })?;
    activate_control(hwnd, &destination, true)?;
    wait("destination calendar", || popup(hwnd))?;
    let anchor = unsafe { destination.CurrentBoundingRectangle()? };
    let calendar = unsafe {
        popup(hwnd)
            .ok_or("destination popup")?
            .CurrentBoundingRectangle()?
    };
    assert!(calendar.left < anchor.right && calendar.right > anchor.left);
    let cell = wait("destination today", || day(hwnd, today))?;
    activate_control(hwnd, &cell, false)?;
    activate_control(hwnd, &cell, false)?;
    press(hwnd, "Apply")?;
    close()?;
    wait("single-day app total", || named(hwnd, "Total ･ 45m"))?;
    select_segment(hwnd, "Overview")?;
    assert!(
        named(hwnd, "Total ･ 1h 40m").is_some(),
        "overview range must remain seven days"
    );
    select_segment(hwnd, "Details")?;
    assert!(named(hwnd, "Total ･ 45m").is_some());
    activate_control(
        hwnd,
        &range_button(hwnd, "Select app trend range", "Select range").ok_or("range trigger")?,
        true,
    )?;
    wait("destination draft", || popup(hwnd))?;
    key(hwnd, 27)?;
    close()?;
    key(hwnd, 13)?;
    wait("focus returned to destination trigger", || popup(hwnd))?;
    press(hwnd, "Cancel")?;
    close()?;
    activate_control(
        hwnd,
        &range_button(hwnd, "Select app trend range", "Reset to last 7 days")
            .ok_or("destination reset")?,
        true,
    )?;
    wait("app range restored", || named(hwnd, "Total ･ 1h 15m"))?;
    activate_control(
        hwnd,
        &range_button(hwnd, "Select app trend range", "Select range").ok_or("range trigger")?,
        true,
    )?;
    wait("pending date picker", || popup(hwnd))?;
    activate_control(
        hwnd,
        &segment(hwnd, "Overview").ok_or("overview tab")?,
        true,
    )?;
    close()?;
    assert!(named(hwnd, "Total ･ 1h 40m").is_some());
    select_segment(hwnd, "Details")?;
    assert!(popup(hwnd).is_none());
    assert!(named(hwnd, "Total ･ 1h 15m").is_some());
    let tray = window(host.0.id(), w!("Patina GPUI")).ok_or("tray")?;
    command(tray, 2)?;
    assert!(wait("exit", || host.0.try_wait().ok().flatten())?.success());
    Ok(())
}

fn chart_heat_geometry(hwnd: HWND, detailed: bool) -> Result<[(i32, i32); 2], Error> {
    let ids = [
        format!(
            "{}-{}",
            if detailed {
                "selection-trend"
            } else {
                "overview-trend"
            },
            Local::now().date_naive()
        ),
        if detailed {
            "destination-heatmap"
        } else {
            "overview-heatmap"
        }
        .to_string(),
    ];
    let elements = controls(hwnd)?;
    let mut geometry = [(0, 0); 2];
    for (i, id) in ids.iter().enumerate() {
        let element = elements
            .iter()
            .find(|el| unsafe {
                el.CurrentAutomationId()
                    .is_ok_and(|value| value == id.as_str())
            })
            .ok_or_else(|| format!("missing {id}"))?;
        let bounds = unsafe { element.CurrentBoundingRectangle()? };
        geometry[i] = (bounds.top, bounds.bottom - bounds.top);
    }
    assert!(geometry[0].1 > 100 && geometry[1].1 > 100);
    Ok(geometry)
}

fn stable_heat_geometry(
    hwnd: HWND,
    detailed: bool,
    expected: [(i32, i32); 2],
) -> Result<(), Error> {
    let until = std::time::Instant::now() + std::time::Duration::from_millis(500);
    loop {
        assert_eq!(
            chart_heat_geometry(hwnd, detailed)?,
            expected,
            "chart or heatmap moved during a switch"
        );
        if std::time::Instant::now() >= until {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(20));
    }
    Ok(())
}

fn full_year_cells(hwnd: HWND, detailed: bool, year: i32) -> Result<(), Error> {
    let prefix = if detailed { "trend-heat-" } else { "heat-" };
    let first = chrono::NaiveDate::from_ymd_opt(year, 1, 1).unwrap();
    let last = chrono::NaiveDate::from_ymd_opt(year, 12, 31).unwrap();
    wait("year cells ready", || {
        controls(hwnd).ok()?.into_iter().find(|el| unsafe {
            el.CurrentAutomationId()
                .is_ok_and(|id| id == format!("{prefix}{first}"))
                && el.CurrentIsEnabled().is_ok_and(|enabled| enabled.as_bool())
        })
    })?;
    let mut dates = std::collections::BTreeSet::new();
    for element in controls(hwnd)? {
        let id = unsafe { element.CurrentAutomationId()? }.to_string();
        let Some(date) = id
            .strip_prefix(prefix)
            .and_then(|date| chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d").ok())
        else {
            continue;
        };
        assert_eq!(date.year(), year, "outside-year padding must stay blank");
        assert!(dates.insert(date), "duplicate date cell");
        assert_eq!(
            unsafe { element.CurrentIsEnabled()? }.as_bool(),
            date <= Local::now().date_naive()
        );
        let bounds = unsafe { element.CurrentBoundingRectangle()? };
        assert!(
            bounds.right > bounds.left && bounds.bottom > bounds.top,
            "date cell must occupy space"
        );
    }
    assert_eq!(dates.len() as i64, (last - first).num_days() + 1);
    assert!(dates.contains(&first) && dates.contains(&last));
    Ok(())
}

fn overview_heat_layout(hwnd: HWND, date: chrono::NaiveDate) -> Result<(), Error> {
    wait("overview heatmap ready", || {
        super::button(hwnd, &format!("{date} ･ 1h 10m"))
    })?;
    for label in ["Daily", "Weekly"] {
        let option = segment(hwnd, label).ok_or("heatmap mode option")?;
        super::assert_control_height(hwnd, &option, 28)?;
    }
    let geometry = chart_heat_geometry(hwnd, false)?;
    super::trend_chart::heatmap_geometry(hwnd)?;
    for mode in ["Weekly", "Daily"] {
        activate_control(hwnd, &segment(hwnd, mode).ok_or("heat granularity")?, true)?;
        wait("overview granularity changed", || {
            super::selected_segment(hwnd, mode)
        })?;
        stable_heat_geometry(hwnd, false, geometry)?;
        super::trend_chart::heatmap_geometry(hwnd)?;
    }
    for direction in [
        "Previous month",
        "Next month",
        "Previous month",
        "Next month",
    ] {
        super::press(hwnd, direction)?;
        stable_heat_geometry(hwnd, false, geometry)?;
        if direction == "Previous month" {
            full_year_cells(hwnd, false, Local::now().date_naive().year())?;
        }
        if direction == "Next month" || date.year() == Local::now().date_naive().year() {
            wait("overview heatmap reloaded", || {
                super::button(hwnd, &format!("{date} ･ 1h 10m"))
            })?;
        }
        assert_eq!(chart_heat_geometry(hwnd, false)?, geometry);
    }
    select_segment(hwnd, "Details")?;
    wait("detail loaded", || named(hwnd, "Total ･ 1h 15m"))?;
    select_segment(hwnd, "Overview")?;
    stable_heat_geometry(hwnd, false, geometry)?;
    Ok(())
}

#[test]
#[ignore = "isolated Win32 desktop"]
fn destination_heatmap_year_range() -> Result<(), Error> {
    if !patina_test_support::run_case()? {
        return Ok(());
    }
    let _com = ComApartment::init()?;
    unsafe { SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2) };
    let root = tempfile::tempdir()?;
    let profile = root.path().join(patina::APP_ID);
    fs::create_dir(&profile)?;
    let db = profile.join("patina.db");
    let today = Local::now().date_naive();
    // Use a completed day so the expected 70 minutes are available even just after midnight.
    let activity_date = today - Days::new(1);
    support::fixture::seed_profile_on(&db, false, activity_date)?;
    let old_date = chrono::NaiveDate::from_ymd_opt(today.year() - 1, 1, 15).unwrap();
    let old_date = old_date - Days::new(old_date.weekday().num_days_from_monday().into());
    let old_start = old_date
        .and_hms_opt(12, 0, 0)
        .unwrap()
        .and_local_timezone(Local)
        .earliest()
        .unwrap()
        .timestamp_millis();
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()?;
    rt.block_on(async {
        let mut db = SqliteConnection::connect_with(&SqliteConnectOptions::new().filename(&db)).await?;
        super::history_timeline::enable_web_history(&mut db).await?;
        sqlx::query("INSERT INTO sessions(exe_name,app_name,start_time,end_time,duration) VALUES ('studio.exe','Studio',?,?,300000)")
            .bind(old_start).bind(old_start+300000).execute(&mut db).await?;
        sqlx::query("INSERT INTO sessions(exe_name,app_name,start_time,end_time,duration) VALUES ('studio.exe','Studio',?,?,600000)")
            .bind(old_start+86_400_000).bind(old_start+86_400_000+600000).execute(&mut db).await?;
        Ok::<(), Error>(())
    })?;
    let mut host = TestChild(
        Command::new(env!("CARGO_BIN_EXE_patina"))
            .env("PATINA_GPUI_PROFILE_PARENT", root.path())
            .arg("--today")
            .spawn()?,
    );
    let hwnd = wait("main", || {
        children::find(host.0.id(), |p| window(p, w!("Patina")))
    })?;
    click(hwnd, "Data")?;
    wait("overview loaded", || named(hwnd, "Total ･ 1h 40m"))?;
    overview_heat_layout(hwnd, activity_date)?;
    select_segment(hwnd, "Details")?;
    for label in ["Apps", "Categories", "Web", "Daily", "Weekly"] {
        let option = wait(label, || segment(hwnd, label))?;
        super::assert_control_height(hwnd, &option, 28)?;
    }
    let heat_button = |name: &str| range_button(hwnd, "Select heatmap range", name);
    let enabled = |name: &str| {
        heat_button(name).filter(|el| unsafe { el.CurrentIsEnabled().is_ok_and(|v| v.as_bool()) })
    };
    let disabled = |name: &str| {
        heat_button(name).filter(|el| unsafe { el.CurrentIsEnabled().is_ok_and(|v| !v.as_bool()) })
    };
    let older = wait("heatmap ready", || enabled("Switch to earlier range"))?;
    assert!(disabled("Switch to newer range").is_some());
    let geometry = chart_heat_geometry(hwnd, true)?;
    activate_control(hwnd, &older, true)?;
    stable_heat_geometry(hwnd, true, geometry)?;
    wait("current year", || named(hwnd, &today.year().to_string()))
        .map_err(|e| format!("{e}; {:?}", names(hwnd)))?;
    full_year_cells(hwnd, true, today.year())?;
    activate_control(
        hwnd,
        &wait("older year available", || {
            enabled("Switch to earlier range")
        })?,
        true,
    )?;
    stable_heat_geometry(hwnd, true, geometry)?;
    wait("previous year", || {
        named(hwnd, &(today.year() - 1).to_string())
    })?;
    wait("earliest year boundary", || {
        disabled("Switch to earlier range")
    })?;
    full_year_cells(hwnd, true, today.year() - 1)?;
    let historic_cell = wait("historic date loaded", || {
        super::button(hwnd, &old_date.to_string())
    })?;
    let description =
        unsafe { historic_cell.GetCurrentPropertyValue(UIA_FullDescriptionPropertyId)? };
    assert!(
        windows::core::BSTR::try_from(&description)?
            .to_string()
            .contains("5m")
    );
    let heat_segment = |name: &str| {
        controls(hwnd).ok()?.into_iter().rev().find(|el| unsafe {
            el.CurrentControlType().ok() == Some(UIA_RadioButtonControlTypeId)
                && el.CurrentName().is_ok_and(|s| s == name)
        })
    };
    let heat_selected = |name: &str| {
        heat_segment(name).filter(|el| unsafe {
            el.GetCurrentPatternAs::<IUIAutomationSelectionItemPattern>(UIA_SelectionItemPatternId)
                .ok()
                .and_then(|p| p.CurrentIsSelected().ok())
                .is_some_and(|v| v.as_bool())
        })
    };
    let heat_bounds = || -> Result<RECT, Error> {
        let panel = controls(hwnd)?
            .into_iter()
            .find(|el| unsafe {
                el.CurrentAutomationId()
                    .is_ok_and(|id| id == "destination-heatmap")
            })
            .ok_or("heatmap panel")?;
        let bounds = unsafe { panel.CurrentBoundingRectangle()? };
        let mut cells = 0;
        for el in controls(hwnd)? {
            if unsafe { el.CurrentAutomationId()? }
                .to_string()
                .starts_with("trend-heat-")
            {
                let cell = unsafe { el.CurrentBoundingRectangle()? };
                assert!(
                    cell.left >= bounds.left && cell.right <= bounds.right,
                    "detail heatmap cell extends outside the panel"
                );
                assert!(cell.right > cell.left, "detail heatmap cell is clipped");
                cells += 1;
            }
        }
        assert!(cells >= 350, "the full year must remain visible");
        Ok(bounds)
    };
    let daily_bounds = heat_bounds()?;
    activate_control(hwnd, &heat_segment("Weekly").ok_or("weekly mode")?, true)?;
    wait("destination weekly selected", || heat_selected("Weekly"))?;
    let description =
        unsafe { historic_cell.GetCurrentPropertyValue(UIA_FullDescriptionPropertyId)? };
    let description = windows::core::BSTR::try_from(&description)?.to_string();
    assert!(description.contains("15m"), "{description}");
    assert!(
        description.contains(&(old_date + Days::new(6)).to_string()),
        "{description}"
    );

    let weekly_bounds = heat_bounds()?;
    assert_eq!(
        daily_bounds.bottom - daily_bounds.top,
        weekly_bounds.bottom - weekly_bounds.top
    );
    unsafe {
        heat_segment("Weekly").ok_or("weekly focus")?.SetFocus()?;
    }
    key(hwnd, 37)?;
    wait("daily keyboard selection", || heat_selected("Daily"))?;
    let description =
        unsafe { historic_cell.GetCurrentPropertyValue(UIA_FullDescriptionPropertyId)? };
    assert!(
        windows::core::BSTR::try_from(&description)?
            .to_string()
            .ends_with(" ･ 5m")
    );
    activate_control(hwnd, &heat_segment("Weekly").ok_or("weekly mode")?, true)?;
    wait("weekly restored", || heat_selected("Weekly"))?;
    select_segment(hwnd, "Overview")?;
    assert!(named(hwnd, "Total ･ 1h 40m").is_some());
    assert!(
        super::selected_segment(hwnd, "Daily").is_some(),
        "overview granularity must remain daily"
    );
    select_segment(hwnd, "Details")?;
    assert!(heat_selected("Weekly").is_some());
    assert!(named(hwnd, &(today.year() - 1).to_string()).is_some());
    assert!(named(hwnd, "Total ･ 1h 15m").is_some());
    activate_control(
        hwnd,
        &wait("newer year", || enabled("Switch to newer range"))?,
        true,
    )?;
    wait("current year restored", || {
        named(hwnd, &today.year().to_string())
    })?;
    activate_control(
        hwnd,
        &wait("recent year", || enabled("Switch to newer range"))?,
        true,
    )?;
    wait("recent year boundary", || disabled("Switch to newer range"))?;
    assert!(
        heat_selected("Weekly").is_some(),
        "year switch must preserve granularity"
    );
    select_segment(hwnd, "Web")?;
    wait("empty web heatmap ready", || {
        enabled("Switch to earlier range")
    })?;
    activate_control(
        hwnd,
        &heat_button("Switch to earlier range").ok_or("web year")?,
        true,
    )?;
    wait("empty web earliest year", || {
        disabled("Switch to earlier range")
    })?;
    assert!(named(hwnd, "Total ･ 0s").is_some());
    assert!(
        heat_selected("Weekly").is_some(),
        "destination mode must preserve granularity"
    );
    let tray = window(host.0.id(), w!("Patina GPUI")).ok_or("tray")?;
    command(tray, 2)?;
    assert!(wait("exit", || host.0.try_wait().ok().flatten())?.success());
    Ok(())
}
#[test]
#[ignore = "isolated Win32 desktop and temporary profile"]
fn restored_data_tab_follows_the_profile() -> Result<(), Error> {
    if !patina_test_support::run_case()? {
        return Ok(());
    }
    let _com = ComApartment::init()?;
    unsafe { SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2) };
    let root = tempfile::tempdir()?;
    let profile = root.path().join(patina::APP_ID);
    fs::create_dir(&profile)?;
    let db = profile.join("patina.db");
    seed(&db)?;
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()?
        .block_on(async {
            let mut conn =
                SqliteConnection::connect_with(&SqliteConnectOptions::new().filename(&db)).await?;
            history_timeline::enable_web_history(&mut conn).await
        })?;
    let launch = || {
        Command::new(env!("CARGO_BIN_EXE_patina"))
            .env("PATINA_GPUI_PROFILE_PARENT", root.path())
            .arg("--main")
            .spawn()
            .map(TestChild)
    };
    let main_window = |pid| children::find(pid, |p| window(p, w!("Patina")));
    let labels = |hwnd, expected| {
        wait("sidebar label toggle", || unsafe {
            let toggle = super::button(hwnd, "Navigation labels")?
                .GetCurrentPatternAs::<IUIAutomationTogglePattern>(UIA_TogglePatternId)
                .ok()?;
            (toggle.CurrentToggleState().ok()? == expected).then_some(())
        })
    };
    let mut host = launch()?;
    let pid = host.0.id();
    let hwnd = wait("first main window", || main_window(pid))?;
    click(hwnd, "Show by category")?;
    wait("Today groups hourly activity", || {
        button(hwnd, "Show total activity")
    })?;
    labels(hwnd, ToggleState_Off)?;
    click(hwnd, "Navigation labels")?;
    labels(hwnd, ToggleState_On)?;
    click(hwnd, "Data")?;
    wait("default overview", || selected_segment(hwnd, "Overview"))?;
    select_segment(hwnd, "Details")?;
    wait("default apps", || selected_segment(hwnd, "Apps"))?;
    select_segment(hwnd, "Categories")?;
    click(hwnd, "Settings")?;
    wait("settings displayed", || named(hwnd, "Show tray icon"))?;
    click(hwnd, "Data")?;
    wait("details after page switch", || {
        selected_segment(hwnd, "Details")
    })?;
    wait("categories after page switch", || {
        selected_segment(hwnd, "Categories")
    })?;
    select_segment(hwnd, "Web")?;
    let tray = wait("tray", || window(pid, w!("Patina GPUI")))?;
    press(hwnd, "Close window")?;
    wait("main released", || main_window(pid).is_none().then_some(()))?;
    command(tray, 4)?;
    let hwnd = wait("tray reopen", || main_window(pid))?;
    wait("details after tray reopen", || {
        selected_segment(hwnd, "Details")
    })?;
    wait("web after tray reopen", || selected_segment(hwnd, "Web"))?;
    labels(hwnd, ToggleState_On)?;
    command(tray, 2)?;
    assert!(wait("complete exit", || host.0.try_wait().ok().flatten())?.success());
    let mut host = launch()?;
    let pid = host.0.id();
    let hwnd = wait("restart", || main_window(pid))?;
    wait("details after restart", || {
        selected_segment(hwnd, "Details")
    })?;
    wait("web after restart", || selected_segment(hwnd, "Web"))?;
    labels(hwnd, ToggleState_On)?;
    click(hwnd, "Navigation labels")?;
    labels(hwnd, ToggleState_Off)?;
    select_segment(hwnd, "Overview")?;
    wait("overview displayed", || selected_segment(hwnd, "Overview"))?;
    let tray = wait("restarted tray", || window(pid, w!("Patina GPUI")))?;
    command(tray, 2)?;
    assert!(wait("second exit", || host.0.try_wait().ok().flatten())?.success());
    let host = launch()?;
    let hwnd = wait("second restart", || main_window(host.0.id()))?;
    wait("overview after restart", || {
        selected_segment(hwnd, "Overview")
    })?;
    labels(hwnd, ToggleState_Off)?;
    select_segment(hwnd, "Details")?;
    wait("overview retained the last detail kind", || {
        selected_segment(hwnd, "Web")
    })?;
    click(hwnd, "History")?;
    wait("History restores Today's hourly mode after restart", || {
        button(hwnd, "Show total activity")
    })?;
    Ok(())
}
