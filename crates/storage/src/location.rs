use serde::{Deserialize, Serialize};
use sqlx::{Connection, SqlitePool};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
};
mod migration;
pub use migration::{directory_size_bytes, resolve_destination};

#[derive(Serialize, Deserialize)]
pub struct Location {
    active: PathBuf,
    pub pending: Option<PathBuf>,
    #[serde(default)]
    staged: Option<PathBuf>,
    #[serde(default)]
    pub backups: Option<PathBuf>,
    #[serde(default)]
    staged_backups: Option<PathBuf>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub move_error: Option<String>,
}
pub fn location_file_path(profile: &Path) -> PathBuf {
    profile.join("database-location.json")
}
pub fn load_location(profile: &Path) -> Result<Location, String> {
    match fs::read(location_file_path(profile)) {
        Ok(b) => serde_json::from_slice(&b).map_err(|e| e.to_string()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Location {
            active: profile.to_owned(),
            pending: None,
            staged: None,
            backups: None,
            staged_backups: None,
            move_error: None,
        }),
        Err(e) => Err(e.to_string()),
    }
}
fn save_location(profile: &Path, state: &Location) -> Result<(), String> {
    let mut f = tempfile::NamedTempFile::new_in(profile).map_err(|e| e.to_string())?;
    serde_json::to_writer(f.as_file_mut(), state).map_err(|e| e.to_string())?;
    f.flush()
        .and_then(|_| f.as_file().sync_all())
        .map_err(|e| e.to_string())?;
    f.persist(location_file_path(profile))
        .map_err(|e| e.to_string())?;
    Ok(())
}
fn check_destination(root: &Path) -> Result<(), String> {
    if !root.is_absolute() || !root.is_dir() {
        return Err("Select an existing absolute directory".into());
    }
    for name in [
        "patina.db",
        "patina.db-wal",
        "patina.db-shm",
        "patina.db-journal",
        "backups",
    ] {
        if fs::symlink_metadata(root.join(name)).is_ok() {
            return Err("The destination already contains a Patina database".into());
        }
    }
    Ok(())
}
fn is_migration_stage(path: &Path, destination: &Path) -> bool {
    path.parent() == Some(destination)
        && path
            .file_name()
            .and_then(|n| n.to_str())
            .is_some_and(|n| n.starts_with(".patina-move-"))
}
fn publish_candidate(
    profile: &Path,
    state: &mut Location,
    old: &Path,
    next: &Path,
    destination: &Path,
) -> Result<PathBuf, String> {
    // A hard link makes publication exclusive. The staged link identifies our
    // candidate after an interruption between publication and pointer commit.
    let stage = if let Some(staged) = &state.staged {
        if !is_migration_stage(staged, next) {
            return Err("Invalid migration state".into());
        }
        staged.clone()
    } else {
        check_destination(next)?;
        let temp = tempfile::Builder::new()
            .prefix(".patina-move-")
            .tempfile_in(next)
            .map_err(|e| e.to_string())?
            .into_temp_path();
        let stage = temp.to_path_buf();
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .map_err(|e| e.to_string())?;
        rt.block_on(async {
            let mut db = sqlx::SqliteConnection::connect_with(
                &sqlx::sqlite::SqliteConnectOptions::new()
                    .filename(old)
                    .read_only(true),
            )
            .await
            .map_err(|e| e.to_string())?;
            sqlx::query("VACUUM INTO ?")
                .bind(stage.to_string_lossy().as_ref())
                .execute(&mut db)
                .await
                .map_err(|e| e.to_string())?;
            db.close().await.map_err(|e| e.to_string())?;
            let mut candidate = sqlx::SqliteConnection::connect_with(
                &sqlx::sqlite::SqliteConnectOptions::new()
                    .filename(&stage)
                    .read_only(true),
            )
            .await
            .map_err(|e| e.to_string())?;
            let check: String = sqlx::query_scalar("PRAGMA integrity_check")
                .fetch_one(&mut candidate)
                .await
                .map_err(|e| e.to_string())?;
            if check != "ok" {
                return Err("Migrated database failed integrity check".to_string());
            }
            candidate.close().await.map_err(|e| e.to_string())
        })?;
        fs::OpenOptions::new()
            .write(true)
            .open(&stage)
            .and_then(|f| f.sync_all())
            .map_err(|e| format!("flush migration candidate: {e}"))?;
        state.staged = Some(stage.clone());
        state.pending = Some(next.to_owned());
        save_location(profile, state)?;
        temp.keep().map_err(|e| e.to_string())?;
        stage
    };
    migration::publish_backups(profile, state, next)?;
    if destination.exists() {
        if !same_file::is_same_file(&stage, destination).map_err(|e| e.to_string())? {
            return Err("Destination changed during migration".into());
        }
    } else {
        fs::hard_link(&stage, destination).map_err(|e| e.to_string())?;
    }
    Ok(stage)
}
pub fn prepare_database_for_startup(profile: &Path) -> Result<PathBuf, String> {
    let mut state = load_location(profile)?;
    let old = state.active.join("patina.db");
    if location_file_path(profile).exists() && (!old.is_file() || !state.active.is_absolute()) {
        return Err("Configured database is unavailable".into());
    }
    if let Some(next) = state.pending.take() {
        let destination = next.join("patina.db");
        let stage = match publish_candidate(profile, &mut state, &old, &next, &destination) {
            Ok(stage) => stage,
            Err(error) => {
                state.pending = None;
                migration::rollback_backups(&mut state, &next);
                let stage = state.staged.take();
                state.move_error = Some(error);
                save_location(profile, &state)?;
                if let Some(stage) = stage.filter(|p| is_migration_stage(p, &next)) {
                    let _ = fs::remove_file(stage);
                }
                return Ok(old);
            }
        };
        state.pending = None;
        state.staged = None;
        state.move_error = None;
        let previous_backups = state
            .backups
            .clone()
            .unwrap_or_else(|| profile.join("backups"));
        state.backups = Some(next.join("backups"));
        let backup_stage = state.staged_backups.take();
        state.active = next;
        save_location(profile, &state)?;
        // Only remove the previous DB after the location pointer is durable.
        // Leave a closed source in place if Windows refuses to delete it.
        let _ = fs::remove_file(stage);
        let _ = fs::remove_file(&old);
        migration::finish_backups(
            &previous_backups,
            state.backups.as_ref().unwrap(),
            backup_stage.as_deref(),
        );
        return Ok(destination);
    }
    Ok(old)
}

