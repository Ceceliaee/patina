use crate::domain::backup::BackupIconCache;
use sqlx::{Pool, Row, Sqlite, Transaction};
use std::sync::Arc;
mod lifecycle;
pub(crate) use lifecycle::acquire_icon_cache_maintenance;

// The case-sensitive primary key can cover name matching, then locate just one data row.
const ICON_CACHE_STATE_QUERY: &str = "SELECT last_updated FROM icon_cache WHERE exe_name = (
    SELECT exe_name FROM icon_cache WHERE exe_name = ? COLLATE NOCASE LIMIT 1
)";

fn icon_payload(value: &str) -> &str {
    value
        .trim()
        .strip_prefix("data:image/png;base64,")
        .unwrap_or(value.trim())
}

pub(crate) struct IconCacheSnapshot {
    pub last_updated: Option<Option<i64>>,
    pool: Pool<Sqlite>,
    exe_name: String,
    epoch: u64,
    lifecycle: Arc<tokio::sync::Mutex<u64>>,
}

pub(crate) async fn read_icon_cache(
    pool: Pool<Sqlite>,
    exe_name: &str,
) -> Result<IconCacheSnapshot, sqlx::Error> {
    let lifecycle = lifecycle::state(&pool);
    let guard = lifecycle.lock().await;
    let epoch = *guard;
    let last_updated = sqlx::query_scalar::<_, Option<i64>>(ICON_CACHE_STATE_QUERY)
        .bind(exe_name.trim())
        .fetch_optional(&pool)
        .await?;
    drop(guard);
    Ok(IconCacheSnapshot {
        last_updated,
        pool,
        exe_name: exe_name.trim().into(),
        epoch,
        lifecycle,
    })
}

impl IconCacheSnapshot {
    pub async fn confirm(self, icon: &str, checked_at: i64) -> Result<bool, sqlx::Error> {
        // Keep the original pool: a restore must never redirect an old extraction into its replacement.
        let guard = self.lifecycle.lock().await;
        if self.epoch != *guard {
            return Ok(false);
        }
        let mut tx = self.pool.begin().await?;
        let current: Option<(String, Option<i64>)> = sqlx::query_as(
            "SELECT icon_base64, last_updated FROM icon_cache WHERE exe_name = ? COLLATE NOCASE LIMIT 1",
        ).bind(&self.exe_name).fetch_optional(&mut *tx).await?;
        if current.as_ref().map(|(_, time)| *time) != self.last_updated {
            return Ok(false);
        }
        let changed = current
            .as_ref()
            .is_none_or(|(old, _)| icon_payload(old) != icon_payload(icon));
        if current.is_some() {
            if changed {
                sqlx::query("UPDATE icon_cache SET icon_base64 = ?, last_updated = ? WHERE exe_name = ? COLLATE NOCASE")
                    .bind(icon).bind(checked_at).bind(&self.exe_name).execute(&mut *tx).await?;
            } else {
                sqlx::query(
                    "UPDATE icon_cache SET last_updated = ? WHERE exe_name = ? COLLATE NOCASE",
                )
                .bind(checked_at)
                .bind(&self.exe_name)
                .execute(&mut *tx)
                .await?;
            }
        } else {
            sqlx::query(
                "INSERT INTO icon_cache (exe_name, icon_base64, last_updated) VALUES (?, ?, ?)",
            )
            .bind(&self.exe_name)
            .bind(icon)
            .bind(checked_at)
            .execute(&mut *tx)
            .await?;
        }
        tx.commit().await?;
        Ok(changed)
    }
}

pub async fn fetch_icon_for_exe(
    pool: &Pool<Sqlite>,
    exe_name: &str,
) -> Result<Option<String>, String> {
    let trimmed = exe_name.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }

    let row =
        sqlx::query("SELECT icon_base64 FROM icon_cache WHERE exe_name = ? COLLATE NOCASE LIMIT 1")
            .bind(trimmed)
            .fetch_optional(pool)
            .await
            .map_err(|error| format!("failed to read icon cache entry: {error}"))?;

    Ok(row.map(|row| row.get("icon_base64")))
}

pub async fn fetch_all_for_backup(pool: &Pool<Sqlite>) -> Result<Vec<BackupIconCache>, String> {
    let rows = sqlx::query("SELECT exe_name, icon_base64, last_updated FROM icon_cache")
        .fetch_all(pool)
        .await
        .map_err(|error| format!("failed to read icon cache for backup: {error}"))?;

    Ok(rows
        .into_iter()
        .map(|row| BackupIconCache {
            exe_name: row.get("exe_name"),
            icon_base64: row.get("icon_base64"),
            last_updated: row.get("last_updated"),
        })
        .collect())
}

