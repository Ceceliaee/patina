#[path = "../../../crates/test-support/children.rs"]
mod children;
#[path = "../../../crates/test-support/windows.rs"]
mod desktop;

#[path = "../../../crates/test-support/login.rs"]
mod login;

use desktop::{ComApartment, Error, TestChild, controls, wait, window};
use sqlx::{Connection, SqliteConnection, sqlite::SqliteConnectOptions};
use std::{
    collections::BTreeMap, fs, os::windows::fs::OpenOptionsExt, path::Path, process::Command,
};
use windows::{
    Win32::{
        Foundation::{HANDLE, HWND, LPARAM, WAIT_OBJECT_0, WPARAM},
        System::Threading::{
            GetExitCodeProcess, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION,
            PROCESS_SYNCHRONIZE, PROCESS_TERMINATE, TerminateProcess, WaitForSingleObject,
        },
        UI::{
            Accessibility::{
                IUIAutomationElement, IUIAutomationTogglePattern, UIA_TogglePatternId,
            },
            WindowsAndMessaging::{
                FindWindowExW, GetWindowThreadProcessId, PostMessageW, WM_COMMAND,
            },
        },
    },
    core::{Owned, w},
};

fn launch(root: &Path) -> Result<TestChild, Error> {
    Ok(TestChild(
        Command::new(env!("CARGO_BIN_EXE_patina"))
            .arg("--today")
            .env("PATINA_PROFILE_PARENT", root)
            .env("PATINA_E2E_DATA_ROOT", root)
            .env("PATINA_E2E", "1")
            .env("PATINA_E2E_NATIVE_FIXTURE", "1")
            .spawn()?,
    ))
}

fn named(hwnd: HWND, name: &str) -> Option<IUIAutomationElement> {
    controls(hwnd)
        .ok()?
        .into_iter()
        .find(|element| unsafe { element.CurrentName().is_ok_and(|label| label == name) })
}

fn window_pid(hwnd: HWND) -> u32 {
    let mut pid = 0;
    unsafe { GetWindowThreadProcessId(hwnd, Some(&mut pid)) };
    pid
}

fn gpui_platform_window(pid: u32) -> bool {
    for class in [w!("Zed::PlatformWindow"), w!("GpuiFast::PlatformWindow")] {
        let mut previous = None;
        while let Ok(hwnd) = unsafe { FindWindowExW(None, previous, class, None) } {
            if window_pid(hwnd) == pid {
                return true;
            }
            previous = Some(hwnd);
        }
    }
    false
}

fn probes(owner: u32) -> Result<BTreeMap<String, u32>, Error> {
    let image = Path::new(env!("CARGO_BIN_EXE_patina"));
    let mut workers = BTreeMap::new();
    for child in patina_test_support::process::children_with_executable(owner, image)? {
        match &child.arguments[1..] {
            [flag, role, kind] if flag == "--role" && role == "Patina Probe" => {
                assert!(
                    workers.insert(kind.clone(), child.pid).is_none(),
                    "duplicate probe role"
                );
            }
            [flag, role, ..] if flag == "--role" && role == "Patina UI" => {}
            args => panic!("unexpected same-image child arguments {args:?}"),
        }
    }
    Ok(workers)
}

fn verify_probe_recovery(owner: u32, renderer: u32) -> Result<(), Error> {
    let workers = wait(
        "foreground and name are direct children using the resident image",
        || {
            let workers = probes(owner).ok()?;
            (workers.contains_key("foreground") && workers.contains_key("name")).then_some(workers)
        },
    )?;
    assert!(gpui_platform_window(renderer));
    assert!(!gpui_platform_window(owner));
    for pid in workers.values() {
        assert!(!gpui_platform_window(*pid));
    }
    let original = workers["foreground"];
    let foreground = unsafe {
        Owned::new(OpenProcess(
            PROCESS_TERMINATE | PROCESS_SYNCHRONIZE,
            false,
            original,
        )?)
    };
    unsafe { TerminateProcess(*foreground, 7)? };
    assert_eq!(
        unsafe { WaitForSingleObject(*foreground, 5000) },
        WAIT_OBJECT_0
    );
    let replacement = wait("only the crashed foreground probe is replaced", || {
        let current = probes(owner).ok()?;
        let pid = *current.get("foreground")?;
        (pid != original && current.get("name") == workers.get("name")).then_some(pid)
    })?;
    assert!(!gpui_platform_window(replacement));
    Ok(())
}

