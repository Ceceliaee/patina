use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use tauri::{AppHandle, Emitter, Runtime};
use tauri_plugin_updater::{Update, UpdaterExt};
use tokio::time::{sleep, Duration};

use crate::data::repositories::update_state;
use crate::data::sqlite_pool::wait_for_sqlite_pool;
use crate::domain::update::{UpdateErrorStage, UpdateSnapshot, UpdateStatus};

const STARTUP_AUTO_CHECK_DELAYS_MS: [u64; 3] = [3_500, 15_000, 60_000];
const UPDATE_SNAPSHOT_CHANGED_EVENT: &str = "update-snapshot-changed";
const RELEASES_BASE_URL: &str = "https://github.com/Ceceliaee/patina/releases";
const LATEST_RELEASE_URL: &str = "https://github.com/Ceceliaee/patina/releases/latest";
const UPDATE_PACKAGE_DIR_NAME: &str = "update-packages";
const UPDATE_PACKAGE_FILE_PREFIX: &str = "patina-update-";

#[derive(Clone)]
pub struct UpdaterRuntimeState {
    inner: Arc<Mutex<UpdaterStateInner>>,
}

struct UpdaterStateInner {
    snapshot: UpdateSnapshot,
    pending_update: Option<Update>,
    downloaded_package: Option<DownloadedUpdatePackage>,
}

#[derive(Clone, Debug)]
struct DownloadedUpdatePackage {
    path: PathBuf,
    size_bytes: u64,
}

#[derive(Clone, Debug, Serialize)]
pub struct UpdaterRetainedPackageStats {
    pub retained: bool,
    pub storage: Option<&'static str>,
    pub size_bytes: Option<u64>,
}

impl UpdaterRuntimeState {
    pub fn new(current_version: String) -> Self {
        Self {
            inner: Arc::new(Mutex::new(UpdaterStateInner {
                snapshot: UpdateSnapshot::idle(current_version)
                    .with_fallback_urls(Some(latest_release_page_url()), None),
                pending_update: None,
                downloaded_package: None,
            })),
        }
    }

    pub fn snapshot(&self) -> UpdateSnapshot {
        self.with_guard(|inner| inner.snapshot.clone())
    }

    fn set_checking(&self) -> UpdateSnapshot {
        self.with_guard(|inner| {
            inner.snapshot = inner.snapshot.clone().checking();
            inner.snapshot.clone()
        })
    }

    fn set_available(&self, update: Update) -> UpdateSnapshot {
        let release_page_url = release_page_url_for_version(&update.version);
        let asset_download_url = Some(update.download_url.to_string());
        self.with_guard(|inner| {
            inner.snapshot = inner
                .snapshot
                .clone()
                .available(
                    update.version.clone(),
                    update.body.clone(),
                    update.date.map(|value| value.to_string()),
                )
                .with_fallback_urls(release_page_url.clone(), asset_download_url.clone());
            inner.pending_update = Some(update);
            clear_downloaded_package(inner);
            inner.snapshot.clone()
        })
    }

    fn set_up_to_date(&self) -> UpdateSnapshot {
        self.with_guard(|inner| {
            inner.snapshot = inner
                .snapshot
                .clone()
                .up_to_date()
                .with_fallback_urls(Some(latest_release_page_url()), None);
            inner.pending_update = None;
            clear_downloaded_package(inner);
            inner.snapshot.clone()
        })
    }

    fn set_error(&self, stage: UpdateErrorStage, message: String) -> UpdateSnapshot {
        self.with_guard(|inner| {
            inner.snapshot = inner.snapshot.clone().error(stage, message);
            inner.snapshot.clone()
        })
    }

    fn set_downloading(&self) -> UpdateSnapshot {
        self.with_guard(|inner| {
            inner.snapshot = inner.snapshot.clone().downloading();
            inner.snapshot.clone()
        })
    }

