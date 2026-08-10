use crate::data::schema;
use crate::data::sqlite_pool::{
    acquire_sqlite_maintenance, expected_migration_metadata, wait_for_sqlite_pool,
};
use crate::domain::backup::{BackupPreview, CURRENT_BACKUP_VERSION};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::{Pool, Row, Sqlite};
use std::collections::{BTreeMap, BTreeSet};
use std::fs::{self, File};
use std::io::{Read, Seek, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use tauri::AppHandle;
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

pub(super) const SNAPSHOT_FORMAT: &str = "PatinaSQLiteSnapshot-1";
const MANIFEST_ENTRY: &str = "manifest.json";
const CHECKSUMS_ENTRY: &str = "checksums.json";
const DATABASE_ENTRY: &str = "database/patina.db";
const MAX_METADATA_BYTES: u64 = 256 * 1024;
pub(crate) const MAX_DATABASE_BYTES: u64 = 512 * 1024 * 1024;
static UNIQUE_COUNTER: AtomicU64 = AtomicU64::new(0);

pub(crate) async fn export_scheduled_backup_create_new(
    app: &AppHandle,
    target_path: &Path,
) -> Result<(), String> {
    let pool = wait_for_sqlite_pool(app).await?;
    let _snapshot = super::BACKUP_SNAPSHOT_LOCK.lock().await;
    let _maintenance = acquire_sqlite_maintenance().await;
    write_snapshot_archive_create_new(
        &pool,
        &[target_path.to_path_buf()],
        env!("CARGO_PKG_VERSION"),
    )
    .await?;
    Ok(())
}

pub(crate) async fn validate_scheduled_snapshot(path: &Path) -> Result<(String, u64), String> {
    let extracted = extract_snapshot_archive(path, false).await?;
    if !extracted.preview.restore_supported {
        return Err("scheduled snapshot is not restorable by this app version".to_string());
    }
    drop(extracted);
    let size = std::fs::metadata(path)
        .map_err(|error| format!("failed to read scheduled backup metadata: {error}"))?
        .len();
    let hash = sha256_file(path)?;
    Ok((hash, size))
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SnapshotManifest {
    format: String,
    product: String,
    created_at_ms: u64,
    app_version: String,
    database: SnapshotDatabaseManifest,
    restore: SnapshotRestoreManifest,
    counts: SnapshotCounts,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SnapshotDatabaseManifest {
    path: String,
    size_bytes: u64,
    sha256: String,
    migration_head: i64,
    migration_fingerprint: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SnapshotRestoreManifest {
    strategies: Vec<String>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(default, rename_all = "camelCase")]
struct SnapshotCounts {
    sessions: usize,
    title_samples: usize,
    import_batches: usize,
    import_exact_sessions: usize,
    import_time_buckets: usize,
    settings: usize,
    icon_cache: usize,
    web_favicon_cache: usize,
    web_activity_segments: usize,
    tool_reminders: usize,
    tool_timers: usize,
    tool_timer_laps: usize,
    tool_pomodoro_runs: usize,
    tool_daily_stats: usize,
    tool_software_reminder_rules: usize,
    scheduled_backup_config: usize,
    scheduled_backup_runs: usize,
    scheduled_export_config: usize,
    scheduled_export_runs: usize,
}

#[derive(Debug, Serialize, Deserialize)]
struct SnapshotChecksums {
    algorithm: String,
    files: BTreeMap<String, String>,
}

pub(super) struct ExtractedSnapshot {
    work_dir: PathBuf,
    pub(super) db_path: PathBuf,
    pub(super) preview: BackupPreview,
}

impl Drop for ExtractedSnapshot {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.work_dir);
    }
}

fn now_ms() -> u64 {
    crate::platform::clock::unix_timestamp_millis_u64()
}

fn unique_suffix() -> String {
    format!(
        "{}-{}-{}",
        std::process::id(),
        now_ms(),
        UNIQUE_COUNTER.fetch_add(1, Ordering::Relaxed)
    )
}

pub(super) fn create_private_work_dir(parent: &Path, label: &str) -> Result<PathBuf, String> {
    for _ in 0..8 {
        let dir = parent.join(format!(".{label}-{}", unique_suffix()));
        match fs::create_dir(&dir) {
            Ok(()) => return Ok(dir),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => {
                return Err(format!(
                    "failed to create backup work directory `{}`: {error}",
                    dir.display()
                ))
            }
        }
    }
    Err("failed to allocate a unique backup work directory".to_string())
}

fn sha256_bytes(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    format!("{:x}", hasher.finalize())
}

pub(super) fn sha256_file(path: &Path) -> Result<String, String> {
    let mut file = File::open(path)
        .map_err(|error| format!("failed to open `{}` for hashing: {error}", path.display()))?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|error| format!("failed to hash `{}`: {error}", path.display()))?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

async fn open_snapshot_pool(path: &Path, read_only: bool) -> Result<Pool<Sqlite>, String> {
    let options = SqliteConnectOptions::new()
        .filename(path)
        .read_only(read_only)
        .create_if_missing(false)
        .pragma("busy_timeout", "5000")
        .pragma("foreign_keys", "ON");
    SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(options)
        .await
        .map_err(|error| format!("failed to open backup sqlite snapshot: {error}"))
}

pub(super) async fn validate_sqlite(pool: &Pool<Sqlite>, full: bool) -> Result<(), String> {
    let pragma = if full {
        "PRAGMA integrity_check"
    } else {
        "PRAGMA quick_check"
    };
    let rows = sqlx::query(pragma)
        .fetch_all(pool)
        .await
        .map_err(|error| format!("failed to check backup sqlite integrity: {error}"))?;
    if rows.is_empty()
        || rows
            .iter()
            .any(|row| row.try_get::<String, _>(0).ok().as_deref() != Some("ok"))
    {
        return Err("backup sqlite integrity check failed".to_string());
    }

    let foreign_key_rows = sqlx::query("PRAGMA foreign_key_check")
        .fetch_all(pool)
        .await
        .map_err(|error| format!("failed to check backup sqlite foreign keys: {error}"))?;
    if !foreign_key_rows.is_empty() {
        return Err("backup sqlite foreign key check failed".to_string());
    }
    Ok(())
}

async fn migration_metadata(pool: &Pool<Sqlite>) -> Result<(i64, String), String> {
    let rows = sqlx::query(
        "SELECT version, description, checksum, success
         FROM _sqlx_migrations
         ORDER BY version ASC",
    )
    .fetch_all(pool)
    .await
    .map_err(|error| format!("failed to inspect backup sqlite migrations: {error}"))?;
    if rows.is_empty() {
        return Err("backup sqlite migration history is missing".to_string());
    }
    let mut hasher = Sha256::new();
    let mut head = 0_i64;
    for row in rows {
        let version: i64 = row.get("version");
        let description: String = row.get("description");
        let checksum: Vec<u8> = row.get("checksum");
        let success: bool = row.get("success");
        if !success || version <= head {
            return Err("backup sqlite migration history is invalid".to_string());
        }
        head = version;
        hasher.update(version.to_le_bytes());
        hasher.update((description.len() as u64).to_le_bytes());
        hasher.update(description.as_bytes());
        hasher.update((checksum.len() as u64).to_le_bytes());
        hasher.update(&checksum);
    }
    Ok((head, format!("{:x}", hasher.finalize())))
}

fn current_migration_head() -> i64 {
    schema::tracker_migrations()
        .iter()
        .map(|migration| migration.version)
        .max()
        .unwrap_or_default()
}

fn expected_migration_fingerprint(head: i64) -> Option<String> {
    let rows = expected_migration_metadata()
        .into_iter()
        .take_while(|(version, _, _)| *version <= head)
        .collect::<Vec<_>>();
    if rows.last().map(|(version, _, _)| *version) != Some(head) {
        return None;
    }
    let mut hasher = Sha256::new();
    for (version, description, checksum) in rows {
        hasher.update(version.to_le_bytes());
        hasher.update((description.len() as u64).to_le_bytes());
        hasher.update(description.as_bytes());
        hasher.update((checksum.len() as u64).to_le_bytes());
        hasher.update(checksum);
    }
    Some(format!("{:x}", hasher.finalize()))
}

async fn count_table(pool: &Pool<Sqlite>, table: &str) -> Result<usize, String> {
    let query = match table {
        "sessions" => "SELECT COUNT(*) FROM sessions",
        "session_title_samples" => "SELECT COUNT(*) FROM session_title_samples",
        "import_batches" => "SELECT COUNT(*) FROM import_batches",
        "import_exact_sessions" => "SELECT COUNT(*) FROM import_exact_sessions",
        "import_time_buckets" => "SELECT COUNT(*) FROM import_time_buckets",
        "settings" => "SELECT COUNT(*) FROM settings",
        "icon_cache" => "SELECT COUNT(*) FROM icon_cache",
        "web_activity_segments" => "SELECT COUNT(*) FROM web_activity_segments",
        "web_favicon_cache" => "SELECT COUNT(*) FROM web_favicon_cache",
        "tool_reminders" => "SELECT COUNT(*) FROM tool_reminders",
        "tool_timers" => "SELECT COUNT(*) FROM tool_timers",
        "tool_timer_laps" => "SELECT COUNT(*) FROM tool_timer_laps",
        "tool_pomodoro_runs" => "SELECT COUNT(*) FROM tool_pomodoro_runs",
        "tool_daily_stats" => "SELECT COUNT(*) FROM tool_daily_stats",
        "tool_software_reminder_rules" => "SELECT COUNT(*) FROM tool_software_reminder_rules",
        "scheduled_backup_config" => "SELECT COUNT(*) FROM scheduled_backup_config",
        "scheduled_backup_runs" => "SELECT COUNT(*) FROM scheduled_backup_runs",
        "scheduled_export_config" => "SELECT COUNT(*) FROM scheduled_export_config",
        "scheduled_export_runs" => "SELECT COUNT(*) FROM scheduled_export_runs",
        _ => return Err(format!("unsupported backup count table `{table}`")),
    };
    let value: i64 = sqlx::query_scalar(query)
        .fetch_one(pool)
        .await
        .map_err(|error| format!("failed to count backup table `{table}`: {error}"))?;
    usize::try_from(value).map_err(|_| format!("invalid row count for `{table}`"))
}

async fn read_counts(pool: &Pool<Sqlite>) -> Result<SnapshotCounts, String> {
    Ok(SnapshotCounts {
        sessions: count_table(pool, "sessions").await?,
        title_samples: count_table(pool, "session_title_samples").await?,
        import_batches: count_table(pool, "import_batches").await?,
        import_exact_sessions: count_table(pool, "import_exact_sessions").await?,
        import_time_buckets: count_table(pool, "import_time_buckets").await?,
        settings: count_table(pool, "settings").await?,
        icon_cache: count_table(pool, "icon_cache").await?,
        web_activity_segments: count_table(pool, "web_activity_segments").await?,
        web_favicon_cache: count_table(pool, "web_favicon_cache").await?,
        tool_reminders: count_table(pool, "tool_reminders").await?,
        tool_timers: count_table(pool, "tool_timers").await?,
        tool_timer_laps: count_table(pool, "tool_timer_laps").await?,
        tool_pomodoro_runs: count_table(pool, "tool_pomodoro_runs").await?,
        tool_daily_stats: count_table(pool, "tool_daily_stats").await?,
        tool_software_reminder_rules: count_table(pool, "tool_software_reminder_rules").await?,
        scheduled_backup_config: count_table(pool, "scheduled_backup_config").await?,
        scheduled_backup_runs: count_table(pool, "scheduled_backup_runs").await?,
        scheduled_export_config: count_table(pool, "scheduled_export_config").await?,
        scheduled_export_runs: count_table(pool, "scheduled_export_runs").await?,
    })
}

pub(super) async fn validate_current_schema(pool: &Pool<Sqlite>) -> Result<(), String> {
    let (head, fingerprint) = migration_metadata(pool).await?;
    if head != current_migration_head()
        || expected_migration_fingerprint(head).as_deref() != Some(fingerprint.as_str())
    {
        return Err("restored sqlite snapshot did not reach the current schema".to_string());
    }
    read_counts(pool).await?;
    Ok(())
}

fn preview_from_manifest(manifest: &SnapshotManifest, supported: bool) -> BackupPreview {
    BackupPreview {
        hash: String::new(),
        format_kind: "sqlite_snapshot".to_string(),
        version: CURRENT_BACKUP_VERSION,
        exported_at_ms: manifest.created_at_ms,
        schema_version: u32::try_from(manifest.database.migration_head).unwrap_or_default(),
        app_version: manifest.app_version.clone(),
        restore_supported: supported,
        restore_message_key: if supported {
            "backup.restore.supported"
        } else {
            "backup.restore.schemaTooNew"
        }
        .to_string(),
        restore_message_args: Vec::new(),
        restore_message: if supported {
            "This backup can be restored by the current version."
        } else {
            "This backup was created with a newer database schema. Upgrade the app before restoring."
        }
        .to_string(),
        session_count: manifest.counts.sessions,
        title_sample_count: manifest.counts.title_samples,
        import_batch_count: manifest.counts.import_batches,
        import_exact_session_count: manifest.counts.import_exact_sessions,
        import_time_bucket_count: manifest.counts.import_time_buckets,
        setting_count: manifest.counts.settings,
        icon_cache_count: manifest.counts.icon_cache + manifest.counts.web_favicon_cache,
        web_activity_segment_count: manifest.counts.web_activity_segments,
        tool_reminder_count: manifest.counts.tool_reminders,
        tool_timer_count: manifest.counts.tool_timers,
        tool_timer_lap_count: manifest.counts.tool_timer_laps,
        tool_pomodoro_run_count: manifest.counts.tool_pomodoro_runs,
        tool_daily_stats_count: manifest.counts.tool_daily_stats,
        tool_software_reminder_rule_count: manifest.counts.tool_software_reminder_rules,
    }
}

async fn inspect_database_identity(path: &Path, full: bool) -> Result<(i64, String), String> {
    let pool = open_snapshot_pool(path, true).await?;
    let result = async {
        validate_sqlite(&pool, full).await?;
        migration_metadata(&pool).await
    }
    .await;
    pool.close().await;
    result
}

async fn inspect_current_database(
    path: &Path,
    full: bool,
) -> Result<(i64, String, SnapshotCounts), String> {
    let pool = open_snapshot_pool(path, true).await?;
    let result = async {
        validate_sqlite(&pool, full).await?;
        let (head, fingerprint) = migration_metadata(&pool).await?;
        let counts = read_counts(&pool).await?;
        Ok((head, fingerprint, counts))
    }
    .await;
    pool.close().await;
    result
}

async fn verify_extracted_database(
    path: &Path,
    manifest: &SnapshotManifest,
    full: bool,
) -> Result<bool, String> {
    let (head, fingerprint) = inspect_database_identity(path, full).await?;
    if head != manifest.database.migration_head
        || fingerprint != manifest.database.migration_fingerprint
    {
        return Err("snapshot database metadata does not match its manifest".to_string());
    }

    let supported = head <= current_migration_head()
        && expected_migration_fingerprint(head).as_deref() == Some(fingerprint.as_str());
    if head == current_migration_head() {
        let pool = open_snapshot_pool(path, true).await?;
        let counts_result = read_counts(&pool).await;
        pool.close().await;
        if counts_result? != manifest.counts {
            return Err("snapshot database metadata does not match its manifest".to_string());
        }
    }
    Ok(supported)
}

#[cfg(target_os = "windows")]
fn publish_archive_atomically(replacement: &Path, target: &Path) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows::core::PCWSTR;
    use windows::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };

    let target_wide = target
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect::<Vec<_>>();
    let replacement_wide = replacement
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect::<Vec<_>>();
    unsafe {
        MoveFileExW(
            PCWSTR(replacement_wide.as_ptr()),
            PCWSTR(target_wide.as_ptr()),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    }
    .map_err(|error| format!("failed to atomically replace existing backup file: {error}"))
}

#[derive(Debug, PartialEq, Eq)]
enum CreateNewPublishError {
    AlreadyExists,
    Other(String),
}

#[cfg(target_os = "windows")]
fn publish_archive_create_new(
    replacement: &Path,
    target: &Path,
) -> Result<(), CreateNewPublishError> {
    use std::os::windows::ffi::OsStrExt;
    use windows::core::PCWSTR;
    use windows::Win32::Storage::FileSystem::{MoveFileExW, MOVEFILE_WRITE_THROUGH};

    let target_wide = target
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect::<Vec<_>>();
    let replacement_wide = replacement
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect::<Vec<_>>();
    match unsafe {
        MoveFileExW(
            PCWSTR(replacement_wide.as_ptr()),
            PCWSTR(target_wide.as_ptr()),
            MOVEFILE_WRITE_THROUGH,
        )
    } {
        Ok(()) => Ok(()),
        Err(error) if (error.code().0 as u32 & 0xffff) == 183 => {
            Err(CreateNewPublishError::AlreadyExists)
        }
        Err(error) => Err(CreateNewPublishError::Other(format!(
            "failed to atomically publish new scheduled backup file: {error}"
        ))),
    }
}

#[cfg(not(target_os = "windows"))]
fn publish_archive_create_new(
    replacement: &Path,
    target: &Path,
) -> Result<(), CreateNewPublishError> {
    match fs::hard_link(replacement, target) {
        Ok(()) => {
            fs::remove_file(replacement).map_err(|error| {
                CreateNewPublishError::Other(format!(
                    "failed to finish publishing scheduled backup: {error}"
                ))
            })?;
            Ok(())
        }
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
            Err(CreateNewPublishError::AlreadyExists)
        }
        Err(error) => Err(CreateNewPublishError::Other(format!(
            "failed to atomically publish new scheduled backup file: {error}"
        ))),
    }
}

