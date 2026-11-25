mod bundled_tools;
#[cfg(debug_assertions)]
mod dev_preview;
mod login;
mod upgrade;
pub use upgrade::adopt_tauri_profile;
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
pub const PROFILE_DIRECTORY: &str = "Patina";
const PREVIOUS_DESKTOP_ID: &str = "Patina.Desktop";
const PREVIOUS_PROFILE: &str = "Patina.GPUI.Experimental";

/// Select a child role before acquiring the profile lock or starting the recorder.
pub fn run_child_if_requested() -> Option<Result<(), Box<dyn std::error::Error>>> {
    if let Some(code) = patina_windows_integration::windows::native_probe::run_if_requested() {
        std::process::exit(code);
    }
    patina_ui::run_if_requested()
}

fn profile_parent_from_env() -> Option<PathBuf> {
    env::var_os("PATINA_PROFILE_PARENT")
        .or_else(|| env::var_os("PATINA_GPUI_PROFILE_PARENT"))
        .map(PathBuf::from)
}

#[derive(Clone, Copy, PartialEq)]
enum ProfileUse {
    Launch,
    TauriUpgrade,
}

fn profile_root(parent: Option<&Path>, usage: ProfileUse) -> io::Result<PathBuf> {
    if let Some(parent) = parent {
        return select_profile(parent, None, usage);
    }
    let roaming = env::var_os("APPDATA").ok_or_else(|| io::Error::other("missing APPDATA"))?;
    let local = env::var_os("LOCALAPPDATA").map(PathBuf::from);
    select_profile(Path::new(&roaming), local.as_deref(), usage)
}

fn select_profile(
    parent: &Path,
    previous_parent: Option<&Path>,
    usage: ProfileUse,
) -> io::Result<PathBuf> {
    if !parent.is_absolute() || !parent.is_dir() {
        return Err(io::Error::other(
            "profile parent must be an existing absolute directory",
        ));
    }
    let root = parent.join(PROFILE_DIRECTORY);
    let previous_parent = previous_parent.filter(|p| p.is_absolute() && *p != parent);
    for base in [Some(parent), previous_parent].into_iter().flatten() {
        if let Some(profile) = existing_profile(base)? {
            // A Tauri installation has its own production database. Older desktop
            // identities keep their data when the installer first adopts that database.
            if usage == ProfileUse::TauriUpgrade && !profile.ends_with(PROFILE_DIRECTORY) {
                break;
            }
            return profile.canonicalize();
        }
        if base != parent && !root.join("patina.db").try_exists()? {
            let local = base.join(PROFILE_DIRECTORY);
            if local.join("patina.db").try_exists()? {
                return local.canonicalize();
            }
        }
    }
    fs::create_dir_all(&root)?;
    root.canonicalize()
}

fn existing_profile(parent: &Path) -> io::Result<Option<PathBuf>> {
    let root = parent.join(PROFILE_DIRECTORY);
    // A previous profile can store its database here while keeping the lock and settings elsewhere.
    if root.is_dir()
        && (root.join("instance.lock").try_exists()?
            || root.join("database-location.json").try_exists()?)
    {
        return Ok(Some(root));
    }
    // Database locations and pending moves can contain absolute paths into the original profile.
    for name in [PREVIOUS_DESKTOP_ID, PREVIOUS_PROFILE] {
        let previous = parent.join(name);
        if previous.try_exists()? {
            if !previous.is_dir() {
                return Err(io::Error::other("previous profile path is not a directory"));
            }
            return Ok(Some(previous));
        }
    }
    Ok(None)
}