    fn set_download_progress(
        &self,
        downloaded_bytes: u64,
        total_bytes: Option<u64>,
    ) -> UpdateSnapshot {
        self.with_guard(|inner| {
            inner.snapshot = inner
                .snapshot
                .clone()
                .download_progress(downloaded_bytes, total_bytes);
            inner.snapshot.clone()
        })
    }

    fn set_downloaded(&self, package: DownloadedUpdatePackage) -> UpdateSnapshot {
        self.with_guard(|inner| {
            clear_downloaded_package(inner);
            inner.snapshot = inner.snapshot.clone().downloaded(package.size_bytes);
            inner.downloaded_package = Some(package);
            inner.snapshot.clone()
        })
    }

    fn set_installing(&self) -> UpdateSnapshot {
        self.with_guard(|inner| {
            inner.snapshot = inner.snapshot.clone().installing();
            inner.snapshot.clone()
        })
    }

    fn pending_update(&self) -> Option<Update> {
        self.with_guard(|inner| inner.pending_update.clone())
    }

    fn set_pending_update(&self, update: Update) {
        self.with_guard(|inner| {
            inner.pending_update = Some(update);
        });
    }

    fn take_downloaded_package(&self) -> Option<DownloadedUpdatePackage> {
        self.with_guard(|inner| inner.downloaded_package.take())
    }

    fn set_downloaded_package(&self, package: DownloadedUpdatePackage) {
        self.with_guard(|inner| {
            inner.downloaded_package = Some(package);
        });
    }

    fn downloaded_package_path(&self) -> Option<PathBuf> {
        self.with_guard(|inner| {
            inner
                .downloaded_package
                .as_ref()
                .map(|package| package.path.clone())
        })
    }

    pub fn retained_package_stats(&self) -> UpdaterRetainedPackageStats {
        self.with_guard(|inner| {
            if let Some(package) = inner.downloaded_package.as_ref() {
                return UpdaterRetainedPackageStats {
                    retained: true,
                    storage: Some("file"),
                    size_bytes: Some(package.size_bytes),
                };
            }

            UpdaterRetainedPackageStats {
                retained: false,
                storage: None,
                size_bytes: None,
            }
        })
    }

    fn with_guard<T>(&self, f: impl FnOnce(&mut UpdaterStateInner) -> T) -> T {
        match self.inner.lock() {
            Ok(mut guard) => f(&mut guard),
            Err(poisoned) => {
                let mut guard = poisoned.into_inner();
                f(&mut guard)
            }
        }
    }
}

fn clear_downloaded_package(inner: &mut UpdaterStateInner) {
    if let Some(package) = inner.downloaded_package.take() {
        remove_downloaded_package_file(&package);
    }
}

fn remove_downloaded_package_file(package: &DownloadedUpdatePackage) {
    if let Err(error) = fs::remove_file(&package.path) {
        if error.kind() != std::io::ErrorKind::NotFound {
            eprintln!(
                "[updater] failed to remove cached update package {}: {error}",
                package.path.display()
            );
        }
    }
}

fn latest_release_page_url() -> String {
    LATEST_RELEASE_URL.to_string()
}

fn release_page_url_for_version(version: &str) -> Option<String> {
    if version.trim().is_empty() {
        return Some(latest_release_page_url());
    }

    Some(format!("{RELEASES_BASE_URL}/tag/v{version}"))
}

fn emit_update_snapshot_changed<R: Runtime>(app: &AppHandle<R>, snapshot: &UpdateSnapshot) {
    if let Err(error) = app.emit(UPDATE_SNAPSHOT_CHANGED_EVENT, snapshot) {
        eprintln!("[updater] failed to emit update snapshot change: {error}");
    }
}

