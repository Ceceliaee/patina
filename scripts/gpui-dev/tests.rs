use super::{STOP, develop, watch::DIRECTORIES};
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
    for &(path, _) in DIRECTORIES {
        fs::create_dir_all(root.join(path))?;
    }
    let desktop = root.join("desktop");
    fs::write(
        desktop.join("rust-toolchain.toml"),
        include_str!("../../desktop/rust-toolchain.toml"),
    )?;
    fs::write(
        desktop.join("Cargo.toml"),
        r#"
[package]
name = "patina-gpui"
version = "0.1.0"
edition = "2024"
[[bin]]
name = "patina-gpui"
path = "patina/main.rs"
"#,
    )?;
    fs::write(
        desktop.join("Cargo.lock"),
        "version = 4\n[[package]]\nname = \"patina-gpui\"\nversion = \"0.1.0\"\n",
    )?;
    fs::write(
        desktop.join("build.rs"),
        r#"
fn main() {
    println!("cargo:rerun-if-changed=patina/version");
    let version = std::fs::read_to_string("patina/version").unwrap();
    if version == "broken" {
        std::fs::write("../failed", "").unwrap();
        panic!("invalid version fixture");
    }
    println!("cargo:rustc-env=VERSION={version}");
}
"#,
    )?;
    fs::write(
        desktop.join("patina/main.rs"),
        r#"
use std::{env, fs, io::{self, Read}, path::PathBuf};
fn main() {
    let profile = PathBuf::from(env::var_os("PATINA_GPUI_PROFILE_PARENT").unwrap());
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
    let version = desktop.join("patina/version");
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
