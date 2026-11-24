use super::*;
use serde_json::json;
use std::{
    env,
    io::Write,
    thread,
    time::{Duration, Instant},
};
use windows::Win32::System::{
    Com::{CLSCTX_INPROC_SERVER, CoCreateInstance},
    Variant::VARIANT,
    WindowsProgramming::{QueryInterruptTimePrecise, QueryUnbiasedInterruptTimePrecise},
};
#[path = "foreground_churn.rs"]
mod churn;
#[path = "foreground_dense.rs"]
mod dense;
#[path = "foreground_frames.rs"]
mod frames;
#[path = "foreground_mini.rs"]
mod mini;

fn system_sleep_ms() -> u64 {
    // Only the biased interrupt clock advances while Windows is asleep.
    unsafe {
        QueryInterruptTimePrecise().saturating_sub(QueryUnbiasedInterruptTimePrecise()) / 10_000
    }
}

// All runs copy the same closed database. Only the recorder in each temporary profile writes to it.
fn prepare(path: &Path) -> Result<(), Error> {
    if path.is_file() {
        return Ok(());
    }
    let draft = tempfile::NamedTempFile::new_in(path.parent().ok_or("seed directory")?)?;
    seed(draft.path())?;
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()?;
    rt.block_on(async {
        let options = SqliteConnectOptions::new().filename(draft.path());
        let mut db = SqliteConnection::connect_with(&options).await?;
        history_timeline::enable_web_history(&mut db).await?;
        let mut tx = db.begin().await?;
        sqlx::query("UPDATE settings SET value='0' WHERE key='tracking_paused'")
            .execute(&mut *tx)
            .await?;
        let midnight = Local::now().date_naive().and_hms_opt(0,0,0).unwrap()
            .and_local_timezone(Local).earliest().ok_or("missing local midnight")?.timestamp_millis();
        let icon = "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEUlEQVR4nGNQSDjwH4QZYAwASvQI/dnllI8AAAAASUVORK5CYII=";
        for app in 0..48 {
            let name = format!("Bench {app:02}");
            let exe = format!("bench{app:02}.exe");
            sqlx::query("INSERT INTO icon_cache(exe_name,icon_base64,last_updated) VALUES(?,?,1)")
                .bind(&exe).bind(icon)
                .execute(&mut *tx).await?;
            let domain = format!("site{app:02}.example.org");
            let svg = format!(r##"<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="#2050{app:02x}"/></svg>"##);
            let url = format!("data:image/svg+xml;base64,{}", base64::Engine::encode(&base64::engine::general_purpose::STANDARD, svg));
            sqlx::query("INSERT INTO web_favicon_cache(normalized_domain,favicon_url,updated_at) VALUES(?,?,0)")
                .bind(&domain).bind(url)
                .execute(&mut *tx).await?;
            for day in 0..90 {
                let start = midnight - day * 86_400_000i64 + (80 + i64::from(app)*3)*60_000;
                sqlx::query("INSERT INTO sessions(exe_name,app_name,start_time,end_time,duration)
                    VALUES(?,?,?,?,90000)")
                    .bind(&exe).bind(&name).bind(start).bind(start+90_000)
                    .execute(&mut *tx).await?;
                sqlx::query("INSERT INTO web_activity_segments(browser_client_id,browser_kind,
                    browser_exe_name,domain,normalized_domain,start_time,end_time,duration,created_at,updated_at)
                    VALUES('fixture','chromium','chrome.exe',?,?,?,?,30000,?,?)")
                    .bind(&domain).bind(&domain).bind(start).bind(start+30_000)
                    .bind(start).bind(start+30_000)
                    .execute(&mut *tx).await?;
            }
        }
        tx.commit().await?;
        db.close().await?;
        Ok::<_, Error>(())
    })?;
    match draft.persist_noclobber(path) {
        Ok(_) => (),
        Err(error) if error.error.kind() == std::io::ErrorKind::AlreadyExists => (),
        Err(error) => return Err(error.into()),
    }
    Ok(())
}

struct Driver {
    ui: IUIAutomation,
    hwnd: HWND,
    log: fs::File,
    start: Instant,
    capture_icons: bool,
}

impl Driver {
    fn find(&self, property: UIA_PROPERTY_ID, value: &str) -> Option<IUIAutomationElement> {
        unsafe {
            let root = self.ui.ElementFromHandle(self.hwnd).ok()?;
            let cond = self
                .ui
                .CreatePropertyCondition(property, &VARIANT::from(value))
                .ok()?;
            root.FindFirst(TreeScope_Descendants, &cond).ok()
        }
    }

    fn ready(&self, property: UIA_PROPERTY_ID, value: &str) -> Result<IUIAutomationElement, Error> {
        let from = Instant::now();
        loop {
            if let Some(el) = self.find(property, value) {
                return Ok(el);
            }
            if from.elapsed() > Duration::from_secs(12) {
                return Err(format!("waiting for {value}: {:?}", names(self.hwnd)).into());
            }
            thread::sleep(Duration::from_millis(8));
        }
    }

    fn event(&mut self, kind: &str, data: serde_json::Value) -> Result<(), Error> {
        writeln!(
            self.log,
            "{}",
            json!({"utc":Utc::now(),"ms":self.start.elapsed().as_millis(),"kind":kind,"data":data})
        )?;
        Ok(())
    }

    fn visit(
        &mut self,
        round: usize,
        label: &str,
        marker: &str,
        id: bool,
        page: Option<&str>,
    ) -> Result<(), Error> {
        let el = wait(label, || {
            self.find(UIA_NamePropertyId, label)
                .filter(|el| unsafe { el.CurrentIsEnabled().is_ok_and(|v| v.as_bool()) })
        })?;
        let started = Instant::now();
        activate_control(self.hwnd, &el, false)?;
        if let Some(title) = page {
            let until = Instant::now() + Duration::from_secs(12);
            while !self
                .find(UIA_AutomationIdPropertyId, "page-title")
                .is_some_and(|el| unsafe { el.CurrentName().is_ok_and(|n| n == title) })
            {
                if Instant::now() > until {
                    return Err(format!("title {title} timed out").into());
                }
                thread::sleep(Duration::from_millis(8));
            }
        }
        let title_ms = started.elapsed().as_secs_f64() * 1000.;
        self.ready(
            if id {
                UIA_AutomationIdPropertyId
            } else {
                UIA_NamePropertyId
            },
            marker,
        )?;
        self.event("ready",json!({"round":round,"label":label,"marker":marker,"clickMs":started.duration_since(self.start).as_secs_f64()*1000.,"headerMs":page.map(|_| title_ms),"contentMs":started.elapsed().as_secs_f64()*1000.}))?;
        if self.capture_icons && matches!(label, "Apps" | "Web" | "Classification" | "Details") {
            let item = if label == "Web" {
                "example.org"
            } else {
                "Bench 00"
            };
            let bounds = unsafe {
                let root = self.ui.ElementFromHandle(self.hwnd)?;
                let name = self
                    .ui
                    .CreatePropertyCondition(UIA_NamePropertyId, &VARIANT::from(item))?;
                let image = self.ui.CreatePropertyCondition(
                    UIA_ControlTypePropertyId,
                    &VARIANT::from(UIA_ImageControlTypeId.0),
                )?;
                let condition = self.ui.CreateAndCondition(&name, &image)?;
                root.FindFirst(TreeScope_Descendants, &condition)
                    .ok()
                    .and_then(|el| el.CurrentBoundingRectangle().ok())
                    .and_then(|r| {
                        let mut at = windows::Win32::Foundation::POINT {
                            x: r.left,
                            y: r.top,
                        };
                        windows::Win32::Graphics::Gdi::ScreenToClient(self.hwnd, &mut at)
                            .ok()
                            .ok()?;
                        Some([at.x, at.y, at.x + r.right - r.left, at.y + r.bottom - r.top])
                    })
            };
            self.event("icon-region",json!({"round":round,"label":label,"item":item,"clientPixels":bounds,"clickMs":started.duration_since(self.start).as_secs_f64()*1000.}))?;
        }
        Ok(())
    }

    fn route(&mut self, round: usize, cold: bool, mode: &str) -> Result<(), Error> {
        if mode == "tools" {
            self.visit(round, "Tools", "Reminder", false, Some("Tools"))?;
            self.ready(UIA_NamePropertyId, "Focus")?;
            self.visit(round, "Reminder", "Create", false, None)?;
            self.visit(round, "Plugin home", "Focus", false, None)?;
            self.visit(round, "Focus", "New focus session", false, None)?;
            self.visit(round, "Today", "today-ranking-count", true, Some("Today"))?;
            self.visit(round, "Tools", "New focus session", false, Some("Tools"))?;
            self.visit(round, "Plugin home", "Reminder", false, None)?;
            self.visit(round, "Today", "today-ranking-count", true, Some("Today"))?;
            return self.event("round", json!(round));
        }
        if mode == "churn" {
            return churn::visit_catalog(self);
        }
        if matches!(mode, "dense" | "dense-frames" | "detail") {
            return dense::measure(self, mode == "detail");
        }
        if mode == "cancel" {
            let data = self.ready(UIA_NamePropertyId, "Data")?;
            let today = self.ready(UIA_NamePropertyId, "Today")?;
            activate_control(self.hwnd, &data, false)?;
            activate_control(self.hwnd, &today, false)?;
            thread::sleep(Duration::from_secs(1));
            let title = self.ready(UIA_AutomationIdPropertyId, "page-title")?;
            assert!(unsafe { title.CurrentName()? } == "Today");
            self.ready(UIA_NamePropertyId, "View details for Studio")?;
            return self.event("round", json!(round));
        }
        let today = Local::now().date_naive();
        let rank_marker = if mode.starts_with("soak-") && round > 0 {
            "View details for Fixture"
        } else {
            "View details for Studio"
        };
        let points = [
            ("History", rank_marker, false, true),
            ("Data", "Overview", false, true),
            ("Overview", &format!("overview-trend-{today}"), true, false),
            ("Details", &format!("selection-trend-{today}"), true, false),
            ("Classification", "Apps", false, true),
            ("Apps", "Edit app name", false, false),
            ("Web", "Search websites", false, false),
            ("Tools", "Reminder", false, true),
            ("Settings", "+ Activity hold time", false, true),
            ("About", "Not checked", false, true),
            ("Today", rank_marker, false, true),
        ];
        for (label, marker, id, page) in points {
            if matches!(mode, "data" | "data-catalog")
                && !matches!(label, "Data" | "Overview" | "Details" | "Today")
            {
                continue;
            }
            self.visit(round, label, marker, id, page.then_some(label))?;
            if mode == "data-catalog" && label == "Details" && round == 0 {
                churn::count_rank_controls(self)?;
            }
            if cold {
                thread::sleep(Duration::from_secs(3));
            } else if self.capture_icons {
                // Leave several independent captures of the settled target before the next click.
                thread::sleep(Duration::from_millis(240));
            }
        }
        self.event("round", json!(round))
    }
}

#[test]
#[ignore = "ten-minute foreground resource measurement on an isolated Windows desktop"]
fn foreground_pages() -> Result<(), Error> {
    if !patina_test_support::run_case()? {
        return Ok(());
    }
    let _com = ComApartment::init()?;
    unsafe {
        SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
    }
    let repo = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let out = env::var_os("PATINA_MEASURE_OUTPUT")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            repo.join("artifacts/runtime-smoke")
                .join(
                    Utc::now()
                        .format("foreground-%Y%m%dT%H%M%S%.3fZ")
                        .to_string(),
                )
                .join("run")
        });
    let seed_path = out.parent().ok_or("output parent")?.join("seed.db");
    fs::create_dir_all(out.parent().unwrap())?;
    fs::create_dir(&out)?;
    prepare(&seed_path)?;
    let mode = env::var("PATINA_MEASURE_MODE").unwrap_or_default();
    let temporary = tempfile::tempdir()?;
    let root = if mode.starts_with("soak-") {
        let path = out.join("profile");
        fs::create_dir(&path)?;
        path
    } else {
        temporary.path().to_owned()
    };
    let dir = root.join(patina::PROFILE_DIRECTORY);
    fs::create_dir(&dir)?;
    let db = dir.join("patina.db");
    fs::copy(seed_path, &db)?;
    let exe = r"C:\fixture\fixture.exe";
    fs::write(
        root.join("native-probe-fixture.json"),
        serde_json::to_vec(
            &json!({"foreground":{"hwnd":"0x42","root_owner_hwnd":"0x42","process_id":42,"window_class":"Fixture","title":"Fixture","exe_name":"fixture.exe","process_path":exe,"is_afk":false,"idle_time_ms":0},"names":{(exe):"Fixture"}}),
        )?,
    )?;
    let binary =
        env::var_os("PATINA_MEASURE_BINARY").unwrap_or_else(|| env!("CARGO_BIN_EXE_patina").into());
    let sampler = env::var_os("PATINA_MEASURE_SAMPLER").map_or_else(
        || {
            Path::new(env!("CARGO_BIN_EXE_patina"))
                .with_file_name("examples")
                .join("windows-resource-sample.exe")
        },
        PathBuf::from,
    );
    if !matches!(
        mode.as_str(),
        "" | "smoke"
            | "tools"
            | "data"
            | "data-catalog"
            | "cancel"
            | "idle"
            | "frames"
            | "dense"
            | "dense-frames"
            | "churn"
            | "soak-window"
            | "soak-window-tray"
            | "soak-window-mini-tray"
            | "detail"
            | "soak-tray"
    ) {
        return Err(format!("unknown measurement mode: {mode}").into());
    }
    if matches!(mode.as_str(), "churn" | "data-catalog") {
        churn::seed_catalog(&db)?;
    }
    let quick = matches!(
        mode.as_str(),
        "smoke"
            | "tools"
            | "data"
            | "data-catalog"
            | "cancel"
            | "frames"
            | "dense"
            | "dense-frames"
            | "churn"
            | "detail"
    );
    let soak = mode.starts_with("soak-");
    let hold = if soak {
        env::var("PATINA_MEASURE_HOLD_SECONDS")
            .ok()
            .map(|s| s.parse::<u64>())
            .transpose()?
            .unwrap_or(24 * 3600)
    } else {
        0
    };
    let mini_phases = if mode == "soak-window-mini-tray" {
        let durations = env::var("PATINA_MEASURE_PHASE_SECONDS")?
            .split(',')
            .map(str::parse::<u64>)
            .collect::<Result<Vec<_>, _>>()?;
        let phases: [u64; 4] = durations
            .try_into()
            .map_err(|_| "expected four phase lengths")?;
        if phases.contains(&0)
            || phases.iter().try_fold(0_u64, |sum, &n| sum.checked_add(n)) != Some(hold)
        {
            return Err("phase lengths must be positive and sum to the residence duration".into());
        }
        Some(phases)
    } else {
        None
    };
    let combined = mode == "soak-window-tray" || mini_phases.is_some();
    let short_hold = combined && hold < 300;
    let secs = if combined {
        hold + 120
    } else if soak {
        hold + 480
    } else if mode == "churn" {
        450
    } else if mode == "data-catalog" {
        120
    } else if quick {
        60
    } else {
        600
    };
    let start = Instant::now();
    let started_at_ms = Utc::now().timestamp_millis();
    let mut app = TestChild(
        Command::new(binary)
            .env("PATINA_PROFILE_PARENT", &root)
            .env_remove("PATINA_DEV_SESSION")
            .env("PATINA_E2E", "1")
            .env("PATINA_E2E_DATA_ROOT", &root)
            .env("PATINA_E2E_NATIVE_FIXTURE", "1")
            .stderr(fs::File::create(out.join("app.log"))?)
            .arg("--today")
            .spawn()?,
    );
    let pid = app.0.id();
    let mut sample = TestChild(
        Command::new(sampler)
            .arg(pid.to_string())
            .arg(out.join("tree.jsonl"))
            .arg(secs.to_string())
            .args([
                if soak && !short_hold { "30" } else { "2" },
                if soak { &mode } else { "foreground-pages" },
            ])
            .spawn()?,
    );
    let main_window = || children::find(pid, |child| window(child, w!("Patina")));
    let tray = wait("tray", || window(pid, w!("Patina Tray")))?;
    let hwnd = wait("main", main_window)?;
    let mut renderer = 0;
    let mut rect = RECT::default();
    let mut client = RECT::default();
    unsafe {
        GetWindowThreadProcessId(hwnd, Some(&mut renderer));
        GetWindowRect(hwnd, &mut rect)?;
        GetClientRect(hwnd, &mut client)?;
    }
    let mut d = Driver {
        ui: unsafe { CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER)? },
        hwnd,
        log: fs::File::create_new(out.join("events.jsonl"))?,
        start,
        capture_icons: mode == "frames",
    };
    d.ready(
        UIA_NamePropertyId,
        if combined {
            "Focus share"
        } else {
            "View details for Studio"
        },
    )?;
    d.event("cold",json!({"host":pid,"ui":renderer,"driver":std::process::id(),"sampler":sample.0.id(),"dpi":unsafe{GetDpiForWindow(hwnd)},"width":rect.right-rect.left,"height":rect.bottom-rect.top,"clientWidth":client.right,"clientHeight":client.bottom}))?;
    let until = |s| thread::sleep(Duration::from_secs(s).saturating_sub(start.elapsed()));
    let navigating = mode != "idle";
    let capture = if matches!(mode.as_str(), "frames" | "dense-frames") {
        let mut navigation = Vec::new();
        for label in [
            "Today",
            "History",
            "Data",
            "Classification",
            "Tools",
            "Settings",
            "About",
        ] {
            let button = d.ready(UIA_NamePropertyId, label)?;
            let rect = unsafe { button.CurrentBoundingRectangle()? };
            let mut at = windows::Win32::Foundation::POINT {
                x: rect.left + (rect.right - rect.left) / 4,
                y: (rect.top + rect.bottom) / 2,
            };
            unsafe {
                windows::Win32::Graphics::Gdi::ScreenToClient(hwnd, &mut at).ok()?;
            }
            navigation.push((label, at.x, at.y));
        }
        Some(frames::Capture::start(
            hwnd,
            &out.join("frames.jsonl"),
            start,
            navigation,
        )?)
    } else {
        None
    };
    if !combined {
        until(if quick { 3 } else { 60 });
    }
    if navigating && !combined {
        d.route(0, !quick, &mode)?;
    }
    if !combined {
        until(if quick { 10 } else { 120 });
    }
    let count = if soak || matches!(mode.as_str(), "dense" | "dense-frames" | "detail" | "churn") {
        0
    } else if quick && !matches!(mode.as_str(), "data" | "data-catalog" | "tools") {
        2
    } else {
        8
    };
    for i in 1..=count {
        if navigating {
            d.route(i, false, &mode)?;
        }
        if !quick {
            thread::sleep(Duration::from_secs(4));
            until(120 + (i as u64) * 22);
        }
    }
    d.event("idle", json!({}))?;
    let catalog_close = start.elapsed().as_secs() + 50;
    if let Some(capture) = capture {
        capture.finish()?;
    }
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()?;
    let mut conn = rt.block_on(SqliteConnection::connect_with(
        &SqliteConnectOptions::new().filename(&db).read_only(true),
    ))?;
    let recording = |conn: &mut SqliteConnection| {
        rt.block_on(sqlx::query_as::<_,(i64,i64)>("SELECT s.id,CAST(t.value AS INTEGER) FROM sessions s JOIN settings t ON t.key='__tracker_last_successful_sample_ms' WHERE s.exe_name='fixture.exe' AND s.end_time IS NULL").fetch_one(conn))
    };
    let mut suspensions = Vec::new();
    let mut hold_until = |end: u64,
                          shown: bool,
                          mini_state: mini::MiniState,
                          driver: &mut Driver,
                          conn: &mut SqliteConnection|
     -> Result<(), Error> {
        let mut last_check = Utc::now().timestamp_millis();
        let mut previous_sleep = system_sleep_ms();
        loop {
            let now = Utc::now().timestamp_millis();
            let gap = now - last_check;
            let total_sleep = system_sleep_ms();
            let slept = total_sleep.saturating_sub(previous_sleep);
            if slept >= 1000 {
                driver.event(
                    "system-sleep",
                    json!({"fromMs":last_check,"toMs":now,"sleepMs":slept}),
                )?;
                suspensions.push((last_check, now, slept));
            }
            last_check = now;
            previous_sleep = total_sleep;
            let (id, heartbeat) = if gap > 90_000 || slept >= 1000 {
                driver.event("sampling-interruption", json!({"gapMs":gap}))?;
                wait("recorder after sampling interruption", || {
                    recording(conn)
                        .ok()
                        .filter(|(_, t)| Utc::now().timestamp_millis() - t < 30_000)
                })?
            } else {
                recording(conn)?
            };
            let age = Utc::now().timestamp_millis() - heartbeat;
            let visible = main_window().is_some_and(|w| unsafe { IsWindowVisible(w).as_bool() });
            let mini_size = if mini_phases.is_some() {
                mini_state.verify(pid, renderer, driver)?
            } else {
                None
            };
            driver.event(
                "recording-check",
                json!({"session":id,"heartbeat":heartbeat,"ageMs":age,"windowVisible":visible,"miniSizeDip":mini_size}),
            )?;
            assert_eq!(visible, shown, "window visibility changed during the hold");
            assert!(age < 30_000, "fixture recorder heartbeat is {age} ms old");
            if start.elapsed() >= Duration::from_secs(end) {
                break;
            }
            thread::sleep(
                Duration::from_secs(if short_hold { 3 } else { 60 })
                    .min(Duration::from_secs(end).saturating_sub(start.elapsed())),
            );
        }
        Ok(())
    };
    if mode == "soak-window" || combined {
        d.visit(0, "Classification", "Apps", false, Some("Classification"))?;
        d.visit(0, "Apps", "Edit app name", false, None)?;
        if combined {
            wait("initial fixture recording", || recording(&mut conn).ok())?;
        }
        d.event("foreground-hold", json!({}))?;
        let end = if combined {
            start.elapsed().as_secs_f64().ceil() as u64 + mini_phases.map_or(hold / 2, |p| p[0])
        } else {
            hold + 180
        };
        hold_until(end, true, mini::MiniState::Closed, &mut d, &mut conn)?;
        d.event("foreground-end", json!({}))?;
        let top = d.ready(UIA_NamePropertyId, "Edit app name")?;
        let at = unsafe { top.CurrentBoundingRectangle()? };
        let x = (at.left + at.right) / 2;
        let y = (at.top + at.bottom) / 2;
        for _ in 0..4 {
            unsafe {
                PostMessageW(
                    Some(hwnd),
                    WM_MOUSEWHEEL,
                    WPARAM((-120_i32 as u32 as usize) << 16),
                    LPARAM(((y as isize) << 16) | (x as u16 as isize)),
                )?;
            }
        }
        wait("foreground list scrolled after overnight hold", || {
            let next = unsafe { top.CurrentBoundingRectangle() }.ok();
            next.is_none_or(|bounds| bounds.top != at.top).then_some(())
        })?;
        d.event("foreground-scroll", json!({}))?;
        if combined {
            d.visit(1, "History", "Day Timeline", false, Some("History"))?;
            d.visit(1, "Today", "Focus share", false, Some("Today"))?;
        } else {
            d.route(1, false, &mode)?;
        }
    }
    until(if combined {
        0
    } else if soak {
        180
    } else if mode == "churn" {
        catalog_close
    } else if mode == "data-catalog" {
        90
    } else if quick {
        38
    } else {
        480
    });
    let before = recording(&mut conn)?;
    let mini_hwnd = if mini_phases.is_some() {
        command(tray, 1)?;
        Some(wait("resident Mini", || mini::find(pid))?)
    } else {
        None
    };
    unsafe {
        PostMessageW(Some(hwnd), WM_CLOSE, WPARAM(0), LPARAM(0))?;
    }
    if let (Some(mini_hwnd), Some(phases)) = (mini_hwnd, mini_phases) {
        wait("main closed with Mini remaining", || {
            main_window().is_none().then_some(())
        })?;
        key(mini_hwnd, 27)?;
        wait("folded Mini region", || {
            (mini::dimensions(mini_hwnd) == Some([112, 24])).then_some(())
        })?;
        d.event("mini-folded", json!({"ui":renderer}))?;
        let end = start.elapsed().as_secs_f64().ceil() as u64 + phases[1];
        hold_until(
            end,
            false,
            mini::MiniState::Folded(mini_hwnd),
            &mut d,
            &mut conn,
        )?;
        d.event("mini-folded-end", json!({}))?;
        mini::expand_and_pin(mini_hwnd)?;
        d.event("mini-pinned", json!({"ui":renderer}))?;
        let end = start.elapsed().as_secs_f64().ceil() as u64 + phases[2];
        hold_until(
            end,
            false,
            mini::MiniState::Pinned(mini_hwnd),
            &mut d,
            &mut conn,
        )?;
        d.event("mini-pinned-end", json!({}))?;
        unsafe {
            PostMessageW(Some(mini_hwnd), WM_CLOSE, WPARAM(0), LPARAM(0))?;
        }
        wait("resident Mini closed", || {
            mini::find(pid).is_none().then_some(())
        })?;
    }
    wait("renderer exited", || {
        (!children::children(pid).ok()?.contains(&renderer)).then_some(())
    })?;
    d.event("tray", json!(before))?;
    if soak {
        let end = if combined {
            start.elapsed().as_secs_f64().ceil() as u64
                + mini_phases.map_or(hold - hold / 2, |p| p[3])
        } else {
            hold + 240
        };
        hold_until(end, false, mini::MiniState::Closed, &mut d, &mut conn)?;
        d.event("tray-end", json!({}))?;
    } else {
        until(if mode == "churn" {
            catalog_close + 36
        } else if mode == "data-catalog" {
            105
        } else if quick {
            48
        } else {
            540
        });
    }
    let after = recording(&mut conn)?;
    assert!(
        (soak || before.0 == after.0) && before.1 < after.1,
        "recording interrupted"
    );
    let reopen_start = Instant::now();
    unsafe {
        PostMessageW(
            Some(tray),
            WM_APP + 1,
            WPARAM(0),
            LPARAM(windows::Win32::UI::Shell::NIN_SELECT as isize),
        )?;
    }
    d.hwnd = wait("reopened main", main_window)?;
    d.event(
        "reopen-visible",
        json!({"elapsedMs":reopen_start.elapsed().as_secs_f64()*1000.}),
    )?;
    if soak {
        if combined {
            d.ready(UIA_NamePropertyId, "Focus share")?;
            d.event(
                "reopen-ready",
                json!({"elapsedMs":reopen_start.elapsed().as_secs_f64()*1000.}),
            )?;
            d.visit(2, "History", "Day Timeline", false, Some("History"))?;
            d.visit(2, "Today", "Focus share", false, Some("Today"))?;
        } else {
            d.ready(UIA_NamePropertyId, "View details for Fixture")?;
            d.route(2, false, &mode)?;
        }
        let gaps: Vec<(i64,i64)> = rt.block_on(sqlx::query_as(
            "WITH ordered AS (SELECT start_time, LAG(end_time) OVER (ORDER BY start_time, id) AS previous_end
             FROM sessions WHERE exe_name='fixture.exe' AND (end_time IS NULL OR end_time >= ?))
             SELECT previous_end, start_time FROM ordered WHERE start_time - previous_end > 30000",
        ).bind(started_at_ms).fetch_all(&mut conn))?;
        let unexplained = gaps
            .iter()
            .filter(|&&(end, resumed)| {
                !suspensions.iter().any(|&(low, high, slept)| {
                    end >= low - 30_000
                        && resumed <= high + 30_000
                        && (resumed - end).abs_diff(slept as i64) <= 30_000
                })
            })
            .count();
        d.event(
            "recording-gaps",
            json!({"over30s":gaps.len(),"intervals":gaps,"unexplained":unexplained}),
        )?;
        assert_eq!(
            unexplained, 0,
            "isolated fixture recording has an unexplained gap"
        );
    } else {
        d.ready(UIA_NamePropertyId, "View details for Studio")?;
    }
    let mut next_pid = 0;
    unsafe {
        GetWindowThreadProcessId(d.hwnd, Some(&mut next_pid));
    }
    d.event("reopened", json!({"ui":next_pid,"recording":after}))?;
    assert!(sample.0.wait()?.success());
    let samples = fs::read_to_string(out.join("tree.jsonl"))?;
    let footer: serde_json::Value =
        serde_json::from_str(samples.lines().last().ok_or("empty measurement")?)?;
    assert!(
        footer["complete"] == true
            && footer["stopReason"] == "duration"
            && footer["unavailableSamples"] == 0,
        "{footer}"
    );
    command(tray, 2)?;
    assert!(wait("host shutdown", || app.0.try_wait().ok().flatten())?.success());
    let end: i64 = rt.block_on(
        sqlx::query_scalar("SELECT end_time FROM sessions WHERE id=?")
            .bind(after.0)
            .fetch_one(&mut conn),
    )?;
    assert!(end >= after.1);
    d.event("sealed", json!(end))?;
    Ok(())
}
