use sqlx::{Pool, Sqlite};

const APP_OVERRIDE_KEY_PREFIX: &str = "__app_override::";
const WEB_DOMAIN_OVERRIDE_KEY_PREFIX: &str = "__web_domain_override::";
const CATEGORY_COLOR_OVERRIDE_KEY_PREFIX: &str = "__category_color_override::";
const CATEGORY_LABEL_OVERRIDE_KEY_PREFIX: &str = "__category_label_override::";
const CATEGORY_DEFAULT_COLOR_ASSIGNMENT_KEY_PREFIX: &str = "__category_default_color_assignment::";
const CATEGORY_DEFINITION_KEY_PREFIX: &str = "__custom_category::";
const DELETED_CATEGORY_KEY_PREFIX: &str = "__deleted_category::";
const MIGRATION_KEY_PREFIX: &str = "__classification_manual_confirmation_migration::";
const MAX_SETTING_KEY_LEN: usize = 256;
const MAX_SETTING_VALUE_LEN: usize = 4096;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ClassificationSettingMutation {
    pub key: String,
    pub value: Option<String>,
}

pub async fn commit_classification_setting_mutations(
    pool: &Pool<Sqlite>,
    mutations: &[ClassificationSettingMutation],
) -> Result<(), String> {
    if mutations.is_empty() {
        return Ok(());
    }

    let mut tx = pool
        .begin()
        .await
        .map_err(|error| format!("failed to start classification settings transaction: {error}"))?;

    for mutation in mutations {
        validate_classification_setting_mutation(mutation)?;
        if let Some(value) = &mutation.value {
            sqlx::query(
                "INSERT INTO settings (key, value) VALUES (?, ?)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            )
            .bind(&mutation.key)
            .bind(value)
            .execute(&mut *tx)
            .await
            .map_err(|error| format!("failed to save classification setting: {error}"))?;
        } else {
            sqlx::query("DELETE FROM settings WHERE key = ?")
                .bind(&mutation.key)
                .execute(&mut *tx)
                .await
                .map_err(|error| format!("failed to delete classification setting: {error}"))?;
        }
    }

    tx.commit().await.map_err(|error| {
        format!("failed to commit classification settings transaction: {error}")
    })?;

    Ok(())
}

fn validate_classification_setting_mutation(
    mutation: &ClassificationSettingMutation,
) -> Result<(), String> {
    if !is_allowed_classification_setting_key(&mutation.key) {
        return Err(format!(
            "invalid classification setting key `{}`",
            mutation.key
        ));
    }

    if let Some(value) = &mutation.value {
        if value.len() > MAX_SETTING_VALUE_LEN {
            return Err(format!(
                "classification setting value is too large for key `{}`",
                mutation.key
            ));
        }

        if mutation.key.starts_with(APP_OVERRIDE_KEY_PREFIX)
            || mutation.key.starts_with(WEB_DOMAIN_OVERRIDE_KEY_PREFIX)
        {
            serde_json::from_str::<serde_json::Value>(value).map_err(|error| {
                format!(
                    "invalid classification override value for key `{}`: {error}",
                    mutation.key
                )
            })?;
        }
    }

    Ok(())
}

fn is_allowed_classification_setting_key(key: &str) -> bool {
    if key.is_empty() || key.len() > MAX_SETTING_KEY_LEN {
        return false;
    }

    [
        APP_OVERRIDE_KEY_PREFIX,
        WEB_DOMAIN_OVERRIDE_KEY_PREFIX,
        CATEGORY_COLOR_OVERRIDE_KEY_PREFIX,
        CATEGORY_LABEL_OVERRIDE_KEY_PREFIX,
        CATEGORY_DEFAULT_COLOR_ASSIGNMENT_KEY_PREFIX,
        CATEGORY_DEFINITION_KEY_PREFIX,
        DELETED_CATEGORY_KEY_PREFIX,
        MIGRATION_KEY_PREFIX,
    ]
    .iter()
    .any(|prefix| key.starts_with(prefix) && key.len() > prefix.len())
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

    async fn load_setting(pool: &SqlitePool, key: &str) -> Option<String> {
        sqlx::query("SELECT value FROM settings WHERE key = ? LIMIT 1")
            .bind(key)
            .fetch_optional(pool)
            .await
            .unwrap()
            .and_then(|row| row.try_get::<String, _>("value").ok())
    }

    #[test]
    fn commit_classification_setting_mutations_upserts_and_deletes_in_one_transaction() {
        tauri::async_runtime::block_on(async {
            let pool = setup_test_db().await;
            let key = "__app_override::chrome.exe";

            commit_classification_setting_mutations(
                &pool,
                &[ClassificationSettingMutation {
                    key: key.to_string(),
                    value: Some(r#"{"enabled":true,"displayName":"Work"}"#.to_string()),
                }],
            )
            .await
            .unwrap();

            assert_eq!(
                load_setting(&pool, key).await,
                Some(r#"{"enabled":true,"displayName":"Work"}"#.to_string())
            );

            commit_classification_setting_mutations(
                &pool,
                &[ClassificationSettingMutation {
                    key: key.to_string(),
                    value: None,
                }],
            )
            .await
            .unwrap();

            assert_eq!(load_setting(&pool, key).await, None);
        });
    }

    #[test]
    fn commit_classification_setting_mutations_accepts_manual_confirmation_migration_marker() {
        tauri::async_runtime::block_on(async {
            let pool = setup_test_db().await;
            let key = "__classification_manual_confirmation_migration::v1";

            commit_classification_setting_mutations(
                &pool,
                &[ClassificationSettingMutation {
                    key: key.to_string(),
                    value: Some("1780226815860".to_string()),
                }],
            )
            .await
            .unwrap();

            assert_eq!(
                load_setting(&pool, key).await,
                Some("1780226815860".to_string())
            );
        });
    }

    #[test]
    fn commit_classification_setting_mutations_accepts_category_label_override() {
        tauri::async_runtime::block_on(async {
            let pool = setup_test_db().await;
            let key = "__category_label_override::development";

            commit_classification_setting_mutations(
                &pool,
                &[ClassificationSettingMutation {
                    key: key.to_string(),
                    value: Some("Dev Tools".to_string()),
                }],
            )
            .await
            .unwrap();

            assert_eq!(
                load_setting(&pool, key).await,
                Some("Dev Tools".to_string())
            );
        });
    }

    #[test]
    fn commit_classification_setting_mutations_rolls_back_invalid_batches() {
        tauri::async_runtime::block_on(async {
            let pool = setup_test_db().await;
            let good_key = "__category_color_override::video";

            let result = commit_classification_setting_mutations(
                &pool,
                &[
                    ClassificationSettingMutation {
                        key: good_key.to_string(),
                        value: Some("#FF669A".to_string()),
                    },
                    ClassificationSettingMutation {
                        key: "tracking_paused".to_string(),
                        value: Some("1".to_string()),
                    },
                ],
            )
            .await;

            assert!(result.is_err());
            assert_eq!(load_setting(&pool, good_key).await, None);
        });
    }
}
