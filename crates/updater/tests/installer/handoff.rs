use super::{Cleanup, Error, run};
use patina_test_support::{polling::wait_observed, process};
use sqlx::{Connection, SqliteConnection, sqlite::SqliteConnectOptions};
use std::{
    env, fs,
    os::windows::{fs::OpenOptionsExt, process::CommandExt},
    path::{Path, PathBuf},
    process::Command,
};
use windows::{
    Win32::{
        Foundation::{HWND, LPARAM, WPARAM},
        UI::WindowsAndMessaging::*,
    },
    core::w,
};
use winreg::{
    RegKey, RegValue,
    enums::{HKEY_CURRENT_USER, REG_BINARY},
};

fn resident(exe: &Path) -> Result<(HWND, u32), Error> {
    Ok(wait_observed("installed host tray", || {
        let hwnd = unsafe { FindWindowW(None, w!("Patina Tray")) }.map_err(|e| e.to_string())?;
        let mut pid = 0;
        unsafe {
            GetWindowThreadProcessId(hwnd, Some(&mut pid));
        }
        if process::executable_path(pid).and_then(|p| p.canonicalize().ok())
            == Some(exe.to_path_buf())
        {
            Ok((hwnd, pid))
        } else {
            Err("installed host not ready".into())
        }
    })?)
}
fn sample(path: &Path) -> Result<(i64, i64, String), Error> {
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()?;
    rt.block_on(async{
        let mut conn=SqliteConnection::connect_with(&SqliteConnectOptions::new().read_only(true).filename(path)).await?;
        let result=sqlx::query_as("SELECT (SELECT MAX(version) FROM _sqlx_migrations), (SELECT duration FROM sessions WHERE exe_name='fixture-released.exe'), (SELECT value FROM settings WHERE key='test_published_handoff')").fetch_one(&mut conn).await?;
        let integrity:String=sqlx::query_scalar("PRAGMA quick_check").fetch_one(&mut conn).await?;
        assert_eq!(integrity,"ok");conn.close().await?; Ok(result)
    })
}

