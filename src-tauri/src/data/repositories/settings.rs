use crate::domain::backup::BackupSetting;
use sqlx::{Pool, Row, Sqlite, Transaction};

pub async fn fetch_all_for_backup(pool: &Pool<Sqlite>) -> Result<Vec<BackupSetting>, String> {
    let rows = sqlx::query("SELECT key, value FROM settings ORDER BY key ASC")
        .fetch_all(pool)
        .await
        .map_err(|error| format!("failed to read settings for backup: {error}"))?;

    Ok(rows
        .into_iter()
        .map(|row| BackupSetting {
            key: row.get("key"),
            value: row.get("value"),
        })
        .collect())
}

pub async fn clear_for_restore(tx: &mut Transaction<'_, Sqlite>) -> Result<(), String> {
    sqlx::query("DELETE FROM settings")
        .execute(&mut **tx)
        .await
        .map_err(|error| format!("failed to clear settings before restore: {error}"))?;
    Ok(())
}

pub async fn insert_for_restore(
    tx: &mut Transaction<'_, Sqlite>,
    settings: &[BackupSetting],
) -> Result<(), String> {
    for setting in settings {
        sqlx::query("INSERT INTO settings (key, value) VALUES (?, ?)")
            .bind(&setting.key)
            .bind(&setting.value)
            .execute(&mut **tx)
            .await
            .map_err(|error| format!("failed to restore settings: {error}"))?;
    }

    super::app_links::validate_in_tx(tx).await?;
    Ok(())
}

pub async fn insert_missing_for_restore(
    tx: &mut Transaction<'_, Sqlite>,
    settings: &[BackupSetting],
) -> Result<(), String> {
    for setting in settings {
        sqlx::query("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)")
            .bind(&setting.key)
            .bind(&setting.value)
            .execute(&mut **tx)
            .await
            .map_err(|error| format!("failed to merge restore settings: {error}"))?;
    }

    super::app_links::validate_in_tx(tx).await?;
    Ok(())
}
