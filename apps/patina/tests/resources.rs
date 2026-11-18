#[path = "../../../crates/test-support/children.rs"]
mod children;
#[path = "../../../crates/test-support/windows.rs"]
mod desktop;

use chrono::Utc;
use desktop::{ComApartment, Error, TestChild, controls, wait, window};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use sqlx::{Connection, SqliteConnection, sqlite::SqliteConnectOptions};
use std::{
    env, fs, io,
    path::{Path, PathBuf},
    process::Command,
    thread,
    time::{Duration, Instant},
};
use windows::{
    Win32::{
        Foundation::{HWND, LPARAM, RECT, WPARAM},
        Graphics::Gdi::GetWindowRgnBox,
        UI::{Accessibility::*, HiDpi::*, WindowsAndMessaging::*},
    },
    core::w,
};

fn size(hwnd: HWND) -> Option<[i32; 2]> {
    let mut rect = RECT::default();
    unsafe {
        if !IsWindowVisible(hwnd).as_bool() || GetWindowRgnBox(hwnd, &mut rect).0 < 2 {
            return None;
        }
    }
    Some([rect.right - rect.left, rect.bottom - rect.top])
}

fn pin(hwnd: HWND) -> Result<(), Error> {
    let toggles = wait("Mini pin control", || {
        let toggles: Vec<IUIAutomationTogglePattern> = controls(hwnd)
            .ok()?
            .iter()
            .filter_map(|el| unsafe { el.GetCurrentPatternAs(UIA_TogglePatternId) }.ok())
            .collect();
        (!toggles.is_empty()).then_some(toggles)
    })?;
    let [toggle] = toggles.as_slice() else {
        return Err("expected one Mini toggle".into());
    };
    unsafe {
        if toggle.CurrentToggleState()? == ToggleState_Off {
            toggle.Toggle()?;
        }
        wait("pinned Mini", || {
            (toggle.CurrentToggleState().ok()? == ToggleState_On).then_some(())
        })?;
    }
    Ok(())
}

async fn recording(conn: &mut SqliteConnection) -> sqlx::Result<Option<(i64, i64)>> {
    sqlx::query_as("SELECT s.id, CAST(t.value AS INTEGER) FROM sessions s JOIN settings t
        ON t.key='__tracker_last_successful_sample_ms' WHERE s.exe_name='fixture.exe' AND s.end_time IS NULL")
        .fetch_optional(conn).await
}

struct Run<'a> {
    binary: &'a Path,
    previous: bool,
    sampler: &'a Path,
    output: &'a Path,
    seconds: u64,
    warmup: u64,
}

