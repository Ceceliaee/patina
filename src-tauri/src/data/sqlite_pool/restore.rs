use super::{
    checkpoint_sqlite_pool, open_single_connection_sqlite_pool, prepare_pool_schema,
    register_sqlite_pool, resolve_product_db_path, wait_for_sqlite_pool,
};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Runtime};

const RESTORE_MARKER_NAME: &str = ".patina-restore-pending";

fn restore_marker_path(db_path: &Path) -> Result<PathBuf, String> {
    db_path
        .parent()
        .map(|parent| parent.join(RESTORE_MARKER_NAME))
        .ok_or_else(|| "sqlite database path has no parent directory".to_string())
}

fn persist_restore_marker(db_path: &Path, rollback_path: &Path) -> Result<PathBuf, String> {
    let marker_path = restore_marker_path(db_path)?;
    let rollback_name = rollback_path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "restore rollback path has no valid file name".to_string())?;
    let mut marker = fs::OpenOptions::new()
        .create(true)
        .truncate(true)
        .write(true)
        .open(&marker_path)
        .map_err(|error| format!("failed to create restore recovery marker: {error}"))?;
    marker
        .write_all(rollback_name.as_bytes())
        .and_then(|_| marker.sync_all())
        .map_err(|error| format!("failed to persist restore recovery marker: {error}"))?;
    Ok(marker_path)
}

pub(super) fn recover_interrupted_db_restore(db_path: &Path) -> Result<(), String> {
    let marker_path = restore_marker_path(db_path)?;
    if !marker_path.exists() {
        return Ok(());
    }
    let rollback_name = fs::read_to_string(&marker_path)
        .map_err(|error| format!("failed to read restore recovery marker: {error}"))?;
    let rollback_name = rollback_name.trim();
    if !rollback_name.starts_with(".patina-restore-rollback-")
        || rollback_name.contains('/')
        || rollback_name.contains('\\')
    {
        return Err("restore recovery marker contains an invalid rollback path".to_string());
    }
    let rollback_path = db_path
        .parent()
        .ok_or_else(|| "sqlite database path has no parent directory".to_string())?
        .join(rollback_name);
    if rollback_path.exists() {
        remove_sqlite_sidecars(db_path)?;
        if db_path.exists() {
            fs::remove_file(db_path).map_err(|error| {
                format!("failed to remove interrupted restored database: {error}")
            })?;
        }
        fs::rename(&rollback_path, db_path)
            .map_err(|error| format!("failed to recover original sqlite database: {error}"))?;
    }
    fs::remove_file(&marker_path)
        .map_err(|error| format!("failed to clear restore recovery marker: {error}"))?;
    Ok(())
}

fn remove_sqlite_sidecars(db_path: &Path) -> Result<(), String> {
    for suffix in ["-wal", "-shm"] {
        let sidecar = PathBuf::from(format!("{}{}", db_path.display(), suffix));
        match fs::remove_file(&sidecar) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => {
                return Err(format!(
                    "failed to remove sqlite restore sidecar `{}`: {error}",
                    sidecar.display()
                ))
            }
        }
    }
    Ok(())
}

async fn prepare_replacement_pool(db_path: &Path) -> Result<sqlx::Pool<sqlx::Sqlite>, String> {
    let next_pool = open_single_connection_sqlite_pool(db_path, false).await?;
    let result = async {
        prepare_pool_schema(&next_pool, db_path).await?;
        crate::data::activity_read_model::invalidate_all(&next_pool, "database_restore").await?;
        // Removing the marker commits the file replacement. Publish no writable pool before it.
        fs::remove_file(restore_marker_path(db_path)?).map_err(|error| {
            format!("failed to finalize restored database recovery marker: {error}")
        })?;
        Ok(())
    }
    .await;
    if let Err(error) = result {
        next_pool.close().await;
        return Err(error);
    }
    Ok(next_pool)
}

