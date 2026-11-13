#[path = "../../test-support/children.rs"]
mod children;
#[path = "../../test-support/windows.rs"]
mod desktop;
#[path = "today/handles.rs"]
mod handles;
mod support;
use support::*;

use chrono::{Local, TimeZone, Utc};
use desktop::{ComApartment, Error, TestChild, controls, wait, window};
use sqlx::{Connection, SqliteConnection, sqlite::SqliteConnectOptions};
use std::{fs, path::Path, process::Command};
use windows::{
    Win32::{
        Foundation::{HWND, LPARAM, RECT, WPARAM},
        UI::{Accessibility::*, HiDpi::*, WindowsAndMessaging::*},
    },
    core::w,
};

#[test]
fn totals_and_classification() -> Result<(), Error> {
    let root = tempfile::tempdir()?;
    let db = root.path().join("patina.db");
    seed(&db)?;
    let recorder = patina_recorder::Recorder::start(&db, || {})?;
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()?;
    let noon = Local::now()
        .date_naive()
        .and_hms_opt(12, 0, 0)
        .unwrap()
        .and_local_timezone(Local)
        .earliest()
        .unwrap()
        .timestamp_millis();
    let read = || async {
        let pool = sqlx::SqlitePool::connect_with(SqliteConnectOptions::new().filename(&db))
            .await
            .map_err(|e| e.to_string())?;
        patina_recorder::DaySummary::load(pool, noon, recorder.locale.get()).await
    };
    let data = rt.block_on(read())?;
    let minute = 60_000;
    assert_eq!(data.total, 70 * minute);
    assert_eq!(data.yesterday, 30 * minute);
    assert_eq!(
        data.apps
            .iter()
            .map(|a| a.duration / minute)
            .collect::<Vec<_>>(),
        [45, 20, 5]
    );
    assert_eq!(data.apps[1].hours[..2], [15 * minute, 5 * minute]);
    assert!(data.apps[2].anonymous);
    rt.block_on(recorder.edit_app(
        "studio.exe".into(),
        patina_recorder::AppEdit::Category("office".into()),
    ))?;
    assert!(
        rt.block_on(recorder.edit_app(
            "activity:anonymous".into(),
            patina_recorder::AppEdit::Category("office".into())
        ))
        .is_err()
    );
    let data = rt.block_on(read())?;
    assert_eq!(data.categories[0].duration, 65 * minute);
    assert_eq!(data.apps[0].name, "Studio");
    recorder.shutdown()?;
    Ok(())
}

fn hourly_keyboard(hwnd: HWND, toggle: &IUIAutomationElement, grouped: bool) -> Result<(), Error> {
    let tooltip = || -> Option<String> {
        controls(hwnd).ok()?.into_iter().find_map(|el| unsafe {
            (el.CurrentControlType().ok()? == UIA_ToolTipControlTypeId)
                .then(|| el.CurrentName().ok().map(|s| s.to_string()))
                .flatten()
        })
    };
    let first_hour = wait("first hour", || {
        controls(hwnd).ok()?.into_iter().find(|el| unsafe {
            el.CurrentName()
                .is_ok_and(|s| s.to_string().starts_with("00:00 · Active 60m"))
                && el.CurrentControlType().ok() != Some(UIA_ToolTipControlTypeId)
        })
    })?;
    let move_to = |element| -> Result<(), Error> {
        let position = client_center(hwnd, element)?;
        unsafe {
            PostMessageW(Some(hwnd), WM_MOUSEMOVE, WPARAM(0), position)?;
        }
        Ok(())
    };
    move_to(toggle)?;
    move_to(&first_hour)?;
    wait("pointer opens the hour tooltip", || {
        tooltip().filter(|s| s.starts_with("00:00 · Active 60m"))
    })?;
    move_to(toggle)?;
    wait("pointer leaves the hour", || {
        tooltip().is_none().then_some(())
    })?;
    unsafe {
        first_hour.SetFocus()?;
    }
    wait("focus opens the first active hour tooltip", || {
        tooltip().filter(|s| s.starts_with("00:00 · Active 60m"))
    })?;
    unsafe {
        toggle.SetFocus()?;
    }
    wait("focus leaves the column", || {
        tooltip().is_none().then_some(())
    })?;
    key(hwnd, 9)?;
    let first = wait("Tab enters the first active hour", || {
        tooltip().filter(|s| s.starts_with("00:00 · Active 60m"))
    })?;
    if grouped {
        assert!(
            first.contains("Dev 45m") && first.contains("Office 15m"),
            "{first}"
        );
    } else {
        assert_eq!(first, "00:00 · Active 60m");
    }
    key(hwnd, 27)?;
    wait("Escape dismisses the tooltip", || {
        tooltip().is_none().then_some(())
    })?;
    key(hwnd, 9)?;
    let next = wait("Tab continues to the next active hour", || {
        tooltip().filter(|s| s.starts_with("01:00 · Active 10m"))
    })?;
    if grouped {
        assert!(
            next.contains("Anonymous 5m") && next.contains("Office 5m"),
            "{next}"
        );
    }
    key(hwnd, 9)?;
    wait("Tab skips empty hours and leaves the chart", || {
        tooltip().is_none().then_some(())
    })?;
    let empty = named(hwnd, "02:00 · Active 0m").ok_or("missing empty hour")?;
    assert!(!unsafe { empty.CurrentIsKeyboardFocusable()? }.as_bool());
    Ok(())
}