impl Run<'_> {
    fn measure(&self, scenario: &str, round: u32, isolated: bool) -> Result<Value, Error> {
        let root = tempfile::tempdir()?;
        let exe = r"C:\fixture\fixture.exe";
        let fixture = json!({"foreground":{"hwnd":"0x42","root_owner_hwnd":"0x42","process_id":42,
            "window_class":"Fixture","title":"Fixture","exe_name":"fixture.exe","process_path":exe,
            "is_afk":false,"idle_time_ms":0}, "names":{(exe):"Fixture"}});
        fs::write(
            root.path().join("native-probe-fixture.json"),
            serde_json::to_vec(&fixture)?,
        )?;
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()?;
        if isolated {
            // A private desktop has no Explorer notification area. Exercise the real tray owner
            // through its callback and use the same resident preferences for both revisions.
            let profile = root.path().join(patina::APP_ID);
            fs::create_dir(&profile)?;
            rt.block_on(async {
                let pool=patina_recorder::open_database(&profile.join("patina.db")).await?;
                sqlx::query("INSERT OR REPLACE INTO settings(key,value) VALUES ('show_tray_icon','0'),('start_minimized','1'),('close_behavior','tray'),('language','en-US')").execute(&pool).await?;
                pool.close().await;
                Ok::<_, Error>(())
            })?;
        }
        let mut cmd = Command::new(self.binary);
        if scenario != "tray" {
            cmd.arg("--mini");
        }
        let mut app = TestChild(
            cmd.env("PATINA_GPUI_PROFILE_PARENT", root.path())
                .env("PATINA_E2E_DATA_ROOT", root.path())
                .env("PATINA_E2E", "1")
                .env("PATINA_E2E_NATIVE_FIXTURE", "1")
                .spawn()?,
        );
        let pid = app.0.id();
        let tray = wait("tray owner", || window(pid, w!("Patina GPUI")))?;
        let dpi = unsafe { GetDpiForWindow(tray) };
        let db = SqliteConnectOptions::new()
            .filename(root.path().join(patina::APP_ID).join("patina.db"))
            .read_only(true);
        let mut conn = rt.block_on(SqliteConnection::connect_with(&db))?;
        wait("fixture recording", || {
            rt.block_on(recording(&mut conn)).ok().flatten()
        })?;
        let mini = || {
            children::find(pid, |p| {
                window(p, w!("Patina Mini")).or_else(|| {
                    self.previous
                        .then(|| window(p, w!("Patina GPUI Mini")))
                        .flatten()
                })
            })
        };
        let expected = if scenario == "tray" {
            None
        } else {
            let hwnd = wait("Mini window", mini)?;
            wait("visible Mini", || size(hwnd))?;
            let dip = if scenario == "collapsed" {
                unsafe {
                    PostMessageW(Some(hwnd), WM_KEYDOWN, WPARAM(27), LPARAM(1))?;
                    PostMessageW(
                        Some(hwnd),
                        WM_KEYUP,
                        WPARAM(27),
                        LPARAM(0xc0000001u32 as isize),
                    )?;
                }
                [112, 24]
            } else {
                pin(hwnd)?;
                [320, 240]
            };
            let scale = f64::from(unsafe { GetDpiForWindow(hwnd) }) / 96.;
            Some(dip.map(|n| (f64::from(n) * scale).round() as i32))
        };
        let ui_pid = mini().map(|hwnd| {
            let mut owner = 0;
            unsafe {
                GetWindowThreadProcessId(hwnd, Some(&mut owner));
            }
            owner
        });
        let state_ok = || match expected {
            None => mini().is_none(),
            Some(dim) => mini().and_then(size) == Some(dim),
        };
        wait(scenario, || state_ok().then_some(()))?;
        thread::sleep(Duration::from_secs(self.warmup));
        if !state_ok() {
            return Err(format!("{scenario} changed during warm-up").into());
        }
        let before = rt
            .block_on(recording(&mut conn))?
            .ok_or("fixture recording stopped")?;
        let path = self.output.join(format!("{scenario}-{round}.jsonl"));
        let mut sampler = TestChild(
            Command::new(self.sampler)
                .arg(pid.to_string())
                .arg(&path)
                .arg(self.seconds.to_string())
                .args(["5", scenario])
                .spawn()?,
        );
        let start = Instant::now();
        loop {
            if app.0.try_wait()?.is_some() || !state_ok() {
                return Err(format!("lost {scenario}").into());
            }
            if let Some(status) = sampler.0.try_wait()? {
                if !status.success() {
                    return Err(format!("sampler exited with {status}").into());
                }
                break;
            }
            if start.elapsed().as_secs() > self.seconds + 30 {
                return Err("sampler timed out".into());
            }
            thread::sleep(Duration::from_secs(1));
        }
        let after = rt
            .block_on(recording(&mut conn))?
            .ok_or("fixture recording stopped")?;
        if after.0 != before.0
            || after.1 <= before.1
            || after.1 - before.1 < (self.seconds as i64 - 10) * 1000
            || Utc::now().timestamp_millis() - after.1 > 10000
        {
            return Err("recorder continuity failed".into());
        }
        let raw = fs::read_to_string(path)?;
        let end: Value = serde_json::from_str(raw.lines().last().ok_or("empty sample")?)?;
        if end["complete"] != true
            || end["sampleCount"] != self.seconds / 5 + 1
            || end["unavailableSamples"] != 0
        {
            return Err(format!("incomplete sample: {end}").into());
        }
        let mut reopen_ms = Vec::new();
        if isolated {
            if let Some(hwnd) = mini() {
                unsafe {
                    PostMessageW(Some(hwnd), WM_CLOSE, WPARAM(0), LPARAM(0))?;
                }
                wait("closed Mini", || mini().is_none().then_some(()))?;
            }
            let main = || {
                children::find(pid, |child| {
                    window(child, w!("Patina UI"))
                        .or_else(|| self.previous.then(|| window(child, w!("Patina"))).flatten())
                })
            };
            if let Some(hwnd) = main() {
                unsafe {
                    PostMessageW(Some(hwnd), WM_CLOSE, WPARAM(0), LPARAM(0))?;
                }
                wait("closed main window", || main().is_none().then_some(()))?;
            }
            for _ in 0..3 {
                let started = Instant::now();
                unsafe {
                    PostMessageW(
                        Some(tray),
                        WM_APP + 1,
                        WPARAM(0),
                        LPARAM(windows::Win32::UI::Shell::NIN_SELECT as isize),
                    )?;
                }
                let hwnd = wait("primary tray activation opens Today", main)?;
                wait("Today UI ready", || {
                    (!controls(hwnd).ok()?.is_empty()).then_some(())
                })?;
                reopen_ms.push(started.elapsed().as_millis() as u64);
                let mut renderer = 0;
                unsafe {
                    GetWindowThreadProcessId(hwnd, Some(&mut renderer));
                }
                unsafe {
                    PostMessageW(Some(hwnd), WM_CLOSE, WPARAM(0), LPARAM(0))?;
                }
                wait("last window closed", || main().is_none().then_some(()))?;
                wait("idle renderer exited", || {
                    (!children::children(pid).ok()?.contains(&renderer)).then_some(())
                })?;
            }
            let recorded_after_close = after.1;
            wait("sampling after last window closes", || {
                rt.block_on(recording(&mut conn))
                    .ok()
                    .flatten()
                    .filter(|row| row.1 > recorded_after_close)
            })?;
            if scenario == "tray" {
                let path = self.output.join(format!("after-close-{round}.jsonl"));
                let status = Command::new(self.sampler)
                    .arg(pid.to_string())
                    .arg(path)
                    .args(["5", "5", "after-close"])
                    .status()?;
                if !status.success() {
                    return Err(format!("after-close sampler exited with {status}").into());
                }
            }
        }
        rt.block_on(conn.close())?;
        unsafe {
            PostMessageW(Some(tray), WM_COMMAND, WPARAM(2), LPARAM(0))?;
        }
        if !wait("clean exit", || app.0.try_wait().ok().flatten())?.success() {
            return Err("GPUI exit failed".into());
        }
        Ok(
            json!({"scenario":scenario,"round":round,"pid":pid,"uiPid":ui_pid,"size":expected,"reopenMs":reopen_ms,"dpi":dpi,"sampleCount":end["sampleCount"],
            "sessionId":after.0,"beforeMs":before.1,"afterMs":after.1}),
        )
    }
}