pub async fn clear_for_restore(tx: &mut Transaction<'_, Sqlite>) -> Result<(), String> {
    sqlx::query("DELETE FROM icon_cache")
        .execute(&mut **tx)
        .await
        .map_err(|error| format!("failed to clear icon cache before restore: {error}"))?;
    Ok(())
}

pub async fn insert_for_restore(
    tx: &mut Transaction<'_, Sqlite>,
    icon_cache: &[BackupIconCache],
) -> Result<(), String> {
    for icon in icon_cache {
        sqlx::query(
            "INSERT INTO icon_cache (exe_name, icon_base64, last_updated) VALUES (?, ?, ?)",
        )
        .bind(&icon.exe_name)
        .bind(&icon.icon_base64)
        .bind(icon.last_updated)
        .execute(&mut **tx)
        .await
        .map_err(|error| format!("failed to restore icon cache: {error}"))?;
    }

    Ok(())
}

pub async fn insert_missing_for_restore(
    tx: &mut Transaction<'_, Sqlite>,
    icon_cache: &[BackupIconCache],
) -> Result<(), String> {
    for icon in icon_cache {
        sqlx::query(
            "INSERT OR IGNORE INTO icon_cache (exe_name, icon_base64, last_updated) VALUES (?, ?, ?)",
        )
        .bind(&icon.exe_name)
        .bind(&icon.icon_base64)
        .bind(icon.last_updated)
        .execute(&mut **tx)
        .await
        .map_err(|error| format!("failed to merge restore icon cache: {error}"))?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::data::schema as db_schema;
    use sqlx::{Executor, Row, SqlitePool};

    async fn setup_test_db() -> SqlitePool {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        pool.execute(db_schema::CURRENT_BASELINE_SCHEMA_SQL)
            .await
            .unwrap();
        pool
    }

    #[test]
    fn icon_cache_reads_entries_case_insensitively() {
        tauri::async_runtime::block_on(async {
            let pool = setup_test_db().await;
            sqlx::query(
                "INSERT INTO icon_cache (exe_name, icon_base64, last_updated) VALUES (?, ?, ?)",
            )
            .bind("Dism++x64.exe")
            .bind("icon-dism")
            .bind(1_i64)
            .execute(&pool)
            .await
            .unwrap();

            assert_eq!(
                fetch_icon_for_exe(&pool, "dism++x64.exe").await.unwrap(),
                Some("icon-dism".to_string())
            );
            assert_eq!(
                read_icon_cache(pool.clone(), "DISM++X64.EXE")
                    .await
                    .unwrap()
                    .last_updated,
                Some(Some(1))
            );
        });
    }

    #[test]
    fn upsert_icon_updates_existing_case_variant_without_duplicate_rows() {
        tauri::async_runtime::block_on(async {
            let pool = setup_test_db().await;
            sqlx::query(
                "INSERT INTO icon_cache (exe_name, icon_base64, last_updated) VALUES (?, ?, ?)",
            )
            .bind("MinerU.exe")
            .bind("icon-old")
            .bind(1_i64)
            .execute(&pool)
            .await
            .unwrap();

            read_icon_cache(pool.clone(), "mineru.exe")
                .await
                .unwrap()
                .confirm("icon-new", 2)
                .await
                .unwrap();

            let count = sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*) FROM icon_cache WHERE exe_name = ? COLLATE NOCASE",
            )
            .bind("MINERU.EXE")
            .fetch_one(&pool)
            .await
            .unwrap();
            assert_eq!(count, 1);

            let row = sqlx::query(
                "SELECT exe_name, icon_base64, last_updated FROM icon_cache
                 WHERE exe_name = ? COLLATE NOCASE",
            )
            .bind("mineru.exe")
            .fetch_one(&pool)
            .await
            .unwrap();
            assert_eq!(row.get::<String, _>("exe_name"), "MinerU.exe");
            assert_eq!(row.get::<String, _>("icon_base64"), "icon-new");
            assert_eq!(row.get::<i64, _>("last_updated"), 2);
        });
    }
    #[test]
    fn confirmation_does_not_rewrite_equal_content_or_overwrite_a_newer_snapshot() {
        tauri::async_runtime::block_on(async {
            let pool = setup_test_db().await;
            sqlx::query("INSERT INTO icon_cache VALUES ('app.exe', 'old', NULL)")
                .execute(&pool)
                .await
                .unwrap();
            // A content UPDATE is observably different from a timestamp-only confirmation.
            pool.execute("CREATE TRIGGER forbid_same_icon UPDATE OF icon_base64 ON icon_cache WHEN NEW.icon_base64 = OLD.icon_base64 BEGIN SELECT RAISE(ABORT, 'unnecessary content write'); END;").await.unwrap();
            let stale = read_icon_cache(pool.clone(), "app.exe").await.unwrap();
            assert!(!read_icon_cache(pool.clone(), "APP.EXE")
                .await
                .unwrap()
                .confirm("old", 100)
                .await
                .unwrap());
            assert!(!stale.confirm("obsolete", 101).await.unwrap());
            assert_eq!(
                fetch_icon_for_exe(&pool, "app.exe")
                    .await
                    .unwrap()
                    .as_deref(),
                Some("old")
            );
            assert_eq!(
                read_icon_cache(pool.clone(), "app.exe")
                    .await
                    .unwrap()
                    .last_updated,
                Some(Some(100))
            );
            pool.close().await;
        });
    }

    #[test]
    fn maintenance_invalidates_extractions_without_holding_a_database_lock_during_extraction() {
        tauri::async_runtime::block_on(async {
            let pool = setup_test_db().await;
            sqlx::query("INSERT INTO icon_cache VALUES ('app.exe', 'old', 1)")
                .execute(&pool)
                .await
                .unwrap();
            let existing = read_icon_cache(pool.clone(), "app.exe").await.unwrap();
            let missing = read_icon_cache(pool.clone(), "missing.exe").await.unwrap();
            {
                let _maintenance = acquire_icon_cache_maintenance(&pool).await;
                sqlx::query("DELETE FROM icon_cache")
                    .execute(&pool)
                    .await
                    .unwrap();
            }
            assert!(!existing.confirm("obsolete", 100).await.unwrap());
            assert!(!missing.confirm("obsolete", 100).await.unwrap());
            assert_eq!(
                sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM icon_cache")
                    .fetch_one(&pool)
                    .await
                    .unwrap(),
                0
            );
            let old_pool = read_icon_cache(pool.clone(), "app.exe").await.unwrap();
            pool.close().await;
            assert!(old_pool.confirm("obsolete", 100).await.is_err());
        });
    }

    #[test]
    fn write_failure_does_not_advance_confirmation_time() {
        tauri::async_runtime::block_on(async {
            let pool = setup_test_db().await;
            sqlx::query("INSERT INTO icon_cache VALUES ('app.exe', 'old', 1)")
                .execute(&pool)
                .await
                .unwrap();
            pool.execute("CREATE TRIGGER fail_icon_write BEFORE UPDATE ON icon_cache BEGIN SELECT RAISE(ABORT, 'fixture write failure'); END;").await.unwrap();
            assert!(read_icon_cache(pool.clone(), "app.exe")
                .await
                .unwrap()
                .confirm("new", 100)
                .await
                .is_err());
            let row: (String, i64) =
                sqlx::query_as("SELECT icon_base64, last_updated FROM icon_cache")
                    .fetch_one(&pool)
                    .await
                    .unwrap();
            assert_eq!(row, ("old".into(), 1));
            pool.close().await;
        });
    }
    #[test]
    fn confirmation_accepts_equivalent_data_uri_payloads() {
        tauri::async_runtime::block_on(async {
            let pool = setup_test_db().await;
            sqlx::query("INSERT INTO icon_cache VALUES ('app.exe', 'aWNvbg==', 1)")
                .execute(&pool)
                .await
                .unwrap();
            assert!(!read_icon_cache(pool.clone(), "app.exe")
                .await
                .unwrap()
                .confirm("data:image/png;base64,aWNvbg==", 100)
                .await
                .unwrap());
            assert_eq!(
                fetch_icon_for_exe(&pool, "app.exe")
                    .await
                    .unwrap()
                    .as_deref(),
                Some("aWNvbg==")
            );
            pool.close().await;
        });
    }
    #[test]
    fn freshness_query_uses_primary_key_lookup_without_scanning_icon_payload_rows() {
        tauri::async_runtime::block_on(async {
            let pool = setup_test_db().await;
            let plan = sqlx::query(&format!("EXPLAIN QUERY PLAN {ICON_CACHE_STATE_QUERY}"))
                .bind("app.exe")
                .fetch_all(&pool)
                .await
                .unwrap();
            let details: Vec<String> = plan.iter().map(|row| row.get("detail")).collect();
            assert!(
                details
                    .iter()
                    .any(|detail| detail.contains("SEARCH icon_cache USING INDEX")),
                "{details:?}"
            );
            assert!(
                !details.iter().any(|detail| detail == "SCAN icon_cache"),
                "{details:?}"
            );
            pool.close().await;
        });
    }
}