fn context_menu(hwnd: HWND, trigger: &IUIAutomationElement) -> Result<(), Error> {
    let at = client_center(hwnd, trigger)?;
    unsafe {
        PostMessageW(Some(hwnd), WM_RBUTTONDOWN, WPARAM(2), at)?;
        PostMessageW(Some(hwnd), WM_RBUTTONUP, WPARAM(0), at)?;
    }
    Ok(())
}

fn app_actions(hwnd: HWND) -> Result<(), Error> {
    let trigger = named(hwnd, "View details for Studio").ok_or("app trigger")?;
    unsafe {
        trigger.SetFocus()?;
    }
    key(hwnd, 13)?;
    wait("app detail dialog", || named(hwnd, "Close"))?;
    key(hwnd, 27)?;
    wait("app detail dismissed", || {
        named(hwnd, "Close").is_none().then_some(())
    })?;
    context_menu(hwnd, &trigger)?;
    let office = wait("classification options", || {
        controls(hwnd).ok()?.into_iter().find(|el| unsafe {
            el.CurrentName().is_ok_and(|s| s == "Office")
                && el.CurrentControlType().ok() == Some(UIA_ButtonControlTypeId)
        })
    })?;
    let invoke: IUIAutomationInvokePattern =
        unsafe { office.GetCurrentPatternAs(UIA_InvokePatternId)? };
    unsafe {
        invoke.Invoke()?;
    }
    wait("saved category in hourly chart", || {
        names(hwnd)
            .iter()
            .any(|s| s.contains("Office 60m"))
            .then_some(())
    })?;
    context_menu(hwnd, &trigger)?;
    let rename = wait("rename action", || named(hwnd, "Change name"))?;
    let rename: IUIAutomationInvokePattern =
        unsafe { rename.GetCurrentPatternAs(UIA_InvokePatternId)? };
    unsafe {
        rename.Invoke()?;
    }
    let field = wait("name editor", || {
        controls(hwnd)
            .ok()?
            .into_iter()
            .find(|el| unsafe { el.CurrentControlType().ok() == Some(UIA_EditControlTypeId) })
    })
    .map_err(|e| format!("{e}; visible nodes: {:?}", names(hwnd)))?;
    let input: IUIAutomationValuePattern =
        unsafe { field.GetCurrentPatternAs(UIA_ValuePatternId)? };
    unsafe {
        input.SetValue(&"Workroom".into())?;
    }
    let save = wait("enabled save name", || {
        named(hwnd, "Save").filter(|e| unsafe { e.CurrentIsEnabled().is_ok_and(|b| b.as_bool()) })
    })?;
    let save: IUIAutomationInvokePattern =
        unsafe { save.GetCurrentPatternAs(UIA_InvokePatternId)? };
    unsafe {
        save.Invoke()?;
    }
    wait("renamed ranking", || {
        named(hwnd, "View details for Workroom")
    })?;
    Ok(())
}

