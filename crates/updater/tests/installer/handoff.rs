use super::{Cleanup, Error, run};
use patina_test_desktop::{polling::wait_observed, process};
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
        let hwnd = unsafe { FindWindowW(None, w!("Patina GPUI")) }.map_err(|e| e.to_string())?;
        let mut pid = 0;
        unsafe {
            GetWindowThreadProcessId(hwnd, Some(&mut pid));
        }
        if process::path(pid).and_then(|p| p.canonicalize().ok()) == Some(exe.to_path_buf()) {
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
    if !patina_test_desktop::run_case()? {
        return Ok(());
    }
    let root = tempfile::tempdir()?;
    let fixtures = root.path().canonicalize()?.join("released-production");
    let old_dir = fixtures.join("custom-data");
    fs::create_dir_all(&old_dir)?;
    // Built from the 27 migrations in v1.10.0 (6469dc51) with one synthetic session.
    let mut archived =
        flate2::read::GzDecoder::new(&include_bytes!("../fixtures/patina-1.10.0.sqlite.gz")[..]);
    let mut file = fs::File::create(old_dir.join("patina.db"))?;
    std::io::copy(&mut archived, &mut file)?;
    drop(file);
    let old_control = serde_json::to_vec(&serde_json::json!({
        "format":"patina.storage-control.v1","profile":"production",
        "dataRoot":old_dir,"webviewRoot":null,"pending":null,"maintenance":{},"cleanupFiles":[]
    }))?;
    let bins = PathBuf::from(
        env::var_os("PATINA_TEST_RELEASE_BIN_DIR")
            .ok_or("Set PATINA_TEST_RELEASE_BIN_DIR to the directory containing patina.exe")?,
    )
    .canonicalize()?;
    let state: serde_json::Value = serde_json::from_slice(&old_control)?;
    assert_eq!(state["format"], "patina.storage-control.v1");
    assert_eq!(state["profile"], "production");
    let source = Path::new(
        state["dataRoot"]
            .as_str()
            .ok_or("Missing historical custom data root")?,
    )
    .join("patina.db")
    .canonicalize()?;
    assert!(source.starts_with(&fixtures));
    let old_bytes = fs::read(&source)?;
    assert_eq!(sample(&source)?, (27, 60000, "v1.10.0".into()));
    let id = format!("Patina.Handoff.Test.{}", std::process::id());
    let _cleanup = Cleanup { id: id.clone() };
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let previous = Cleanup {
        id: format!("{id}.Previous"),
    };
    let (legacy, _) = hkcu.create_subkey(format!("Software\\{}\\ReleasedProfile", previous.id))?;
    legacy.set_raw_value(
        "State",
        &RegValue {
            vtype: REG_BINARY,
            bytes: old_control.as_slice().into(),
        },
    )?;
    let parent = root.path().join("profile-parent");
    let profile = parent.join("Patina.GPUI.Experimental");
    let custom = root.path().join("gpui-custom-data");
    fs::create_dir_all(&custom)?;
    fs::create_dir_all(&profile)?;
    let database = custom.join("patina.db");
    fs::copy(&source, &database)?;
    let control = profile.join("database-location.json");
    let location = serde_json::to_vec(&serde_json::json!({"active":custom,"pending":null}))?;
    fs::write(&control, &location)?;
    let install = root.path().join("installation");
    let setup = root.path().join("setup.exe");
    let installer =
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../../packaging/windows/patina.nsi");
    run(Command::new(env::var("PATINA_TEST_MAKENSIS")?)
        .arg("/V2")
        .arg("/DAPP_VERSION=1.10.0")
        .arg("/DRESOURCE_VERSION=1.10.0.0")
        .arg(format!("/DINSTALLATION_ID={id}"))
        .arg(format!("/DOUTPUT_FILE={}", setup.display()))
        .arg(format!(
            "/DAPP_BINARY={}",
            bins.join("patina.exe").display()
        ))
        .arg(installer))?;
    let setup_and_exit = || -> Result<(), Error> {
        run(Command::new(&setup)
            .arg("/S")
            .arg(format!("/PROFILEPARENT={}", parent.display()))
            .raw_arg(format!("/D={}", install.display())))?;
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
            let children = process::children(pid, &application).map_err(|e| e.to_string())?;
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
            if process::path(pid).is_none() {
                Ok(())
            } else {
                Err("active".into())
            }
        })?;
        assert_eq!(sample(&database)?, (27, 60000, "v1.10.0".into()));
        Ok(())
    };
    setup_and_exit()?;
    // A previous build's real application files can be supplied for a release rehearsal.
    if let Some(previous) = env::var_os("PATINA_TEST_PREVIOUS_BIN_DIR") {
        let previous = PathBuf::from(previous);
        for name in ["patina.exe", "patina-ui.exe", "patina-probe.exe"] {
            fs::copy(previous.join(name), install.join(name))?;
        }
    }
    setup_and_exit()?;
    // The old registry entry belongs to the other installation.
    assert_eq!(legacy.get_raw_value("State")?.bytes, old_control);
    run(Command::new(install.join("Uninstall.exe"))
        .arg("/S")
        .raw_arg(format!("_?={}", install.display())))?;
    assert_eq!(legacy.get_raw_value("State")?.bytes, old_control);
    assert_eq!(fs::read(&control)?, location);
    assert_eq!(sample(&database)?, (27, 60000, "v1.10.0".into()));
    assert_eq!(fs::read(source)?, old_bytes);
    Ok(())
}
