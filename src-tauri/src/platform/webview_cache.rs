use crate::domain::storage::{WebviewCacheEntrySnapshot, WebviewCacheSnapshot};
use crate::platform::{storage_control, storage_paths};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Runtime};

const EBWEBVIEW_DIR_NAME: &str = "EBWebView";
const PROFILE_MIGRATION_STAGING_PREFIX: &str = ".patina-webview-state-staging";

const PERSISTENT_PROFILE_PATHS: &[&[&str]] =
    &[&["Default", "Local Storage"], &["Default", "IndexedDB"]];

const CACHE_ALLOWLIST: &[(&str, &[&str])] = &[
    ("HTTP cache", &["EBWebView", "Default", "Cache"]),
    ("JS code cache", &["EBWebView", "Default", "Code Cache"]),
    ("GPU cache", &["EBWebView", "Default", "GPUCache"]),
    ("Shader cache", &["EBWebView", "ShaderCache"]),
    ("Graphite shader cache", &["EBWebView", "GrShaderCache"]),
    (
        "Dawn Graphite cache",
        &["EBWebView", "Default", "DawnGraphiteCache"],
    ),
    (
        "Dawn WebGPU cache",
        &["EBWebView", "Default", "DawnWebGPUCache"],
    ),
];

pub fn webview_cache_snapshot<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<WebviewCacheSnapshot, String> {
    let paths = storage_paths::resolve_storage_paths(app)?;
    let state = storage_control::read_maintenance_state(app)
        .unwrap_or_else(|_| storage_control::StorageMaintenanceState::new());
    Ok(snapshot_for_root(&paths.webview_root, &state))
}

pub fn snapshot_for_root(
    webview_root: &Path,
    state: &storage_control::StorageMaintenanceState,
) -> WebviewCacheSnapshot {
    let entries = allowlisted_cache_paths(webview_root)
        .into_iter()
        .map(|(label, path)| WebviewCacheEntrySnapshot {
            label,
            size_bytes: safe_dir_size(&path),
            path: path.to_string_lossy().to_string(),
        })
        .collect::<Vec<_>>();
    let reclaimable_size_bytes = entries.iter().map(|entry| entry.size_bytes).sum::<u64>();
    let ebwebview_path = webview_root.join(EBWEBVIEW_DIR_NAME);
    let total_size_bytes = safe_dir_size(&ebwebview_path);

    WebviewCacheSnapshot {
        webview_root: webview_root.to_string_lossy().to_string(),
        ebwebview_path: ebwebview_path.to_string_lossy().to_string(),
        total_size_bytes,
        reclaimable_size_bytes,
        last_trim_at_ms: state.last_webview_cache_trim_at_ms,
        entries,
    }
}

pub fn ebwebview_path(webview_root: &Path) -> PathBuf {
    webview_root.join(EBWEBVIEW_DIR_NAME)
}

pub fn clear_regenerable_cache_dirs(webview_root: &Path) -> Result<(), String> {
    clear_allowlisted_cache_dirs(webview_root)
}

pub fn migrate_persistent_profile_state(
    source_root: &Path,
    target_root: &Path,
    migration_id: &str,
) -> Result<(), String> {
    let source_profile = ebwebview_path(source_root);
    if !source_profile.exists() {
        return Ok(());
    }

    let safe_id = migration_id
        .chars()
        .filter(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
        .collect::<String>();
    let staging_name = if safe_id.is_empty() {
        PROFILE_MIGRATION_STAGING_PREFIX.to_string()
    } else {
        format!("{PROFILE_MIGRATION_STAGING_PREFIX}-{safe_id}")
    };
    let staging_root = target_root.join(staging_name);
    remove_dir_if_exists(&staging_root)?;

    let copied_any = match stage_persistent_profile_state(&source_profile, &staging_root) {
        Ok(copied_any) => copied_any,
        Err(error) => {
            let _ = remove_dir_if_exists(&staging_root);
            return Err(error);
        }
    };

    if !copied_any {
        return Ok(());
    }

    let target_profile = ebwebview_path(target_root);
    for segments in PERSISTENT_PROFILE_PATHS {
        let staged = join_segments(&staging_root, segments);
        if !staged.exists() {
            continue;
        }
        let target = join_segments(&target_profile, segments);
        remove_dir_if_exists(&target)?;
        let parent = target.parent().ok_or_else(|| {
            format!(
                "persistent WebView path `{}` has no parent",
                target.display()
            )
        })?;
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "failed to create persistent WebView target `{}`: {error}",
                parent.display()
            )
        })?;
        fs::rename(&staged, &target).map_err(|error| {
            format!(
                "failed to promote persistent WebView state from `{}` to `{}`: {error}",
                staged.display(),
                target.display()
            )
        })?;
    }

    remove_dir_if_exists(&staging_root)
}