fn headings(hwnd: HWND) -> Result<serde_json::Value, Error> {
    use windows::Win32::{Foundation::POINT, Graphics::Gdi::ClientToScreen};
    let mut origin = POINT::default();
    unsafe {
        ClientToScreen(hwnd, &mut origin).ok()?;
    }
    let mut positions = serde_json::Map::new();
    for el in controls(hwnd)? {
        let name = unsafe { el.CurrentName()? }.to_string();
        if ["Focus share", "Today's Activity", "Top Apps"].contains(&name.as_str())
            && !positions.contains_key(&name)
        {
            let r = unsafe { el.CurrentBoundingRectangle()? };
            positions.insert(
                name,
                serde_json::json!([r.left - origin.x, r.top - origin.y]),
            );
        }
    }
    assert_eq!(positions.len(), 3);
    Ok(positions.into())
}

#[test]
#[ignore = "requires the prepared Tauri baseline, the native run directory and an interactive desktop"]
fn tauri_comparison() -> Result<(), Error> {
    use std::{
        env,
        net::{TcpListener, TcpStream},
        os::windows::process::CommandExt,
        process::Stdio,
    };
    let _com = ComApartment::init()?;
    unsafe { SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2) };
    let out =
        std::path::PathBuf::from(env::var_os("PATINA_TODAY_RUN").ok_or("set PATINA_TODAY_RUN")?);
    let manifest: serde_json::Value = serde_json::from_slice(&fs::read(
        env::var_os("PATINA_TAURI_MANIFEST").ok_or("set PATINA_TAURI_MANIFEST")?,
    )?)?;
    let root = tempfile::Builder::new()
        .prefix("patina-tauri-e2e-")
        .tempdir()?;
    fs::create_dir(root.path().join("data"))?;
    fs::copy(out.join("fixture.db"), root.path().join("data/patina.db"))?;
    let port = manifest["frontendPort"].as_u64().ok_or("frontend port")? as u16;
    let address = ("127.0.0.1", port);
    let probe = TcpListener::bind(address)?;
    drop(probe);
    let mut server = TestChild(
        Command::new("python")
            .args([
                "-m",
                "http.server",
                &port.to_string(),
                "--bind",
                "127.0.0.1",
                "--directory",
                manifest["frontend"].as_str().ok_or("frontend directory")?,
            ])
            .creation_flags(0x08000000)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()?,
    );
    wait("Tauri assets", || TcpStream::connect(address).ok())?;
    assert!(server.0.try_wait()?.is_none());
    let devtools = TcpListener::bind(("127.0.0.1", 0))?.local_addr()?.port();
    let mut child = TestChild(
        Command::new(manifest["binary"].as_str().ok_or("Tauri baseline binary")?)
            .env("PATINA_E2E", "1")
            .env("PATINA_E2E_SINGLE_INSTANCE", "1")
            .env("PATINA_E2E_DATA_ROOT", root.path())
            .env("PATINA_E2E_STORAGE_ID", root.path().file_name().unwrap())
            .env(
                "PATINA_E2E_FRONTEND_URL",
                format!("http://127.0.0.1:{port}"),
            )
            .env("PATINA_E2E_DEVTOOLS_PORT", devtools.to_string())
            .env(
                "TAURI_CONFIG",
                manifest["config"].as_str().ok_or("Tauri config")?,
            )
            .spawn()?,
    );
    let hwnd = wait("baseline main window", || {
        window(child.0.id(), w!("Patina"))
    })?;
    wait("Tauri Today data", || {
        names(hwnd).contains(&"Studio".into()).then_some(())
    })?;
    if std::env::var_os("PATINA_COMPARE_PAGE_LAYOUT").is_some() {
        capture_original_pages(hwnd, &out)?;
        unsafe {
            PostMessageW(Some(hwnd), WM_CLOSE, WPARAM(0), LPARAM(0))?;
        }
        return Ok(());
    }
    let labels = names(hwnd);
    let mut rect = RECT::default();
    unsafe {
        GetClientRect(hwnd, &mut rect)?;
    }
    let dpi = unsafe { GetDpiForWindow(hwnd) };
    let native: serde_json::Value = serde_json::from_slice(&fs::read(out.join("gpui.json"))?)?;
    let fixture_hash = hash(&out.join("fixture.db"))?;
    assert_eq!(native["fixtureHash"], fixture_hash);
    let binary_hash = hash(Path::new(
        manifest["binary"].as_str().ok_or("baseline binary")?,
    ))?;
    assert_eq!(manifest["binaryHash"], binary_hash);
    fs::write(
        out.join("tauri.json"),
        serde_json::to_vec_pretty(
            &serde_json::json!({"labels":labels,"headings":headings(hwnd)?,"client":[rect.right,rect.bottom],"dpi":dpi,"fixtureHash":fixture_hash,"binaryHash":binary_hash}),
        )?,
    )?;
    assert_eq!(
        native["client"],
        serde_json::json!([rect.right, rect.bottom])
    );
    assert_eq!(native["dpi"], dpi);
    for hour in 0..24 {
        let minutes = match hour {
            0 => 60,
            1 => 10,
            _ => 0,
        };
        let hour_label = format!("{hour:02}:00 · Active {minutes}m");
        assert!(labels.contains(&hour_label));
        assert!(
            native["labels"]
                .as_array()
                .unwrap()
                .iter()
                .any(|v| v == &hour_label)
        );
    }
    for label in [
        "1h 10m",
        "Up 40m from yesterday",
        "Top 3",
        "45m",
        "20m",
        "5m",
    ] {
        assert!(
            labels.iter().any(|s| s.contains(label)),
            "missing {label}: {labels:?}"
        );
    }
    let button = controls(hwnd)?
        .into_iter()
        .find(|el| unsafe { el.CurrentName().is_ok_and(|s| s == "Show by category") })
        .ok_or("baseline chart mode")?;
    let toggle: IUIAutomationTogglePattern =
        unsafe { button.GetCurrentPatternAs(UIA_TogglePatternId)? };
    unsafe {
        toggle.Toggle()?;
    }
    wait("Tauri category chart", || {
        names(hwnd)
            .contains(&"Show total activity".into())
            .then_some(())
    })?;
    let sampler = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../src-tauri/target/debug/examples/windows-resource-sample.exe");
    assert!(
        Command::new(sampler)
            .arg(child.0.id().to_string())
            .arg(out.join("tauri-today.jsonl"))
            .args(["30", "5", "tauri-today"])
            .status()?
            .success()
    );
    // This isolated profile is paused; use the window's normal exit policy for teardown.
    unsafe {
        PostMessageW(Some(hwnd), WM_CLOSE, WPARAM(0), LPARAM(0))?;
    }
    assert!(wait("Tauri exit", || child.0.try_wait().ok().flatten())?.success());
    Ok(())
}

