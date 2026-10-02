use crate::platform::{app_paths, storage_control};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Runtime};

pub const SQLITE_DB_FILE_NAME: &str = "patina.db";
const BACKUP_DIR_NAME: &str = "backups";
const REMOTE_BACKUP_TEMP_DIR_NAME: &str = "remote-backup-temp";

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StoragePaths {
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
        data_root: PathBuf,
        webview_root: PathBuf,
        is_custom_data_root: bool,
        is_custom_webview_root: bool,
    ) -> Self {
        Self {
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
            root.join("data"),
            root.join("webview"),
            false,
            false,
        ));
    }

    Ok(StoragePaths::from_roots(
        app_paths::product_roaming_data_dir(app)?,
        app_paths::product_webview_data_dir(app)?,
        false,
        false,
    ))
}

pub fn resolve_storage_paths<R: Runtime>(app: &AppHandle<R>) -> Result<StoragePaths, String> {
    resolve_roots(default_storage_paths(app)?, storage_control::read(app)?)
}

fn resolve_roots(
    defaults: StoragePaths,
    state: storage_control::StorageControl,
) -> Result<StoragePaths, String> {
    let custom_data = state.data_root.is_some();
    let custom_cache = state.webview_root.is_some();
    let paths = StoragePaths::from_roots(
        state.data_root.unwrap_or(defaults.data_root),
        state.webview_root.unwrap_or(defaults.webview_root),
        custom_data,
        custom_cache,
    );
    if custom_data {
        let metadata = std::fs::metadata(&paths.db_path).map_err(|e| {
            format!(
                "custom database `{}` is unavailable: {e}",
                paths.db_path.display()
            )
        })?;
        if !metadata.is_file() {
            return Err(format!(
                "custom database `{}` is not a file",
                paths.db_path.display()
            ));
        }
    }
    if custom_cache {
        std::fs::read_dir(&paths.webview_root).map_err(|e| {
            format!(
                "custom cache directory `{}` is unavailable: {e}",
                paths.webview_root.display()
            )
        })?;
    }
    Ok(paths)
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_custom_database_never_uses_existing_default_database() {
        let root =
            std::env::temp_dir().join(format!("patina-path-resolution-{}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join(SQLITE_DB_FILE_NAME), b"different database").unwrap();
        let defaults = StoragePaths::from_roots(root.clone(), root.clone(), false, false);
        let state = serde_json::from_value(serde_json::json!({
            "format":"patina.storage-control.v1", "profile":"dev", "dataRoot":root.join("missing"),
            "webviewRoot":null, "pending":null, "cleanupFiles":[],
            "maintenance":{"format":"patina.storage-maintenance-state.v1", "lastWebviewCacheTrimAtMs":null,"lastMaintenanceError":null}
        })).unwrap();
        assert!(resolve_roots(defaults, state)
            .unwrap_err()
            .contains("custom database"));
        assert_eq!(
            std::fs::read(root.join(SQLITE_DB_FILE_NAME)).unwrap(),
            b"different database"
        );
        std::fs::remove_file(root.join(SQLITE_DB_FILE_NAME)).unwrap();
        std::fs::remove_dir(root).unwrap();
    }

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