fn sha(path: &Path) -> io::Result<String> {
    let mut digest = Sha256::new();
    io::copy(&mut fs::File::open(path)?, &mut digest)?;
    Ok(format!("{:x}", digest.finalize()))
}

fn run(smoke: bool, isolated: bool) -> Result<(), Error> {
    let _com = ComApartment::init()?;
    if unsafe { SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2) }
        .is_invalid()
    {
        return Err(io::Error::last_os_error().into());
    }
    let repo = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .canonicalize()?;
    let baseline = if isolated {
        env::var_os("PATINA_RESOURCE_BASELINE").map(PathBuf::from)
    } else {
        None
    };
    let binary = baseline
        .as_deref()
        .unwrap_or(Path::new(env!("CARGO_BIN_EXE_patina")));
    let sampler = env::var_os("PATINA_RESOURCE_SAMPLER")
        .map(PathBuf::from)
        .unwrap_or_else(|| repo.join("target/debug/examples/windows-resource-sample.exe"));
    // Keep each trial on the same build even if Cargo produces another test target.
    let mut group = vec![binary.to_owned()];
    if baseline.is_some() {
        // Historical split builds need their matching executables beside the host.
        group.extend(
            ["patina-ui.exe", "patina-probe.exe"]
                .map(|name| binary.with_file_name(name))
                .into_iter()
                .filter(|path| path.exists()),
        );
    }
    let stage = tempfile::tempdir()?;
    for file in &group {
        fs::copy(
            file,
            stage
                .path()
                .join(file.file_name().ok_or("missing binary filename")?),
        )?;
    }
    let binary = stage
        .path()
        .join(binary.file_name().ok_or("missing host filename")?);
    let hashes = || -> io::Result<Value> {
        let mut result = json!({"sampler": sha(&sampler)?});
        for file in &group {
            let name = file.file_name().unwrap().to_string_lossy();
            result[&*name] = json!(sha(&stage.path().join(&*name))?);
        }
        Ok(result)
    };
    let initial = hashes()?;
    let now = Utc::now();
    let label = if isolated && baseline.is_some() {
        "previous-isolated"
    } else if isolated {
        "isolated"
    } else if smoke {
        "smoke"
    } else {
        "baseline"
    };
    let output = repo
        .join("artifacts/runtime-smoke")
        .join(format!("gpui-{label}-{}", now.format("%Y%m%dT%H%M%S%.3fZ")));
    fs::create_dir_all(output.parent().unwrap())?;
    fs::create_dir(&output)?;
    println!("Writing {label} to {}", output.display());
    let run = Run {
        binary: &binary,
        previous: baseline.is_some(),
        sampler: &sampler,
        output: &output,
        seconds: if smoke { 15 } else { 600 },
        warmup: if smoke { 2 } else { 30 },
    };
    let mut report = json!({"started":now.to_rfc3339(),"hashes":initial,"platform":env::consts::OS,"mode":label,
        "logicalProcessors":thread::available_parallelism()?.get(),"screen":unsafe { [GetSystemMetrics(SM_CXSCREEN),GetSystemMetrics(SM_CYSCREEN)] },
        "rounds":[], "status":"running"});
    let save = |value: &Value| -> Result<(), Error> {
        let tmp = output.join("result.tmp");
        fs::write(&tmp, serde_json::to_vec_pretty(value)?)?;
        fs::rename(tmp, output.join("result.json"))?;
        Ok(())
    };
    let measured = (|| -> Result<(), Error> {
        for round in 1..=if smoke && !isolated { 1 } else { 3 } {
            for scenario in ["tray", "collapsed", "expanded"] {
                report["current"] = json!(format!("{scenario}-{round}"));
                save(&report)?;
                let result = run.measure(scenario, round, isolated)?;
                report["rounds"].as_array_mut().unwrap().push(result);
            }
        }
        if hashes()? != initial {
            return Err("binaries changed during sampling".into());
        }
        Ok(())
    })();
    report["status"] = json!(if measured.is_ok() { "passed" } else { "failed" });
    if let Err(err) = &measured {
        report["error"] = json!(err.to_string());
    }
    save(&report)?;
    measured
}

#[test]
#[ignore = "dedicated Windows session: three ten-minute resource rounds"]
fn tray_mini_baseline() -> Result<(), Error> {
    patina_test_desktop::dedicated_session()?;
    run(false, false)
}

#[test]
#[ignore = "dedicated Windows session: resource sampler"]
fn sampler_smoke() -> Result<(), Error> {
    patina_test_desktop::dedicated_session()?;
    run(true, false)
}

#[test]
#[ignore = "isolated Windows desktop, environment-dependent resource measurements"]
fn isolated_resource_comparison() -> Result<(), Error> {
    if !patina_test_desktop::run_case()? {
        return Ok(());
    }
    run(true, true)
}
