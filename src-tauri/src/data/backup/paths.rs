use crate::platform::storage_paths;
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Runtime};

const BACKUP_FILE_EXT: &str = "zip";

fn default_backup_path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let backup_dir = storage_paths::resolve_storage_paths(app)?.backup_dir;
    fs::create_dir_all(&backup_dir)
        .map_err(|error| format!("failed to create backup dir: {error}"))?;

    Ok(backup_dir.join(backup_file_name()))
}

fn backup_file_name() -> String {
    let timestamp = chrono::Local::now().format("%Y%m%d-%H%M%S").to_string();
    backup_file_name_for_timestamp(&timestamp)
}

pub(super) fn backup_file_name_for_timestamp(timestamp: &str) -> String {
    format!("Patina-backup-{timestamp}.{BACKUP_FILE_EXT}")
}

pub(super) fn resolve_backup_path<R: Runtime>(
    app: &AppHandle<R>,
    raw_path: Option<String>,
) -> Result<PathBuf, String> {
    let Some(raw_path) = raw_path.map(|value| value.trim().to_string()) else {
        return default_backup_path(app);
    };

    if raw_path.is_empty() {
        return default_backup_path(app);
    }

    let mut path = PathBuf::from(&raw_path);
    let ends_with_separator = raw_path.ends_with('\\') || raw_path.ends_with('/');
    if path.is_dir() || ends_with_separator {
        fs::create_dir_all(&path)
            .map_err(|error| format!("failed to create backup target dir: {error}"))?;
        path = path.join(backup_file_name());
    }

    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent)
                .map_err(|error| format!("failed to create backup parent dir: {error}"))?;
        }
    }

    Ok(path)
}

fn resolve_dialog_directory(initial_path: Option<String>) -> Option<PathBuf> {
    let raw = initial_path?.trim().to_string();
    if raw.is_empty() {
        return None;
    }

    let path = PathBuf::from(raw);
    if path.is_dir() {
        return Some(path);
    }

    path.parent().and_then(|parent| {
        if parent.as_os_str().is_empty() {
            None
        } else {
            Some(parent.to_path_buf())
        }
    })
}

pub fn pick_backup_save_file(initial_path: Option<String>) -> Option<String> {
    let mut dialog = rfd::FileDialog::new().add_filter("Patina backup", &["zip"]);
    if let Some(dir) = resolve_dialog_directory(initial_path) {
        dialog = dialog.set_directory(dir);
    }
    dialog = dialog.set_file_name(backup_file_name());

    dialog
        .save_file()
        .map(|path| path.to_string_lossy().to_string())
}

pub fn pick_backup_file(initial_path: Option<String>) -> Option<String> {
    let mut dialog = rfd::FileDialog::new().add_filter("Patina backup", &["zip"]);
    if let Some(dir) = resolve_dialog_directory(initial_path) {
        dialog = dialog.set_directory(dir);
    }

    dialog
        .pick_file()
        .map(|path| path.to_string_lossy().to_string())
}

pub fn pick_tai_file(initial_path: Option<String>) -> Option<String> {
    let mut dialog = rfd::FileDialog::new().add_filter("Tai CSV", &["csv"]);
    if let Some(dir) = resolve_dialog_directory(initial_path) {
        dialog = dialog.set_directory(dir);
    }

    dialog
        .pick_file()
        .map(|path| path.to_string_lossy().to_string())
}