fn stage_persistent_profile_state(source: &Path, staging: &Path) -> Result<bool, String> {
    let mut copied_any = false;
    for segments in PERSISTENT_PROFILE_PATHS {
        let source = join_segments(source, segments);
        if !source.exists() {
            continue;
        }
        let staged = join_segments(staging, segments);
        copy_dir_without_links(&source, &staged)?;
        copied_any = true;
    }
    Ok(copied_any)
}

pub fn remove_retired_cache_root(
    webview_root: &Path,
    remove_empty_root: bool,
) -> Result<(), String> {
    let mut errors = Vec::new();
    if let Err(error) = remove_cache_dir(webview_root, &ebwebview_path(webview_root)) {
        errors.push(error);
    }
    if remove_empty_root {
        if let Err(error) = remove_empty_root_dir(webview_root) {
            errors.push(error);
        }
    }

    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors.join("; "))
    }
}

fn clear_allowlisted_cache_dirs(webview_root: &Path) -> Result<(), String> {
    let mut errors = Vec::new();
    for (_, path) in allowlisted_cache_paths(webview_root) {
        if let Err(error) = remove_cache_dir(webview_root, &path) {
            errors.push(error);
        }
    }

    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors.join("; "))
    }
}

fn allowlisted_cache_paths(webview_root: &Path) -> Vec<(String, PathBuf)> {
    CACHE_ALLOWLIST
        .iter()
        .map(|(label, segments)| {
            let mut path = webview_root.to_path_buf();
            for segment in *segments {
                path.push(segment);
            }
            ((*label).to_string(), path)
        })
        .collect()
}

fn join_segments(root: &Path, segments: &[&str]) -> PathBuf {
    segments
        .iter()
        .fold(root.to_path_buf(), |path, segment| path.join(segment))
}

fn copy_dir_without_links(source: &Path, target: &Path) -> Result<(), String> {
    if is_reparse_or_symlink(source) {
        return Err(format!(
            "refusing to migrate linked WebView path `{}`",
            source.display()
        ));
    }
    fs::create_dir_all(target).map_err(|error| {
        format!(
            "failed to create WebView migration target `{}`: {error}",
            target.display()
        )
    })?;
    for entry in fs::read_dir(source).map_err(|error| {
        format!(
            "failed to read WebView path `{}`: {error}",
            source.display()
        )
    })? {
        let entry = entry.map_err(|error| {
            format!(
                "failed to read WebView entry in `{}`: {error}",
                source.display()
            )
        })?;
        let source_path = entry.path();
        if is_reparse_or_symlink(&source_path) {
            return Err(format!(
                "refusing to migrate linked WebView entry `{}`",
                source_path.display()
            ));
        }
        let target_path = target.join(entry.file_name());
        let metadata = entry.metadata().map_err(|error| {
            format!(
                "failed to inspect WebView entry `{}`: {error}",
                source_path.display()
            )
        })?;
        if metadata.is_dir() {
            copy_dir_without_links(&source_path, &target_path)?;
        } else if metadata.is_file() {
            fs::copy(&source_path, &target_path).map_err(|error| {
                format!(
                    "failed to copy WebView state `{}` to `{}`: {error}",
                    source_path.display(),
                    target_path.display()
                )
            })?;
        }
    }
    Ok(())
}