pub fn schedule_storage_move(profile: &Path, directory: Option<&Path>) -> Result<(), String> {
    let dest = migration::resolve_destination(profile, directory)?;
    fs::create_dir_all(&dest).map_err(|e| e.to_string())?;
    let dest = dest.canonicalize().map_err(|e| e.to_string())?;
    let mut state = load_location(profile)?;
    if state.active != dest {
        check_destination(&dest)?;
    }
    state.pending = (state.active != dest).then_some(dest);
    state.move_error = None;
    save_location(profile, &state)?;
    Ok(())
}

pub async fn restore_database_in_place(
    target: &SqlitePool,
    source: &SqlitePool,
) -> Result<(), String> {
    let mut target = target.acquire().await.map_err(|e| e.to_string())?;
    let mut source = source.acquire().await.map_err(|e| e.to_string())?;
    let mut dst = target.lock_handle().await.map_err(|e| e.to_string())?;
    let mut src = source.lock_handle().await.map_err(|e| e.to_string())?;
    // The online-backup API commits the replacement in one SQLite transaction.
    // Both SQLx handles stay locked until finish releases the backup object.
    unsafe {
        use libsqlite3_sys::*;
        let copy = sqlite3_backup_init(
            dst.as_raw_handle().as_ptr(),
            c"main".as_ptr(),
            src.as_raw_handle().as_ptr(),
            c"main".as_ptr(),
        );
        if copy.is_null() {
            return Err("Could not begin database replacement".into());
        }
        let step = sqlite3_backup_step(copy, -1);
        let finish = sqlite3_backup_finish(copy);
        if step != SQLITE_DONE || finish != SQLITE_OK {
            return Err(format!("Database replacement failed ({step}, {finish})"));
        }
    }
    Ok(())
}