fn probe_handles(owner: u32) -> Result<Vec<(String, Owned<HANDLE>)>, Error> {
    probes(owner)?
        .into_iter()
        .map(|(role, pid)| unsafe {
            Ok((
                role,
                Owned::new(OpenProcess(
                    PROCESS_SYNCHRONIZE | PROCESS_QUERY_LIMITED_INFORMATION,
                    false,
                    pid,
                )?),
            ))
        })
        .collect()
}

async fn recording(db: &mut SqliteConnection) -> sqlx::Result<Option<(i64, i64)>> {
    sqlx::query_as(
        "SELECT s.id, CAST(t.value AS INTEGER) FROM sessions s JOIN settings t ON
         t.key='__tracker_last_successful_sample_ms' WHERE s.exe_name='fixture.exe' AND s.end_time IS NULL",
    )
    .fetch_optional(db).await
}

#[test]
#[ignore = "isolated Win32 desktop without an Explorer tray"]
fn login_keeps_recording_when_explorer_is_unavailable() -> Result<(), Error> {
    use std::os::windows::process::CommandExt;
    use windows::Win32::UI::WindowsAndMessaging::{FindWindowW, RegisterWindowMessageW};
    if !patina_test_support::run_case()? {
        return Ok(());
    }
    assert!(unsafe { FindWindowW(w!("Shell_TrayWnd"), None) }.is_err());
    let restart = unsafe { RegisterWindowMessageW(w!("TaskbarCreated")) };
    assert_ne!(restart, 0);
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()?;
    for (silent, icon, paused) in [
        (true, true, false),
        (false, true, true),
        (true, false, true),
        (false, false, false),
    ] {
        let root = tempfile::tempdir()?;
        let profile = root.path().join(patina::PROFILE_DIRECTORY);
        fs::create_dir(&profile)?;
        let path = profile.join("patina.db");
        rt.block_on(async {
            let pool = patina_activity::open_database(&path).await?;
            for (key, flag) in [
                ("start_minimized", silent),
                ("show_tray_icon", icon),
                ("tracking_paused", paused),
                ("launch_at_login", true),
            ] {
                sqlx::query("INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)")
                    .bind(key)
                    .bind(if flag { "1" } else { "0" })
                    .execute(&pool)
                    .await?;
            }
            pool.close().await;
            Ok::<_, Error>(())
        })?;
        let exe = r"C:\fixture\fixture.exe";
        fs::write(
            root.path().join("native-probe-fixture.json"),
            serde_json::to_vec(&serde_json::json!({
                "foreground":{"hwnd":"0x42","root_owner_hwnd":"0x42","process_id":42,"window_class":"Fixture","title":"Fixture","exe_name":"fixture.exe","process_path":exe,"is_afk":false,"idle_time_ms":0},"names":{(exe):"Fixture"}
            }))?,
        )?;
        let entry = login::TestLoginEntry::for_profile(&profile)?;
        let binary = env!("CARGO_BIN_EXE_patina");
        let command = format!(r#""{binary}" -a "{}""#, root.path().display());
        entry.key.set_value(&entry.name, &command)?;
        let stored: String = entry.key.get_value(&entry.name)?;
        let (exe, args) = stored
            .strip_prefix('"')
            .and_then(|s| s.split_once('"'))
            .ok_or("invalid Run command")?;
        let mut host = TestChild(
            Command::new(exe)
                .raw_arg(args.trim_start())
                .env_remove("PATINA_PROFILE_PARENT")
                .env("PATINA_E2E_DATA_ROOT", root.path())
                .env("PATINA_E2E", "1")
                .env("PATINA_E2E_NATIVE_FIXTURE", "1")
                .spawn()?,
        );
        let pid = host.0.id();
        let tray = wait("login host", || window(pid, w!("Patina Tray")))?;
        let main = || children::find(pid, |p| window(p, w!("Patina")));
        let mut db = rt.block_on(SqliteConnection::connect_with(
            &SqliteConnectOptions::new().filename(&path),
        ))?;
        let before = if paused {
            None
        } else {
            Some(wait("first login sample", || {
                rt.block_on(recording(&mut db)).ok().flatten()
            })?)
        };
        unsafe {
            PostMessageW(Some(tray), restart, WPARAM(0), LPARAM(0))?;
        }
        if let Some((id, sample)) = before {
            wait("same session after taskbar recreation", || {
                let (next, time) = rt.block_on(recording(&mut db)).ok().flatten()?;
                (id == next && time > sample).then_some(())
            })?;
        }
        if silent {
            assert!(main().is_none());
            assert!(
                Command::new(binary)
                    .arg("--main")
                    .arg("--profile-parent")
                    .arg(root.path())
                    .status()?
                    .success()
            );
        }
        wait("same host owns visible main window", main)?;
        unsafe {
            PostMessageW(Some(tray), WM_COMMAND, WPARAM(2), LPARAM(0))?;
        }
        assert!(
            wait("login host exited normally", || host
                .0
                .try_wait()
                .ok()
                .flatten())?
            .success()
        );
        let count:i64=rt.block_on(sqlx::query_scalar("SELECT COUNT(*) FROM sessions WHERE exe_name='fixture.exe' AND end_time IS NOT NULL").fetch_one(&mut db))?;
        assert_eq!(count, if paused { 0 } else { 1 });
    }
    Ok(())
}

#[test]
#[ignore = "isolated Win32 desktop"]
fn partial_startup_releases_the_profile_and_preserves_the_last_sample() -> Result<(), Error> {
    if !patina_test_support::run_case()? {
        return Ok(());
    }
    let root = tempfile::tempdir()?;
    let profile = root.path().join("Patina.Desktop");
    let current = root.path().join(patina::PROFILE_DIRECTORY);
    fs::create_dir_all(current.join("EBWebView"))?;
    fs::create_dir(&profile)?;
    let database = profile.join("patina.db");
    const SESSION_START: i64 = 1_700_000_000_000;
    const LAST_SAMPLE: i64 = SESSION_START + 4000;
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()?;
    runtime.block_on(async {
        let pool = patina_activity::open_database(&database).await?;
        sqlx::query("INSERT INTO sessions(exe_name,app_name,start_time) VALUES('interrupted.exe','Interrupted',?)")
            .bind(SESSION_START).execute(&pool).await?;
        sqlx::query("INSERT OR REPLACE INTO settings(key,value) VALUES('tracking_paused','1'),('show_tray_icon','0'),('start_minimized','1'),('__tracker_last_successful_sample_ms',?)")
            .bind(LAST_SAMPLE.to_string()).execute(&pool).await?;
        pool.close().await;
        Ok::<_, Error>(())
    })?;
    let mut failed = TestChild(
        Command::new(env!("CARGO_BIN_EXE_patina"))
            .env("PATINA_PROFILE_PARENT", root.path())
            .env("PATINA_UPDATE_FIXTURE", root.path().join("missing-fixture"))
            .spawn()?,
    );
    assert!(
        !wait("failure after recorder and maintenance startup", || failed
            .0
            .try_wait()
            .ok()
            .flatten())?
        .success()
    );
    drop(
        fs::OpenOptions::new()
            .write(true)
            .share_mode(0)
            .open(profile.join("instance.lock"))?,
    );
    let mut reopened = launch(root.path())?;
    let tray = wait("profile reopened after failed startup", || {
        window(reopened.0.id(), w!("Patina Tray"))
    })?;
    unsafe {
        PostMessageW(Some(tray), WM_COMMAND, WPARAM(2), LPARAM(0))?;
    }
    assert!(
        wait("reopened host completed shutdown", || reopened
            .0
            .try_wait()
            .ok()
            .flatten())?
        .success()
    );
    let mut db = runtime.block_on(SqliteConnection::connect_with(
        &SqliteConnectOptions::new().filename(database),
    ))?;
    let record: (i64, i64) = runtime.block_on(
        sqlx::query_as("SELECT end_time,duration FROM sessions WHERE exe_name='interrupted.exe'")
            .fetch_one(&mut db),
    )?;
    assert_eq!(record, (LAST_SAMPLE, LAST_SAMPLE - SESSION_START));
    assert!(!current.join("instance.lock").exists());
    assert!(!current.join("patina.db").exists());
    Ok(())
}

#[test]
#[ignore = "isolated Win32 desktop"]
fn concurrent_launch_and_renderer_crash_reopen_the_committed_snapshot() -> Result<(), Error> {
    if !patina_test_support::run_case()? {
        return Ok(());
    }
    let _com = ComApartment::init()?;
    let root = tempfile::tempdir()?;
    let profile = root.path().join(patina::PROFILE_DIRECTORY);
    fs::create_dir(&profile)?;
    let path = profile.join("patina.db");
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()?;
    rt.block_on(async {
        let pool = patina_activity::open_database(&path).await?;
        sqlx::query("INSERT OR REPLACE INTO settings(key,value) VALUES
            ('show_tray_icon','0'),('start_minimized','1'),('close_behavior','tray'),('language','en-US'),
            ('hourly_activity_chart_mode','total')").execute(&pool).await?;
        sqlx::raw_sql("CREATE TABLE lifecycle_chart_writes(mode TEXT);
            CREATE TRIGGER observe_chart_write AFTER UPDATE OF value ON settings
            WHEN NEW.key='hourly_activity_chart_mode'
            BEGIN INSERT INTO lifecycle_chart_writes VALUES(NEW.value); END;")
            .execute(&pool).await?;
        pool.close().await;
        Ok::<_, Error>(())
    })?;
    let exe = r"C:\fixture\fixture.exe";
    fs::write(
        root.path().join("native-probe-fixture.json"),
        serde_json::to_vec(&serde_json::json!({
            "foreground": { "hwnd":"0x42","root_owner_hwnd":"0x42","process_id":42,
                "window_class":"Fixture","title":"Fixture","exe_name":"fixture.exe","process_path":exe,
                "is_afk":false,"idle_time_ms":0 }, "names":{(exe):"Fixture"}
        }))?,
    )?;
    let mut first = launch(root.path())?;
    let mut second = launch(root.path())?;
    let (owner, tray) = wait("resident owner for both launches", || {
        [first.0.id(), second.0.id()]
            .into_iter()
            .find_map(|pid| window(pid, w!("Patina Tray")).map(|tray| (pid, tray)))
    })?;
    let (host, forwarded) = if owner == first.0.id() {
        (&mut first, &mut second)
    } else {
        (&mut second, &mut first)
    };
    assert!(
        wait("second launch forwarded successfully", || forwarded
            .0
            .try_wait()
            .ok()
            .flatten())?
        .success()
    );
    assert!(host.0.try_wait()?.is_none());
    let lock = || {
        fs::OpenOptions::new()
            .write(true)
            .share_mode(0)
            .open(profile.join("instance.lock"))
    };
    assert_eq!(lock().unwrap_err().raw_os_error(), Some(32));
    let main = || children::find(owner, |pid| window(pid, w!("Patina")));
    let initial = wait("first renderer", main)?;
    let initial_pid = window_pid(initial);
    let toggle = wait("initial chart snapshot", || {
        named(initial, "Show by category")
    })?;
    let mut db = rt.block_on(SqliteConnection::connect_with(
        &SqliteConnectOptions::new().filename(&path),
    ))?;
    let (session, before) = wait("initial recording", || {
        rt.block_on(recording(&mut db)).ok().flatten()
    })?;
    verify_probe_recovery(owner, initial_pid)?;

    // A competing transaction holds the product write until its requesting window is gone.
    rt.block_on(sqlx::query("BEGIN IMMEDIATE").execute(&mut db))?;
    let pattern: IUIAutomationTogglePattern =
        unsafe { toggle.GetCurrentPatternAs(UIA_TogglePatternId)? };
    unsafe { pattern.Toggle()? };
    wait(
        "renderer shows category mode while storage is locked",
        || named(initial, "Show total activity"),
    )?;
    assert!(children::children(owner)?.contains(&initial_pid));
    let peer = unsafe { Owned::new(OpenProcess(PROCESS_TERMINATE, false, initial_pid)?) };
    unsafe { TerminateProcess(*peer, 7)? };
    wait("crashed renderer reaped", || {
        (!children::children(owner).ok()?.contains(&initial_pid)).then_some(())
    })?;
    rt.block_on(sqlx::query("COMMIT").execute(&mut db))?;
    wait("unacknowledged write committed once", || {
        let value = rt
            .block_on(
                sqlx::query_scalar::<_, String>(
                    "SELECT value FROM settings WHERE key='hourly_activity_chart_mode'",
                )
                .fetch_one(&mut db),
            )
            .ok()?;
        (value == "category").then_some(())
    })?;
    wait("recorder advanced while renderer was gone", || {
        let (id, at) = rt.block_on(recording(&mut db)).ok().flatten()?;
        (id == session && at > before).then_some(())
    })?;
    assert!(host.0.try_wait()?.is_none());
    let mut reopen = launch(root.path())?;
    assert!(
        wait("reopen forwarded to resident", || reopen
            .0
            .try_wait()
            .ok()
            .flatten())?
        .success()
    );
    let replacement = wait("replacement renderer", main)?;
    assert_ne!(window_pid(replacement), initial_pid);
    wait("replacement reads the committed chart setting", || {
        named(replacement, "Show total activity")
    })?;
    wait("replacement reads live tracked activity", || {
        named(replacement, "View details for Fixture")
    })?;
    let workers = probe_handles(owner)?;
    assert!(workers.iter().any(|(role, _)| role == "foreground"));
    unsafe { PostMessageW(Some(tray), WM_COMMAND, WPARAM(2), LPARAM(0))? };
    assert!(
        wait("host flushed and exited", || host
            .0
            .try_wait()
            .ok()
            .flatten())?
        .success()
    );
    let sealed = rt.block_on(
        sqlx::query_scalar::<_, Option<i64>>("SELECT end_time FROM sessions WHERE id=?")
            .bind(session)
            .fetch_one(&mut db),
    )?;
    assert!(sealed.is_some_and(|end| end >= before));
    wait("all owned subprocesses exited", || {
        children::children(owner).ok()?.is_empty().then_some(())
    })?;
    for (role, process) in workers {
        assert_eq!(
            unsafe { WaitForSingleObject(*process, 5000) },
            WAIT_OBJECT_0
        );
        let mut code = 0;
        unsafe { GetExitCodeProcess(*process, &mut code)? };
        assert_eq!(code, 0, "{role} did not exit cleanly");
    }
    let writes = rt.block_on(
        sqlx::query_scalar::<_, String>("SELECT mode FROM lifecycle_chart_writes")
            .fetch_all(&mut db),
    )?;
    assert_eq!(writes, ["category"]);
    drop(lock()?);
    Ok(())
}
