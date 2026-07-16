use crate::platform::{app_paths, storage_anchor};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Runtime};

pub const SQLITE_DB_FILE_NAME: &str = "patina.db";
const BACKUP_DIR_NAME: &str = "backups";
const REMOTE_BACKUP_TEMP_DIR_NAME: &str = "remote-backup-temp";

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StoragePaths {
    pub data_anchor_dir: PathBuf,
    pub cache_anchor_dir: PathBuf,
    pub data_root: PathBuf,
    pub db_path: PathBuf,
    pub backup_dir: PathBuf,
    pub remote_backup_temp_dir: PathBuf,
    pub webview_root: PathBuf,
    pub is_custom_data_root: bool,
    pub is_custom_webview_root: bool,
}

impl StoragePaths {
    fn from_roots(
        data_anchor_dir: PathBuf,
        cache_anchor_dir: PathBuf,
        data_root: PathBuf,
        webview_root: PathBuf,
        is_custom_data_root: bool,
        is_custom_webview_root: bool,
    ) -> Self {
        Self {
            data_anchor_dir,
            cache_anchor_dir,
            db_path: data_root.join(SQLITE_DB_FILE_NAME),
            backup_dir: data_root.join(BACKUP_DIR_NAME),
            remote_backup_temp_dir: data_root.join(REMOTE_BACKUP_TEMP_DIR_NAME),
            data_root,
            webview_root,
            is_custom_data_root,
            is_custom_webview_root,
        }
    }
}

pub fn default_storage_paths<R: Runtime>(app: &AppHandle<R>) -> Result<StoragePaths, String> {
    #[cfg(debug_assertions)]
    if std::env::var("PATINA_E2E").as_deref() == Ok("1") {
        let root = std::env::var_os("PATINA_E2E_DATA_ROOT")
            .map(PathBuf::from)
            .ok_or_else(|| "PATINA_E2E_DATA_ROOT is required when PATINA_E2E=1".to_string())?;
        if !root.is_absolute() {
            return Err("PATINA_E2E_DATA_ROOT must be absolute".to_string());
        }
        return Ok(StoragePaths::from_roots(
            root.join("anchors"),
            root.join("anchors"),
            root.join("data"),
            root.join("webview"),
            false,
            false,
        ));
    }

    let data_anchor_dir = storage_anchor::data_anchor_dir(app)?;
    let cache_anchor_dir = storage_anchor::cache_anchor_dir(app)?;
    Ok(StoragePaths::from_roots(
        data_anchor_dir,
        cache_anchor_dir,
        app_paths::product_roaming_data_dir(app)?,
        app_paths::product_webview_data_dir(app)?,
        false,
        false,
    ))
}

pub fn resolve_storage_paths<R: Runtime>(app: &AppHandle<R>) -> Result<StoragePaths, String> {
    let default_paths = default_storage_paths(app)?;
    let data_root = match storage_anchor::read_data_anchor(app) {
        Ok(Some(anchor)) => anchor.data_root,
        Ok(None) => default_paths.data_root.clone(),
        Err(error) => {
            let _ = storage_anchor::record_maintenance_error(app, error);
            default_paths.data_root.clone()
        }
    };
    let webview_root = match storage_anchor::read_cache_anchor(app) {
        Ok(Some(anchor)) => anchor.webview_root,
        Ok(None) => default_paths.webview_root.clone(),
        Err(error) => {
            let _ = storage_anchor::record_maintenance_error(app, error);
            default_paths.webview_root.clone()
        }
    };
    let is_custom_data_root = !same_path(&data_root, &default_paths.data_root);
    let is_custom_webview_root = !same_path(&webview_root, &default_paths.webview_root);
    let resolved_paths = StoragePaths::from_roots(
        default_paths.data_anchor_dir.clone(),
        default_paths.cache_anchor_dir.clone(),
        data_root,
        webview_root.clone(),
        is_custom_data_root,
        is_custom_webview_root,
    );
    if resolved_paths.db_path.exists() {
        return Ok(resolved_paths);
    }

    if is_custom_data_root {
        let message = format!(
            "custom data directory `{}` is unavailable or missing `{}`",
            resolved_paths.data_root.display(),
            SQLITE_DB_FILE_NAME
        );
        let _ = storage_anchor::record_maintenance_error(app, message.clone());
        if default_paths.db_path.exists() {
            return Ok(StoragePaths::from_roots(
                default_paths.data_anchor_dir,
                default_paths.cache_anchor_dir,
                default_paths.data_root,
                webview_root,
                false,
                is_custom_webview_root,
            ));
        }

        return Err(message);
    }

    Ok(resolved_paths)
}

pub fn derive_custom_webview_root(data_root: &Path) -> PathBuf {
    data_root.to_path_buf()
}

pub fn derive_custom_data_root(selected_root: &Path, product_folder: &str) -> PathBuf {
    if selected_root
        .file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| product_folder_name_eq(name, product_folder))
    {
        return selected_root.to_path_buf();
    }

    selected_root.join(product_folder)
}

pub fn db_path_for_data_root(data_root: &Path) -> PathBuf {
    data_root.join(SQLITE_DB_FILE_NAME)
}

pub fn backup_dir_for_data_root(data_root: &Path) -> PathBuf {
    data_root.join(BACKUP_DIR_NAME)
}

fn product_folder_name_eq(left: &str, right: &str) -> bool {
    #[cfg(windows)]
    {
        left.eq_ignore_ascii_case(right)
    }

    #[cfg(not(windows))]
    {
        left == right
    }
}

fn same_path(left: &Path, right: &Path) -> bool {
    path_key(left) == path_key(right)
}

fn path_key(path: &Path) -> String {
    let mut key = path.to_string_lossy().replace('\\', "/");
    while key.len() > 1 && key.ends_with('/') {
        key.pop();
    }

    #[cfg(windows)]
    {
        key.to_lowercase()
    }

    #[cfg(not(windows))]
    {
        key
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn custom_webview_root_uses_product_root_as_webview_parent() {
        assert_eq!(
            derive_custom_webview_root(Path::new("D:\\Patina Data")),
            PathBuf::from("D:\\Patina Data")
        );
    }

    #[test]
    fn custom_data_root_uses_product_folder_under_selected_root() {
        assert_eq!(
            derive_custom_data_root(Path::new("D:\\Storage"), "Patina"),
            PathBuf::from("D:\\Storage\\Patina")
        );
    }

    #[test]
    fn custom_data_root_does_not_duplicate_product_folder() {
        assert_eq!(
            derive_custom_data_root(Path::new("D:\\Storage\\Patina"), "Patina"),
            PathBuf::from("D:\\Storage\\Patina")
        );
    }

    #[test]
    fn storage_paths_keep_remote_temp_under_data_root() {
        let paths = StoragePaths::from_roots(
            PathBuf::from("C:\\DataAnchor"),
            PathBuf::from("C:\\CacheAnchor"),
            PathBuf::from("D:\\Patina Data"),
            PathBuf::from("D:\\Patina Data\\webview"),
            true,
            true,
        );

        assert_eq!(paths.db_path, PathBuf::from("D:\\Patina Data\\patina.db"));
        assert_eq!(paths.backup_dir, PathBuf::from("D:\\Patina Data\\backups"));
        assert_eq!(
            paths.remote_backup_temp_dir,
            PathBuf::from("D:\\Patina Data\\remote-backup-temp")
        );
    }
}