pub(crate) async fn replace_product_db_from_candidate<R: Runtime>(
    app: &AppHandle<R>,
    candidate_path: &Path,
) -> Result<(), String> {
    let db_path = resolve_product_db_path(app)?;
    let parent = db_path
        .parent()
        .ok_or_else(|| "sqlite database path has no parent directory".to_string())?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("failed to create sqlite data directory: {error}"))?;
    let suffix = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    let staging_path = parent.join(format!(".patina-restore-staging-{suffix}.db"));
    let rollback_path = parent.join(format!(".patina-restore-rollback-{suffix}.db"));
    fs::copy(candidate_path, &staging_path)
        .map_err(|error| format!("failed to stage restored sqlite database: {error}"))?;
    let marker_path = persist_restore_marker(&db_path, &rollback_path)?;

    let current_pool = wait_for_sqlite_pool(app).await?;
    if let Err(error) = checkpoint_sqlite_pool(&current_pool).await {
        let _ = fs::remove_file(&staging_path);
        let _ = fs::remove_file(&marker_path);
        return Err(format!(
            "failed to checkpoint current sqlite database before restore: {error}"
        ));
    }
    current_pool.close().await;
    if let Err(error) = remove_sqlite_sidecars(&db_path) {
        let _ = fs::remove_file(&staging_path);
        let _ = fs::remove_file(&marker_path);
        let reopened = open_single_connection_sqlite_pool(&db_path, false).await?;
        prepare_pool_schema(&reopened, &db_path).await?;
        register_sqlite_pool(app, reopened).await?;
        return Err(error);
    }

    if !db_path.exists() {
        let _ = fs::remove_file(&staging_path);
        let _ = fs::remove_file(&marker_path);
        return Err("current sqlite database is missing".to_string());
    }
    if let Err(error) = fs::rename(&db_path, &rollback_path) {
        let _ = fs::remove_file(&staging_path);
        let _ = fs::remove_file(&marker_path);
        let reopened = open_single_connection_sqlite_pool(&db_path, false).await?;
        prepare_pool_schema(&reopened, &db_path).await?;
        register_sqlite_pool(app, reopened).await?;
        return Err(format!(
            "failed to preserve current sqlite database: {error}"
        ));
    }
    if let Err(install_error) = fs::rename(&staging_path, &db_path) {
        match fs::rename(&rollback_path, &db_path) {
            Ok(()) => {
                let _ = fs::remove_file(&staging_path);
                let _ = fs::remove_file(&marker_path);
                let reopened = open_single_connection_sqlite_pool(&db_path, false).await?;
                prepare_pool_schema(&reopened, &db_path).await?;
                register_sqlite_pool(app, reopened).await?;
                return Err(format!(
                    "failed to install restored sqlite database; the original database was restored: {install_error}"
                ));
            }
            Err(rollback_error) => {
                return Err(format!(
                    "critical restore failure: failed to install restored sqlite database ({install_error}) and failed to return the original database ({rollback_error}); recovery files and marker were preserved"
                ));
            }
        }
    }

    let open_result = async {
        let next_pool = prepare_replacement_pool(&db_path).await?;
        if let Err(error) = register_sqlite_pool(app, next_pool.clone()).await {
            next_pool.close().await;
            return Err(error);
        }
        Ok(())
    }
    .await;

    if let Err(error) = open_result {
        // Registration can fail after disk commit; retain restart recovery before undoing it.
        if !marker_path.exists() {
            persist_restore_marker(&db_path, &rollback_path).map_err(|marker_error| {
                format!("restored sqlite database activation failed: {error}; failed to preserve rollback recovery: {marker_error}")
            })?;
        }
        remove_sqlite_sidecars(&db_path).map_err(|sidecar_error| {
            format!("restored sqlite database activation failed: {error}; failed to clear candidate sidecars: {sidecar_error}")
        })?;
        fs::remove_file(&db_path).map_err(|remove_error| {
            format!("restored sqlite database activation failed: {error}; failed to remove candidate: {remove_error}")
        })?;
        fs::rename(&rollback_path, &db_path).map_err(|rollback_error| {
            format!(
                "restored sqlite database failed validation: {error}; failed to restore original database: {rollback_error}"
            )
        })?;
        let original_pool = open_single_connection_sqlite_pool(&db_path, false).await?;
        prepare_pool_schema(&original_pool, &db_path).await?;
        register_sqlite_pool(app, original_pool).await?;
        let _ = fs::remove_file(&marker_path);
        return Err(format!(
            "restored sqlite database failed validation and the original database was restored: {error}"
        ));
    }

    if let Err(error) = fs::remove_file(&rollback_path) {
        eprintln!("[sql] restored database is active but rollback cleanup failed: {error}");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use futures_util::FutureExt;
    use sqlx::{Executor, Row};
    use std::panic::AssertUnwindSafe;

    #[cfg(target_os = "windows")]
    #[tokio::test]
    async fn locked_restore_marker_prevents_publishing_the_replacement_pool() {
        use std::os::windows::fs::OpenOptionsExt;

        let dir =
            std::env::temp_dir().join(format!("patina-restore-commit-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&dir).unwrap();
        let db_path = dir.join("patina.db");
        let rollback_path = dir.join(".patina-restore-rollback-original.db");
        let mut opened_pools = Vec::new();
        let outcome = AssertUnwindSafe(async {
            eprintln!("restore_marker_commit_fixture={}", dir.display());
            for (path, name) in [(&rollback_path, "original"), (&db_path, "candidate")] {
                let pool = open_single_connection_sqlite_pool(path, true).await.unwrap();
                opened_pools.push(pool.clone());
                prepare_pool_schema(&pool, path).await.unwrap();
                sqlx::query("INSERT INTO settings(key, value) VALUES ('restore_identity', ?)")
                    .bind(name).execute(&pool).await.unwrap();
                checkpoint_sqlite_pool(&pool).await.unwrap();
                pool.close().await;
            }
            let marker_path = persist_restore_marker(&db_path, &rollback_path).unwrap();
            // Permit reads/writes, but retain a real Windows handle without FILE_SHARE_DELETE.
            let marker_lock = fs::OpenOptions::new().read(true).share_mode(0x0000_0003)
                .open(&marker_path).unwrap();
            let denied = fs::remove_file(&marker_path).unwrap_err();
            assert_eq!(denied.raw_os_error(), Some(32));
            eprintln!("restore_marker_delete_denied_os_code={:?}", denied.raw_os_error());
            let result = prepare_replacement_pool(&db_path).await;
            if let Ok(pool) = &result {
                opened_pools.push(pool.clone());
            }
            assert!(result.is_err(), "an uncommitted candidate pool was exposed while its rollback marker could not be removed");
            assert!(result.unwrap_err().contains("failed to finalize"));
            drop(marker_lock);

            // A failed prepare must release candidate handles so startup can roll back immediately.
            recover_interrupted_db_restore(&db_path).unwrap();
            recover_interrupted_db_restore(&db_path).unwrap();
            let recovered = open_single_connection_sqlite_pool(&db_path, false).await.unwrap();
            opened_pools.push(recovered.clone());
            assert_eq!(sqlx::query_scalar::<_, String>("SELECT value FROM settings WHERE key = 'restore_identity'")
                .fetch_one(&recovered).await.unwrap(), "original");
            recovered.execute("INSERT INTO settings(key, value) VALUES ('after_recovery', 'durable')")
                .await.unwrap();
            checkpoint_sqlite_pool(&recovered).await.unwrap();
            recovered.close().await;
            recover_interrupted_db_restore(&db_path).unwrap();
            let reopened = open_single_connection_sqlite_pool(&db_path, false).await.unwrap();
            opened_pools.push(reopened.clone());
            assert_eq!(sqlx::query_scalar::<_, String>("SELECT value FROM settings WHERE key = 'after_recovery'")
                .fetch_one(&reopened).await.unwrap(), "durable");
            assert!(!marker_path.exists());
            assert!(!rollback_path.exists());
            reopened.close().await;
            fs::copy(&db_path, &rollback_path).unwrap();
            let retry = open_single_connection_sqlite_pool(&db_path, false).await.unwrap();
            opened_pools.push(retry.clone());
            retry.execute("UPDATE settings SET value = 'replacement' WHERE key = 'restore_identity'").await.unwrap();
            checkpoint_sqlite_pool(&retry).await.unwrap();
            retry.close().await;
            persist_restore_marker(&db_path, &rollback_path).unwrap();
            let committed = prepare_replacement_pool(&db_path).await.unwrap();
            opened_pools.push(committed.clone());
            assert!(!marker_path.exists(), "disk commit must precede writable pool publication");
            committed.execute("INSERT INTO settings(key,value) VALUES('after_commit','durable')").await.unwrap();
            checkpoint_sqlite_pool(&committed).await.unwrap();
            committed.close().await;
            // Even if obsolete rollback cleanup is delayed, startup must retain committed writes.
            recover_interrupted_db_restore(&db_path).unwrap();
            let restarted = open_single_connection_sqlite_pool(&db_path, false).await.unwrap();
            opened_pools.push(restarted.clone());
            assert_eq!(sqlx::query_scalar::<_, String>("SELECT value FROM settings WHERE key='restore_identity'")
                .fetch_one(&restarted).await.unwrap(), "replacement");
            assert_eq!(sqlx::query_scalar::<_, String>("SELECT value FROM settings WHERE key='after_commit'")
                .fetch_one(&restarted).await.unwrap(), "durable");
        }).catch_unwind().await;
        for pool in opened_pools {
            pool.close().await;
        }
        let cleanup_path = dir.canonicalize().unwrap();
        assert_eq!(
            cleanup_path.parent(),
            Some(std::env::temp_dir().canonicalize().unwrap().as_path())
        );
        fs::remove_dir_all(&cleanup_path).unwrap();
        assert!(!cleanup_path.exists());
        eprintln!(
            "restore_marker_commit_fixture_removed={}",
            cleanup_path.display()
        );
        if let Err(panic) = outcome {
            std::panic::resume_unwind(panic);
        }
    }

    #[test]
    fn interrupted_database_replacement_restores_the_original_file() {
        let suffix = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("patina-restore-recovery-test-{suffix}"));
        fs::create_dir(&dir).unwrap();
        let db_path = dir.join("patina.db");
        let rollback_path = dir.join(format!(".patina-restore-rollback-{suffix}.db"));
        fs::write(&db_path, b"interrupted candidate").unwrap();
        fs::write(format!("{}-wal", db_path.display()), b"candidate wal").unwrap();
        fs::write(format!("{}-shm", db_path.display()), b"candidate shm").unwrap();
        fs::write(&rollback_path, b"original database").unwrap();
        persist_restore_marker(&db_path, &rollback_path).unwrap();

        recover_interrupted_db_restore(&db_path).unwrap();

        assert_eq!(fs::read(&db_path).unwrap(), b"original database");
        assert!(!rollback_path.exists());
        assert!(!restore_marker_path(&db_path).unwrap().exists());
        assert!(!PathBuf::from(format!("{}-wal", db_path.display())).exists());
        assert!(!PathBuf::from(format!("{}-shm", db_path.display())).exists());
        fs::remove_dir_all(dir).unwrap();
    }

    #[tokio::test]
    async fn interrupted_replacement_recovers_wal_facts_and_rebuilds_the_old_algorithm() {
        let dir =
            std::env::temp_dir().join(format!("patina-sqlite-restore-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&dir).unwrap();
        let db_path = dir.join("patina.db");
        let rollback_path = dir.join(".patina-restore-rollback-original.db");
        let mut opened_pools = Vec::new();
        let outcome = AssertUnwindSafe(async {
            let original = open_single_connection_sqlite_pool(&db_path, true).await.unwrap();
            opened_pools.push(original.clone());
            prepare_pool_schema(&original, &db_path).await.unwrap();
            original.execute(
                "PRAGMA journal_mode = WAL;
                 INSERT INTO sessions(app_name, exe_name, start_time, end_time, duration)
                 VALUES ('Original', 'original.exe', 0, 1000, 1000);",
            ).await.unwrap();
            for _ in 0..10 {
                if !crate::data::activity_read_model::maintain_once(&original).await.unwrap() {
                    break;
                }
            }
            original.execute(
                "UPDATE sessions SET end_time = 2000, duration = 2000;
                 UPDATE read_model_state SET algorithm_version = 1 WHERE model_name = 'activity_hourly';",
            ).await.unwrap();
            checkpoint_sqlite_pool(&original).await.unwrap();
            original.close().await;
            fs::rename(&db_path, &rollback_path).unwrap();

            let candidate = open_single_connection_sqlite_pool(&db_path, true).await.unwrap();
            opened_pools.push(candidate.clone());
            prepare_pool_schema(&candidate, &db_path).await.unwrap();
            candidate.execute(
                "INSERT INTO sessions(app_name, exe_name, start_time, end_time, duration)
                 VALUES ('Interrupted candidate', 'candidate.exe', 0, 9000, 9000);",
            ).await.unwrap();
            candidate.close().await;
            persist_restore_marker(&db_path, &rollback_path).unwrap();
            fs::write(format!("{}-wal", db_path.display()), b"candidate WAL must not be replayed").unwrap();
            fs::write(format!("{}-shm", db_path.display()), b"candidate shared memory").unwrap();

            recover_interrupted_db_restore(&db_path).unwrap();
            recover_interrupted_db_restore(&db_path).unwrap();
            assert!(!rollback_path.exists());
            assert!(!restore_marker_path(&db_path).unwrap().exists());
            assert!(!PathBuf::from(format!("{}-wal", db_path.display())).exists());
            assert!(!PathBuf::from(format!("{}-shm", db_path.display())).exists());

            let recovered = open_single_connection_sqlite_pool(&db_path, false).await.unwrap();
            opened_pools.push(recovered.clone());
            prepare_pool_schema(&recovered, &db_path).await.unwrap();
            let fact = sqlx::query("SELECT exe_name, duration FROM sessions").fetch_one(&recovered).await.unwrap();
            assert_eq!(fact.get::<String, _>("exe_name"), "original.exe");
            assert_eq!(fact.get::<i64, _>("duration"), 2000);
            let mut settled = false;
            for _ in 0..10 {
                if !crate::data::activity_read_model::maintain_once(&recovered).await.unwrap() {
                    settled = true;
                    break;
                }
            }
            assert!(settled);
            let state = sqlx::query(
                "SELECT state, algorithm_version,
                   (SELECT SUM(effective_duration_ms) FROM activity_hourly_effective) duration,
                   (SELECT COUNT(*) FROM activity_summary_dirty_ranges) dirty_ranges
                 FROM read_model_state WHERE model_name = 'activity_hourly'",
            ).fetch_one(&recovered).await.unwrap();
            assert_eq!(state.get::<String, _>("state"), "ready");
            assert_eq!(state.get::<i64, _>("algorithm_version"), 2);
            assert_eq!(state.get::<i64, _>("duration"), 2000);
            assert_eq!(state.get::<i64, _>("dirty_ranges"), 0);
        }).catch_unwind().await;
        for pool in opened_pools {
            pool.close().await;
        }
        assert_eq!(db_path.parent(), Some(dir.as_path()));
        let cleanup_path = dir.canonicalize().unwrap();
        assert!(cleanup_path.starts_with(std::env::temp_dir().canonicalize().unwrap()));
        fs::remove_dir_all(&cleanup_path).unwrap();
        if let Err(panic) = outcome {
            std::panic::resume_unwind(panic);
        }
    }
}
