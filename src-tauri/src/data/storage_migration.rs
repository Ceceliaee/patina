use crate::data::storage_migration_cleanup::{
    remove_migration_path_if_safe, remove_path_if_exists,
};
use crate::data::storage_path_safety::{
    ensure_destructive_paths_are_disjoint, probe_directory_writable,
    resolved_path_is_same_or_child, resolved_paths_equal, same_path,
};
use crate::data::{backup, sqlite_pool, storage_restart};
use crate::domain::storage::{
    StorageMigrationPreview, StorageMigrationRequest, WebviewCacheMigrationRequest,
};
use crate::platform::{app_paths, storage_anchor, storage_paths, webview_cache};
use sqlx::{Pool, Sqlite};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Runtime};

const MIGRATION_STATE_PENDING_RESTART: &str = "pending-restart";
const PRE_MIGRATION_BACKUP_PREFIX: &str = "pre-storage-migration";
pub async fn preview_storage_migration<R: Runtime>(
    app: &AppHandle<R>,
    request: StorageMigrationRequest,
) -> Result<StorageMigrationPreview, String> {
    let current = storage_paths::resolve_storage_paths(app)?;
    let target_data_root = resolve_custom_target_data_root(app, &request.target_data_root)?;
    validate_target_data_root(
        &current,
        &target_data_root,
        TargetDataRootMode::Custom,
        TargetValidationAccess::InspectOnly,
    )?;
    let target_webview_root = current.webview_root.clone();
    storage_migration_preview(app, &current, target_data_root, target_webview_root)
}

pub async fn preview_webview_cache_migration<R: Runtime>(
    app: &AppHandle<R>,
    request: WebviewCacheMigrationRequest,
) -> Result<StorageMigrationPreview, String> {
    let current = storage_paths::resolve_storage_paths(app)?;
    let target_data_root = current.data_root.clone();
    let target_webview_root =
        resolve_custom_target_webview_root(app, &request.target_webview_root)?;
    validate_target_webview_root(
        &current,
        &target_webview_root,
        TargetWebviewRootMode::Custom,
        TargetValidationAccess::InspectOnly,
    )?;
    storage_migration_preview(app, &current, target_data_root, target_webview_root)
}

pub async fn preview_restore_default_storage_migration<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<StorageMigrationPreview, String> {
    let current = storage_paths::resolve_storage_paths(app)?;
    if !current.is_custom_data_root {
        return Err("data directory already uses the default location".to_string());
    }

    let default_paths = storage_paths::default_storage_paths(app)?;
    validate_target_data_root(
        &current,
        &default_paths.data_root,
        TargetDataRootMode::RestoreDefault,
        TargetValidationAccess::InspectOnly,
    )?;
    storage_migration_preview(
        app,
        &current,
        default_paths.data_root,
        current.webview_root.clone(),
    )
}

pub async fn preview_restore_default_webview_cache_migration<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<StorageMigrationPreview, String> {
    let current = storage_paths::resolve_storage_paths(app)?;
    if !current.is_custom_webview_root {
        return Err("cache directory already uses the default location".to_string());
    }

    let default_paths = storage_paths::default_storage_paths(app)?;
    validate_target_webview_root(
        &current,
        &default_paths.webview_root,
        TargetWebviewRootMode::RestoreDefault,
        TargetValidationAccess::InspectOnly,
    )?;
    storage_migration_preview(
        app,
        &current,
        current.data_root.clone(),
        default_paths.webview_root,
    )
}

pub async fn schedule_storage_migration(
    app: AppHandle,
    request: StorageMigrationRequest,
) -> Result<StorageMigrationPreview, String> {
    let preview = preview_storage_migration(&app, request.clone()).await?;
    let current = storage_paths::resolve_storage_paths(&app)?;
    let target_data_root = resolve_custom_target_data_root(&app, &request.target_data_root)?;
    let target_webview_root = current.webview_root.clone();
    validate_target_data_root(
        &current,
        &target_data_root,
        TargetDataRootMode::Custom,
        TargetValidationAccess::ProbeWithoutCreate,
    )?;
    schedule_pending_storage_migration(app, current, target_data_root, target_webview_root).await?;

    Ok(preview)
}

pub async fn schedule_webview_cache_migration(
    app: AppHandle,
    request: WebviewCacheMigrationRequest,
) -> Result<StorageMigrationPreview, String> {
    let preview = preview_webview_cache_migration(&app, request.clone()).await?;
    let current = storage_paths::resolve_storage_paths(&app)?;
    let target_data_root = current.data_root.clone();
    let target_webview_root =
        resolve_custom_target_webview_root(&app, &request.target_webview_root)?;
    validate_target_webview_root(
        &current,
        &target_webview_root,
        TargetWebviewRootMode::Custom,
        TargetValidationAccess::ProbeWithoutCreate,
    )?;
    schedule_pending_storage_migration(app, current, target_data_root, target_webview_root).await?;

    Ok(preview)
}

pub async fn schedule_restore_default_storage_migration(
    app: AppHandle,
) -> Result<StorageMigrationPreview, String> {
    let preview = preview_restore_default_storage_migration(&app).await?;
    let current = storage_paths::resolve_storage_paths(&app)?;
    let default_paths = storage_paths::default_storage_paths(&app)?;
    let target_webview_root = current.webview_root.clone();
    validate_target_data_root(
        &current,
        &default_paths.data_root,
        TargetDataRootMode::RestoreDefault,
        TargetValidationAccess::ProbeWithoutCreate,
    )?;
    schedule_pending_storage_migration(app, current, default_paths.data_root, target_webview_root)
        .await?;

    Ok(preview)
}

pub async fn schedule_restore_default_webview_cache_migration(
    app: AppHandle,
) -> Result<StorageMigrationPreview, String> {
    let preview = preview_restore_default_webview_cache_migration(&app).await?;
    let current = storage_paths::resolve_storage_paths(&app)?;
    let default_paths = storage_paths::default_storage_paths(&app)?;
    validate_target_webview_root(
        &current,
        &default_paths.webview_root,
        TargetWebviewRootMode::RestoreDefault,
        TargetValidationAccess::ProbeWithoutCreate,
    )?;
    schedule_pending_storage_migration(
        app,
        current.clone(),
        current.data_root,
        default_paths.webview_root,
    )
    .await?;

    Ok(preview)
}