#[test]
#[ignore = "requires an interactive Windows desktop and the Windows resource sampler"]
fn main_window_lifecycle() -> Result<(), Error> {
    let _com = ComApartment::init()?;
    unsafe { SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2) };
    let repo = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .canonicalize()?;
    let out = repo
        .join("artifacts/runtime-smoke")
        .join(format!("today-{}", Utc::now().format("%Y%m%dT%H%M%S%.3fZ")));
    fs::create_dir(&out)?;
    let fixture = out.join("fixture.db");
    seed(&fixture)?;
    let root = tempfile::tempdir()?;
    let profile = root.path().join(patina_gpui::APP_ID);
    fs::create_dir(&profile)?;
    fs::copy(&fixture, profile.join("patina.db"))?;
    let exe = r"C:\fixture\fixture.exe";
    fs::write(
        root.path().join("native-probe-fixture.json"),
        serde_json::to_vec(&serde_json::json!({
            "foreground":{"hwnd":"0x42","root_owner_hwnd":"0x42","process_id":42,"window_class":"Fixture","title":"Fixture",
            "exe_name":"fixture.exe","process_path":exe,"is_afk":false,"idle_time_ms":0},"names":{(exe):"Fixture"}
        }))?,
    )?;
    let mut child = TestChild(
        Command::new(env!("CARGO_BIN_EXE_patina-gpui"))
            .env("PATINA_GPUI_PROFILE_PARENT", root.path())
            .env("PATINA_E2E_DATA_ROOT", root.path())
            .env("PATINA_E2E", "1")
            .env("PATINA_E2E_NATIVE_FIXTURE", "1")
            .spawn()?,
    );
    let pid = child.0.id();
    let tray = wait("tray", || window(pid, w!("Patina GPUI")))?;
    let main = || children::find(pid, |p| window(p, w!("Patina")));
    let sample = |state: &str| -> Result<u64, Error> {
        let sampler = repo.join("src-tauri/target/debug/examples/windows-resource-sample.exe");
        let status = Command::new(sampler)
            .arg(pid.to_string())
            .arg(out.join(format!("{state}.jsonl")))
            .args(["30", "5", state])
            .status()?;
        if !status.success() {
            return Err(format!("{state}: {status}").into());
        }
        let mut totals = Vec::new();
        let mut complete = false;
        for line in fs::read_to_string(out.join(format!("{state}.jsonl")))?.lines() {
            let row: serde_json::Value = serde_json::from_str(line)?;
            if let Some(processes) = row["processes"].as_array() {
                let mut bytes = 0;
                for process in processes {
                    bytes += process["privateBytes"]
                        .as_u64()
                        .ok_or("missing private bytes")?;
                }
                totals.push(bytes);
            }
            complete = row["complete"] == true && row["unavailableSamples"] == 0;
        }
        assert!(complete && totals.len() == 7, "incomplete {state} sample");
        totals.sort_unstable();
        Ok(totals[totals.len() / 2])
    };
    println!("Evidence {}", out.display());
    sample("tray-before")?;
    command(tray, 4)?;
    let hwnd = wait("Today", main)?;
    command(tray, 4)?;
    wait("Today snapshot", || {
        names(hwnd).iter().any(|s| s == "Studio").then_some(())
    })?;
    let labels = names(hwnd);
    let mut rect = RECT::default();
    unsafe {
        GetClientRect(hwnd, &mut rect)?;
    }
    println!(
        "client {}x{} dpi {} labels {labels:?}",
        rect.right,
        rect.bottom,
        unsafe { GetDpiForWindow(hwnd) }
    );
    fs::write(
        out.join("gpui.json"),
        serde_json::to_vec_pretty(
            &serde_json::json!({"labels":labels,"headings":headings(hwnd)?,"client":[rect.right,rect.bottom],"dpi":unsafe{GetDpiForWindow(hwnd)},
                "fixtureHash":hash(&fixture)?,"binaryHash":hash(Path::new(env!("CARGO_BIN_EXE_patina-gpui")))?}),
        )?,
    )?;
    for label in [
        "1h 10m",
        "Up 40m from yesterday",
        "Top 3",
        "45m · 64%",
        "20m · 29%",
        "5m · 7%",
    ] {
        assert!(labels.iter().any(|s| s == label), "{label}");
    }
    let chart_mode = wait("hourly chart mode", || named(hwnd, "Show by category"))?;
    let toggle: IUIAutomationTogglePattern =
        unsafe { chart_mode.GetCurrentPatternAs(UIA_TogglePatternId)? };
    unsafe {
        toggle.Toggle()?;
    }
    drop(toggle);
    wait("category mode", || {
        names(hwnd)
            .contains(&"Show total activity".into())
            .then_some(())
    })?;
    let open_bytes = sample("today")?;

    unsafe {
        PostMessageW(Some(hwnd), WM_CLOSE, WPARAM(0), LPARAM(0))?;
    }
    wait("closed Today", || main().is_none().then_some(()))?;
    sample("tray-after")?;
    let mut cycles = Vec::new();
    for cycle in 2..=15 {
        let started = std::time::Instant::now();
        command(tray, 4)?;
        let current = wait("warm Today", main)?;
        wait("warm data", || {
            names(current).contains(&"Top 3".into()).then_some(())
        })?;
        let reopen_ms = started.elapsed().as_millis();
        unsafe {
            PostMessageW(Some(current), WM_CLOSE, WPARAM(0), LPARAM(0))?;
        }
        wait("warm close", || main().is_none().then_some(()))?;
        use std::os::windows::io::AsRawHandle;
        use windows::Win32::{
            Foundation::HANDLE,
            System::{
                ProcessStatus::{GetProcessMemoryInfo, PROCESS_MEMORY_COUNTERS_EX},
                Threading::GetProcessHandleCount,
            },
        };
        let handle = HANDLE(child.0.as_raw_handle());
        let mut memory = PROCESS_MEMORY_COUNTERS_EX::default();
        let mut handles = 0;
        unsafe {
            GetProcessMemoryInfo(
                handle,
                (&raw mut memory).cast(),
                std::mem::size_of_val(&memory) as u32,
            )?;
            GetProcessHandleCount(handle, &mut handles)?;
        }
        cycles.push(serde_json::json!({"cycle":cycle,"reopenMs":reopen_ms,"hostPrivateBytes":memory.PrivateUsage,"hostHandles":handles}));
    }
    fs::write(out.join("cycles.json"), serde_json::to_vec_pretty(&cycles)?)?;
    std::thread::sleep(std::time::Duration::from_secs(60));
    assert!(
        sample("tray-warm")? < open_bytes,
        "warm tray retained the cost of an open Today window"
    );
    // Resume with the main window gone. The existing sampler must advance in both return states.
    command(tray, 3)?;
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()?;
    let mut db = rt.block_on(SqliteConnection::connect_with(
        &SqliteConnectOptions::new()
            .filename(profile.join("patina.db"))
            .read_only(true),
    ))?;
    let mut progress = || {
        rt.block_on(sqlx::query_as::<_,(i64,i64)>("SELECT s.id, CAST(t.value AS INTEGER) FROM sessions s JOIN settings t ON t.key='__tracker_last_successful_sample_ms' WHERE s.exe_name='fixture.exe' AND s.end_time IS NULL").fetch_optional(&mut db)).ok().flatten()
    };
    let in_tray = wait("recording in tray", &mut progress)?;
    command(tray, 4)?;
    let active_main = wait("Today while recording", main)?;
    wait("live application in Today", || {
        named(active_main, "View details for Fixture")
    })?;
    let mut active_renderer = 0;
    unsafe {
        GetWindowThreadProcessId(active_main, Some(&mut active_renderer));
        PostMessageW(Some(active_main), WM_CLOSE, WPARAM(0), LPARAM(0))?;
    }
    wait("active recorder returned to pure tray", || {
        (!children::children(pid).ok()?.contains(&active_renderer)).then_some(())
    })?;
    sample("tray-active")?;
    let before_mini = progress().ok_or("recording stopped in tray")?;
    assert_eq!(in_tray.0, before_mini.0);
    assert!(before_mini.1 - in_tray.1 >= 20_000);

    command(tray, 1)?;
    let mini = wait("Mini", || {
        children::find(pid, |p| window(p, w!("Patina GPUI Mini")))
    })?;
    let pin = wait("Mini pin control", || named(mini, "Keep expanded"))?;
    let pin: IUIAutomationTogglePattern = unsafe { pin.GetCurrentPatternAs(UIA_TogglePatternId)? };
    if unsafe { pin.CurrentToggleState()? } == ToggleState_Off {
        unsafe {
            pin.Toggle()?;
        }
    }
    wait("pinned Mini", || {
        (unsafe { pin.CurrentToggleState().ok()? } == ToggleState_On).then_some(())
    })?;
    sample("mini-before")?;
    let mini_start = progress().ok_or("recording stopped before opening Today from Mini")?;
    assert_eq!(mini_start.0, in_tray.0);
    let open = wait("Mini open main control", || {
        controls(mini)
            .ok()?
            .into_iter()
            .find(|el| unsafe { el.CurrentName().is_ok_and(|s| s == "Open main window") })
    })?;
    let invoke: IUIAutomationInvokePattern =
        unsafe { open.GetCurrentPatternAs(UIA_InvokePatternId)? };
    unsafe {
        invoke.Invoke()?;
    }
    let hwnd = wait("recreated Today", main)?;
    wait("restored chart mode", || {
        names(hwnd)
            .contains(&"Show total activity".into())
            .then_some(())
    })?;
    unsafe {
        PostMessageW(Some(hwnd), WM_CLOSE, WPARAM(0), LPARAM(0))?;
    }
    wait("returned to Mini", || {
        (main().is_none()
            && children::find(pid, |p| window(p, w!("Patina GPUI Mini"))) == Some(mini))
        .then_some(())
    })?;
    sample("mini-after")?;
    let after = progress().ok_or("recording stopped in Mini")?;
    assert_eq!(after.0, in_tray.0);
    assert!(after.1 - mini_start.1 >= 20_000);
    assert_eq!(unsafe { pin.CurrentToggleState()? }, ToggleState_On);
    command(tray, 2)?;
    assert!(wait("exit", || child.0.try_wait().ok().flatten())?.success());
    let sealed = rt.block_on(
        sqlx::query_scalar::<_, Option<i64>>("SELECT end_time FROM sessions WHERE id=?")
            .bind(after.0)
            .fetch_one(&mut db),
    )?;
    assert!(sealed.is_some_and(|end| end >= after.1));
    fs::write(
        out.join("recording.json"),
        serde_json::to_vec_pretty(&serde_json::json!({
            "sessionId": after.0, "trayStart": in_tray.1, "trayEnd": before_mini.1,
            "miniStart": mini_start.1, "miniEnd": after.1, "pinned": true, "sealedAt": sealed,
        }))?,
    )?;
    Ok(())
}

