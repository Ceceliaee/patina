mod bundled_tools;
#[cfg(debug_assertions)]
mod dev_preview;
mod login;
mod message_loop;
mod requests;
mod tool_events;
mod tool_service;
mod tray;
mod window_process;

use patina_activity::{
    ActivityBridges, ActivityMaintenance, ActivityQueries, Classification, NativeToolData,
    Preferences, Recorder, RecordingSignals, StorageOperations,
};
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

/// Select a child role before acquiring the profile lock or starting the recorder.
pub fn run_child_if_requested() -> Option<Result<(), Box<dyn std::error::Error>>> {
    if let Some(code) = patina_windows_integration::windows::native_probe::run_if_requested() {
        std::process::exit(code);
    }
    patina_ui::run_if_requested()
}

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
    let database = patina_activity::prepare_database_for_startup(&root)?;
    let database_runtime = DesktopDatabase::open(&database)?;
    let runtime = &database_runtime.runtime;
    let pool = &database_runtime.pool;
    runtime.block_on(patina_activity::ensure_machine_id(pool))?;
    let initial = runtime.block_on(patina_activity::load_app_preferences(pool.clone()))?;
    let locale = Rc::new(std::cell::Cell::new(initial.locale));
    let signals = RecordingSignals::new({
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
    });
    let recorder = Recorder::start(runtime, pool.clone(), signals.clone())?;
    let recording = recorder.control();
    let bridges = Arc::new(ActivityBridges::new(pool.clone(), signals.clone()));
    let storage = StorageOperations::new(
        &root,
        &database,
        pool.clone(),
        signals.clone(),
        runtime.handle().clone(),
    );
    let mut maintenance = ActivityMaintenance::start(
        runtime,
        pool.clone(),
        bridges.clone(),
        storage.clone(),
        &initial,
    );
    let preferences =
        Preferences::with_recording(pool.clone(), locale.clone(), signals.clone(), bridges);
    let queries = requests::BackgroundQueries::new(
        runtime.handle().clone(),
        ActivityQueries::new(pool.clone()),
    );
    let classification = Classification::with_recording(pool.clone(), signals);
    let behavior = initial.desktop;
    let silent = actions.is_empty() && behavior.start_minimized;
    if actions.is_empty() && !silent {
        send.try_send(Action::Main)?;
    }
    let tray = tray::Tray::new(
        send.clone(),
        recording.clone(),
        locale.clone(),
        behavior,
        &profile_id,
        silent,
    )?;
    let login = login::LoginEntry::new(&profile_id, parent.as_deref())?;
    if let Err(e) = login.apply(behavior.launch_at_login) {
        eprintln!("restore login entry: {e}");
    }
    let updater = make_updater(&root).map_err(io::Error::other)?;
    let update_shutdown = updater.clone();
    let (tools, worker) = tool_service::ToolService::start(
        root.join("tools"),
        NativeToolData::new(pool.clone(), runtime.handle().clone()),
        locale.get().tag().into(),
        send,
        usage_active,
    )?;
    let loop_result = {
        let executor = async_executor::LocalExecutor::new();
        let _runtime_context = runtime.enter();
        message_loop::run(executor.run(window_process::serve(
            &executor,
            actions,
            windows_open,
            revision,
            requests::DesktopRequests {
                queries,
                classification,
                preferences,
                storage,
                recording,
                tools,
                tray,
                login,
                updater,
            },
        )))
    };
    let tools_stopped = worker.stop();
    let maintenance_stopped = maintenance.shutdown();
    let sealed = recorder.shutdown();
    drop(maintenance);
    drop(recorder);
    drop(database_runtime);
    tools_stopped?;
    maintenance_stopped?;
    sealed?;
    let exit = loop_result?;
    update_shutdown
        .write_shutdown_receipt()
        .map_err(io::Error::other)?;
    if matches!(exit, requests::ExitAction::Restart) {
        drop(_profile_lock);
        #[cfg(debug_assertions)]
        if env::var_os("PATINA_GPUI_DEV_SESSION").is_some() {
            std::process::exit(75);
        }
        let mut command = std::process::Command::new(env::current_exe()?);
        command.arg("--main");
        if let Some(dir) = parent {
            command.arg("--profile-parent").arg(dir);
        }
        command.spawn()?;
    }
    Ok(())
}

struct DesktopDatabase {
    runtime: tokio::runtime::Runtime,
    pool: sqlx::SqlitePool,
}

impl DesktopDatabase {
    fn open(path: &Path) -> Result<Self, String> {
        let runtime = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .enable_all()
            .build()
            .map_err(|error| error.to_string())?;
        let pool = runtime.block_on(patina_activity::open_database(path))?;
        Ok(Self { runtime, pool })
    }
}

impl Drop for DesktopDatabase {
    fn drop(&mut self) {
        self.runtime.block_on(self.pool.close());
    }
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