pub async fn check_for_updates<R: Runtime>(
    app: &AppHandle<R>,
    state: &UpdaterRuntimeState,
    silent: bool,
) -> Result<UpdateSnapshot, String> {
    cleanup_stale_update_packages(app, state.downloaded_package_path().as_deref());

    let silent_context = if silent {
        let pool = wait_for_sqlite_pool(app).await?;
        let today = update_state::current_local_day();
        let last_day = update_state::load_last_auto_check_day(&pool)
            .await
            .map_err(|error| format!("failed to read auto update check state: {error}"))?;
        if last_day.as_deref() == Some(today.as_str()) {
            return Ok(state.snapshot());
        }
        Some((pool, today))
    } else {
        None
    };

    let checking_snapshot = state.set_checking();
    emit_update_snapshot_changed(app, &checking_snapshot);

    let updater = match app.updater() {
        Ok(updater) => updater,
        Err(error) => {
            let snapshot = state.set_error(
                UpdateErrorStage::Check,
                format!("failed to initialize updater: {error}"),
            );
            emit_update_snapshot_changed(app, &snapshot);
            return Ok(snapshot);
        }
    };

    let update = match updater.check().await {
        Ok(update) => update,
        Err(error) => {
            let snapshot = state.set_error(
                UpdateErrorStage::Check,
                format!("failed to check updates: {error}"),
            );
            emit_update_snapshot_changed(app, &snapshot);
            return Ok(snapshot);
        }
    };

    let snapshot = match update {
        Some(update) => state.set_available(update),
        None => state.set_up_to_date(),
    };

    if let Some((pool, today)) = silent_context {
        if let Err(error) = update_state::save_last_auto_check_day(&pool, &today).await {
            eprintln!("[updater] failed to persist auto update check state: {error}");
        }
    }

    emit_update_snapshot_changed(app, &snapshot);
    Ok(snapshot)
}

pub async fn run_startup_auto_check<R: Runtime>(app: AppHandle<R>, state: UpdaterRuntimeState) {
    for (attempt, delay_ms) in STARTUP_AUTO_CHECK_DELAYS_MS.iter().enumerate() {
        sleep(Duration::from_millis(*delay_ms)).await;

        match check_for_updates(&app, &state, true).await {
            Ok(snapshot) => {
                if snapshot.status != UpdateStatus::Error {
                    return;
                }
                eprintln!(
                    "[updater] startup auto-check attempt {} failed: {}",
                    attempt + 1,
                    snapshot
                        .error_message
                        .as_deref()
                        .unwrap_or("unknown updater error")
                );
            }
            Err(error) => {
                eprintln!(
                    "[updater] startup auto-check attempt {} failed: {error}",
                    attempt + 1
                );
            }
        }
    }

    eprintln!("[updater] startup auto-check exhausted retry budget");
}

pub async fn download_pending<R: Runtime>(
    app: &AppHandle<R>,
    state: &UpdaterRuntimeState,
) -> Result<UpdateSnapshot, String> {
    let Some(update) = state.pending_update() else {
        let snapshot = state.set_error(
            UpdateErrorStage::Download,
            "there is no pending update".to_string(),
        );
        emit_update_snapshot_changed(app, &snapshot);
        return Ok(snapshot);
    };

    let downloading_snapshot = state.set_downloading();
    emit_update_snapshot_changed(app, &downloading_snapshot);

    let progress_state = Arc::new(Mutex::new(0_u64));
    let progress_state_for_download = Arc::clone(&progress_state);
    let app_for_progress = app.clone();
    let state_for_progress = state.clone();

    let download_result = update
        .download(
            move |chunk_length, content_length| {
                let downloaded_bytes = match progress_state_for_download.lock() {
                    Ok(mut guard) => {
                        *guard += chunk_length as u64;
                        *guard
                    }
                    Err(poisoned) => {
                        let mut guard = poisoned.into_inner();
                        *guard += chunk_length as u64;
                        *guard
                    }
                };
                let snapshot =
                    state_for_progress.set_download_progress(downloaded_bytes, content_length);
                emit_update_snapshot_changed(&app_for_progress, &snapshot);
            },
            move || {},
        )
        .await;

    match download_result {
        Ok(bytes) => {
            cleanup_stale_update_packages(app, state.downloaded_package_path().as_deref());
            let package = match write_update_package_to_temp_file(app, &update.version, bytes) {
                Ok(package) => package,
                Err(error) => {
                    let snapshot = state.set_error(UpdateErrorStage::Download, error);
                    emit_update_snapshot_changed(app, &snapshot);
                    return Ok(snapshot);
                }
            };
            let snapshot = state.set_downloaded(package);
            emit_update_snapshot_changed(app, &snapshot);
            Ok(snapshot)
        }
        Err(error) => {
            let snapshot = state.set_error(
                UpdateErrorStage::Download,
                format!("failed to download update: {error}"),
            );
            emit_update_snapshot_changed(app, &snapshot);
            Ok(snapshot)
        }
    }
}

