#[path = "installer/handoff.rs"]
mod handoff;
use std::{
    env, fs,
    io::Write,
    os::windows::{fs::OpenOptionsExt, process::CommandExt},
    path::{Path, PathBuf},
    process::{Command, Output},
    time::{Duration, Instant},
};
use winreg::{RegKey, enums::HKEY_CURRENT_USER};
type Error = Box<dyn std::error::Error>;

fn run(command: &mut Command) -> Result<Output, Error> {
    let output = command.creation_flags(0x08000000).output()?;
    assert!(
        output.status.success(),
        "{}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    Ok(output)
}
struct Cleanup {
    id: String,
}
impl Drop for Cleanup {
    fn drop(&mut self) {
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let _ = hkcu.delete_subkey_all(format!("Software\\{}", self.id));
        let _ = hkcu.delete_subkey_all(format!(
            "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\{}",
            self.id
        ));
        if let Some(appdata) = env::var_os("APPDATA") {
            let _ = fs::remove_file(
                PathBuf::from(appdata)
                    .join("Microsoft/Windows/Start Menu/Programs")
                    .join(format!("{}.lnk", self.id)),
            );
        }
    }
}
fn wait_file(path: &Path) {
    let deadline = Instant::now() + Duration::from_secs(10);
    while !path.exists() {
        assert!(Instant::now() < deadline, "missing {}", path.display());
        std::thread::sleep(Duration::from_millis(30));
    }
}

#[test]
#[ignore = "isolated Win32 desktop; requires NSIS and rustc"]
fn native_install_upgrade_shutdown_and_uninstall() -> Result<(), Error> {
    if !patina_test_desktop::run_case()? {
        return Ok(());
    }
    let root = tempfile::tempdir()?;
    let id = format!("Patina.GPUI.Test.{}", std::process::id());
    let _cleanup = Cleanup { id: id.clone() };
    let nsis = env::var_os("PATINA_TEST_MAKENSIS")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            env::var_os("ProgramFiles(x86)")
                .map(PathBuf::from)
                .map(|dir| dir.join("NSIS/makensis.exe"))
                .unwrap_or_else(|| PathBuf::from("makensis.exe"))
        });
    let source = root.path().join("fixture.rs");
    let binary = root.path().join("fixture.exe");
    fs::write(
        &source,
        r##"#![windows_subsystem = "windows"]
fn main() {
    let args: Vec<_> = std::env::args().collect();
    if args.get(1).is_some_and(|s| s == "--gate") {
        std::thread::sleep(std::time::Duration::from_millis(800));
        std::fs::write(&args[2], b"clean").unwrap();
    } else {
        let path = std::env::current_exe().unwrap().parent().unwrap().join("started.txt");
        std::fs::write(path, args.join("\n")).unwrap();
    }
}"##,
    )?;
    run(Command::new("rustc").arg(&source).arg("-o").arg(&binary))?;
    let setup = root.path().join("setup.exe");
    run(Command::new(nsis)
        .arg("/V2")
        .arg("/DAPP_VERSION=0.2.0")
        .arg("/DRESOURCE_VERSION=0.2.0.0")
        .arg(format!("/DINSTALLATION_ID={id}"))
        .arg(format!("/DAPP_BINARY={}", binary.display()))
        .arg(format!("/DOUTPUT_FILE={}", setup.display()))
        .arg(Path::new(env!("CARGO_MANIFEST_DIR")).join("../../packaging/windows/patina.nsi")))?;
    let destination = root.path().join("install with spaces");
    // The first GPUI installer had one executable and the same installation identity.
    fs::create_dir_all(&destination)?;
    fs::write(destination.join("patina-gpui.exe"), b"previous application")?;
    fs::write(destination.join("patina-gpui-installation"), b"patina-gpui")?;
    let mut install = Command::new(&setup);
    install
        .arg("/S")
        .raw_arg(format!("/D={}", destination.display()));
    run(&mut install)?;
    wait_file(&destination.join("started.txt"));
    assert!(!destination.join("patina-gpui.exe").exists());
    assert!(destination.join("patina-gpui-installation").is_file());
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let registration = hkcu.open_subkey(format!(
        "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\{id}"
    ))?;
    assert_eq!(
        registration.get_value::<String, _>("Publisher")?,
        "Ceceliaee"
    );
    assert_eq!(
        registration.get_value::<String, _>("DisplayVersion")?,
        "0.2.0"
    );
    let expected = fs::read(&binary)?;
    assert!(fs::read(destination.join("patina.exe"))? == expected);
    let before = b"previous resident executable";
    let mut old_host =
        patina_test_desktop::polling::wait_observed("installed fixture exit", || {
            fs::OpenOptions::new()
                .write(true)
                .open(destination.join("patina.exe"))
                .map_err(|e| e.to_string())
        })?;
    old_host.set_len(0)?;
    old_host.write_all(before)?;
    drop(old_host);
    let previous_ui = b"previous window executable";
    let previous_probe = b"previous probe executable";
    for (name, bytes) in [
        ("patina-ui.exe", previous_ui.as_slice()),
        ("patina-probe.exe", previous_probe.as_slice()),
    ] {
        assert!(!destination.join(name).exists());
        fs::write(destination.join(name), bytes)?;
    }
    let locked = fs::OpenOptions::new()
        .read(true)
        .share_mode(1)
        .open(destination.join("patina-probe.exe"))?;
    let busy = Command::new(&setup)
        .arg("/S")
        .raw_arg(format!("/D={}", destination.display()))
        .output()?;
    assert!(
        !busy.status.success(),
        "locked installation must not be replaced"
    );
    assert_eq!(fs::read(destination.join("patina.exe"))?, before);
    assert_eq!(fs::read(destination.join("patina-ui.exe"))?, previous_ui);
    assert_eq!(
        fs::read(destination.join("patina-probe.exe"))?,
        previous_probe
    );
    assert!(!destination.join(".patina-staging").exists());
    let blocked_uninstall = Command::new(destination.join("Uninstall.exe"))
        .arg("/S")
        .raw_arg(format!("_?={}", destination.display()))
        .output()?;
    assert!(!blocked_uninstall.status.success());
    assert_eq!(fs::read(destination.join("patina.exe"))?, before);
    assert_eq!(fs::read(destination.join("patina-ui.exe"))?, previous_ui);
    assert_eq!(
        fs::read(destination.join("patina-probe.exe"))?,
        previous_probe
    );
    drop(locked);
    // Recover a setup interrupted after two replacement files were published.
    let prior = destination.join(".patina-previous");
    fs::create_dir(&prior)?;
    for name in [
        "patina.exe",
        "patina-ui.exe",
        "patina-probe.exe",
        "Uninstall.exe",
        "patina-gpui-installation",
    ] {
        fs::rename(destination.join(name), prior.join(name))?;
    }
    fs::write(destination.join(".patina-publishing"), "")?;
    fs::write(destination.join("patina-ui.exe"), b"partial update")?;
    fs::write(destination.join("patina-probe.exe"), b"partial update")?;
    let held = fs::OpenOptions::new()
        .read(true)
        .share_mode(1)
        .open(prior.join("patina-probe.exe"))?;
    let retry = Command::new(&setup)
        .arg("/S")
        .raw_arg(format!("/D={}", destination.display()))
        .output()?;
    assert!(!retry.status.success());
    assert!(destination.join(".patina-backing").is_file());
    assert_eq!(fs::read(prior.join("patina-probe.exe"))?, previous_probe);
    assert_eq!(fs::read(destination.join("patina-ui.exe"))?, previous_ui);
    assert_eq!(fs::read(destination.join("patina.exe"))?, before);
    drop(held);
    run(&mut install)?;
    assert!(fs::read(destination.join("patina.exe"))? == expected);
    for name in ["patina-ui.exe", "patina-probe.exe"] {
        assert!(!destination.join(name).exists());
    }
    assert!(!prior.exists());
    let missing_gate = root.path().join("missing-gate");
    let bad = Command::new(&setup)
        .arg("/S")
        .arg("/UPDATEPID=4294967295")
        .arg(format!("/UPDATEGATE={}", missing_gate.display()))
        .raw_arg(format!("/D={}", destination.display()))
        .output()?;
    assert!(!bad.status.success());
    assert!(fs::read(destination.join("patina.exe"))? == expected);
    fs::remove_file(destination.join("started.txt"))?;
    let gate = root.path().join("clean-gate");
    let mut host = Command::new(&binary).arg("--gate").arg(&gate).spawn()?;
    let mut upgrade = Command::new(&setup);
    upgrade
        .arg("/S")
        .arg(format!("/UPDATEPID={}", host.id()))
        .arg(format!("/UPDATEGATE={}", gate.display()))
        .arg(format!("/PROFILEPARENT={}", root.path().display()))
        .raw_arg(format!("/D={}", destination.display()));
    run(&mut upgrade)?;
    assert!(host.wait()?.success());
    wait_file(&destination.join("started.txt"));
    assert!(fs::read_to_string(destination.join("started.txt"))?.contains("--profile-parent"));
    assert!(!destination.join(".patina-previous").exists());
    let data = destination.join("user-data.db");
    fs::write(&data, "preserve")?;
    let mut uninstall = Command::new(destination.join("Uninstall.exe"));
    uninstall
        .arg("/S")
        .raw_arg(format!("_?={}", destination.display()));
    run(&mut uninstall)?;
    for filename in ["patina.exe", "patina-ui.exe", "patina-probe.exe"] {
        assert!(!destination.join(filename).exists());
    }
    assert_eq!(fs::read_to_string(data)?, "preserve");
    assert!(
        hkcu.open_subkey(format!(
            "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\{id}"
        ))
        .is_err()
    );
    Ok(())
}