#[cfg(test)]
#[test]
fn profile_selection_preserves_existing_locations() {
    let parent = tempfile::tempdir().unwrap();
    let previous = parent.path().join(PREVIOUS_PROFILE);
    let desktop = parent.path().join("Patina.Desktop");
    let current = parent.path().join("Patina");
    let select = || profile_root(Some(parent.path()), ProfileUse::Launch).unwrap();
    fs::create_dir(&previous).unwrap();
    fs::write(previous.join("database-location.json"), b"existing").unwrap();
    assert_eq!(select(), previous.canonicalize().unwrap());
    assert!(!current.exists());
    fs::create_dir_all(current.join("EBWebView")).unwrap();
    assert_eq!(select(), previous.canonicalize().unwrap());
    fs::create_dir(&desktop).unwrap();
    fs::write(current.join("patina.db"), b"relocated database").unwrap();
    fs::write(
        desktop.join("database-location.json"),
        serde_json::to_vec(&serde_json::json!({"active": current})).unwrap(),
    )
    .unwrap();
    assert_eq!(select(), desktop.canonicalize().unwrap());
    assert_eq!(
        fs::read(current.join("patina.db")).unwrap(),
        b"relocated database"
    );
    fs::write(current.join("database-location.json"), b"current").unwrap();
    assert_eq!(select(), current.canonicalize().unwrap());
    assert_eq!(
        fs::read(previous.join("database-location.json")).unwrap(),
        b"existing"
    );
    let fresh = tempfile::tempdir().unwrap();
    assert_eq!(
        profile_root(Some(fresh.path()), ProfileUse::Launch).unwrap(),
        fresh.path().canonicalize().unwrap().join("Patina")
    );
}

#[cfg(test)]
#[test]
fn default_profile_uses_roaming_and_recognizes_local_user_data() -> io::Result<()> {
    let root = tempfile::tempdir()?;
    let roaming = root.path().join("Roaming");
    let local = root.path().join("Local");
    let target = roaming.join(PROFILE_DIRECTORY);
    let old = local.join(PROFILE_DIRECTORY);
    fs::create_dir(&roaming)?;
    fs::create_dir_all(old.join("EBWebView"))?;
    fs::write(old.join("Patina.exe"), b"installer")?;
    let select = || select_profile(&roaming, Some(&local), ProfileUse::Launch);
    assert_eq!(select()?, target.canonicalize()?);
    fs::write(old.join("patina.db"), b"existing")?;
    assert_eq!(select()?, old.canonicalize()?);
    fs::write(target.join("patina.db"), b"released roaming database")?;
    assert_eq!(select()?, target.canonicalize()?);
    let previous = local.join(PREVIOUS_PROFILE);
    fs::create_dir(&previous)?;
    assert_eq!(select()?, previous.canonicalize()?);
    let upgrade = || select_profile(&roaming, Some(&local), ProfileUse::TauriUpgrade);
    assert_eq!(upgrade()?, target.canonicalize()?);
    fs::write(old.join("database-location.json"), b"custom data location")?;
    assert_eq!(select()?, old.canonicalize()?);
    assert_eq!(upgrade()?, old.canonicalize()?);
    fs::write(target.join("instance.lock"), b"")?;
    assert_eq!(select()?, target.canonicalize()?);
    assert_eq!(
        profile_root(Some(&local), ProfileUse::Launch)?,
        old.canonicalize()?
    );
    Ok(())
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
    let parent = parent.or_else(profile_parent_from_env);
    let root = profile_root(parent.as_deref(), ProfileUse::Launch)?;
    // The login entry must retain its identity after a toolchain or binary upgrade.
    let path_bytes: Vec<_> = root
        .as_os_str()
        .to_ascii_lowercase()
        .encode_wide()
        .flat_map(u16::to_le_bytes)
        .collect();
    let digest = Sha256::digest(path_bytes);
    let profile_id = format!("{APP_ID}.{digest:x}");
    let mut previous_ids = vec![format!("{PREVIOUS_DESKTOP_ID}.{digest:x}")];
    if root.ends_with(PREVIOUS_PROFILE) {
        previous_ids.push(format!("{PREVIOUS_PROFILE}.{digest:x}"));
    }
    let _profile_lock = match lock_profile(&root) {
        Err(e) if forward && e.raw_os_error() == Some(32) => {
            if !autostart {
                tray::reopen(&profile_id, &previous_ids, &actions)?;
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
    } else {
        for name in previous_ids {
            if let Err(e) = login::remove_entry(&name) {
                eprintln!("remove previous login entry: {e}");
            }
        }
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
        if env::var_os("PATINA_DEV_SESSION").is_some() {
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
    if let Some(fixture) = env::var_os("PATINA_UPDATE_FIXTURE") {
        if env::var_os("PATINA_PROFILE_PARENT").is_none() {
            return Err("Updater fixtures require an isolated profile".into());
        }
        return patina_updater::fixture::service(root.join("updates"), Path::new(&fixture));
    }
    patina_updater::Service::bundled(env!("CARGO_PKG_VERSION"), root.join("updates"))
}