#[cfg(not(target_os = "windows"))]
fn publish_archive_atomically(replacement: &Path, target: &Path) -> Result<(), String> {
    fs::rename(replacement, target)
        .map_err(|error| format!("failed to publish snapshot backup: {error}"))
}

fn write_zip_entry<W: Write + std::io::Seek>(
    zip: &mut ZipWriter<W>,
    name: &str,
    bytes: &[u8],
) -> Result<(), String> {
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
    zip.start_file(name, options)
        .map_err(|error| format!("failed to start snapshot archive entry `{name}`: {error}"))?;
    zip.write_all(bytes)
        .map_err(|error| format!("failed to write snapshot archive entry `{name}`: {error}"))
}

pub(super) async fn write_snapshot_archive(
    pool: &Pool<Sqlite>,
    target: &Path,
    app_version: &str,
) -> Result<BackupPreview, String> {
    write_snapshot_archive_internal(pool, &[target.to_path_buf()], app_version, true)
        .await
        .map(|(_, preview)| preview)
}

pub(super) async fn write_snapshot_archive_create_new(
    pool: &Pool<Sqlite>,
    targets: &[PathBuf],
    app_version: &str,
) -> Result<(PathBuf, BackupPreview), String> {
    if targets.is_empty() {
        return Err("scheduled backup requires at least one target candidate".to_string());
    }
    write_snapshot_archive_internal(pool, targets, app_version, false).await
}

