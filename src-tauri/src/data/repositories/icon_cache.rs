use crate::domain::backup::BackupIconCache;
use sqlx::{Pool, Row, Sqlite, Transaction};

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

pub async fn is_icon_cached(pool: &Pool<Sqlite>, exe_name: &str) -> Result<bool, sqlx::Error> {
    Ok(
        sqlx::query("SELECT exe_name FROM icon_cache WHERE exe_name = ? LIMIT 1")
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