pub async fn install_downloaded<R: Runtime>(
    app: &AppHandle<R>,
    state: &UpdaterRuntimeState,
) -> Result<UpdateSnapshot, String> {
    let Some(update) = state.pending_update() else {
        let snapshot = state.set_error(
            UpdateErrorStage::Install,
            "there is no pending update".to_string(),
        );
        emit_update_snapshot_changed(app, &snapshot);
        return Ok(snapshot);
    };
    let Some(downloaded_package) = state.take_downloaded_package() else {
        let snapshot = state.set_error(
            UpdateErrorStage::Install,
            "update package has not been downloaded".to_string(),
        );
        emit_update_snapshot_changed(app, &snapshot);
        return Ok(snapshot);
    };
    let downloaded_bytes = match fs::read(&downloaded_package.path) {
        Ok(bytes) => bytes,
        Err(error) => {
            state.set_pending_update(update);
            let snapshot = state.set_error(
                UpdateErrorStage::Install,
                format!("failed to read downloaded update package: {error}"),
            );
            emit_update_snapshot_changed(app, &snapshot);
            return Ok(snapshot);
        }
    };

    let post_install_reopen_pool = match wait_for_sqlite_pool(app).await {
        Ok(pool) => {
            if let Err(error) = update_state::request_post_install_reopen_main_window(&pool).await {
                eprintln!("[updater] failed to persist post-install reopen intent: {error}");
            }
            Some(pool)
        }
        Err(error) => {
            eprintln!("[updater] failed to load sqlite pool for reopen intent: {error}");
            None
        }
    };

    let installing_snapshot = state.set_installing();
    emit_update_snapshot_changed(app, &installing_snapshot);
    let install_result = update.install(&downloaded_bytes);

    match install_result {
        Ok(()) => {
            remove_downloaded_package_file(&downloaded_package);
            state.set_pending_update(update);
            let snapshot = state.snapshot();
            emit_update_snapshot_changed(app, &snapshot);
            Ok(snapshot)
        }
        Err(error) => {
            state.set_pending_update(update);
            state.set_downloaded_package(downloaded_package);
            if let Some(pool) = post_install_reopen_pool.as_ref() {
                if let Err(clear_error) =
                    update_state::clear_post_install_reopen_main_window(pool).await
                {
                    eprintln!(
                        "[updater] failed to clear post-install reopen intent after install error: {clear_error}"
                    );
                }
            }
            let snapshot = state.set_error(
                UpdateErrorStage::Install,
                format!("failed to install update: {error}"),
            );
            emit_update_snapshot_changed(app, &snapshot);
            Ok(snapshot)
        }
    }
}

fn update_package_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    Ok(crate::platform::app_paths::product_roaming_data_dir(app)?.join(UPDATE_PACKAGE_DIR_NAME))
}

fn write_update_package_to_temp_file<R: Runtime>(
    app: &AppHandle<R>,
    version: &str,
    bytes: Vec<u8>,
) -> Result<DownloadedUpdatePackage, String> {
    let dir = update_package_dir(app)?;
    write_update_package_to_dir(&dir, version, bytes)
}