pub async fn run_pending_storage_migration<R: Runtime>(app: &AppHandle<R>) -> Result<bool, String> {
    let pending = match storage_anchor::read_pending_migration(app) {
        Ok(pending) => pending,
        Err(error) => {
            storage_anchor::discard_unreadable_pending_migration(app, &error)?;
            return Ok(true);
        }
    };
    let Some(pending) = pending else {
        return Ok(false);
    };
    match execute_pending_storage_migration(app, &pending).await {
        Ok(()) => {
            storage_anchor::remove_pending_migration(app)?;
            Ok(true)
        }
        Err(error) => {
            let _ = storage_anchor::remove_pending_migration(app);
            let _ = storage_anchor::record_maintenance_error(
                app,
                format!("storage migration `{}` failed: {error}", pending.id),
            );
            eprintln!("storage migration `{}` failed: {error}", pending.id);
            Ok(true)
        }
    }
}
async fn execute_pending_storage_migration<R: Runtime>(
    app: &AppHandle<R>,
    pending: &storage_anchor::PendingStorageMigration,
) -> Result<(), String> {
    if pending.state != MIGRATION_STATE_PENDING_RESTART {
        return Err(format!(
            "unsupported storage migration state `{}`",
            pending.state
        ));
    }

    let source_paths = storage_paths::resolve_storage_paths(app)?;
    let source_webview_root = source_paths.webview_root.clone();
    let data_root_changes = !same_path(&pending.source_data_root, &pending.target_data_root);
    let webview_root_changes = !same_path(&source_webview_root, &pending.target_webview_root);
    let default_paths = storage_paths::default_storage_paths(app)?;
    let (target_mode, target_webview_mode) = resolve_target_modes(pending, &default_paths);
    if data_root_changes {
        ensure_destructive_paths_are_disjoint(
            &pending.source_data_root,
            &pending.target_data_root,
        )?;
        if !pending
            .source_data_root
            .join(storage_paths::SQLITE_DB_FILE_NAME)
            .exists()
        {
            return Err(format!(
                "source database `{}` is missing",
                pending
                    .source_data_root
                    .join(storage_paths::SQLITE_DB_FILE_NAME)
                    .display()
            ));
        }

        validate_target_data_root(
            &target_data_validation_paths(
                storage_anchor::anchor_dir(app)?,
                &pending.source_data_root,
                &source_webview_root,
            ),
            &pending.target_data_root,
            target_mode,
            TargetValidationAccess::CreateAndProbe,
        )?;

        let staging_root = pending
            .target_data_root
            .join(format!(".patina-migration-staging-{}", pending.id));
        if staging_root.exists() {
            remove_migration_path_if_safe(&staging_root).map_err(|error| {
                format!(
                    "failed to clear migration staging `{}`: {error}",
                    staging_root.display()
                )
            })?;
        }
        fs::create_dir_all(&staging_root).map_err(|error| {
            format!(
                "failed to create staging dir `{}`: {error}",
                staging_root.display()
            )
        })?;

        let result = copy_and_validate_data_root(&pending.source_data_root, &staging_root).await;
        if let Err(error) = result {
            let _ = remove_migration_path_if_safe(&staging_root);
            return Err(error);
        }

        promote_staging_root(&staging_root, &pending.target_data_root)?;
        if let Err(error) =
            clean_pre_migration_backup(&pending.target_data_root, pending.id.as_str())
        {
            let _ = storage_anchor::record_maintenance_error(
                app,
                format!(
                    "storage migration `{}` could not fully clean generated backup in `{}`: {error}",
                    pending.id,
                    pending.target_data_root.display()
                ),
            );
        }
    }

    if webview_root_changes {
        validate_target_webview_root_for_execution(
            &source_paths,
            &pending.target_webview_root,
            target_webview_mode,
        )?;
        webview_cache::migrate_persistent_profile_state(
            &source_webview_root,
            &pending.target_webview_root,
            &pending.id,
        )?;
    }

    if pending.clear_webview_cache {
        webview_cache::clear_regenerable_cache_dirs(&pending.target_webview_root)?;
        storage_anchor::mark_webview_cache_trimmed(app)?;
    }

    storage_restart::switch_anchors(
        app,
        pending,
        &source_paths,
        !same_path(&pending.target_data_root, &default_paths.data_root),
        !same_path(&pending.target_webview_root, &default_paths.webview_root),
    )?;

    if data_root_changes {
        ensure_destructive_paths_are_disjoint(
            &pending.source_data_root,
            &pending.target_data_root,
        )?;
        let remove_old_data_root = should_remove_old_data_root_container(
            &pending.source_data_root,
            &pending.target_webview_root,
            &default_paths.data_root,
        )?;
        if let Err(error) = clean_old_data_payload(&pending.source_data_root, remove_old_data_root)
        {
            let _ = storage_anchor::record_maintenance_error(
                app,
                format!(
                    "storage migration `{}` could not fully clean old data root `{}`: {error}",
                    pending.id,
                    pending.source_data_root.display()
                ),
            );
        }
    }

    if webview_root_changes {
        ensure_destructive_paths_are_disjoint(&source_webview_root, &pending.target_webview_root)?;
        if let Err(error) = webview_cache::remove_retired_cache_root(
            &source_webview_root,
            source_paths.is_custom_webview_root,
        ) {
            let _ = storage_anchor::record_maintenance_error(
                app,
                format!(
                    "storage migration `{}` could not fully clean old WebView cache root `{}`: {error}",
                    pending.id,
                    source_webview_root.display()
                ),
            );
        }
    }

    Ok(())
}

async fn copy_and_validate_data_root(source: &Path, staging: &Path) -> Result<(), String> {
    copy_sqlite_files(source, staging)?;
    copy_dir_if_exists(&source.join("backups"), &staging.join("backups"))?;

    let target_db = staging.join(storage_paths::SQLITE_DB_FILE_NAME);
    let pool = sqlite_pool::open_single_connection_sqlite_pool(&target_db, false).await?;
    sqlite_pool::prepare_pool_schema(&pool, &target_db).await?;
    validate_counts(source, &pool).await?;
    pool.close().await;

    Ok(())
}

fn promote_staging_root(staging: &Path, target: &Path) -> Result<(), String> {
    fs::create_dir_all(target).map_err(|error| {
        format!(
            "failed to create target dir `{}`: {error}",
            target.display()
        )
    })?;

    for entry in fs::read_dir(staging)
        .map_err(|error| format!("failed to read staging `{}`: {error}", staging.display()))?
    {
        let entry = entry.map_err(|error| {
            format!(
                "failed to read staging entry `{}`: {error}",
                staging.display()
            )
        })?;
        let target_path = target.join(entry.file_name());
        if target_path.exists() {
            remove_migration_path_if_safe(&target_path).map_err(|error| {
                format!("failed to replace `{}`: {error}", target_path.display())
            })?;
        }
        fs::rename(entry.path(), &target_path).map_err(|error| {
            format!(
                "failed to move `{}` to `{}`: {error}",
                entry.path().display(),
                target_path.display()
            )
        })?;
    }

    remove_migration_path_if_safe(staging)
        .map_err(|error| format!("failed to remove staging `{}`: {error}", staging.display()))
}

