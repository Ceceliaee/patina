#[path = "../../test-support/children.rs"]
mod children;
#[path = "../../test-support/windows.rs"]
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
    sampler: &'a Path,
    output: &'a Path,
    seconds: u64,
    warmup: u64,
}

impl Run<'_> {
    fn measure(&self, scenario: &str, round: u32) -> Result<Value, Error> {
        let root = tempfile::tempdir()?;
        let exe = r"C:\fixture\fixture.exe";
        let fixture = json!({"foreground":{"hwnd":"0x42","root_owner_hwnd":"0x42","process_id":42,
            "window_class":"Fixture","title":"Fixture","exe_name":"fixture.exe","process_path":exe,
            "is_afk":false,"idle_time_ms":0}, "names":{(exe):"Fixture"}});
        fs::write(
            root.path().join("native-probe-fixture.json"),
            serde_json::to_vec(&fixture)?,
        )?;
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
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()?;
        let db = SqliteConnectOptions::new()
            .filename(root.path().join(patina_gpui::APP_ID).join("patina.db"))
            .read_only(true);
        let mut conn = rt.block_on(SqliteConnection::connect_with(&db))?;
        wait("fixture recording", || {
            rt.block_on(recording(&mut conn)).ok().flatten()
        })?;
        let mini = || children::find(pid, |p| window(p, w!("Patina GPUI Mini")));
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
        rt.block_on(conn.close())?;
        unsafe {
            PostMessageW(Some(tray), WM_COMMAND, WPARAM(2), LPARAM(0))?;
        }
        if !wait("clean exit", || app.0.try_wait().ok().flatten())?.success() {
            return Err("GPUI exit failed".into());
        }
        Ok(
            json!({"scenario":scenario,"round":round,"pid":pid,"size":expected,"sampleCount":end["sampleCount"],
            "sessionId":after.0,"beforeMs":before.1,"afterMs":after.1}),
        )
    }
}

fn sha(path: &Path) -> io::Result<String> {
    let mut digest = Sha256::new();
    io::copy(&mut fs::File::open(path)?, &mut digest)?;
    Ok(format!("{:x}", digest.finalize()))
}

fn run(smoke: bool) -> Result<(), Error> {
    let _com = ComApartment::init()?;
    if unsafe { SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2) }
        .is_invalid()
    {
        return Err(io::Error::last_os_error().into());
    }
    let repo = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .canonicalize()?;
    let binary = Path::new(env!("CARGO_BIN_EXE_patina-gpui"));
    let sampler = env::var_os("PATINA_RESOURCE_SAMPLER")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            repo.join("src-tauri/target/debug/examples/windows-resource-sample.exe")
        });
    let hashes =
        || -> io::Result<Value> { Ok(json!({"binary":sha(binary)?,"sampler":sha(&sampler)?})) };
    let initial = hashes()?;
    let now = Utc::now();
    let label = if smoke { "smoke" } else { "baseline" };
    let output = repo
        .join("artifacts/runtime-smoke")
        .join(format!("gpui-{label}-{}", now.format("%Y%m%dT%H%M%S%.3fZ")));
    fs::create_dir_all(output.parent().unwrap())?;
    fs::create_dir(&output)?;
    println!("Writing {label} to {}", output.display());
    let run = Run {
        binary,
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
        for round in 1..=if smoke { 1 } else { 3 } {
            for scenario in ["tray", "collapsed", "expanded"] {
                report["current"] = json!(format!("{scenario}-{round}"));
                save(&report)?;
                let result = run.measure(scenario, round)?;
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
#[ignore = "three interactive desktop states, three ten-minute rounds each"]
fn tray_mini_baseline() -> Result<(), Error> {
    run(false)
}

#[test]
#[ignore = "short verification of the Windows sampler and all three desktop states"]
fn sampler_smoke() -> Result<(), Error> {
    run(true)
}