fn write_update_package_to_dir(
    dir: &Path,
    version: &str,
    bytes: Vec<u8>,
) -> Result<DownloadedUpdatePackage, String> {
    fs::create_dir_all(dir).map_err(|error| {
        format!(
            "failed to create update package cache directory {}: {error}",
            dir.display()
        )
    })?;
    let size_bytes = bytes.len() as u64;
    let file_name = format!(
        "{UPDATE_PACKAGE_FILE_PREFIX}{}-{}-{}.bin",
        std::process::id(),
        now_ms(),
        sanitize_update_package_version(version),
    );
    let path = dir.join(file_name);

    fs::write(&path, &bytes).map_err(|error| {
        format!(
            "failed to write downloaded update package {}: {error}",
            path.display()
        )
    })?;

    Ok(DownloadedUpdatePackage { path, size_bytes })
}

fn cleanup_stale_update_packages<R: Runtime>(
    app: &AppHandle<R>,
    active_package_path: Option<&Path>,
) {
    let Ok(dir) = update_package_dir(app) else {
        return;
    };
    cleanup_stale_update_packages_in_dir(&dir, active_package_path);
}

fn cleanup_stale_update_packages_in_dir(dir: &Path, active_package_path: Option<&Path>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };

    for entry in entries.flatten() {
        let path = entry.path();
        let is_active = active_package_path
            .map(|active_path| active_path == path.as_path())
            .unwrap_or(false);
        if is_active {
            continue;
        }
        let Some(file_name) = path.file_name().and_then(|value| value.to_str()) else {
            continue;
        };
        if !file_name.starts_with(UPDATE_PACKAGE_FILE_PREFIX) {
            continue;
        }
        if let Err(error) = fs::remove_file(&path) {
            if error.kind() != std::io::ErrorKind::NotFound {
                eprintln!(
                    "[updater] failed to remove stale update package {}: {error}",
                    path.display()
                );
            }
        }
    }
}

fn sanitize_update_package_version(version: &str) -> String {
    let sanitized = version
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '.' | '-' | '_') {
                ch
            } else {
                '_'
            }
        })
        .collect::<String>();
    let trimmed = sanitized.trim_matches('_');
    if trimmed.is_empty() {
        "unknown".to_string()
    } else {
        trimmed.to_string()
    }
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::{
        cleanup_stale_update_packages_in_dir, sanitize_update_package_version,
        write_update_package_to_dir, UPDATE_PACKAGE_FILE_PREFIX,
    };
    use std::fs;
    use std::path::PathBuf;

    fn temp_dir(label: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "patina-updater-test-{}-{label}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&path);
        fs::create_dir_all(&path).unwrap();
        path
    }

    #[test]
    fn update_package_versions_are_safe_file_name_parts() {
        assert_eq!(sanitize_update_package_version("1.8.2"), "1.8.2");
        assert_eq!(sanitize_update_package_version(" 1/8/2 "), "1_8_2");
        assert_eq!(sanitize_update_package_version(""), "unknown");
    }

    #[test]
    fn update_package_download_is_written_to_file() {
        let dir = temp_dir("write");
        let package = write_update_package_to_dir(&dir, "1.8.2", vec![1, 2, 3, 4]).unwrap();

        assert_eq!(package.size_bytes, 4);
        assert!(package.path.exists());
        assert_eq!(fs::read(&package.path).unwrap(), vec![1, 2, 3, 4]);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn stale_update_package_cleanup_keeps_active_package_only() {
        let dir = temp_dir("cleanup");
        let active = write_update_package_to_dir(&dir, "1.8.2", vec![1]).unwrap();
        let stale = dir.join(format!("{UPDATE_PACKAGE_FILE_PREFIX}stale.bin"));
        let unrelated = dir.join("notes.txt");
        fs::write(&stale, [2]).unwrap();
        fs::write(&unrelated, [3]).unwrap();

        cleanup_stale_update_packages_in_dir(&dir, Some(&active.path));

        assert!(active.path.exists());
        assert!(!stale.exists());
        assert!(unrelated.exists());

        let _ = fs::remove_dir_all(&dir);
    }
}