fn clean_old_data_payload(data_root: &Path, remove_container: bool) -> Result<(), String> {
    let mut errors = Vec::new();
    for suffix in ["", "-wal", "-shm"] {
        let file_name = format!("{}{}", storage_paths::SQLITE_DB_FILE_NAME, suffix);
        if let Err(error) = remove_path_if_exists(&data_root.join(file_name)) {
            errors.push(error);
        }
    }
    for dir_name in ["backups", "remote-backup-temp"] {
        if let Err(error) = remove_path_if_exists(&data_root.join(dir_name)) {
            errors.push(error);
        }
    }
    if remove_container {
        if let Err(error) = remove_path_if_exists(data_root) {
            errors.push(error);
        }
    } else {
        let _ = fs::remove_dir(data_root);
    }

    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors.join("; "))
    }
}

fn should_remove_old_data_root_container(
    source_data_root: &Path,
    target_webview_root: &Path,
    default_data_root: &Path,
) -> Result<bool, String> {
    Ok(!resolved_paths_equal(source_data_root, default_data_root)?
        && !resolved_path_is_same_or_child(target_webview_root, source_data_root)?)
}

fn clean_pre_migration_backup(data_root: &Path, migration_id: &str) -> Result<(), String> {
    let backup_dir = storage_paths::backup_dir_for_data_root(data_root);
    let backup_path = backup_dir.join(pre_migration_backup_file_name(migration_id));
    remove_path_if_exists(&backup_path)?;
    let _ = fs::remove_dir(&backup_dir);
    Ok(())
}

fn copy_sqlite_files(source: &Path, target: &Path) -> Result<(), String> {
    for suffix in ["", "-wal", "-shm"] {
        let file_name = format!("{}{}", storage_paths::SQLITE_DB_FILE_NAME, suffix);
        let source_path = source.join(&file_name);
        if source_path.exists() {
            fs::copy(&source_path, target.join(&file_name)).map_err(|error| {
                format!(
                    "failed to copy `{}` to staging: {error}",
                    source_path.display()
                )
            })?;
        }
    }
    Ok(())
}

fn copy_dir_if_exists(source: &Path, target: &Path) -> Result<(), String> {
    if !source.exists() {
        return Ok(());
    }
    copy_dir_recursive(source, target)
}

fn copy_dir_recursive(source: &Path, target: &Path) -> Result<(), String> {
    fs::create_dir_all(target)
        .map_err(|error| format!("failed to create `{}`: {error}", target.display()))?;
    for entry in fs::read_dir(source)
        .map_err(|error| format!("failed to read `{}`: {error}", source.display()))?
    {
        let entry =
            entry.map_err(|error| format!("failed to read `{}`: {error}", source.display()))?;
        let source_path = entry.path();
        let target_path = target.join(entry.file_name());
        let metadata = entry
            .metadata()
            .map_err(|error| format!("failed to inspect `{}`: {error}", source_path.display()))?;
        if metadata.is_dir() {
            copy_dir_recursive(&source_path, &target_path)?;
        } else if metadata.is_file() {
            fs::copy(&source_path, &target_path).map_err(|error| {
                format!(
                    "failed to copy `{}` to `{}`: {error}",
                    source_path.display(),
                    target_path.display()
                )
            })?;
        }
    }
    Ok(())
}

pub(super) async fn checkpoint_current_database<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<(), String> {
    let pool = sqlite_pool::wait_for_sqlite_pool(app).await?;
    sqlx::query("PRAGMA wal_checkpoint(TRUNCATE)")
        .execute(&pool)
        .await
        .map_err(|error| format!("failed to checkpoint sqlite before migration: {error}"))?;
    Ok(())
}

async fn validate_counts(source: &Path, target_pool: &Pool<Sqlite>) -> Result<(), String> {
    let source_db = source.join(storage_paths::SQLITE_DB_FILE_NAME);
    let source_pool = sqlite_pool::open_single_connection_sqlite_pool(&source_db, false).await?;
    for table in [
        "sessions",
        "session_title_samples",
        "settings",
        "icon_cache",
        "tool_reminders",
        "tool_timers",
        "tool_timer_laps",
        "tool_pomodoro_runs",
        "tool_daily_stats",
        "tool_activity_reminder_rules",
        "web_activity_segments",
        "web_favicon_cache",
    ] {
        let source_count = table_count_if_exists(&source_pool, table).await?;
        let target_count = table_count_if_exists(target_pool, table).await?;
        if source_count != target_count {
            source_pool.close().await;
            return Err(format!(
                "migration count mismatch for `{table}`: source {source_count}, target {target_count}"
            ));
        }
    }
    source_pool.close().await;
    Ok(())
}

async fn table_count_if_exists(pool: &Pool<Sqlite>, table: &str) -> Result<i64, String> {
    let exists: Option<i64> =
        sqlx::query_scalar("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1")
            .bind(table)
            .fetch_optional(pool)
            .await
            .map_err(|error| format!("failed to inspect table `{table}`: {error}"))?;
    if exists.is_none() {
        return Ok(0);
    }

    let query = format!("SELECT COUNT(*) FROM {table}");
    sqlx::query_scalar::<_, i64>(&query)
        .fetch_one(pool)
        .await
        .map_err(|error| format!("failed to count `{table}`: {error}"))
}

fn resolve_custom_target_data_root<R: Runtime>(
    app: &AppHandle<R>,
    raw: &str,
) -> Result<PathBuf, String> {
    let selected_root = normalize_selected_storage_root(raw)?;
    Ok(storage_paths::derive_custom_data_root(
        &selected_root,
        app_paths::app_profile(app).product_folder(),
    ))
}

fn resolve_custom_target_webview_root<R: Runtime>(
    app: &AppHandle<R>,
    raw: &str,
) -> Result<PathBuf, String> {
    let selected_root = normalize_selected_storage_root(raw)?;
    let data_root = storage_paths::derive_custom_data_root(
        &selected_root,
        app_paths::app_profile(app).product_folder(),
    );
    Ok(storage_paths::derive_custom_webview_root(&data_root))
}

fn normalize_selected_storage_root(raw: &str) -> Result<PathBuf, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("selected storage directory is empty".to_string());
    }
    let path = PathBuf::from(trimmed);
    if !path.is_absolute() {
        return Err("selected storage directory must be an absolute path".to_string());
    }
    Ok(path)
}

#[derive(Clone, Copy)]
enum TargetDataRootMode {
    Custom,
    RestoreDefault,
}

#[derive(Clone, Copy)]
enum TargetWebviewRootMode {
    Custom,
    RestoreDefault,
}