#[test]
#[ignore = "requires an interactive Windows desktop"]
fn ranked_app_actions() -> Result<(), Error> {
    let _com = ComApartment::init()?;
    unsafe { SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2) };
    let root = tempfile::tempdir()?;
    let profile = root.path().join(patina_gpui::APP_ID);
    fs::create_dir(&profile)?;
    seed(&profile.join("patina.db"))?;
    let mut child = TestChild(
        Command::new(env!("CARGO_BIN_EXE_patina-gpui"))
            .env("PATINA_GPUI_PROFILE_PARENT", root.path())
            .env("RUST_BACKTRACE", "1")
            .stderr(fs::File::create(root.path().join("stderr.log"))?)
            .arg("--today")
            .spawn()?,
    );
    let hwnd = wait("Today", || {
        children::find(child.0.id(), |p| window(p, w!("Patina")))
    })?;
    let toggle = wait("chart toggle", || named(hwnd, "Show by category"))?;
    hourly_keyboard(hwnd, &toggle, false)?;
    let toggle: IUIAutomationTogglePattern =
        unsafe { toggle.GetCurrentPatternAs(UIA_TogglePatternId)? };
    unsafe {
        toggle.Toggle()?;
    }
    let toggle = wait("category mode", || named(hwnd, "Show total activity"))?;
    hourly_keyboard(hwnd, &toggle, true)?;
    if let Err(e) = app_actions(hwnd) {
        return Err(format!(
            "{e}; process {:?}; stderr {}",
            child.0.try_wait()?,
            fs::read_to_string(root.path().join("stderr.log"))?
        )
        .into());
    }
    let tray = wait("tray", || window(child.0.id(), w!("Patina GPUI")))?;
    command(tray, 2)?;
    assert!(wait("exit", || child.0.try_wait().ok().flatten())?.success());
    Ok(())
}

