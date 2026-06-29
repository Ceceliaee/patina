use crate::domain::backup::BackupIconCache;
use sqlx::{Pool, Row, Sqlite, Transaction};
use std::collections::HashMap;

pub async fn fetch_icon_map(pool: &Pool<Sqlite>) -> Result<HashMap<String, String>, String> {
    let rows = sqlx::query("SELECT exe_name, icon_base64 FROM icon_cache")
        .fetch_all(pool)
        .await
        .map_err(|error| format!("failed to read icon cache map: {error}"))?;

    let mut map = HashMap::new();
    for row in rows {
        let exe_name: String = row.get("exe_name");
        let icon_base64: String = row.get("icon_base64");
        if !exe_name.trim().is_empty() {
            map.insert(exe_name, icon_base64);
        }
    }

    Ok(map)
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

pub async fn is_icon_cached(pool: &Pool<Sqlite>, exe_name: &str) -> Result<bool, sqlx::Error> {
    Ok(
        sqlx::query("SELECT exe_name FROM icon_cache WHERE exe_name = ? COLLATE NOCASE LIMIT 1")
            .bind(exe_name)
            .fetch_optional(pool)
            .await?
            .is_some(),
    )
}

pub async fn upsert_icon(
    pool: &Pool<Sqlite>,
    exe_name: &str,
    icon_base64: &str,
    last_updated: i64,
) -> Result<(), sqlx::Error> {
    let update_result = sqlx::query(
        "UPDATE icon_cache
         SET icon_base64 = ?,
             last_updated = ?
         WHERE exe_name = ? COLLATE NOCASE",
    )
    .bind(icon_base64)
    .bind(last_updated)
    .bind(exe_name)
    .execute(pool)
    .await?;

    if update_result.rows_affected() > 0 {
        return Ok(());
    }

    sqlx::query(
        "INSERT INTO icon_cache (exe_name, icon_base64, last_updated)
         VALUES (?, ?, ?)
         ON CONFLICT(exe_name) DO UPDATE
         SET icon_base64 = excluded.icon_base64,
             last_updated = excluded.last_updated",
    )
    .bind(exe_name)
    .bind(icon_base64)
    .bind(last_updated)
    .execute(pool)
    .await?;

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
            assert!(is_icon_cached(&pool, "DISM++X64.EXE").await.unwrap());
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

            upsert_icon(&pool, "mineru.exe", "icon-new", 2_i64)
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
}