#[derive(Clone, Copy)]
enum TargetValidationAccess {
    InspectOnly,
    ProbeWithoutCreate,
    CreateAndProbe,
}

fn resolve_target_modes(
    pending: &storage_anchor::PendingStorageMigration,
    default_paths: &storage_paths::StoragePaths,
) -> (TargetDataRootMode, TargetWebviewRootMode) {
    let data = if same_path(&pending.target_data_root, &default_paths.data_root) {
        TargetDataRootMode::RestoreDefault
    } else {
        TargetDataRootMode::Custom
    };
    let webview = if same_path(&pending.target_webview_root, &default_paths.webview_root) {
        TargetWebviewRootMode::RestoreDefault
    } else {
        TargetWebviewRootMode::Custom
    };
    (data, webview)
}

fn validate_target_data_root(
    current: &storage_paths::StoragePaths,
    target: &Path,
    mode: TargetDataRootMode,
    access: TargetValidationAccess,
) -> Result<(), String> {
    if resolved_paths_equal(target, &current.data_root)? {
        return Err("target data directory is already active".to_string());
    }
    if resolved_path_is_same_or_child(target, &current.data_root)?
        || resolved_path_is_same_or_child(&current.data_root, target)?
    {
        return Err(
            "target data directory cannot be inside or above the current data directory"
                .to_string(),
        );
    }
    if resolved_path_is_same_or_child(
        target,
        &webview_cache::ebwebview_path(&current.webview_root),
    )? {
        return Err(
            "target data directory cannot be inside the current WebView cache directory"
                .to_string(),
        );
    }

    if target.exists() {
        if !target.is_dir() {
            return Err("target data directory is not a directory".to_string());
        }
        if matches!(mode, TargetDataRootMode::Custom)
            && storage_paths::db_path_for_data_root(target).exists()
        {
            return Err("target data directory already contains patina.db".to_string());
        }
    }

    match access {
        TargetValidationAccess::InspectOnly => return Ok(()),
        TargetValidationAccess::ProbeWithoutCreate => {
            probe_existing_parent(target, "target data directory")?;
            return Ok(());
        }
        TargetValidationAccess::CreateAndProbe => {}
    }

    fs::create_dir_all(target)
        .map_err(|error| format!("failed to create target data directory: {error}"))?;
    probe_directory_writable(target, "target data directory")
}

fn target_data_validation_paths(
    anchor_dir: PathBuf,
    source_data_root: &Path,
    source_webview_root: &Path,
) -> storage_paths::StoragePaths {
    storage_paths::StoragePaths {
        data_anchor_dir: anchor_dir.clone(),
        cache_anchor_dir: anchor_dir,
        data_root: source_data_root.to_path_buf(),
        db_path: source_data_root.join(storage_paths::SQLITE_DB_FILE_NAME),
        backup_dir: storage_paths::backup_dir_for_data_root(source_data_root),
        remote_backup_temp_dir: source_data_root.join("remote-backup-temp"),
        webview_root: source_webview_root.to_path_buf(),
        is_custom_data_root: true,
        is_custom_webview_root: true,
    }
}

fn validate_target_webview_root(
    current: &storage_paths::StoragePaths,
    target: &Path,
    mode: TargetWebviewRootMode,
    access: TargetValidationAccess,
) -> Result<(), String> {
    if resolved_paths_equal(target, &current.webview_root)? {
        return Err("target cache directory is already active".to_string());
    }
    if resolved_path_is_same_or_child(target, &current.webview_root)?
        || resolved_path_is_same_or_child(&current.webview_root, target)?
    {
        return Err(
            "target cache directory cannot be inside or above the current cache directory"
                .to_string(),
        );
    }
    if target.exists() {
        if !target.is_dir() {
            return Err("target cache directory is not a directory".to_string());
        }
        if matches!(mode, TargetWebviewRootMode::Custom)
            && webview_cache::ebwebview_path(target).exists()
        {
            return Err("target cache directory already contains EBWebView".to_string());
        }
    }

    match access {
        TargetValidationAccess::InspectOnly => return Ok(()),
        TargetValidationAccess::ProbeWithoutCreate => {
            probe_existing_parent(target, "target cache directory")?;
            return Ok(());
        }
        TargetValidationAccess::CreateAndProbe => {}
    }

    fs::create_dir_all(target)
        .map_err(|error| format!("failed to create target cache directory: {error}"))?;
    probe_directory_writable(target, "target cache directory")
}

fn validate_target_webview_root_for_execution(
    current: &storage_paths::StoragePaths,
    target: &Path,
    mode: TargetWebviewRootMode,
) -> Result<(), String> {
    ensure_destructive_paths_are_disjoint(&current.webview_root, target)?;
    validate_target_webview_root(
        current,
        target,
        mode,
        TargetValidationAccess::CreateAndProbe,
    )
}

fn probe_existing_parent(target: &Path, label: &str) -> Result<(), String> {
    let probe_dir = existing_parent_dir(target)
        .ok_or_else(|| format!("{label} has no writable parent directory"))?;
    probe_directory_writable(&probe_dir, &format!("{label} parent"))
}

fn existing_parent_dir(target: &Path) -> Option<PathBuf> {
    let mut cursor = if target.exists() {
        Some(target)
    } else {
        target.parent()
    };
    while let Some(path) = cursor {
        if path.exists() {
            return path.is_dir().then(|| path.to_path_buf());
        }
        cursor = path.parent();
    }
    None
}

async fn schedule_pending_storage_migration(
    app: AppHandle,
    current: storage_paths::StoragePaths,
    target_data_root: PathBuf,
    target_webview_root: PathBuf,
) -> Result<(), String> {
    let existing_pending = storage_anchor::read_pending_migration(&app)?;
    let plan = plan_pending_storage_migration(
        &current,
        existing_pending.as_ref(),
        target_data_root,
        target_webview_root,
        timestamp_for_file(),
    )?;

    if plan.requested_data_root_changes {
        let pre_migration_backup_path = current
            .backup_dir
            .join(pre_migration_backup_file_name(plan.migration_id.as_str()))
            .to_string_lossy()
            .to_string();
        backup::export_backup(Some(pre_migration_backup_path), app.clone()).await?;
    }

    checkpoint_current_database(&app).await?;
    let pending = storage_anchor::PendingStorageMigration {
        format: storage_anchor::STORAGE_MIGRATION_PENDING_FORMAT.to_string(),
        id: plan.migration_id,
        source_data_root: current.data_root,
        target_data_root: plan.target_data_root,
        target_webview_root: plan.target_webview_root,
        created_at_ms: storage_anchor::now_ms(),
        state: MIGRATION_STATE_PENDING_RESTART.to_string(),
        clear_webview_cache: false,
    };
    storage_anchor::write_pending_migration(&app, &pending)?;

    let persisted = storage_anchor::read_pending_migration(&app)?
        .ok_or_else(|| "storage restart operation was not persisted".to_string())?;
    if persisted.id != pending.id
        || persisted.target_data_root != pending.target_data_root
        || persisted.target_webview_root != pending.target_webview_root
    {
        let _ = storage_anchor::remove_pending_migration(&app);
        return Err("storage restart operation verification failed".to_string());
    }

    Ok(())
}

