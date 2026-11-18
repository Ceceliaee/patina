mod bundled_tools;
#[cfg(debug_assertions)]
mod dev_preview;
mod login;
mod message_loop;
mod tool_events;
mod tool_service;
mod tray;
mod window_process;

use patina_recorder::Recorder;
use std::{
    env, fs, io,
    os::windows::fs::OpenOptionsExt,
    path::{Path, PathBuf},
};
use std::{
    rc::Rc,
    sync::{
        Arc,
        atomic::{AtomicBool, AtomicU64, Ordering},
    },
};
pub use tray::Action;

pub use patina_desktop_protocol::APP_ID;
static RESTART_AFTER_STORAGE: AtomicBool = AtomicBool::new(false);

fn profile_root(parent: Option<&Path>) -> io::Result<PathBuf> {
    let parent = parent
        .map(Path::to_owned)
        .or_else(|| env::var_os("LOCALAPPDATA").map(PathBuf::from))
        .ok_or_else(|| io::Error::other("missing GPUI profile parent"))?;
    if !parent.is_absolute() || !parent.is_dir() {
        return Err(io::Error::other(
            "GPUI profile parent must be an existing absolute directory",
        ));
    }
    let root = parent.join(APP_ID);
    fs::create_dir_all(&root)?;
    root.canonicalize()
}

fn lock_profile(root: &Path) -> io::Result<fs::File> {
    fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .write(true)
        .share_mode(0)
        .open(root.join("instance.lock"))
}

pub fn run(
    send: async_channel::Sender<Action>,
    actions: async_channel::Receiver<Action>,
) -> Result<(), Box<dyn std::error::Error>> {
    launch(send, actions, None, false, false)
}

pub fn launch(
    send: async_channel::Sender<Action>,
    actions: async_channel::Receiver<Action>,
    parent: Option<PathBuf>,
    forward: bool,
    autostart: bool,
) -> Result<(), Box<dyn std::error::Error>> {
    use sha2::{Digest, Sha256};
    use std::os::windows::ffi::OsStrExt;
    let parent = parent.or_else(|| env::var_os("PATINA_GPUI_PROFILE_PARENT").map(PathBuf::from));
    let root = profile_root(parent.as_deref())?;
    // The login entry must retain its identity after a toolchain or binary upgrade.
    let path_bytes: Vec<_> = root
        .as_os_str()
        .to_ascii_lowercase()
        .encode_wide()
        .flat_map(u16::to_le_bytes)
        .collect();
    let profile_id = format!("{APP_ID}.{:x}", Sha256::digest(path_bytes));
    let _profile_lock = match lock_profile(&root) {
        Err(e) if forward && e.raw_os_error() == Some(32) => {
            if !autostart {
                tray::reopen(&profile_id, &actions)?;
            }
            return Ok(());
        }
        result => result?,
    };
    #[cfg(debug_assertions)]
    dev_preview::exit_with_launcher(&send)?;
    patina_windows_integration::enable_monitor_dpi()?;
    let windows_open = Arc::new(AtomicBool::new(false));
    let revision = Arc::new(AtomicU64::new(0));
    let usage_active = Arc::new(AtomicBool::new(false));
    let database = patina_recorder::database_for_profile(&root)?;
    let (recorder, preferences) = Recorder::start_with_preferences(&database, &root, {
        let send = send.clone();
        let windows_open = windows_open.clone();
        let usage_active = usage_active.clone();
        let revision = revision.clone();
        move || {
            revision.fetch_add(1, Ordering::AcqRel);
            if usage_active.load(Ordering::Acquire) {
                let _ = send.try_send(Action::WakeTools);
            }
            if windows_open.load(Ordering::Acquire) {
                let _ = send.try_send(Action::Refresh);
            }
        }
    })?;
    let recorder = Rc::new(recorder);
    let behavior = preferences.desktop;
    let silent = actions.is_empty() && behavior.start_minimized;
    if actions.is_empty() && !silent {
        send.try_send(Action::Today)?;
    }
    let tray = tray::Tray::new(
        send.clone(),
        recorder.clone(),
        behavior,
        &profile_id,
        silent,
    )?;
    let login = login::LoginEntry::new(&profile_id, parent.as_deref())?;
    if let Err(e) = login.apply(behavior.launch_at_login) {
        eprintln!("restore login entry: {e}");
    }
    let shutdown = recorder.clone();
    let (tools, worker) = tool_service::ToolService::start(
        root.join("tools"),
        recorder.tools(),
        recorder.locale.get().tag().into(),
        send,
        usage_active,
    )?;
    let updater = make_updater(&root).map_err(io::Error::other)?;
    let update_shutdown = updater.clone();
    let executor = async_executor::LocalExecutor::new();
    let loop_result = message_loop::run(executor.run(window_process::serve(
        &executor,
        actions,
        recorder,
        windows_open,
        revision,
        window_process::Services {
            tools,
            tray,
            login,
            updater,
        },
    )));
    let tools_stopped = worker.stop();
    shutdown.shutdown()?;
    tools_stopped?;
    loop_result?;
    update_shutdown
        .complete_shutdown()
        .map_err(io::Error::other)?;
    if RESTART_AFTER_STORAGE.swap(false, Ordering::AcqRel) {
        drop(_profile_lock);
        #[cfg(debug_assertions)]
        if env::var_os("PATINA_GPUI_DEV_SESSION").is_some() {
            std::process::exit(75);
        }
        let mut command = std::process::Command::new(env::current_exe()?);
        command.arg("--today");
        if let Some(dir) = parent {
            command.arg("--profile-parent").arg(dir);
        }
        command.spawn()?;
    }
    Ok(())
}

fn make_updater(root: &Path) -> Result<patina_updater::Service, String> {
    #[cfg(debug_assertions)]
    if let Some(fixture) = env::var_os("PATINA_GPUI_UPDATE_FIXTURE") {
        if env::var_os("PATINA_GPUI_PROFILE_PARENT").is_none() {
            return Err("Updater fixtures require an isolated profile".into());
        }
        return patina_updater::fixture::service(root.join("updates"), Path::new(&fixture));
    }
    patina_updater::Service::bundled(env!("CARGO_PKG_VERSION"), root.join("updates"))
}
