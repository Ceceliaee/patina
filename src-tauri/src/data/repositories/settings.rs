use crate::domain::backup::BackupSetting;
use sqlx::{Pool, Row, Sqlite, Transaction};
#[cfg(test)]
mod read_tests;

#[derive(Debug, serde::Serialize, sqlx::FromRow)]
pub struct SettingRow {
    pub key: String,
    pub value: String,
}

pub async fn load_rows(
    pool: &Pool<Sqlite>,
    key: Option<&str>,
    key_prefix: Option<&str>,
) -> Result<Vec<SettingRow>, sqlx::Error> {
    match (key, key_prefix) {
        (Some(_), Some(_)) => Err(sqlx::Error::Protocol(
            "choose a setting key or prefix, not both".into(),
        )),
        (Some(key), None) => {
            sqlx::query_as("SELECT key, value FROM settings WHERE key = ?")
                .bind(key)
                .fetch_all(pool)
                .await
        }
        (None, Some(prefix)) => {
            let pattern = format!(
                "{}%",
                prefix
                    .replace('\\', "\\\\")
                    .replace('%', "\\%")
                    .replace('_', "\\_")
            );
            sqlx::query_as(
                "SELECT key, value FROM settings WHERE key LIKE ? ESCAPE '\\' ORDER BY key",
            )
            .bind(pattern)
            .fetch_all(pool)
            .await
        }
        (None, None) => {
            sqlx::query_as("SELECT key, value FROM settings ORDER BY key")
                .fetch_all(pool)
                .await
        }
    }
}

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
        if setting.key == super::remote_backup_settings::WEBDAV_CREDENTIAL_REF_KEY
            || setting.key == super::remote_backup_settings::WEBDAV_SAVE_ID_KEY
        {
            continue;
        }
        sqlx::query("INSERT INTO settings (key, value) VALUES (?, ?)")
            .bind(&setting.key)
            .bind(&setting.value)
            .execute(&mut **tx)
            .await
            .map_err(|error| format!("failed to restore settings: {error}"))?;
    }

    super::app_links::validate_in_tx(tx).await?;
    super::web_links::load_in_tx(tx).await?;
    Ok(())
}

pub async fn insert_missing_for_restore(
    tx: &mut Transaction<'_, Sqlite>,
    settings: &[BackupSetting],
) -> Result<(), String> {
    // A merge may add a source WebDAV config, but cannot grant access to a
    // destination installation's legacy credential. Existing pairings are retained.
    let has_destination_config: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM settings WHERE key=?)")
            .bind(super::remote_backup_settings::WEBDAV_BACKUP_URL_KEY)
            .fetch_one(&mut **tx)
            .await
            .map_err(|e| e.to_string())?;
    if !has_destination_config
        && settings
            .iter()
            .any(|setting| setting.key == super::remote_backup_settings::WEBDAV_BACKUP_URL_KEY)
    {
        super::remote_backup_settings::detach_for_restore(tx).await?;
    }
    for setting in settings {
        if setting.key == super::remote_backup_settings::WEBDAV_CREDENTIAL_REF_KEY
            || setting.key == super::remote_backup_settings::WEBDAV_SAVE_ID_KEY
        {
            continue;
        }
        sqlx::query("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)")
            .bind(&setting.key)
            .bind(&setting.value)
            .execute(&mut **tx)
            .await
            .map_err(|error| format!("failed to merge restore settings: {error}"))?;
    }

    super::app_links::validate_in_tx(tx).await?;
    super::web_links::load_in_tx(tx).await?;
    Ok(())
}