struct PendingStorageMigrationPlan {
    migration_id: String,
    target_data_root: PathBuf,
    target_webview_root: PathBuf,
    requested_data_root_changes: bool,
}

fn plan_pending_storage_migration(
    current: &storage_paths::StoragePaths,
    existing_pending: Option<&storage_anchor::PendingStorageMigration>,
    requested_target_data_root: PathBuf,
    requested_target_webview_root: PathBuf,
    new_migration_id: String,
) -> Result<PendingStorageMigrationPlan, String> {
    if let Some(existing) = existing_pending {
        if existing.state != MIGRATION_STATE_PENDING_RESTART {
            return Err(format!(
                "unsupported pending storage migration state `{}`",
                existing.state
            ));
        }
        if !same_path(&existing.source_data_root, &current.data_root) {
            return Err(
                "pending storage migration source no longer matches current data directory"
                    .to_string(),
            );
        }
    }

    let requested_data_root_changes = !same_path(&current.data_root, &requested_target_data_root);
    let requested_webview_root_changes =
        !same_path(&current.webview_root, &requested_target_webview_root);

    let target_data_root = if requested_data_root_changes {
        requested_target_data_root
    } else if let Some(existing) = existing_pending {
        existing.target_data_root.clone()
    } else {
        requested_target_data_root
    };
    let target_webview_root = if requested_webview_root_changes {
        requested_target_webview_root
    } else if let Some(existing) = existing_pending {
        existing.target_webview_root.clone()
    } else {
        requested_target_webview_root
    };

    let final_data_root_changes = !same_path(&current.data_root, &target_data_root);
    let final_webview_root_changes = !same_path(&current.webview_root, &target_webview_root);
    if !final_data_root_changes && !final_webview_root_changes {
        return Err("storage directories are already active".to_string());
    }

    Ok(PendingStorageMigrationPlan {
        migration_id: existing_pending
            .map(|existing| existing.id.clone())
            .unwrap_or(new_migration_id),
        target_data_root,
        target_webview_root,
        requested_data_root_changes,
    })
}

fn storage_migration_preview<R: Runtime>(
    app: &AppHandle<R>,
    current: &storage_paths::StoragePaths,
    target_data_root: PathBuf,
    target_webview_root: PathBuf,
) -> Result<StorageMigrationPreview, String> {
    let cache = webview_cache::webview_cache_snapshot(app)?;
    Ok(StorageMigrationPreview {
        current_data_root: current.data_root.to_string_lossy().to_string(),
        target_data_root: target_data_root.to_string_lossy().to_string(),
        current_webview_root: current.webview_root.to_string_lossy().to_string(),
        target_webview_root: target_webview_root.to_string_lossy().to_string(),
        database_size_bytes: file_size(&current.db_path),
        backup_dir_size_bytes: dir_size(&current.backup_dir),
        webview_cache_reclaimable_bytes: cache.reclaimable_size_bytes,
        requires_restart: true,
    })
}

fn file_size(path: &Path) -> u64 {
    fs::metadata(path)
        .map(|metadata| metadata.len())
        .unwrap_or(0)
}

fn dir_size(path: &Path) -> u64 {
    if !path.exists() {
        return 0;
    }
    let mut total = 0;
    let Ok(entries) = fs::read_dir(path) else {
        return 0;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(metadata) = entry.metadata() else {
            continue;
        };
        if metadata.is_dir() {
            total += dir_size(&path);
        } else {
            total += metadata.len();
        }
    }
    total
}

pub(super) fn timestamp_for_file() -> String {
    chrono::Local::now().format("%Y%m%d-%H%M%S").to_string()
}