fn remove_dir_if_exists(path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Ok(());
    }
    if is_reparse_or_symlink(path) {
        return Err(format!(
            "refusing to remove linked WebView path `{}`",
            path.display()
        ));
    }
    fs::remove_dir_all(path).map_err(|error| {
        format!(
            "failed to remove WebView path `{}`: {error}",
            path.display()
        )
    })
}

fn remove_cache_dir(webview_root: &Path, path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Ok(());
    }
    ensure_path_inside_root(webview_root, path)?;
    if is_reparse_or_symlink(path) {
        return Ok(());
    }
    fs::remove_dir_all(path)
        .map_err(|error| format!("failed to remove cache dir `{}`: {error}", path.display()))
}

fn remove_empty_root_dir(webview_root: &Path) -> Result<(), String> {
    if !webview_root.exists() {
        return Ok(());
    }
    if is_reparse_or_symlink(webview_root) {
        return Ok(());
    }
    let mut entries = fs::read_dir(webview_root).map_err(|error| {
        format!(
            "failed to inspect cache root `{}`: {error}",
            webview_root.display()
        )
    })?;
    if entries.next().is_some() {
        return Ok(());
    }
    fs::remove_dir(webview_root).map_err(|error| {
        format!(
            "failed to remove empty cache root `{}`: {error}",
            webview_root.display()
        )
    })
}

fn ensure_path_inside_root(root: &Path, path: &Path) -> Result<(), String> {
    let root = root.canonicalize().map_err(|error| {
        format!(
            "failed to inspect webview root `{}`: {error}",
            root.display()
        )
    })?;
    let path = path
        .canonicalize()
        .map_err(|error| format!("failed to inspect cache path `{}`: {error}", path.display()))?;

    if path.starts_with(&root) {
        Ok(())
    } else {
        Err(format!(
            "refusing to remove cache path `{}` outside `{}`",
            path.display(),
            root.display()
        ))
    }
}

fn safe_dir_size(path: &Path) -> u64 {
    dir_size(path).unwrap_or(0)
}

fn dir_size(path: &Path) -> Result<u64, String> {
    if !path.exists() || is_reparse_or_symlink(path) {
        return Ok(0);
    }

    let metadata = fs::metadata(path)
        .map_err(|error| format!("failed to inspect `{}`: {error}", path.display()))?;
    if metadata.is_file() {
        return Ok(metadata.len());
    }

    let mut total = 0;
    let entries = fs::read_dir(path)
        .map_err(|error| format!("failed to read `{}`: {error}", path.display()))?;
    for entry in entries {
        let entry =
            entry.map_err(|error| format!("failed to read `{}`: {error}", path.display()))?;
        let entry_path = entry.path();
        if is_reparse_or_symlink(&entry_path) {
            continue;
        }
        let metadata = entry
            .metadata()
            .map_err(|error| format!("failed to inspect `{}`: {error}", entry_path.display()))?;
        if metadata.is_dir() {
            total += dir_size(&entry_path)?;
        } else {
            total += metadata.len();
        }
    }
    Ok(total)
}

