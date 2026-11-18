use super::{STOP, develop, watch::WATCHED_DIRECTORIES};
use std::{
    fs, io,
    path::Path,
    sync::atomic::Ordering,
    thread,
    time::{Duration, Instant},
};

fn wait_for(path: &Path) -> io::Result<()> {
    let start = Instant::now();
    while !path.exists() {
        if start.elapsed() > Duration::from_secs(30) {
            return Err(io::Error::other(format!(
                "Timed out waiting for {}",
                path.display()
            )));
        }
        thread::sleep(Duration::from_millis(50));
    }
    Ok(())
}

#[test]
fn failed_build_keeps_preview_until_fixed_save() -> io::Result<()> {
    let fixture = tempfile::tempdir()?;
    let root = fixture.path();
    for &(path, _) in WATCHED_DIRECTORIES {
        fs::create_dir_all(root.join(path))?;
    }
    fs::write(
        root.join("Cargo.toml"),
        "[workspace]\nresolver='3'\nmembers=['apps/*']",
    )?;
    let host = root.join("apps/patina");
    fs::create_dir_all(host.join("src/bin"))?;
    fs::write(
        host.join("Cargo.toml"),
        "[package]\nname='patina'\nversion='0.1.0'\nedition='2024'",
    )?;
    fs::write(host.join("src/main.rs"), "fn main() {}")?;
    fs::write(
        host.join("src/bin/unrelated.rs"),
        r#"compile_error!("preview must build only the desktop executable");"#,
    )?;
    let status = std::process::Command::new(env!("CARGO"))
        .args(["generate-lockfile", "--offline"])
        .current_dir(root)
        .status()?;
    assert!(status.success());
    fs::write(
        host.join("build.rs"),
        r#"
fn main() {
    println!("cargo:rerun-if-changed=version");
    let version = std::fs::read_to_string("version").unwrap();
    if version == "broken" {
        std::fs::write("../../failed", "").unwrap();
        panic!("invalid version fixture");
    }
    println!("cargo:rustc-env=VERSION={version}");
}
"#,
    )?;
    fs::write(
        host.join("src/main.rs"),
        r#"
use std::{env, fs, io::{self, Read}, path::PathBuf};
fn main() {
    let profile = PathBuf::from(env::var_os("PATINA_GPUI_PROFILE_PARENT").unwrap());
    let executable = env::current_exe().unwrap();
    assert_eq!(executable.file_name().unwrap(), "patina.exe");
    assert_eq!(fs::read_dir(executable.parent().unwrap()).unwrap().count(), 1);
    if env!("VERSION") == "first" {
        fs::write(profile.join("ready"), "").unwrap();
        io::stdin().read_to_end(&mut Vec::new()).unwrap();
        fs::write(profile.join("closed"), "").unwrap();
    } else {
        assert!(profile.join("closed").exists());
        fs::write(profile.join("recovered"), "").unwrap();
    }
}
"#,
    )?;
    let version = host.join("version");
    fs::write(&version, "first")?;
    thread::scope(|scope| {
        let runner = scope.spawn(|| develop(root, root, &["--today".into()]));
        let verify = (|| {
            wait_for(&root.join("ready"))?;
            fs::write(&version, "broken")?;
            wait_for(&root.join("failed"))?;
            if root.join("closed").exists() {
                return Err(io::Error::other("failed build closed the working preview"));
            }
            fs::write(&version, "second")?;
            wait_for(&root.join("recovered"))
        })();
        if verify.is_err() {
            STOP.store(true, Ordering::Relaxed);
        }
        let result = runner.join().unwrap();
        STOP.store(false, Ordering::Relaxed);
        result.and(verify)
    })
}