fn pre_migration_backup_file_name(migration_id: &str) -> String {
    format!("Patina-{PRE_MIGRATION_BACKUP_PREFIX}-{migration_id}.zip")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_storage_paths(
        data_root: PathBuf,
        webview_root: PathBuf,
    ) -> storage_paths::StoragePaths {
        storage_paths::StoragePaths {
            data_anchor_dir: data_root.join(".data-anchor"),
            cache_anchor_dir: webview_root.join(".cache-anchor"),
            db_path: data_root.join(storage_paths::SQLITE_DB_FILE_NAME),
            backup_dir: data_root.join("backups"),
            remote_backup_temp_dir: data_root.join("remote-backup-temp"),
            data_root,
            webview_root,
            is_custom_data_root: true,
            is_custom_webview_root: true,
        }
    }

    #[test]
    fn target_path_with_parent_segments_cannot_alias_the_active_data_root() {
        let root = std::env::temp_dir().join(format!(
            "patina-storage-alias-parent-segments-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&root);
        let current_root = root.join("current");
        let webview_root = root.join("webview");
        fs::create_dir_all(&current_root).unwrap();
        fs::create_dir_all(&webview_root).unwrap();
        let current = test_storage_paths(current_root.clone(), webview_root);
        let alias = root.join("unused").join("..").join("current");

        let error = validate_target_data_root(
            &current,
            &alias,
            TargetDataRootMode::Custom,
            TargetValidationAccess::InspectOnly,
        )
        .unwrap_err();

        assert!(error.contains("already active"));
        let _ = fs::remove_dir_all(&root);
    }

    #[cfg(windows)]
    #[test]
    fn target_junction_cannot_alias_the_active_data_root() {
        let root = std::env::temp_dir().join(format!(
            "patina-storage-alias-junction-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&root);
        let current_root = root.join("current");
        let webview_root = root.join("webview");
        let junction = root.join("current-junction");
        fs::create_dir_all(&current_root).unwrap();
        fs::create_dir_all(&webview_root).unwrap();
        let status = std::process::Command::new("cmd")
            .arg("/C")
            .arg("mklink")
            .arg("/J")
            .arg(&junction)
            .arg(&current_root)
            .status()
            .unwrap();
        assert!(status.success(), "failed to create test junction");
        let current = test_storage_paths(current_root, webview_root);

        let error = validate_target_data_root(
            &current,
            &junction,
            TargetDataRootMode::Custom,
            TargetValidationAccess::InspectOnly,
        )
        .unwrap_err();

        assert!(error.contains("already active"));
        fs::remove_dir(&junction).unwrap();
        let _ = fs::remove_dir_all(&root);
    }

    #[cfg(windows)]
    #[test]
    fn execution_validation_rejects_a_webview_target_junctioned_to_the_active_root() {
        let root = std::env::temp_dir().join(format!(
            "patina-webview-execution-alias-junction-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&root);
        let data_root = root.join("data");
        let current_webview_root = root.join("current-webview");
        let target_junction = root.join("target-webview");
        fs::create_dir_all(&data_root).unwrap();
        fs::create_dir_all(&current_webview_root).unwrap();
        let status = std::process::Command::new("cmd")
            .arg("/C")
            .arg("mklink")
            .arg("/J")
            .arg(&target_junction)
            .arg(&current_webview_root)
            .status()
            .unwrap();
        assert!(status.success(), "failed to create test junction");
        let current = test_storage_paths(data_root, current_webview_root.clone());

        let error = validate_target_webview_root_for_execution(
            &current,
            &target_junction,
            TargetWebviewRootMode::Custom,
        )
        .unwrap_err();

        assert!(error.contains("overlapping locations"));
        fs::remove_dir(&target_junction).unwrap();
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn writable_probe_preserves_a_preexisting_legacy_probe_file() {
        let root = std::env::temp_dir().join(format!(
            "patina-storage-probe-preserves-existing-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        let legacy_probe = root.join(".patina-write-probe");
        fs::write(&legacy_probe, b"user-owned").unwrap();

        probe_directory_writable(&root, "test directory").unwrap();

        assert_eq!(fs::read(&legacy_probe).unwrap(), b"user-owned");
        let remaining: Vec<_> = fs::read_dir(&root)
            .unwrap()
            .map(|entry| entry.unwrap().file_name())
            .collect();
        assert_eq!(remaining, vec![legacy_probe.file_name().unwrap()]);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn writable_probes_use_collision_safe_names_and_leave_no_artifacts() {
        let root = std::env::temp_dir().join(format!(
            "patina-storage-probe-concurrent-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();

        std::thread::scope(|scope| {
            for _ in 0..8 {
                let root = root.clone();
                scope.spawn(move || probe_directory_writable(&root, "test directory").unwrap());
            }
        });

        assert_eq!(fs::read_dir(&root).unwrap().count(), 0);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn target_cannot_be_inside_current_data_root() {
        let current = storage_paths::StoragePaths {
            data_anchor_dir: PathBuf::from("C:\\DataAnchor"),
            cache_anchor_dir: PathBuf::from("C:\\CacheAnchor"),
            data_root: PathBuf::from("C:\\Data"),
            db_path: PathBuf::from("C:\\Data\\patina.db"),
            backup_dir: PathBuf::from("C:\\Data\\backups"),
            remote_backup_temp_dir: PathBuf::from("C:\\Data\\remote-backup-temp"),
            webview_root: PathBuf::from("C:\\Local\\Patina"),
            is_custom_data_root: false,
            is_custom_webview_root: false,
        };

        let error = validate_target_data_root(
            &current,
            Path::new("C:\\Data\\Child"),
            TargetDataRootMode::Custom,
            TargetValidationAccess::InspectOnly,
        )
        .unwrap_err();

        assert!(error.contains("inside or above"));
    }

    #[test]
    fn target_data_root_can_share_current_cache_parent() {
        let current = storage_paths::StoragePaths {
            data_anchor_dir: PathBuf::from("C:\\DataAnchor"),
            cache_anchor_dir: PathBuf::from("C:\\CacheAnchor"),
            data_root: PathBuf::from("C:\\Data"),
            db_path: PathBuf::from("C:\\Data\\patina.db"),
            backup_dir: PathBuf::from("C:\\Data\\backups"),
            remote_backup_temp_dir: PathBuf::from("C:\\Data\\remote-backup-temp"),
            webview_root: PathBuf::from("D:\\Patina"),
            is_custom_data_root: false,
            is_custom_webview_root: true,
        };

        validate_target_data_root(
            &current,
            Path::new("D:\\Patina"),
            TargetDataRootMode::Custom,
            TargetValidationAccess::InspectOnly,
        )
        .unwrap();
    }

    #[test]
    fn target_data_root_cannot_be_inside_current_ebwebview_dir() {
        let current = storage_paths::StoragePaths {
            data_anchor_dir: PathBuf::from("C:\\DataAnchor"),
            cache_anchor_dir: PathBuf::from("C:\\CacheAnchor"),
            data_root: PathBuf::from("C:\\Data"),
            db_path: PathBuf::from("C:\\Data\\patina.db"),
            backup_dir: PathBuf::from("C:\\Data\\backups"),
            remote_backup_temp_dir: PathBuf::from("C:\\Data\\remote-backup-temp"),
            webview_root: PathBuf::from("D:\\Patina"),
            is_custom_data_root: false,
            is_custom_webview_root: true,
        };

        let error = validate_target_data_root(
            &current,
            Path::new("D:\\Patina\\EBWebView\\Patina"),
            TargetDataRootMode::Custom,
            TargetValidationAccess::InspectOnly,
        )
        .unwrap_err();

        assert!(error.contains("WebView cache"));
    }

    #[test]
    fn restore_default_allows_existing_default_database() {
        let root = std::env::temp_dir().join(format!(
            "patina-restore-default-existing-db-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&root);
        let current_root = root.join("custom");
        let default_root = root.join("default");
        fs::create_dir_all(&default_root).unwrap();
        fs::write(
            default_root.join(storage_paths::SQLITE_DB_FILE_NAME),
            b"old",
        )
        .unwrap();

        let current = storage_paths::StoragePaths {
            data_anchor_dir: default_root.clone(),
            cache_anchor_dir: default_root.join("webview-anchor"),
            data_root: current_root.clone(),
            db_path: current_root.join(storage_paths::SQLITE_DB_FILE_NAME),
            backup_dir: current_root.join("backups"),
            remote_backup_temp_dir: current_root.join("remote-backup-temp"),
            webview_root: current_root.join("webview"),
            is_custom_data_root: true,
            is_custom_webview_root: true,
        };

        validate_target_data_root(
            &current,
            &default_root,
            TargetDataRootMode::RestoreDefault,
            TargetValidationAccess::InspectOnly,
        )
        .unwrap();
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn inspect_only_validation_does_not_create_target_data_root() {
        let root =
            std::env::temp_dir().join(format!("patina-preview-no-create-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        let current_root = root.join("current");
        let target_root = root.join("target").join("Patina");
        fs::create_dir_all(&current_root).unwrap();

        let current = storage_paths::StoragePaths {
            data_anchor_dir: current_root.join(".data-anchor"),
            cache_anchor_dir: current_root.join(".cache-anchor"),
            data_root: current_root.clone(),
            db_path: current_root.join(storage_paths::SQLITE_DB_FILE_NAME),
            backup_dir: current_root.join("backups"),
            remote_backup_temp_dir: current_root.join("remote-backup-temp"),
            webview_root: current_root.join("webview"),
            is_custom_data_root: true,
            is_custom_webview_root: true,
        };

        validate_target_data_root(
            &current,
            &target_root,
            TargetDataRootMode::Custom,
            TargetValidationAccess::InspectOnly,
        )
        .unwrap();

        assert!(!target_root.exists());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn schedule_validation_does_not_create_target_data_root() {
        let root =
            std::env::temp_dir().join(format!("patina-schedule-no-create-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        let current_root = root.join("current");
        let target_parent = root.join("target");
        let target_root = target_parent.join("Patina");
        fs::create_dir_all(&current_root).unwrap();

        let current = storage_paths::StoragePaths {
            data_anchor_dir: current_root.join(".data-anchor"),
            cache_anchor_dir: current_root.join(".cache-anchor"),
            data_root: current_root.clone(),
            db_path: current_root.join(storage_paths::SQLITE_DB_FILE_NAME),
            backup_dir: current_root.join("backups"),
            remote_backup_temp_dir: current_root.join("remote-backup-temp"),
            webview_root: current_root.join("webview"),
            is_custom_data_root: true,
            is_custom_webview_root: true,
        };

        validate_target_data_root(
            &current,
            &target_root,
            TargetDataRootMode::Custom,
            TargetValidationAccess::ProbeWithoutCreate,
        )
        .unwrap();

        assert!(!target_parent.exists());
        assert!(!target_root.exists());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn schedule_validation_does_not_create_target_webview_root() {
        let root = std::env::temp_dir().join(format!(
            "patina-schedule-cache-no-create-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&root);
        let current_root = root.join("current");
        let target_parent = root.join("target");
        let target_root = target_parent.join("Patina");
        fs::create_dir_all(&current_root).unwrap();

        let current = storage_paths::StoragePaths {
            data_anchor_dir: current_root.join(".data-anchor"),
            cache_anchor_dir: current_root.join(".cache-anchor"),
            data_root: current_root.clone(),
            db_path: current_root.join(storage_paths::SQLITE_DB_FILE_NAME),
            backup_dir: current_root.join("backups"),
            remote_backup_temp_dir: current_root.join("remote-backup-temp"),
            webview_root: current_root.join("webview"),
            is_custom_data_root: true,
            is_custom_webview_root: true,
        };

        validate_target_webview_root(
            &current,
            &target_root,
            TargetWebviewRootMode::Custom,
            TargetValidationAccess::ProbeWithoutCreate,
        )
        .unwrap();

        assert!(!target_parent.exists());
        assert!(!target_root.exists());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn cleaning_old_data_payload_keeps_anchor_and_webview_cache() {
        let root = std::env::temp_dir().join(format!(
            "patina-clean-old-data-payload-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("backups")).unwrap();
        fs::create_dir_all(root.join("remote-backup-temp")).unwrap();
        fs::create_dir_all(root.join("webview").join("EBWebView")).unwrap();
        fs::write(root.join(storage_paths::SQLITE_DB_FILE_NAME), b"db").unwrap();
        fs::write(
            root.join(format!("{}-wal", storage_paths::SQLITE_DB_FILE_NAME)),
            b"wal",
        )
        .unwrap();
        fs::write(root.join("backups").join("backup.zip"), b"backup").unwrap();
        fs::write(root.join("remote-backup-temp").join("temp.zip"), b"temp").unwrap();
        fs::write(storage_anchor::data_anchor_path(&root), b"anchor").unwrap();

        clean_old_data_payload(&root, false).unwrap();

        assert!(!root.join(storage_paths::SQLITE_DB_FILE_NAME).exists());
        assert!(!root
            .join(format!("{}-wal", storage_paths::SQLITE_DB_FILE_NAME))
            .exists());
        assert!(!root.join("backups").exists());
        assert!(!root.join("remote-backup-temp").exists());
        assert!(storage_anchor::data_anchor_path(&root).exists());
        assert!(root.join("webview").join("EBWebView").exists());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn cleaning_old_custom_data_root_removes_container() {
        let root = std::env::temp_dir().join(format!(
            "patina-clean-old-custom-data-root-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("backups")).unwrap();
        fs::create_dir_all(root.join("webview").join("EBWebView")).unwrap();
        fs::write(root.join(storage_paths::SQLITE_DB_FILE_NAME), b"db").unwrap();
        fs::write(storage_anchor::data_anchor_path(&root), b"anchor").unwrap();

        clean_old_data_payload(&root, true).unwrap();

        assert!(!root.exists());
    }

    #[test]
    fn old_custom_data_root_stays_when_cache_is_still_inside() {
        let default_root = PathBuf::from(r"C:\Users\Example\AppData\Roaming\Patina");
        let source_root = PathBuf::from(r"D:\Patina");
        let cache_root = source_root.join("webview");

        assert!(
            !should_remove_old_data_root_container(&source_root, &cache_root, &default_root,)
                .unwrap()
        );
    }

    #[test]
    fn old_custom_data_root_is_removed_when_cache_moves_out() {
        let default_root = PathBuf::from(r"C:\Users\Example\AppData\Roaming\Patina");
        let source_root = PathBuf::from(r"D:\Patina");
        let cache_root = PathBuf::from(r"E:\Patina\webview");

        assert!(
            should_remove_old_data_root_container(&source_root, &cache_root, &default_root,)
                .unwrap()
        );
    }

    #[test]
    fn old_default_data_root_container_is_not_removed() {
        let default_root = PathBuf::from(r"C:\Users\Example\AppData\Roaming\Patina");
        let cache_root = PathBuf::from(r"E:\Patina\webview");

        assert!(
            !should_remove_old_data_root_container(&default_root, &cache_root, &default_root,)
                .unwrap()
        );
    }

    #[cfg(windows)]
    #[test]
    fn old_data_root_container_stays_when_target_cache_aliases_a_child() {
        let root = std::env::temp_dir().join(format!(
            "patina-cross-root-cache-alias-junction-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&root);
        let source_data_root = root.join("old-data");
        let target_cache_real = source_data_root.join("new-cache");
        let target_cache_junction = root.join("target-cache");
        let default_data_root = root.join("default-data");
        fs::create_dir_all(&target_cache_real).unwrap();
        fs::create_dir_all(&default_data_root).unwrap();
        let status = std::process::Command::new("cmd")
            .arg("/C")
            .arg("mklink")
            .arg("/J")
            .arg(&target_cache_junction)
            .arg(&target_cache_real)
            .status()
            .unwrap();
        assert!(status.success(), "failed to create test junction");

        assert!(!should_remove_old_data_root_container(
            &source_data_root,
            &target_cache_junction,
            &default_data_root,
        )
        .unwrap());

        fs::remove_dir(&target_cache_junction).unwrap();
        let _ = fs::remove_dir_all(&root);
    }

    #[cfg(windows)]
    #[test]
    fn removing_a_preexisting_staging_junction_never_removes_its_target() {
        let root = std::env::temp_dir().join(format!(
            "patina-staging-junction-removal-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&root);
        let owned_target = root.join("user-owned");
        let sentinel = owned_target.join("keep.txt");
        let staging_junction = root.join(".patina-migration-staging-test");
        fs::create_dir_all(&owned_target).unwrap();
        fs::write(&sentinel, b"keep").unwrap();
        let status = std::process::Command::new("cmd")
            .arg("/C")
            .arg("mklink")
            .arg("/J")
            .arg(&staging_junction)
            .arg(&owned_target)
            .status()
            .unwrap();
        assert!(status.success(), "failed to create test junction");

        let error = remove_migration_path_if_safe(&staging_junction).unwrap_err();

        assert!(error.contains("refusing to remove linked migration path"));
        assert!(staging_junction.exists());
        assert_eq!(fs::read(&sentinel).unwrap(), b"keep");
        fs::remove_file(&sentinel).unwrap();
        fs::remove_dir(&staging_junction).unwrap();
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn pending_merge_keeps_data_target_when_cache_is_scheduled_after_data() {
        let current = storage_paths::StoragePaths {
            data_anchor_dir: PathBuf::from(r"C:\DataAnchor"),
            cache_anchor_dir: PathBuf::from(r"C:\CacheAnchor"),
            data_root: PathBuf::from(r"C:\Data\Patina"),
            db_path: PathBuf::from(r"C:\Data\Patina\patina.db"),
            backup_dir: PathBuf::from(r"C:\Data\Patina\backups"),
            remote_backup_temp_dir: PathBuf::from(r"C:\Data\Patina\remote-backup-temp"),
            webview_root: PathBuf::from(r"C:\Cache\Patina"),
            is_custom_data_root: false,
            is_custom_webview_root: false,
        };
        let existing = storage_anchor::PendingStorageMigration {
            format: storage_anchor::STORAGE_MIGRATION_PENDING_FORMAT.to_string(),
            id: "migration-1".to_string(),
            source_data_root: current.data_root.clone(),
            target_data_root: PathBuf::from(r"D:\Patina"),
            target_webview_root: current.webview_root.clone(),
            created_at_ms: 1,
            state: MIGRATION_STATE_PENDING_RESTART.to_string(),
            clear_webview_cache: false,
        };

        let plan = plan_pending_storage_migration(
            &current,
            Some(&existing),
            current.data_root.clone(),
            PathBuf::from(r"E:\Patina"),
            "migration-2".to_string(),
        )
        .unwrap();

        assert_eq!(plan.migration_id, "migration-1");
        assert_eq!(plan.target_data_root, PathBuf::from(r"D:\Patina"));
        assert_eq!(plan.target_webview_root, PathBuf::from(r"E:\Patina"));
        assert!(!plan.requested_data_root_changes);
    }

    #[test]
    fn pending_merge_keeps_cache_target_when_data_is_scheduled_after_cache() {
        let current = storage_paths::StoragePaths {
            data_anchor_dir: PathBuf::from(r"C:\DataAnchor"),
            cache_anchor_dir: PathBuf::from(r"C:\CacheAnchor"),
            data_root: PathBuf::from(r"C:\Data\Patina"),
            db_path: PathBuf::from(r"C:\Data\Patina\patina.db"),
            backup_dir: PathBuf::from(r"C:\Data\Patina\backups"),
            remote_backup_temp_dir: PathBuf::from(r"C:\Data\Patina\remote-backup-temp"),
            webview_root: PathBuf::from(r"C:\Cache\Patina"),
            is_custom_data_root: false,
            is_custom_webview_root: false,
        };
        let existing = storage_anchor::PendingStorageMigration {
            format: storage_anchor::STORAGE_MIGRATION_PENDING_FORMAT.to_string(),
            id: "migration-1".to_string(),
            source_data_root: current.data_root.clone(),
            target_data_root: current.data_root.clone(),
            target_webview_root: PathBuf::from(r"E:\Patina"),
            created_at_ms: 1,
            state: MIGRATION_STATE_PENDING_RESTART.to_string(),
            clear_webview_cache: false,
        };

        let plan = plan_pending_storage_migration(
            &current,
            Some(&existing),
            PathBuf::from(r"D:\Patina"),
            current.webview_root.clone(),
            "migration-2".to_string(),
        )
        .unwrap();

        assert_eq!(plan.migration_id, "migration-1");
        assert_eq!(plan.target_data_root, PathBuf::from(r"D:\Patina"));
        assert_eq!(plan.target_webview_root, PathBuf::from(r"E:\Patina"));
        assert!(plan.requested_data_root_changes);
    }

    #[test]
    fn cleaning_pre_migration_backup_removes_empty_backup_dir() {
        let root = std::env::temp_dir().join(format!(
            "patina-clean-generated-backup-empty-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&root);
        let backup_dir = storage_paths::backup_dir_for_data_root(&root);
        fs::create_dir_all(&backup_dir).unwrap();
        fs::write(
            backup_dir.join(pre_migration_backup_file_name("20260622-223000")),
            b"backup",
        )
        .unwrap();

        clean_pre_migration_backup(&root, "20260622-223000").unwrap();

        assert!(!backup_dir.exists());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn cleaning_pre_migration_backup_keeps_user_backups() {
        let root = std::env::temp_dir().join(format!(
            "patina-clean-generated-backup-keep-user-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&root);
        let backup_dir = storage_paths::backup_dir_for_data_root(&root);
        fs::create_dir_all(&backup_dir).unwrap();
        fs::write(
            backup_dir.join(pre_migration_backup_file_name("20260622-223100")),
            b"generated",
        )
        .unwrap();
        fs::write(
            backup_dir.join("Patina-backup-20260622-220000.zip"),
            b"user",
        )
        .unwrap();

        clean_pre_migration_backup(&root, "20260622-223100").unwrap();

        assert!(!backup_dir
            .join(pre_migration_backup_file_name("20260622-223100"))
            .exists());
        assert!(backup_dir
            .join("Patina-backup-20260622-220000.zip")
            .exists());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn normalizes_absolute_target_path() {
        let normalized = normalize_selected_storage_root("D:\\Patina Data").unwrap();
        assert_eq!(normalized, PathBuf::from("D:\\Patina Data"));
    }
}
