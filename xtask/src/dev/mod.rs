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

const BINARIES: [&str; 3] = ["patina", "patina-ui", "patina-probe"];

fn build(root: &Path) -> io::Result<Option<Vec<PathBuf>>> {
    let mut command = Command::new(env::var_os("CARGO").unwrap_or_else(|| "cargo".into()));
    command.current_dir(root).args([
        "build",
        "--locked",
        "--bins",
        "--message-format=json-render-diagnostics",
    ]);
    for package in BINARIES {
        command.args(["--package", package]);
    }
    let mut cargo = command.stdout(Stdio::piped()).spawn()?;
    let mut binaries = std::collections::HashMap::new();
    for line in BufReader::new(cargo.stdout.take().unwrap()).lines() {
        let message: serde_json::Value = serde_json::from_str(&line?)?;
        if message["reason"] == "compiler-artifact"
            && let Some(name) = message["target"]["name"].as_str()
            && BINARIES.contains(&name)
            && let Some(path) = message["executable"].as_str()
        {
            binaries.insert(name.to_owned(), PathBuf::from(path));
        }
    }
    if !cargo.wait()?.success() {
        eprintln!("Build failed. Save a source file to retry.");
        return Ok(None);
    }
    BINARIES
        .iter()
        .map(|name| {
            binaries.remove(*name).ok_or_else(|| {
                io::Error::other(format!("Cargo did not report the {name} executable"))
            })
        })
        .collect::<io::Result<Vec<_>>>()
        .map(Some)
}

fn stop(preview: &mut Option<Child>) -> io::Result<()> {
    if let Some(mut child) = preview.take() {
        // EOF asks the tray host to flush the recorder and close its window process.
        drop(child.stdin.take());
        child.wait()?;
    }
    Ok(())
}

pub(super) fn run(root: &Path, mut args: Vec<String>) -> io::Result<()> {
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
    develop(root, &profile, &args)
}

fn develop(root: &Path, profile: &Path, args: &[String]) -> io::Result<()> {
    let sources = watch::Sources::new(root)?;
    let session = tempfile::Builder::new().prefix("patina-dev-").tempdir()?;
    let mut running_dir = None;
    let mut preview: Option<Child> = None;
    let mut running_build: Option<Vec<SystemTime>> = None;
    let mut changed = true;
    eprintln!(
        "Watching GPUI sources. Ctrl+C to exit. Profile: {}",
        profile.display()
    );
    while !STOP.load(Ordering::Relaxed) {
        let build = if changed { build(root)? } else { None };
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
        if let Some(binaries) = build {
            let version = binaries
                .iter()
                .map(|p| fs::metadata(p)?.modified())
                .collect::<io::Result<Vec<_>>>()?;
            if running_build.as_ref() != Some(&version) && !STOP.load(Ordering::Relaxed) {
                // Windows locks running executables. Keep Cargo's output free for the next build.
                let staged = tempfile::Builder::new()
                    .prefix("bin-")
                    .tempdir_in(session.path())?;
                for binary in &binaries {
                    fs::copy(binary, staged.path().join(binary.file_name().unwrap()))?;
                }
                stop(&mut preview)?;
                let executable = staged.path().join("patina.exe");
                preview = Some(
                    Command::new(&executable)
                        .args(args)
                        .env("PATINA_GPUI_PROFILE_PARENT", profile)
                        .env("PATINA_GPUI_DEV_SESSION", session.path())
                        .env("PATINA_GPUI_DEV_BINARY", &binaries[0])
                        .creation_flags(CREATE_NO_WINDOW)
                        .stdin(Stdio::piped())
                        .spawn()?,
                );
                running_dir.replace(staged);
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
