use crate::data::sqlite_error::SqliteOperationError;
use serde::Deserialize;
use sqlx::{Row, Sqlite, Transaction};
use std::collections::HashMap;

pub const APP_LINK_PREFIX: &str = "__app_link::";

pub async fn is_linked_identity(
    tx: &mut Transaction<'_, Sqlite>,
    key: &str,
) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM settings WHERE substr(key,1,12)='__app_link::' AND (substr(key,13)=? OR value=?))")
        .bind(key).bind(key).fetch_one(&mut **tx).await
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct LinkChange {
    parent: Option<String>,
    previous: Option<String>,
}

fn invalid(message: impl Into<String>) -> SqliteOperationError {
    SqliteOperationError::invalid_input("save application association", message)
}

fn valid_identity(key: &str) -> bool {
    !key.is_empty()
        && key.trim() == key
        && key.to_lowercase() == key
        && key.trim_matches('"') == key
        && !key.chars().any(char::is_control)
        && key.len() + APP_LINK_PREFIX.len() <= 256
        && crate::domain::tracking::resolve_app_override_executable(key).is_some_and(|canonical| {
            canonical == key || (!key.ends_with(".exe") && canonical == format!("{key}.exe"))
        })
}

pub async fn apply_change(
    tx: &mut Transaction<'_, Sqlite>,
    key: &str,
    value: Option<&str>,
) -> Result<(), SqliteOperationError> {
    let member = key
        .strip_prefix(APP_LINK_PREFIX)
        .ok_or_else(|| invalid("invalid member key"))?;
    if !valid_identity(member) {
        return Err(invalid("invalid member identity"));
    }
    let change: LinkChange =
        serde_json::from_str(value.ok_or_else(|| invalid("missing association change"))?)
            .map_err(|_| invalid("invalid association change"))?;
    if change
        .parent
        .as_deref()
        .is_some_and(|parent| !valid_identity(parent))
    {
        return Err(invalid("invalid parent identity"));
    }
    let current: Option<String> = sqlx::query_scalar("SELECT value FROM settings WHERE key = ?")
        .bind(key)
        .fetch_optional(&mut **tx)
        .await
        .map_err(|e| SqliteOperationError::from_sqlx("read application association", e))?;
    if current != change.previous && current != change.parent {
        return Err(invalid(
            "application association changed; reload before saving",
        ));
    }
    if let Some(parent) = change.parent {
        sqlx::query("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
            .bind(key).bind(parent).execute(&mut **tx).await
            .map_err(|e| SqliteOperationError::from_sqlx("save application association", e))?;
    } else {
        sqlx::query("DELETE FROM settings WHERE key=?")
            .bind(key)
            .execute(&mut **tx)
            .await
            .map_err(|e| SqliteOperationError::from_sqlx("remove application association", e))?;
    }
    Ok(())
}

pub async fn validate_in_tx(tx: &mut Transaction<'_, Sqlite>) -> Result<(), String> {
    let rows = sqlx::query("SELECT key,value FROM settings WHERE substr(key,1,12)='__app_link::'")
        .fetch_all(&mut **tx)
        .await
        .map_err(|e| format!("read application associations: {e}"))?;
    let links: HashMap<String, String> = rows
        .into_iter()
        .map(|row| {
            let key: String = row.get("key");
            (key[APP_LINK_PREFIX.len()..].to_string(), row.get("value"))
        })
        .collect();
    for (member, parent) in &links {
        if !valid_identity(member)
            || !valid_identity(parent)
            || member == parent
            || links.contains_key(parent)
        {
            return Err("invalid application associations: self-reference, nested association or invalid identity".into());
        }
    }
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::data::repositories::classification_settings::{
        commit_classification_setting_mutations, ClassificationSettingMutation,
    };
    use crate::domain::backup::BackupSetting;
    use sqlx::sqlite::SqlitePoolOptions;

    fn change(
        member: &str,
        parent: Option<&str>,
        previous: Option<&str>,
    ) -> ClassificationSettingMutation {
        ClassificationSettingMutation {
            key: format!("{APP_LINK_PREFIX}{member}"),
            value: Some(serde_json::json!({"parent":parent,"previous":previous}).to_string()),
        }
    }

    #[test]
    fn app_links_transactions_conflicts_and_restore() {
        tauri::async_runtime::block_on(async {
            let pool = SqlitePoolOptions::new()
                .max_connections(1)
                .connect("sqlite::memory:")
                .await
                .unwrap();
            sqlx::query("CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT NOT NULL)")
                .execute(&pool)
                .await
                .unwrap();
            let initial = change("b.exe", Some("a.exe"), None);
            commit_classification_setting_mutations(&pool, &[initial.clone()])
                .await
                .unwrap();
            commit_classification_setting_mutations(&pool, &[initial])
                .await
                .unwrap();
            assert!(commit_classification_setting_mutations(
                &pool,
                &[change("b.exe", Some("c.exe"), None)]
            )
            .await
            .is_err());
            assert!(commit_classification_setting_mutations(
                &pool,
                &[
                    change("c.exe", Some("d.exe"), None),
                    change("a.exe", Some("b.exe"), None),
                ]
            )
            .await
            .is_err());
            let rows: Vec<(String, String)> = sqlx::query_as("SELECT key,value FROM settings")
                .fetch_all(&pool)
                .await
                .unwrap();
            assert_eq!(
                rows,
                vec![(format!("{APP_LINK_PREFIX}b.exe"), "a.exe".to_string())]
            );
            let mut tx = pool.begin().await.unwrap();
            assert!(
                crate::data::repositories::settings::insert_missing_for_restore(
                    &mut tx,
                    &[BackupSetting {
                        key: format!("{APP_LINK_PREFIX}a.exe"),
                        value: "b.exe".into()
                    },]
                )
                .await
                .is_err()
            );
            tx.rollback().await.unwrap();
            let mut tx = pool.begin().await.unwrap();
            crate::data::repositories::settings::insert_missing_for_restore(
                &mut tx,
                &[BackupSetting {
                    key: format!("{APP_LINK_PREFIX}b.exe"),
                    value: "c.exe".into(),
                }],
            )
            .await
            .unwrap();
            tx.commit().await.unwrap();
            let parent: String =
                sqlx::query_scalar("SELECT value FROM settings WHERE key='__app_link::b.exe'")
                    .fetch_one(&pool)
                    .await
                    .unwrap();
            assert_eq!(parent, "a.exe");
            commit_classification_setting_mutations(&pool, &[change("b.exe", None, Some("a.exe"))])
                .await
                .unwrap();
            let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM settings")
                .fetch_one(&pool)
                .await
                .unwrap();
            assert_eq!(count, 0);
        });
    }
}