fn capture_original_pages(hwnd: HWND, dir: &Path) -> Result<(), Error> {
    let mut pages = Vec::new();
    for (name, ready) in [
        ("History", "Day Timeline"),
        ("Data", "Activity Trend"),
        ("Classification", "Manage categories"),
        ("Settings", "Time rules"),
        ("About", "GitHub"),
    ] {
        let trigger = wait(name, || {
            controls(hwnd).ok()?.into_iter().find(|e| unsafe {
                e.CurrentControlType().ok() == Some(UIA_ButtonControlTypeId)
                    && e.CurrentName().is_ok_and(|s| s == name)
            })
        })?;
        let invoke: IUIAutomationInvokePattern =
            unsafe { trigger.GetCurrentPatternAs(UIA_InvokePatternId)? };
        unsafe {
            invoke.Invoke()?;
        }
        wait("original page content", || {
            names(hwnd).iter().any(|s| s.contains(ready)).then_some(())
        })?;
        let mut origin = windows::Win32::Foundation::POINT::default();
        unsafe {
            windows::Win32::Graphics::Gdi::ClientToScreen(hwnd, &mut origin).ok()?;
        }
        let items = controls(hwnd)?
            .into_iter()
            .filter_map(|el| unsafe {
                let name = el.CurrentName().ok()?.to_string();
                if name.is_empty() {
                    return None;
                }
                let rect = el.CurrentBoundingRectangle().ok()?;
                Some(serde_json::json!([
                    name,
                    rect.left - origin.x,
                    rect.top - origin.y,
                    rect.right - rect.left,
                    rect.bottom - rect.top
                ]))
            })
            .collect::<Vec<_>>();

        pages.push(serde_json::json!({"page":name,"nodes":items}));
        fs::write(
            dir.join("original-pages.json"),
            serde_json::to_vec_pretty(&pages)?,
        )?;
    }
    Ok(())
}