async fn write_snapshot_archive_internal(
    pool: &Pool<Sqlite>,
    targets: &[PathBuf],
    app_version: &str,
    replace_existing: bool,
) -> Result<(PathBuf, BackupPreview), String> {
    let target = targets
        .first()
        .ok_or_else(|| "backup requires a target path".to_string())?;
    let parent = target
        .parent()
        .filter(|path| !path.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    fs::create_dir_all(parent)
        .map_err(|error| format!("failed to create backup target directory: {error}"))?;
    let work_dir = create_private_work_dir(parent, "patina-snapshot")?;
    let db_path = work_dir.join("patina.db");
    let archive_path = work_dir.join("backup.zip");
    let result = async {
        sqlx::query("VACUUM INTO ?")
            .bind(db_path.to_string_lossy().to_string())
            .execute(pool)
            .await
            .map_err(|error| format!("failed to create consistent sqlite snapshot: {error}"))?;

        let (migration_head, migration_fingerprint, counts) =
            inspect_current_database(&db_path, true).await?;
        let size_bytes = fs::metadata(&db_path)
            .map_err(|error| format!("failed to read sqlite snapshot metadata: {error}"))?
            .len();
        let database_sha256 = sha256_file(&db_path)?;
        let manifest = SnapshotManifest {
            format: SNAPSHOT_FORMAT.to_string(),
            product: "Patina".to_string(),
            created_at_ms: now_ms(),
            app_version: app_version.to_string(),
            database: SnapshotDatabaseManifest {
                path: DATABASE_ENTRY.to_string(),
                size_bytes,
                sha256: database_sha256.clone(),
                migration_head,
                migration_fingerprint,
            },
            restore: SnapshotRestoreManifest {
                strategies: vec!["replace".to_string(), "merge".to_string()],
            },
            counts,
        };
        let manifest_bytes = serde_json::to_vec_pretty(&manifest)
            .map_err(|error| format!("failed to serialize snapshot manifest: {error}"))?;
        let mut checksum_files = BTreeMap::new();
        checksum_files.insert(MANIFEST_ENTRY.to_string(), sha256_bytes(&manifest_bytes));
        checksum_files.insert(DATABASE_ENTRY.to_string(), database_sha256);
        let checksum_bytes = serde_json::to_vec_pretty(&SnapshotChecksums {
            algorithm: "sha256".to_string(),
            files: checksum_files,
        })
        .map_err(|error| format!("failed to serialize snapshot checksums: {error}"))?;

        let archive_file = File::create(&archive_path)
            .map_err(|error| format!("failed to create snapshot archive: {error}"))?;
        let mut zip = ZipWriter::new(archive_file);
        write_zip_entry(&mut zip, MANIFEST_ENTRY, &manifest_bytes)?;
        zip.start_file(
            DATABASE_ENTRY,
            SimpleFileOptions::default().compression_method(CompressionMethod::Deflated),
        )
        .map_err(|error| format!("failed to start snapshot database entry: {error}"))?;
        let mut db_file = File::open(&db_path)
            .map_err(|error| format!("failed to open sqlite snapshot: {error}"))?;
        std::io::copy(&mut db_file, &mut zip)
            .map_err(|error| format!("failed to archive sqlite snapshot: {error}"))?;
        write_zip_entry(&mut zip, CHECKSUMS_ENTRY, &checksum_bytes)?;
        let archive_file = zip
            .finish()
            .map_err(|error| format!("failed to finish snapshot archive: {error}"))?;
        archive_file
            .sync_all()
            .map_err(|error| format!("failed to flush snapshot archive: {error}"))?;

        let inspected = extract_snapshot_archive(&archive_path, false).await?;
        if !inspected.preview.restore_supported {
            return Err(
                "generated sqlite snapshot is not restorable by this app version".to_string(),
            );
        }
        let preview = inspected.preview.clone();
        drop(inspected);
        if replace_existing {
            publish_archive_atomically(&archive_path, target)?;
            return Ok((target.clone(), preview));
        }

        for candidate in targets {
            match publish_archive_create_new(&archive_path, candidate) {
                Ok(()) => return Ok((candidate.clone(), preview)),
                Err(CreateNewPublishError::AlreadyExists) => continue,
                Err(CreateNewPublishError::Other(error)) => return Err(error),
            }
        }
        Err("all scheduled backup file names are already in use".to_string())
    }
    .await;
    let _ = fs::remove_dir_all(&work_dir);
    result
}

fn read_metadata_entry(archive: &mut ZipArchive<File>, name: &str) -> Result<Vec<u8>, String> {
    let entry = archive
        .by_name(name)
        .map_err(|error| format!("snapshot archive is missing `{name}`: {error}"))?;
    if entry.size() > MAX_METADATA_BYTES {
        return Err(format!("snapshot metadata entry `{name}` is too large"));
    }
    let mut bytes = Vec::with_capacity(entry.size() as usize);
    entry
        .take(MAX_METADATA_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| format!("failed to read snapshot entry `{name}`: {error}"))?;
    if bytes.len() as u64 > MAX_METADATA_BYTES {
        return Err(format!("snapshot metadata entry `{name}` is too large"));
    }
    Ok(bytes)
}

pub(super) fn is_snapshot_archive(path: &Path) -> Result<bool, String> {
    let mut file = File::open(path)
        .map_err(|error| format!("failed to open backup file `{}`: {error}", path.display()))?;
    let mut magic = [0_u8; 2];
    if file.read_exact(&mut magic).is_err() || magic != *b"PK" {
        return Ok(false);
    }
    file.rewind()
        .map_err(|error| format!("failed to inspect backup file: {error}"))?;
    let mut archive = ZipArchive::new(file).map_err(|error| {
        format!(
            "failed to open backup archive `{}`: {error}",
            path.display()
        )
    })?;
    let manifest_bytes = match read_metadata_entry(&mut archive, MANIFEST_ENTRY) {
        Ok(bytes) => bytes,
        Err(_) => return Ok(false),
    };
    let value: serde_json::Value = serde_json::from_slice(&manifest_bytes)
        .map_err(|error| format!("failed to parse backup manifest: {error}"))?;
    Ok(value.get("format").and_then(|value| value.as_str()) == Some(SNAPSHOT_FORMAT))
}

pub(super) async fn extract_snapshot_archive(
    backup_path: &Path,
    full_check: bool,
) -> Result<ExtractedSnapshot, String> {
    let parent = std::env::temp_dir();
    let work_dir = create_private_work_dir(&parent, "patina-restore")?;
    let db_path = work_dir.join("patina.db");
    let result = async {
        let file = File::open(backup_path).map_err(|error| {
            format!(
                "failed to open backup file `{}`: {error}",
                backup_path.display()
            )
        })?;
        let mut archive = ZipArchive::new(file).map_err(|error| {
            format!(
                "failed to open backup archive `{}`: {error}",
                backup_path.display()
            )
        })?;
        if archive.len() != 3 {
            return Err("snapshot archive has an unexpected file set".to_string());
        }
        let mut names = BTreeSet::new();
        for index in 0..archive.len() {
            let entry = archive
                .by_index(index)
                .map_err(|error| format!("failed to inspect snapshot archive: {error}"))?;
            let name = entry.name().to_string();
            if entry.enclosed_name().is_none() || !names.insert(name) {
                return Err("snapshot archive contains an unsafe or duplicate path".to_string());
            }
        }
        let expected = BTreeSet::from([
            MANIFEST_ENTRY.to_string(),
            CHECKSUMS_ENTRY.to_string(),
            DATABASE_ENTRY.to_string(),
        ]);
        if names != expected {
            return Err("snapshot archive has an unexpected file set".to_string());
        }
        let manifest_bytes = read_metadata_entry(&mut archive, MANIFEST_ENTRY)?;
        let checksum_bytes = read_metadata_entry(&mut archive, CHECKSUMS_ENTRY)?;
        let manifest: SnapshotManifest = serde_json::from_slice(&manifest_bytes)
            .map_err(|error| format!("failed to parse snapshot manifest: {error}"))?;
        let checksums: SnapshotChecksums = serde_json::from_slice(&checksum_bytes)
            .map_err(|error| format!("failed to parse snapshot checksums: {error}"))?;
        if manifest.format != SNAPSHOT_FORMAT
            || manifest.product != "Patina"
            || manifest.database.path != DATABASE_ENTRY
            || checksums.algorithm != "sha256"
            || manifest.restore.strategies != vec!["replace".to_string(), "merge".to_string()]
        {
            return Err("snapshot manifest is not supported".to_string());
        }
        let checksum_names = checksums.files.keys().cloned().collect::<BTreeSet<_>>();
        let expected_checksum_names =
            BTreeSet::from([MANIFEST_ENTRY.to_string(), DATABASE_ENTRY.to_string()]);
        if checksum_names != expected_checksum_names {
            return Err("snapshot checksum file set is invalid".to_string());
        }
        let expected_manifest = checksums
            .files
            .get(MANIFEST_ENTRY)
            .ok_or_else(|| "snapshot manifest checksum is missing".to_string())?;
        if expected_manifest != &sha256_bytes(&manifest_bytes) {
            return Err("snapshot manifest checksum mismatch".to_string());
        }
        let db_entry = archive
            .by_name(DATABASE_ENTRY)
            .map_err(|error| format!("snapshot database is missing: {error}"))?;
        if db_entry.size() == 0
            || db_entry.size() > MAX_DATABASE_BYTES
            || db_entry.size() != manifest.database.size_bytes
        {
            return Err("snapshot database size is invalid".to_string());
        }
        let mut output = File::create(&db_path)
            .map_err(|error| format!("failed to create extracted snapshot database: {error}"))?;
        let copied = std::io::copy(&mut db_entry.take(MAX_DATABASE_BYTES + 1), &mut output)
            .map_err(|error| format!("failed to extract snapshot database: {error}"))?;
        if copied != manifest.database.size_bytes || copied > MAX_DATABASE_BYTES {
            return Err("snapshot database extracted size is invalid".to_string());
        }
        output
            .sync_all()
            .map_err(|error| format!("failed to flush extracted snapshot database: {error}"))?;
        let digest = sha256_file(&db_path)?;
        let checksum_digest = checksums
            .files
            .get(DATABASE_ENTRY)
            .ok_or_else(|| "snapshot database checksum is missing".to_string())?;
        if digest != manifest.database.sha256 || &digest != checksum_digest {
            return Err("snapshot database checksum mismatch".to_string());
        }
        let supported = verify_extracted_database(&db_path, &manifest, full_check).await?;
        let preview = preview_from_manifest(&manifest, supported);
        Ok(ExtractedSnapshot {
            work_dir: work_dir.clone(),
            db_path: db_path.clone(),
            preview,
        })
    }
    .await;
    if result.is_err() {
        let _ = fs::remove_dir_all(&work_dir);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn snapshot_format_is_explicit_and_not_the_legacy_format() {
        assert_eq!(SNAPSHOT_FORMAT, "PatinaSQLiteSnapshot-1");
        assert_ne!(SNAPSHOT_FORMAT, "PatinaBackup");
    }

    #[test]
    fn sha256_is_stable() {
        assert_eq!(
            sha256_bytes(b"patina"),
            "d94f56e94b0baa931ff993ad4fb39e4726e3ff182e889e8c9003cdd6e6b0b484"
        );
    }

    #[tokio::test]
    async fn snapshot_archive_round_trips_a_consistent_database() {
        let work_dir = create_private_work_dir(&std::env::temp_dir(), "patina-snapshot-test")
            .expect("create test directory");
        let db_path = work_dir.join("source.db");
        let archive_path = work_dir.join("backup.zip");
        let pool = crate::data::sqlite_pool::open_single_connection_sqlite_pool(&db_path, true)
            .await
            .expect("open source database");
        crate::data::sqlite_pool::prepare_pool_schema(&pool, &db_path)
            .await
            .expect("prepare source schema");
        sqlx::query("INSERT INTO settings (key, value) VALUES ('snapshot-test', 'preserved')")
            .execute(&pool)
            .await
            .expect("insert source row");
        sqlx::query(
            "INSERT INTO import_batches (
                id, imported_at, source_name, source_kind, source_fingerprint,
                exact_session_count, hour_bucket_count
             ) VALUES ('backup-batch', 1, 'external.csv', 'patina-csv', 'source', 1, 1)",
        )
        .execute(&pool)
        .await
        .expect("insert import batch");
        sqlx::query(
            "INSERT INTO import_exact_sessions (
                batch_id, fingerprint, app_name, exe_name, window_title,
                start_time, end_time, duration
             ) VALUES ('backup-batch', 'exact', 'External', 'external.exe', '', 10, 20, 10)",
        )
        .execute(&pool)
        .await
        .expect("insert external exact session");
        sqlx::query(
            "INSERT INTO import_time_buckets (
                batch_id, fingerprint, app_name, exe_name, bucket_start_time, duration
             ) VALUES ('backup-batch', 'bucket', 'External', 'external.exe', 0, 10)",
        )
        .execute(&pool)
        .await
        .expect("insert external hour bucket");

        let preview = write_snapshot_archive(&pool, &archive_path, "test")
            .await
            .expect("write snapshot archive");
        assert_eq!(preview.format_kind, "sqlite_snapshot");
        assert_eq!(preview.setting_count, 1);
        assert_eq!(preview.import_batch_count, 1);
        assert_eq!(preview.import_exact_session_count, 1);
        assert_eq!(preview.import_time_bucket_count, 1);

        let extracted = extract_snapshot_archive(&archive_path, true)
            .await
            .expect("extract snapshot archive");
        let restored_pool = open_snapshot_pool(&extracted.db_path, true)
            .await
            .expect("open extracted database");
        let value: String =
            sqlx::query_scalar("SELECT value FROM settings WHERE key = 'snapshot-test'")
                .fetch_one(&restored_pool)
                .await
                .expect("read extracted row");
        let external_counts: (i64, i64, i64) = sqlx::query_as(
            "SELECT
                (SELECT COUNT(*) FROM import_batches),
                (SELECT COUNT(*) FROM import_exact_sessions),
                (SELECT COUNT(*) FROM import_time_buckets)",
        )
        .fetch_one(&restored_pool)
        .await
        .expect("read extracted external rows");
        assert_eq!(value, "preserved");
        assert_eq!(external_counts, (1, 1, 1));
        restored_pool.close().await;
        pool.close().await;
        drop(extracted);
        fs::remove_dir_all(work_dir).expect("remove test directory");
    }

    #[tokio::test]
    async fn older_migration_prefix_is_verified_before_current_table_counts() {
        let work_dir = create_private_work_dir(&std::env::temp_dir(), "patina-old-snapshot-test")
            .expect("create test directory");
        let db_path = work_dir.join("old.db");
        let pool = crate::data::sqlite_pool::open_single_connection_sqlite_pool(&db_path, true)
            .await
            .expect("open source database");
        crate::data::sqlite_pool::prepare_pool_schema(&pool, &db_path)
            .await
            .expect("prepare source schema");
        let migrations = expected_migration_metadata();
        let removed_version = migrations.last().expect("current migration").0;
        let old_head = migrations
            .iter()
            .rev()
            .nth(1)
            .expect("previous migration")
            .0;
        sqlx::query("DROP TABLE scheduled_export_runs")
            .execute(&pool)
            .await
            .expect("remove current scheduled export runs table");
        sqlx::query("DROP TABLE scheduled_export_config")
            .execute(&pool)
            .await
            .expect("remove current scheduled export config table");
        sqlx::query("DELETE FROM _sqlx_migrations WHERE version = ?")
            .bind(removed_version)
            .execute(&pool)
            .await
            .expect("rewind migration history");
        pool.close().await;

        let manifest = SnapshotManifest {
            format: SNAPSHOT_FORMAT.to_string(),
            product: "Patina".to_string(),
            created_at_ms: now_ms(),
            app_version: "old".to_string(),
            database: SnapshotDatabaseManifest {
                path: DATABASE_ENTRY.to_string(),
                size_bytes: 1,
                sha256: "0".repeat(64),
                migration_head: old_head,
                migration_fingerprint: expected_migration_fingerprint(old_head)
                    .expect("known migration prefix"),
            },
            restore: SnapshotRestoreManifest {
                strategies: vec!["replace".to_string(), "merge".to_string()],
            },
            counts: SnapshotCounts::default(),
        };

        assert!(verify_extracted_database(&db_path, &manifest, false)
            .await
            .expect("old schema prefix should reach migration"));

        let migration_pool =
            crate::data::sqlite_pool::open_single_connection_sqlite_pool(&db_path, false)
                .await
                .expect("open old schema for migration");
        crate::data::sqlite_pool::prepare_pool_schema(&migration_pool, &db_path)
            .await
            .expect("migrate old schema");
        validate_current_schema(&migration_pool)
            .await
            .expect("migrated schema should expose all current tables");
        migration_pool.close().await;
        fs::remove_dir_all(work_dir).expect("remove test directory");
    }

    #[test]
    fn publishing_over_an_existing_backup_keeps_the_target_path_valid() {
        let work_dir = create_private_work_dir(&std::env::temp_dir(), "patina-publish-test")
            .expect("create test directory");
        let target = work_dir.join("backup.zip");
        let replacement = work_dir.join("replacement.zip");
        fs::write(&target, b"old").expect("write old backup");
        fs::write(&replacement, b"new").expect("write replacement backup");

        publish_archive_atomically(&replacement, &target).expect("replace backup atomically");

        assert_eq!(fs::read(&target).expect("read published backup"), b"new");
        assert!(!replacement.exists());
        fs::remove_dir_all(work_dir).expect("remove test directory");
    }

    #[test]
    fn create_new_publish_never_overwrites_an_unknown_target() {
        let work_dir = create_private_work_dir(&std::env::temp_dir(), "patina-create-new-test")
            .expect("create test directory");
        let target = work_dir.join("backup.zip");
        let replacement = work_dir.join("replacement.zip");
        fs::write(&target, b"unknown").expect("write unknown target");
        fs::write(&replacement, b"scheduled").expect("write replacement");

        assert_eq!(
            publish_archive_create_new(&replacement, &target),
            Err(CreateNewPublishError::AlreadyExists)
        );
        assert_eq!(fs::read(&target).expect("read target"), b"unknown");
        assert_eq!(
            fs::read(&replacement).expect("read retained replacement"),
            b"scheduled"
        );
        fs::remove_dir_all(work_dir).expect("remove test directory");
    }

    #[test]
    fn non_zip_files_are_not_misclassified_as_snapshots() {
        let work_dir = create_private_work_dir(&std::env::temp_dir(), "patina-format-test")
            .expect("create test directory");
        let path = work_dir.join("legacy.json");
        fs::write(&path, br#"{"version":1}"#).expect("write legacy file");
        assert!(!is_snapshot_archive(&path).expect("inspect legacy file"));
        fs::remove_dir_all(work_dir).expect("remove test directory");
    }

    #[tokio::test]
    async fn snapshot_reader_rejects_traversal_entries_before_extraction() {
        let work_dir = create_private_work_dir(&std::env::temp_dir(), "patina-unsafe-zip-test")
            .expect("create test directory");
        let path = work_dir.join("unsafe.zip");
        let file = File::create(&path).expect("create unsafe archive");
        let mut zip = ZipWriter::new(file);
        let options = SimpleFileOptions::default();
        for name in ["../manifest.json", CHECKSUMS_ENTRY, DATABASE_ENTRY] {
            zip.start_file(name, options).expect("start unsafe entry");
            zip.write_all(b"invalid").expect("write unsafe entry");
        }
        zip.finish().expect("finish unsafe archive");

        let error = extract_snapshot_archive(&path, false)
            .await
            .err()
            .expect("unsafe archive must be rejected");
        assert!(error.contains("unsafe") || error.contains("unexpected file set"));
        fs::remove_dir_all(work_dir).expect("remove test directory");
    }

    #[tokio::test]
    async fn snapshot_reader_rejects_duplicate_entries() {
        let work_dir = create_private_work_dir(&std::env::temp_dir(), "patina-duplicate-zip-test")
            .expect("create test directory");
        let path = work_dir.join("duplicate.zip");
        let mut zip = ZipWriter::new(std::io::Cursor::new(Vec::new()));
        let options = SimpleFileOptions::default();
        for name in [MANIFEST_ENTRY, "manifesu.json", DATABASE_ENTRY] {
            zip.start_file(name, options)
                .expect("start duplicate entry");
            zip.write_all(b"invalid").expect("write duplicate entry");
        }
        let mut bytes = zip.finish().expect("finish duplicate archive").into_inner();
        for index in 0..bytes.len().saturating_sub(b"manifesu.json".len()) {
            if &bytes[index..index + b"manifesu.json".len()] == b"manifesu.json" {
                bytes[index..index + b"manifest.json".len()].copy_from_slice(b"manifest.json");
            }
        }
        fs::write(&path, bytes).expect("write duplicate archive");

        let error = extract_snapshot_archive(&path, false)
            .await
            .err()
            .expect("duplicate archive must be rejected");
        let normalized = error.to_ascii_lowercase();
        assert!(
            normalized.contains("duplicate") || normalized.contains("unexpected file set"),
            "{error}"
        );
        fs::remove_dir_all(work_dir).expect("remove test directory");
    }
}
