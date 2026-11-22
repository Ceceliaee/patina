use crate::{Config, Result, Target, Transport, WindowsHttp, manifest, verify};
use std::{
    fs::{self, File, OpenOptions},
    os::windows::{fs::OpenOptionsExt, process::CommandExt},
    path::{Path, PathBuf},
    process::Command,
    sync::{Arc, Mutex},
};
use tempfile::TempDir;

use crate::{Phase, Request, Snapshot};

struct VerifiedDownload {
    staging_lock: File,
    directory: TempDir,
    installer: PathBuf,
}
struct Inner {
    snapshot: Snapshot,
    ready: Option<VerifiedDownload>,
    shutdown_receipt: Option<PathBuf>,
    staging_lock: Option<File>,
}

#[derive(Clone)]
pub struct Service {
    inner: Arc<Mutex<Inner>>,
    config: Arc<Config>,
    transport: Arc<dyn Transport>,
    target: Target,
    root: PathBuf,
}

impl Service {
    pub fn bundled(current: &str, root: PathBuf) -> Result<Self> {
        Self::new(
            current,
            Target::current()?,
            Config::bundled(),
            root,
            Arc::new(WindowsHttp),
        )
    }
    pub fn new(
        current: &str,
        target: Target,
        config: Config,
        root: PathBuf,
        transport: Arc<dyn Transport>,
    ) -> Result<Self> {
        semver::Version::parse(current).map_err(|e| e.to_string())?;
        config.key()?;
        if config.endpoints.is_empty() {
            return Err("No update endpoints".into());
        }
        for endpoint in &config.endpoints {
            manifest::https_url(endpoint)?;
        }
        fs::create_dir_all(&root).map_err(|e| e.to_string())?;
        let root = root.canonicalize().map_err(|e| e.to_string())?;
        // Only this updater's locked staging directories live below this dedicated root.
        for entry in fs::read_dir(&root).map_err(|e| e.to_string())?.flatten() {
            if !entry.file_name().to_string_lossy().starts_with("pending-") {
                continue;
            }
            let Ok(meta) = fs::symlink_metadata(entry.path()) else {
                continue;
            };
            use std::os::windows::fs::MetadataExt;
            if !meta.is_dir() || meta.file_attributes() & 0x400 != 0 {
                continue;
            }
            if let Ok(lock) = OpenOptions::new()
                .read(true)
                .write(true)
                .share_mode(0)
                .open(entry.path().join("owner.lock"))
            {
                // NSIS may still be running when it starts the updated app.
                if ["Patina-setup.exe", "Patina-GPUI-setup.exe"]
                    .iter()
                    .any(|name| {
                        fs::remove_file(entry.path().join(name))
                            .is_err_and(|e| e.kind() != std::io::ErrorKind::NotFound)
                    })
                {
                    continue;
                }
                drop(lock);
                if fs::remove_dir_all(entry.path()).is_err() && entry.path().is_dir() {
                    // Preserve ownership after partial cleanup so the next launch can retry.
                    let _ = OpenOptions::new()
                        .create(true)
                        .truncate(false)
                        .write(true)
                        .open(entry.path().join("owner.lock"));
                }
            }
        }
        Ok(Self {
            inner: Arc::new(Mutex::new(Inner {
                snapshot: Snapshot::idle(current),
                ready: None,
                shutdown_receipt: None,
                staging_lock: None,
            })),
            config: Arc::new(config),
            transport,
            target,
            root,
        })
    }
    pub fn snapshot(&self) -> Snapshot {
        self.inner.lock().unwrap().snapshot.clone()
    }
    pub fn request(&self, request: Request) -> Result<Snapshot> {
        if matches!(request, Request::Status) {
            return Ok(self.snapshot());
        }
        {
            let mut state = self.inner.lock().unwrap();
            if matches!(
                state.snapshot.phase,
                Phase::Checking | Phase::Downloading | Phase::Installing
            ) {
                return Ok(state.snapshot.clone());
            }
            match request {
                Request::Check => {
                    state.snapshot.release = None;
                    state.ready = None;
                    state.snapshot.phase = Phase::Checking;
                }
                Request::Download => {
                    if state.snapshot.release.is_none() {
                        return Err("Check for an update before downloading".into());
                    }
                    state.ready = None;
                    state.snapshot.phase = Phase::Downloading;
                }
                Request::Status => unreachable!(),
            }
            state.snapshot.received_bytes = 0;
            state.snapshot.error = None;
        }
        let worker = self.clone();
        if let Err(error) = std::thread::Builder::new()
            .name("patina-update".into())
            .spawn(move || {
                let result = match request {
                    Request::Check => worker.check(),
                    Request::Download => worker.download(),
                    Request::Status => unreachable!(),
                };
                if let Err(error) = result {
                    worker.fail(error);
                }
            })
        {
            self.fail(error.to_string());
        }
        Ok(self.snapshot())
    }
    fn fail(&self, error: String) {
        let mut state = self.inner.lock().unwrap();
        state.snapshot.phase = Phase::Failed;
        state.snapshot.error = Some(error);
    }
    fn check(&self) -> Result<()> {
        let installed_version = self
            .inner
            .lock()
            .unwrap()
            .snapshot
            .installed_version
            .clone();
        let mut last = "No update endpoints".to_owned();
        for endpoint in &self.config.endpoints {
            let result = (|| {
                let mut bytes = Vec::new();
                self.transport
                    .get(endpoint, manifest::MAX_MANIFEST, &mut bytes, &mut |_| {})?;
                manifest::parse(&bytes, &self.config, &installed_version, self.target)
            })();
            match result {
                Ok(release) => {
                    let mut state = self.inner.lock().unwrap();
                    state.snapshot.phase = if release.is_some() {
                        Phase::Available
                    } else {
                        Phase::Current
                    };
                    state.snapshot.release = release;
                    return Ok(());
                }
                Err(error) => last = error,
            }
        }
        Err(last)
    }
    fn download(&self) -> Result<()> {
        let release = self.snapshot().release.ok_or("Missing update release")?;
        let directory = tempfile::Builder::new()
            .prefix("pending-")
            .tempdir_in(&self.root)
            .map_err(|e| e.to_string())?;
        let lock = OpenOptions::new()
            .create_new(true)
            .read(true)
            .write(true)
            .share_mode(0)
            .open(directory.path().join("owner.lock"))
            .map_err(|e| e.to_string())?;
        let installer = directory.path().join("Patina-setup.exe");
        let mut file = File::create(&installer).map_err(|e| e.to_string())?;
        self.transport
            .get(&release.url, release.size, &mut file, &mut |received| {
                self.inner.lock().unwrap().snapshot.received_bytes = received;
            })?;
        file.sync_all().map_err(|e| e.to_string())?;
        drop(file);
        verify(
            &mut File::open(&installer).map_err(|e| e.to_string())?,
            &release,
            &self.config,
        )?;
        let mut state = self.inner.lock().unwrap();
        state.ready = Some(VerifiedDownload {
            directory,
            installer,
            staging_lock: lock,
        });
        state.snapshot.phase = Phase::Ready;
        Ok(())
    }