fn is_reparse_or_symlink(path: &Path) -> bool {
    let Ok(metadata) = fs::symlink_metadata(path) else {
        return false;
    };
    if metadata.file_type().is_symlink() {
        return true;
    }

    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x0400;
        metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
    }

    #[cfg(not(windows))]
    {
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn temp_dir(label: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "patina-webview-cache-{label}-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&path);
        fs::create_dir_all(&path).unwrap();
        path
    }

    fn write_file(path: &Path, bytes: usize) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        let mut file = fs::File::create(path).unwrap();
        file.write_all(&vec![1; bytes]).unwrap();
    }

    #[test]
    fn snapshot_only_counts_allowlisted_cache_as_reclaimable() {
        let root = temp_dir("snapshot");
        write_file(
            &root
                .join("EBWebView")
                .join("Default")
                .join("Cache")
                .join("a"),
            10,
        );
        write_file(
            &root
                .join("EBWebView")
                .join("Default")
                .join("Local Storage")
                .join("keep"),
            20,
        );

        let snapshot = snapshot_for_root(&root, &storage_control::StorageMaintenanceState::new());
        let _ = fs::remove_dir_all(&root);

        assert_eq!(snapshot.reclaimable_size_bytes, 10);
        assert_eq!(snapshot.total_size_bytes, 30);
    }

    #[test]
    fn clear_allowlist_preserves_local_storage() {
        let root = temp_dir("clear");
        let cache_file = root
            .join("EBWebView")
            .join("Default")
            .join("Code Cache")
            .join("js")
            .join("compiled");
        let local_storage_file = root
            .join("EBWebView")
            .join("Default")
            .join("Local Storage")
            .join("keep");
        write_file(&cache_file, 10);
        write_file(&local_storage_file, 20);

        clear_regenerable_cache_dirs(&root).unwrap();

        assert!(!cache_file.exists());
        assert!(local_storage_file.exists());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn profile_migration_preserves_local_state_without_copying_cache() {
        let source = temp_dir("profile-migration-source");
        let target = temp_dir("profile-migration-target");
        let source_local_storage = source
            .join("EBWebView")
            .join("Default")
            .join("Local Storage")
            .join("leveldb")
            .join("state");
        let source_indexed_db = source
            .join("EBWebView")
            .join("Default")
            .join("IndexedDB")
            .join("state");
        let source_cache = source
            .join("EBWebView")
            .join("Default")
            .join("Cache")
            .join("entry");
        let stale_target_state = target
            .join("EBWebView")
            .join("Default")
            .join("Local Storage")
            .join("stale");
        write_file(&source_local_storage, 10);
        write_file(&source_indexed_db, 20);
        write_file(&source_cache, 30);
        write_file(&stale_target_state, 5);

        migrate_persistent_profile_state(&source, &target, "test-1").unwrap();

        assert!(target
            .join("EBWebView")
            .join("Default")
            .join("Local Storage")
            .join("leveldb")
            .join("state")
            .exists());
        assert!(target
            .join("EBWebView")
            .join("Default")
            .join("IndexedDB")
            .join("state")
            .exists());
        assert!(!stale_target_state.exists());
        assert!(!target
            .join("EBWebView")
            .join("Default")
            .join("Cache")
            .exists());
        assert!(source_cache.exists());

        let _ = fs::remove_dir_all(source);
        let _ = fs::remove_dir_all(target);
    }

    #[test]
    fn clear_allowlist_continues_when_one_cache_path_fails() {
        let root = temp_dir("partial-clear");
        let cache_file = root.join("EBWebView").join("Default").join("Cache");
        let code_cache_file = root
            .join("EBWebView")
            .join("Default")
            .join("Code Cache")
            .join("js")
            .join("compiled");
        write_file(&cache_file, 10);
        write_file(&code_cache_file, 20);

        let error = clear_allowlisted_cache_dirs(&root).unwrap_err();

        assert!(error.contains("failed to remove cache dir"));
        assert!(cache_file.exists());
        assert!(!code_cache_file.exists());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn remove_retired_cache_root_removes_ebwebview_and_empty_root() {
        let root = temp_dir("retired-empty");
        let local_storage_file = root
            .join("EBWebView")
            .join("Default")
            .join("Local Storage")
            .join("keep");
        write_file(&local_storage_file, 20);

        remove_retired_cache_root(&root, true).unwrap();

        assert!(!root.exists());
    }

    #[test]
    fn remove_retired_cache_root_keeps_nonempty_root() {
        let root = temp_dir("retired-nonempty");
        let cache_file = root
            .join("EBWebView")
            .join("Default")
            .join("Cache")
            .join("entry");
        let user_file = root.join("notes.txt");
        write_file(&cache_file, 10);
        write_file(&user_file, 5);

        remove_retired_cache_root(&root, true).unwrap();

        assert!(!root.join("EBWebView").exists());
        assert!(user_file.exists());
        let _ = fs::remove_dir_all(&root);
    }
}
