#[cfg(test)]
mod tests;
mod watch;

use std::{
    env, fs, io,
    io::{BufRead, BufReader},
    os::windows::process::CommandExt,
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::atomic::{AtomicBool, Ordering},
    time::SystemTime,
};
use windows_sys::Win32::System::{
    Console::{CTRL_BREAK_EVENT, CTRL_C_EVENT, SetConsoleCtrlHandler},
    Threading::CREATE_NO_WINDOW,
};

static STOP: AtomicBool = AtomicBool::new(false);

unsafe extern "system" fn interrupt(event: u32) -> i32 {
    if matches!(event, CTRL_C_EVENT | CTRL_BREAK_EVENT) {
        STOP.store(true, Ordering::Relaxed);
        return 1;
    }
    0
}

fn desktop_toolchain(desktop: &Path) -> io::Result<String> {
    let output = Command::new("rustup")
        .args(["show", "active-toolchain"])
        .env_remove("RUSTUP_TOOLCHAIN")
        .current_dir(desktop)
        .output()?;
    if output.status.success()
        && let Some(name) = String::from_utf8_lossy(&output.stdout)
            .split_whitespace()
            .next()
    {
        return Ok(name.to_owned());
    }
    Err(io::Error::other(format!(
        "desktop toolchain: {}",
        String::from_utf8_lossy(&output.stderr)
    )))
}

fn build(desktop: &Path, toolchain: &str) -> io::Result<Option<PathBuf>> {
    let mut cargo = Command::new("rustup")
        .args([
            "run",
            toolchain,
            "cargo",
            "build",
            "--locked",
            "--package",
            "patina-gpui",
            "--bin",
            "patina-gpui",
            "--message-format=json-render-diagnostics",
        ])
        .current_dir(desktop)
        .stdout(Stdio::piped())
        .spawn()?;
    let mut binary = None;
    for line in BufReader::new(cargo.stdout.take().unwrap()).lines() {
        let message: serde_json::Value = serde_json::from_str(&line?)?;
        if message["reason"] == "compiler-artifact"
            && message["target"]["name"] == "patina-gpui"
            && let Some(path) = message["executable"].as_str()
        {
            binary = Some(PathBuf::from(path));
        }
    }
    if !cargo.wait()?.success() {
        eprintln!("Build failed. Save a source file to retry.");
        return Ok(None);
    }
    binary
        .map(Some)
        .ok_or_else(|| io::Error::other("Cargo did not report the GPUI executable"))
}

fn stop(preview: &mut Option<Child>) -> io::Result<()> {
    if let Some(mut child) = preview.take() {
        // EOF asks the tray host to flush the recorder and close its window process.
        drop(child.stdin.take());
        child.wait()?;
    }
    Ok(())
}

fn main() -> io::Result<()> {
    let mut args = env::args().skip(1).collect::<Vec<_>>();
    if args.is_empty() {
        args.push("--today".into());
    }
    if args
        .iter()
        .any(|arg| !matches!(arg.as_str(), "--today" | "--mini"))
    {
        return Err(io::Error::other("Usage: cargo run [-- --today | --mini]"));
    }
    let profile = if let Some(parent) = env::var_os("PATINA_GPUI_PROFILE_PARENT") {
        PathBuf::from(parent)
    } else {
        let local =
            env::var_os("LOCALAPPDATA").ok_or_else(|| io::Error::other("missing LOCALAPPDATA"))?;
        let path = PathBuf::from(local).join("Patina.GPUI.Dev");
        fs::create_dir_all(&path)?;
        path
    };
    if unsafe { SetConsoleCtrlHandler(Some(interrupt), 1) } == 0 {
        return Err(io::Error::last_os_error());
    }
    develop(Path::new(env!("CARGO_MANIFEST_DIR")), &profile, &args)
}

fn develop(root: &Path, profile: &Path, args: &[String]) -> io::Result<()> {
    let desktop = root.join("desktop");
    let toolchain = desktop_toolchain(&desktop)?;
    let sources = watch::Sources::new(root)?;
    let session = tempfile::Builder::new().prefix("patina-dev-").tempdir()?;
    let executable = session.path().join("patina-gpui.exe");
    let mut preview: Option<Child> = None;
    let mut running_build: Option<SystemTime> = None;
    let mut changed = true;
    eprintln!(
        "Watching GPUI sources. Ctrl+C to exit. Profile: {}",
        profile.display()
    );
    while !STOP.load(Ordering::Relaxed) {
        let build = if changed {
            build(&desktop, &toolchain)?
        } else {
            None
        };
        if let Some(child) = &mut preview
            && let Some(status) = child.try_wait()?
        {
            if status.code() == Some(75) {
                preview = None;
                running_build = None;
                changed = true;
                continue;
            }
            if !status.success() {
                return Err(io::Error::other(format!(
                    "GPUI exited with {status} (profile {})",
                    profile.display()
                )));
            }
            break;
        }
        if let Some(binary) = build {
            let version = fs::metadata(&binary)?.modified()?;
            if running_build != Some(version) && !STOP.load(Ordering::Relaxed) {
                // Windows locks running executables. Keep Cargo's output free for the next build.
                let staged = session.path().join("build.exe");
                fs::copy(&binary, &staged)?;
                stop(&mut preview)?;
                fs::rename(staged, &executable)?;
                preview = Some(
                    Command::new(&executable)
                        .args(args)
                        .env("PATINA_GPUI_PROFILE_PARENT", profile)
                        .env("PATINA_GPUI_DEV_SESSION", session.path())
                        .env("PATINA_GPUI_DEV_BINARY", &binary)
                        .creation_flags(CREATE_NO_WINDOW)
                        .stdin(Stdio::piped())
                        .spawn()?,
                );
                running_build = Some(version);
                eprintln!("GPUI preview started.");
            }
        }
        changed = sources.changed(250)?;
        if changed {
            while !STOP.load(Ordering::Relaxed) {
                if !sources.changed(150)? {
                    break;
                }
            }
        }
    }
    stop(&mut preview)
}