    /// NSIS waits for this host to exit and for its clean-shutdown receipt before replacing files.
    pub fn begin_install(&self, executable: &Path) -> Result<()> {
        self.begin_install_with(executable, |command| {
            command.spawn().map(|_| ()).map_err(|e| e.to_string())
        })
    }
    fn begin_install_with(
        &self,
        executable: &Path,
        launch: impl FnOnce(&mut Command) -> Result<()>,
    ) -> Result<()> {
        let mut state = self.inner.lock().unwrap();
        if state.snapshot.phase != Phase::Ready {
            return Err("A verified installer is required".into());
        }
        let release = state.snapshot.release.as_ref().ok_or("Missing release")?;
        let ready = state.ready.as_ref().ok_or("Missing downloaded installer")?;
        let mut file = OpenOptions::new()
            .read(true)
            .share_mode(1)
            .open(&ready.installer)
            .map_err(|e| e.to_string())?;
        verify(&mut file, release, &self.config)?;
        let shutdown_receipt = ready.directory.path().join("shutdown-complete");
        let mut command = Command::new(&ready.installer);
        command
            .arg(format!("/UPDATEPID={}", std::process::id()))
            .arg(format!("/UPDATEGATE={}", shutdown_receipt.display()));
        if self.root.ends_with("updates")
            && let Some(parent) = self.root.parent().and_then(Path::parent)
        {
            command.arg(format!("/PROFILEPARENT={}", parent.display()));
        }
        // Installed builds have a marker; development/portable builds use the installer's default destination.
        if let Some(dir) = executable.parent().filter(|dir| {
            dir.join("patina-installation").is_file()
                || dir.join("patina-gpui-installation").is_file()
        }) {
            command.raw_arg(format!("/D={}", dir.display()));
        }
        launch(&mut command)?;
        let ready = state.ready.take().unwrap();
        let _ = ready.directory.keep();
        state.staging_lock = Some(ready.staging_lock);
        state.shutdown_receipt = Some(shutdown_receipt);
        state.snapshot.phase = Phase::Installing;
        Ok(())
    }
    pub fn write_shutdown_receipt(&self) -> Result<()> {
        if let Some(shutdown_receipt) = &self.inner.lock().unwrap().shutdown_receipt {
            fs::write(shutdown_receipt, b"clean").map_err(|e| e.to_string())?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tests::ready_service;

    #[test]
    fn installer_launch_failure_keeps_ready_and_gate_requires_clean_shutdown() {
        let root = tempfile::tempdir().unwrap();
        let service = ready_service(root.path());
        assert!(
            service
                .begin_install_with(Path::new("test.exe"), |_| Err("spawn failed".into()))
                .is_err()
        );
        assert_eq!(service.snapshot().phase, Phase::Ready);
        let mut shutdown_receipt = PathBuf::new();
        service
            .begin_install_with(Path::new("test.exe"), |command| {
                let args: Vec<_> = command
                    .get_args()
                    .map(|s| s.to_string_lossy().into_owned())
                    .collect();
                assert_eq!(args.len(), 2);
                assert!(args[0].starts_with("/UPDATEPID="));
                shutdown_receipt = PathBuf::from(args[1].strip_prefix("/UPDATEGATE=").unwrap());
                assert!(!shutdown_receipt.exists());
                assert!(
                    command
                        .get_program()
                        .to_string_lossy()
                        .ends_with("Patina-setup.exe")
                );
                Ok(())
            })
            .unwrap();
        assert_eq!(service.snapshot().phase, Phase::Installing);
        assert!(!shutdown_receipt.exists());
        service.write_shutdown_receipt().unwrap();
        assert_eq!(fs::read(&shutdown_receipt).unwrap(), b"clean");
        assert!(
            service
                .begin_install_with(Path::new("test.exe"), |_| panic!("duplicate installation"))
                .is_err()
        );
    }

    #[test]
    fn installer_is_reverified_immediately_before_launch() {
        let root = tempfile::tempdir().unwrap();
        let service = ready_service(root.path());
        let path = service
            .inner
            .lock()
            .unwrap()
            .ready
            .as_ref()
            .unwrap()
            .installer
            .clone();
        fs::write(path, b"tampered").unwrap();
        assert!(
            service
                .begin_install_with(Path::new("test.exe"), |_| panic!("unverified execution"))
                .is_err()
        );
    }

    #[test]
    fn pending_download_cleanup_respects_live_owner() {
        let root = tempfile::tempdir().unwrap();
        let service = ready_service(root.path());
        let path = service
            .inner
            .lock()
            .unwrap()
            .ready
            .as_ref()
            .unwrap()
            .directory
            .path()
            .to_path_buf();
        let other = Service::new(
            "0.1.0",
            Target::X64,
            (*service.config).clone(),
            root.path().into(),
            service.transport.clone(),
        )
        .unwrap();
        assert!(path.exists());
        drop(other);
        drop(service);
        assert!(
            !path.exists(),
            "lock must be dropped before staging directory"
        );
    }

    #[test]
    fn running_installer_staging_is_retried_after_it_exits() {
        let root = tempfile::tempdir().unwrap();
        let pending = root.path().join("pending-installed");
        fs::create_dir(&pending).unwrap();
        fs::write(pending.join("owner.lock"), []).unwrap();
        let installer = pending.join("Patina-setup.exe");
        fs::write(&installer, b"running installer").unwrap();
        let lock = OpenOptions::new()
            .read(true)
            .share_mode(1)
            .open(&installer)
            .unwrap();
        let (config, _, _) = crate::tests::fixture();
        let _service = Service::new(
            "0.1.0",
            Target::X64,
            config.clone(),
            root.path().into(),
            Arc::new(WindowsHttp),
        )
        .unwrap();
        assert!(pending.join("owner.lock").exists());
        assert!(installer.exists());
        drop(lock);
        let _service = Service::new(
            "0.1.0",
            Target::X64,
            config,
            root.path().into(),
            Arc::new(WindowsHttp),
        )
        .unwrap();
        assert!(!pending.exists());
    }
}