#[test]
#[ignore = "requires a native Windows application and NSIS"]
fn published_profile_copy_survives_install_upgrade_and_uninstall() -> Result<(), Error> {
    if !patina_test_support::run_case()? {
        return Ok(());
    }
    let root = tempfile::tempdir()?;
    let fixtures = root.path().canonicalize()?.join("released-production");
    let old_dir = fixtures.join("custom-data");
    fs::create_dir_all(&old_dir)?;
    // Built from the 27 migrations in v1.10.0 (6469dc51) with one synthetic session.
    let mut archived = zip::ZipArchive::new(std::io::Cursor::new(include_bytes!(
        "../../../test-support/fixtures/patina-1.10.0.zip"
    )))?;
    let mut file = fs::File::create(old_dir.join("patina.db"))?;
    std::io::copy(&mut archived.by_name("database/patina.db")?, &mut file)?;
    drop(file);
    let parent = root.path().join("Roaming");
    let local = root.path().join("Local");
    fs::create_dir(&parent)?;
    let profile = parent.join("Patina");
    let previous_db = local.join("Patina.Desktop/patina.db");
    fs::create_dir_all(previous_db.parent().unwrap())?;
    fs::write(&previous_db, b"independent desktop history")?;
    let custom = root.path().join("custom data");
    fs::create_dir_all(custom.join("backups"))?;
    fs::write(custom.join("backups/retained.zip"), b"previous backup")?;
    let old_control = serde_json::to_vec(&serde_json::json!({
        "format":"patina.storage-control.v1","profile":"production",
        "dataRoot":custom,"webviewRoot":null,"pending":null,"maintenance":{},"cleanupFiles":[]
    }))?;
    let bins = PathBuf::from(
        env::var_os("PATINA_TEST_RELEASE_BIN_DIR")
            .ok_or("Set PATINA_TEST_RELEASE_BIN_DIR to the directory containing patina.exe")?,
    )
    .canonicalize()?;
    let state: serde_json::Value = serde_json::from_slice(&old_control)?;
    assert_eq!(state["format"], "patina.storage-control.v1");
    assert_eq!(state["profile"], "production");
    let source = old_dir.join("patina.db").canonicalize()?;
    assert!(source.starts_with(&fixtures));
    let old_bytes = fs::read(&source)?;
    assert_eq!(sample(&source)?, (27, 60000, "v1.10.0".into()));
    let id = format!("Patina.Handoff.Test.{}", std::process::id());
    let _cleanup = Cleanup { id: id.clone() };
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let previous = Cleanup {
        id: format!("{id}.Previous"),
    };
    let storage_key = format!("Software\\{}\\ReleasedProfile", previous.id);
    let (legacy, _) = hkcu.create_subkey(&storage_key)?;
    legacy.set_raw_value(
        "State",
        &RegValue {
            vtype: REG_BINARY,
            bytes: old_control.as_slice().into(),
        },
    )?;
    let database = custom.join("patina.db");
    let control = profile.join("database-location.json");
    let install = local.join("Patina");
    fs::create_dir_all(&install)?;
    fs::write(install.join("Patina.exe"), b"previous Patina")?;
    fs::write(install.join("uninstall.exe"), b"previous uninstaller")?;
    let old_registration = format!(
        "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\{}",
        previous.id
    );
    let (old_key, _) = hkcu.create_subkey(&old_registration)?;
    old_key.set_value("InstallLocation", &format!("\"{}\"", install.display()))?;
    old_key.set_value("MainBinaryName", &"Patina.exe")?;
    old_key.set_value(
        "UninstallString",
        &format!("\"{}\\uninstall.exe\"", install.display()),
    )?;
    drop(old_key);
    let setup = root.path().join("setup.exe");
    let installer =
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../../packaging/windows/patina.nsi");
    run(Command::new(env::var("PATINA_TEST_MAKENSIS")?)
        .arg("/V2")
        .arg("/DAPP_VERSION=1.10.1")
        .arg("/DRESOURCE_VERSION=1.10.1.0")
        .arg(format!("/DINSTALLATION_ID={id}"))
        .arg(format!("/DTAURI_PRODUCT={}", previous.id))
        .arg(format!("/DTAURI_STORAGE_KEY={storage_key}"))
        .arg(format!("/DTAURI_DATA_DIR={}", old_dir.display()))
        .arg(format!("/DOUTPUT_FILE={}", setup.display()))
        .arg(format!(
            "/DAPP_BINARY={}",
            bins.join("patina.exe").display()
        ))
        .arg(installer))?;
    let tauri_update = || {
        let mut cmd = Command::new(&setup);
        cmd.env("APPDATA", &parent)
            .env("LOCALAPPDATA", &local)
            .env_remove("PATINA_PROFILE_PARENT")
            .env_remove("PATINA_GPUI_PROFILE_PARENT")
            .arg("/S")
            .args(["/P", "/R", "/UPDATE", "/ARGS", "--autostart"]);
        cmd
    };
    assert!(
        !tauri_update().status()?.success(),
        "unavailable custom data must block upgrade"
    );
    assert_eq!(fs::read(install.join("Patina.exe"))?, b"previous Patina");
    assert_eq!(
        fs::read(install.join("uninstall.exe"))?,
        b"previous uninstaller"
    );
    assert!(hkcu.open_subkey(&old_registration).is_ok());
    assert!(!control.exists());
    assert!(!profile.join("instance.lock").exists());
    fs::copy(&source, &database)?;
    let existing = profile.join("patina.db");
    fs::write(&existing, b"independent desktop data")?;
    assert!(!tauri_update().status()?.success());
    assert_eq!(fs::read(&existing)?, b"independent desktop data");
    assert_eq!(fs::read(&database)?, old_bytes);
    assert_eq!(fs::read(install.join("Patina.exe"))?, b"previous Patina");
    fs::remove_file(existing)?;
    let setup_and_exit = |tauri: bool| -> Result<(), Error> {
        if tauri {
            run(&mut tauri_update())?;
        } else {
            run(Command::new(&setup)
                .arg("/S")
                .arg(format!("/PROFILEPARENT={}", parent.display()))
                .raw_arg(format!("/D={}", install.display())))?;
        }
        let application = install.join("patina.exe").canonicalize()?;
        assert!(fs::read(&application)? == fs::read(bins.join("patina.exe"))?);
        for retired in ["patina-ui.exe", "patina-probe.exe"] {
            assert!(!install.join(retired).exists());
        }
        let (tray, pid) = match resident(&application) {
            Ok(host) => host,
            Err(problem) => {
                let log = root.path().join("host-startup.log");
                let mut child = Command::new(&application)
                    .arg("--today")
                    .arg("--profile-parent")
                    .arg(&parent)
                    .stderr(fs::File::create(&log)?)
                    .spawn()?;
                std::thread::sleep(std::time::Duration::from_secs(2));
                let status = child.try_wait()?;
                if status.is_none() {
                    child.kill()?;
                    child.wait()?;
                }
                return Err(format!(
                    "{problem}; direct startup {status:?}: {}",
                    fs::read_to_string(log)?
                )
                .into());
            }
        };
        wait_observed("installed UI and sampling probe roles", || {
            let children =
                process::children_with_executable(pid, &application).map_err(|e| e.to_string())?;
            let has = |role: &str| {
                children.iter().any(|c| {
                    c.arguments.get(1).map(String::as_str) == Some("--role")
                        && c.arguments.get(2).map(String::as_str) == Some(role)
                })
            };
            if has("Patina UI") && has("Patina Probe") {
                Ok(())
            } else {
                Err(format!(
                    "observed UI={}, probe={}",
                    has("Patina UI"),
                    has("Patina Probe")
                ))
            }
        })?;
        let exclusive = fs::OpenOptions::new()
            .read(true)
            .share_mode(0)
            .open(&database);
        assert_eq!(
            exclusive.unwrap_err().raw_os_error(),
            Some(32),
            "the recording host must hold the copied custom database open"
        );
        assert!(!profile.join("patina.db").exists());
        unsafe {
            PostMessageW(Some(tray), WM_COMMAND, WPARAM(2), LPARAM(0))?;
        }
        wait_observed("installed host clean shutdown", || {
            if process::executable_path(pid).is_none() {
                Ok(())
            } else {
                Err("active".into())
            }
        })?;
        assert_eq!(sample(&database)?, (27, 60000, "v1.10.0".into()));
        Ok(())
    };
    setup_and_exit(true)?;
    assert!(hkcu.open_subkey(&old_registration).is_err());
    let location = fs::read(&control)?;
    let selected: serde_json::Value = serde_json::from_slice(&location)?;
    assert_eq!(
        Path::new(selected["active"].as_str().unwrap()),
        custom.canonicalize()?
    );
    assert_eq!(
        Path::new(selected["backups"].as_str().unwrap()),
        custom.canonicalize()?.join("backups")
    );
    assert_eq!(
        fs::read(custom.join("backups/retained.zip"))?,
        b"previous backup"
    );
    // A previous build's real application files can be supplied for a release rehearsal.
    if let Some(previous) = env::var_os("PATINA_TEST_PREVIOUS_BIN_DIR") {
        let previous = PathBuf::from(previous);
        for name in ["patina.exe", "patina-ui.exe", "patina-probe.exe"] {
            fs::copy(previous.join(name), install.join(name))?;
        }
    }
    setup_and_exit(false)?;
    // Uninstall owns the program files, while storage and its location belong to the user.
    assert_eq!(legacy.get_raw_value("State")?.bytes, old_control);
    run(Command::new(install.join("Uninstall.exe"))
        .arg("/S")
        .raw_arg(format!("_?={}", install.display())))?;
    assert_eq!(legacy.get_raw_value("State")?.bytes, old_control);
    assert_eq!(fs::read(&control)?, location);
    assert!(!parent.join("Patina.Desktop").exists());
    assert!(!parent.join("Patina.GPUI.Experimental").exists());
    assert_eq!(sample(&database)?, (27, 60000, "v1.10.0".into()));
    assert_eq!(fs::read(&source)?, old_bytes);
    // An installation without a custom directory uses its roaming database.
    let default_parent = root.path().join("fresh-roaming");
    let roaming = default_parent.join("Patina");
    fs::create_dir_all(&roaming)?;
    fs::copy(&source, roaming.join("patina.db"))?;
    let adopt_default = |parent: &Path| {
        run(Command::new(bins.join("patina.exe"))
            .env("APPDATA", parent)
            .env("LOCALAPPDATA", &local)
            .env_remove("PATINA_PROFILE_PARENT")
            .env_remove("PATINA_GPUI_PROFILE_PARENT")
            .arg("--upgrade-tauri-profile")
            .arg("")
            .arg(parent.join("Patina"))
            .arg(format!("{storage_key}\\Absent"))
            .arg("0"))
    };
    adopt_default(&default_parent)?;
    let moved_parent = root.path().join("another-account-path");
    fs::rename(&default_parent, &moved_parent)?;
    adopt_default(&moved_parent)?;
    assert_eq!(fs::read(previous_db)?, b"independent desktop history");
    assert_eq!(
        sample(&moved_parent.join("Patina/patina.db"))?,
        (27, 60000, "v1.10.0".into())
    );
    Ok(())
}
