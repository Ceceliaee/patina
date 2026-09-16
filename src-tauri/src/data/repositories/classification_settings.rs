use crate::data::sqlite_error::SqliteOperationError;
use crate::domain::activity_read_model::{
    resolve_activity_precedence, ActivityOrigin, OwnedActivityRange,
};
use crate::domain::classification::{
    ClassificationSnapshot, CATEGORY_COLOR_OVERRIDE_KEY_PREFIX, CATEGORY_DEFINITION_KEY_PREFIX,
    CATEGORY_LABEL_OVERRIDE_KEY_PREFIX, DELETED_CATEGORY_KEY_PREFIX,
};
pub use crate::domain::classification::{APP_OVERRIDE_KEY_PREFIX, WEB_DOMAIN_OVERRIDE_KEY_PREFIX};
use sqlx::{Pool, Row, Sqlite, Transaction};
use std::collections::HashMap;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LegacyClassificationApp {
    pub exe_name: String,
    pub app_name: String,
}

pub async fn load_legacy_classification_apps(
    pool: &Pool<Sqlite>,
    now_ms: i64,
) -> Result<Vec<LegacyClassificationApp>, String> {
    if !(0..=9_007_199_254_740_991).contains(&now_ms) {
        return Err("invalid legacy classification timestamp".to_string());
    }
    let rows = sqlx::query(
        "SELECT origin, exe_name, app_name, start_time, effective_end_time, capacity_end_time
         FROM (
           SELECT id AS record_id, 'native' AS origin, exe_name, app_name, start_time,
                  COALESCE(end_time, ?) AS effective_end_time, NULL AS capacity_end_time
           FROM sessions WHERE start_time < ? AND COALESCE(end_time, ?) > 0
           UNION ALL
           SELECT id, 'import_exact', exe_name, app_name, start_time, end_time, NULL
           FROM import_exact_sessions WHERE start_time < ? AND end_time > 0
           UNION ALL
           SELECT id, 'import_bucket', exe_name, COALESCE(app_name, ''), bucket_start_time,
                  bucket_start_time + duration, bucket_start_time + 3600000
           FROM import_time_buckets WHERE bucket_start_time < ? AND bucket_start_time + 3600000 > 0
         ) ORDER BY start_time ASC, origin ASC, record_id ASC",
    )
    .bind(now_ms)
    .bind(now_ms)
    .bind(now_ms)
    .bind(now_ms)
    .bind(now_ms)
    .fetch_all(pool)
    .await
    .map_err(|error| format!("failed to read legacy classification facts: {error}"))?;
    let mut identities = Vec::with_capacity(rows.len());
    let mut candidates = Vec::with_capacity(rows.len());
    for row in rows {
        let origin = match row.get::<String, _>("origin").as_str() {
            "native" => ActivityOrigin::Native,
            "import_exact" => ActivityOrigin::ImportExact,
            "import_bucket" => ActivityOrigin::ImportBucket,
            _ => unreachable!("the query defines every origin"),
        };
        let original_start: i64 = row.get("start_time");
        let original_end: i64 = row.get("effective_end_time");
        let start_ms = original_start.max(0);
        let (end_ms, capacity_end_ms) = if origin == ActivityOrigin::ImportBucket {
            let original_capacity_end: i64 = row.get("capacity_end_time");
            let capacity_end = original_capacity_end.min(now_ms);
            let original_capacity = (original_capacity_end - original_start).max(0);
            let capacity = (capacity_end - start_ms).max(0);
            let requested = (original_end - original_start).max(0);
            // The released JS reader rounds the clipped requested duration before allocation.
            let clipped = if original_capacity > 0 {
                ((requested as f64 * capacity as f64) / original_capacity as f64).round() as i64
            } else {
                0
            };
            (start_ms + capacity.min(clipped), Some(capacity_end))
        } else {
            (original_end.min(now_ms), None)
        };
        if end_ms <= start_ms {
            continue;
        }
        let app_name: String = row.get("app_name");
        identities.push(LegacyClassificationApp {
            exe_name: row.get("exe_name"),
            app_name: app_name.trim_matches(is_legacy_name_whitespace).to_string(),
        });
        candidates.push(OwnedActivityRange {
            origin,
            start_ms,
            end_ms,
            capacity_end_ms,
            value: identities.len() - 1,
        });
    }
    let mut observed = Vec::<LegacyClassificationApp>::new();
    let mut ranks = HashMap::<String, (usize, bool, ActivityOrigin, i64)>::new();
    // Preserve first effective raw-key order: legacy canonicalization chooses the first matching alias.
    for range in resolve_activity_precedence(&candidates) {
        let identity = &identities[range.value];
        let named = !identity.app_name.is_empty();
        if let Some((index, previous_named, origin, seen)) = ranks.get_mut(&identity.exe_name) {
            if (named && !*previous_named)
                || (named == *previous_named
                    && (range.origin < *origin
                        || (range.origin == *origin && range.start_ms > *seen)))
            {
                observed[*index].app_name.clone_from(&identity.app_name);
                *previous_named = named;
                *origin = range.origin;
                *seen = range.start_ms;
            }
        } else {
            ranks.insert(
                identity.exe_name.clone(),
                (observed.len(), named, range.origin, range.start_ms),
            );
            observed.push(identity.clone());
        }
    }
    Ok(observed)
}

fn is_legacy_name_whitespace(value: char) -> bool {
    matches!(value, '\u{0009}'..='\u{000d}' | '\u{0020}' | '\u{00a0}' | '\u{1680}'
        | '\u{2000}'..='\u{200a}' | '\u{2028}' | '\u{2029}' | '\u{202f}' | '\u{205f}'
        | '\u{3000}' | '\u{feff}')
}

const CATEGORY_DEFAULT_COLOR_ASSIGNMENT_KEY_PREFIX: &str = "__category_default_color_assignment::";
const MIGRATION_KEY_PREFIX: &str = "__classification_manual_confirmation_migration::";
const MAX_SETTING_KEY_LEN: usize = 256;
const MAX_SETTING_VALUE_LEN: usize = 4096;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ClassificationSettingMutation {
    pub key: String,
    pub value: Option<String>,
}

pub async fn load_classification_snapshot(
    pool: &Pool<Sqlite>,
) -> Result<ClassificationSnapshot, String> {
    let rows = load_classification_setting_rows(pool).await?;
    Ok(ClassificationSnapshot::from_settings(rows))
}

pub async fn load_classification_snapshot_in_tx(
    tx: &mut Transaction<'_, Sqlite>,
) -> Result<ClassificationSnapshot, String> {
    let rows = sqlx::query(&classification_settings_query())
        .bind(format!("{APP_OVERRIDE_KEY_PREFIX}%"))
        .bind(format!("{WEB_DOMAIN_OVERRIDE_KEY_PREFIX}%"))
        .bind(format!("{CATEGORY_LABEL_OVERRIDE_KEY_PREFIX}%"))
        .bind(format!("{CATEGORY_COLOR_OVERRIDE_KEY_PREFIX}%"))
        .bind(format!("{CATEGORY_DEFINITION_KEY_PREFIX}%"))
        .bind(format!("{DELETED_CATEGORY_KEY_PREFIX}%"))
        .fetch_all(&mut **tx)
        .await
        .map_err(|error| format!("failed to read classification settings: {error}"))?;
    Ok(ClassificationSnapshot::from_settings(rows.into_iter().map(
        |row| (row.get::<String, _>("key"), row.get::<String, _>("value")),
    )))
}

async fn load_classification_setting_rows(
    pool: &Pool<Sqlite>,
) -> Result<Vec<(String, String)>, String> {
    let rows = sqlx::query(&classification_settings_query())
        .bind(format!("{APP_OVERRIDE_KEY_PREFIX}%"))
        .bind(format!("{WEB_DOMAIN_OVERRIDE_KEY_PREFIX}%"))
        .bind(format!("{CATEGORY_LABEL_OVERRIDE_KEY_PREFIX}%"))
        .bind(format!("{CATEGORY_COLOR_OVERRIDE_KEY_PREFIX}%"))
        .bind(format!("{CATEGORY_DEFINITION_KEY_PREFIX}%"))
        .bind(format!("{DELETED_CATEGORY_KEY_PREFIX}%"))
        .fetch_all(pool)
        .await
        .map_err(|error| format!("failed to read classification settings: {error}"))?;
    Ok(rows
        .into_iter()
        .map(|row| (row.get::<String, _>("key"), row.get::<String, _>("value")))
        .collect())
}

fn classification_settings_query() -> String {
    "SELECT key, value FROM settings
     WHERE key = 'language'
        OR substr(key,1,12) = '__app_link::'
        OR substr(key,1,12) = '__web_site::'
        OR key LIKE ? OR key LIKE ? OR key LIKE ? OR key LIKE ? OR key LIKE ? OR key LIKE ?"
        .to_string()
}

pub async fn commit_classification_setting_mutations(
    pool: &Pool<Sqlite>,
    mutations: &[ClassificationSettingMutation],
) -> Result<(), SqliteOperationError> {
    if mutations.is_empty() {
        return Ok(());
    }

    let mut tx = pool.begin().await.map_err(|error| {
        SqliteOperationError::from_sqlx("start classification settings transaction", error)
    })?;

    apply_classification_setting_mutations_in_tx(&mut tx, mutations).await?;

    tx.commit().await.map_err(|error| {
        SqliteOperationError::from_sqlx("commit classification settings transaction", error)
    })?;

    Ok(())
}

pub async fn apply_classification_setting_mutations_in_tx(
    tx: &mut Transaction<'_, Sqlite>,
    mutations: &[ClassificationSettingMutation],
) -> Result<(), SqliteOperationError> {
    for mutation in mutations {
        validate_classification_setting_mutation(mutation)?;
        if mutation
            .key
            .starts_with(crate::domain::web_links::SETTING_PREFIX)
        {
            super::web_links::apply_change(tx, &mutation.key, mutation.value.as_deref()).await?;
            continue;
        }
        if mutation.key.starts_with(super::app_links::APP_LINK_PREFIX) {
            super::app_links::apply_change(tx, &mutation.key, mutation.value.as_deref()).await?;
            continue;
        }
        if let Some(value) = &mutation.value {
            sqlx::query(
                "INSERT INTO settings (key, value) VALUES (?, ?)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            )
            .bind(&mutation.key)
            .bind(value)
            .execute(&mut **tx)
            .await
            .map_err(|error| {
                SqliteOperationError::from_sqlx("save classification setting", error)
            })?;
        } else {
            sqlx::query("DELETE FROM settings WHERE key = ?")
                .bind(&mutation.key)
                .execute(&mut **tx)
                .await
                .map_err(|error| {
                    SqliteOperationError::from_sqlx("delete classification setting", error)
                })?;
        }
    }
    super::app_links::validate_in_tx(tx)
        .await
        .map_err(|message| {
            SqliteOperationError::invalid_input("validate application associations", message)
        })?;
    super::web_links::load_in_tx(tx).await.map_err(|message| {
        SqliteOperationError::invalid_input("validate website associations", message)
    })?;
    Ok(())
}

fn validate_classification_setting_mutation(
    mutation: &ClassificationSettingMutation,
) -> Result<(), SqliteOperationError> {
    if !is_allowed_classification_setting_key(&mutation.key) {
        return Err(SqliteOperationError::invalid_input(
            "validate classification setting",
            format!("invalid key `{}`", mutation.key),
        ));
    }

    if let Some(value) = &mutation.value {
        if value.len() > MAX_SETTING_VALUE_LEN
            && !mutation
                .key
                .starts_with(crate::domain::web_links::SETTING_PREFIX)
        {
            return Err(SqliteOperationError::invalid_input(
                "validate classification setting",
                format!("value is too large for key `{}`", mutation.key),
            ));
        }

        if mutation.key.starts_with(APP_OVERRIDE_KEY_PREFIX)
            || mutation.key.starts_with(WEB_DOMAIN_OVERRIDE_KEY_PREFIX)
        {
            serde_json::from_str::<serde_json::Value>(value).map_err(|error| {
                SqliteOperationError::invalid_input(
                    "validate classification setting",
                    format!("invalid override value for key `{}`: {error}", mutation.key),
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
        super::app_links::APP_LINK_PREFIX,
        crate::domain::web_links::SETTING_PREFIX,
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
    use futures_util::FutureExt;
    use sqlx::{Executor, Row, SqlitePool};

    #[tokio::test]
    async fn legacy_classification_apps_match_released_reader_oracle() {
        struct Case {
            name: &'static str,
            now_ms: i64,
            sql: &'static str,
            expected: &'static [(&'static str, &'static str)],
        }
        let cases = [
            Case {
                name: "unclassified native suppresses imported Chrome",
                now_ms: 1000,
                sql: r#"INSERT INTO sessions VALUES (1, 'unknown.exe', 'Unknown', 100, 200);
INSERT INTO import_exact_sessions VALUES (2, 'chrome.exe', 'Chrome', 110, 150);"#,
                expected: &[("unknown.exe", "Unknown")],
            },
            Case {
                name: "zero and future records do not become candidates",
                now_ms: 1000,
                sql: r#"INSERT INTO sessions VALUES (5, 'past.exe', 'Chrome', -200, 200);
INSERT INTO import_time_buckets VALUES (6, 'zero-bucket.exe', 'ChatGPT', 0, 0);
INSERT INTO sessions VALUES (3, 'zero.exe', 'Code', 10, 10);
INSERT INTO sessions VALUES (4, 'future.exe', 'Word', 2000, 3000);"#,
                expected: &[("past.exe", "Chrome")],
            },
            Case {
                name: "raw case variants retain first encounter order before canonical mapping",
                now_ms: 1000,
                sql: r#"INSERT INTO sessions VALUES (7, 'mystery.exe', 'Word', 100, 150);
INSERT INTO sessions VALUES (8, 'MYSTERY.EXE', 'ChatGPT', 200, 250);"#,
                expected: &[("mystery.exe", "Word"), ("MYSTERY.EXE", "ChatGPT")],
            },
            Case {
                name: "same origin and effective start keeps the first record name",
                now_ms: 1000,
                sql: r#"INSERT INTO sessions VALUES (9, 'mystery.exe', 'Word', 100, 200);
INSERT INTO sessions VALUES (10, 'mystery.exe', 'ChatGPT', 100, 200);"#,
                expected: &[("mystery.exe", "Word")],
            },
            Case {
                name: "nonempty native name beats imports and later blank native name",
                now_ms: 1000,
                sql: r#"INSERT INTO sessions VALUES (11, 'named.exe', '', 0, 20);
INSERT INTO import_exact_sessions VALUES (12, 'named.exe', 'Zoom', 25, 50);
INSERT INTO sessions VALUES (13, 'named.exe', 'Word', 100, 110);
INSERT INTO sessions VALUES (14, 'named.exe', '', 150, 160);
INSERT INTO import_exact_sessions VALUES (15, 'named.exe', 'ChatGPT', 200, 220);"#,
                expected: &[("named.exe", "Word")],
            },
            Case {
                name: "nonempty imported name beats empty native name",
                now_ms: 1000,
                sql: r#"INSERT INTO sessions VALUES (16, 'named.exe', '', 0, 20);
INSERT INTO import_exact_sessions VALUES (17, 'named.exe', 'ChatGPT', 25, 50);"#,
                expected: &[("named.exe", "ChatGPT")],
            },
            Case {
                name: "latest effective exact fragment determines equal origin name",
                now_ms: 1000,
                sql: r#"INSERT INTO import_exact_sessions VALUES (18, 'mystery.exe', 'Word', 10, 100);
INSERT INTO sessions VALUES (19, 'unknown.exe', 'Unknown', 20, 80);
INSERT INTO import_exact_sessions VALUES (20, 'mystery.exe', 'ChatGPT', 40, 120);"#,
                expected: &[("mystery.exe", "ChatGPT"), ("unknown.exe", "Unknown")],
            },
            Case {
                name: "partial bucket half rounding and stable allocation keep only second bucket",
                now_ms: 1,
                sql: r#"INSERT INTO import_time_buckets VALUES (21, 'first.exe', 'Word', 0, 1800000);
INSERT INTO import_time_buckets VALUES (22, 'second.exe', 'ChatGPT', 0, 1800000);"#,
                expected: &[("second.exe", "ChatGPT")],
            },
            Case {
                name: "legacy migration preserves untrackable known executable classification",
                now_ms: 1000,
                sql: r#"INSERT INTO sessions VALUES (23, 'conhost.exe', 'Console', 10, 20);"#,
                expected: &[("conhost.exe", "Console")],
            },
            Case {
                name: "named exact beats bucket name outside exact occupied interval",
                now_ms: 3600000,
                sql: r#"INSERT INTO import_time_buckets VALUES (25, 'named.exe', 'ChatGPT', 0, 1800000);
INSERT INTO import_exact_sessions VALUES (24, 'named.exe', 'Word', 100, 200);"#,
                expected: &[("named.exe", "Word")],
            },
            Case {
                name: "SQL record id orders exact contenders despite inverse insertion order",
                now_ms: 1000,
                sql: r#"INSERT INTO import_exact_sessions VALUES (20, 'mystery.exe', 'Word', 10, 20);
INSERT INTO import_exact_sessions VALUES (2, 'mystery.exe', 'ChatGPT', 10, 30);"#,
                expected: &[("mystery.exe", "ChatGPT")],
            },
            Case {
                name: "negative starts preserve SQL encounter order when clipping creates equal starts",
                now_ms: 1000,
                sql: r#"INSERT INTO import_exact_sessions VALUES (20, 'mystery.exe', 'Word', -100, 100);
INSERT INTO import_exact_sessions VALUES (2, 'MYSTERY.EXE', 'ChatGPT', -50, 150);"#,
                expected: &[("mystery.exe", "Word"), ("MYSTERY.EXE", "ChatGPT")],
            },
            Case {
                name: "effective order differs from SQL lexical origin order across raw aliases",
                now_ms: 30,
                sql: r#"INSERT INTO sessions VALUES (1, 'mystery.exe', 'Word', 0, 10);
INSERT INTO import_exact_sessions VALUES (2, 'MYSTERY.EXE', 'ChatGPT', 0, 20);
INSERT INTO import_time_buckets VALUES (3, 'Mystery.exe', 'Discord', 0, 3600000);"#,
                expected: &[("mystery.exe", "Word"), ("Mystery.exe", "Discord"), ("MYSTERY.EXE", "ChatGPT")],
            },
        ];
        for case in cases {
            let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
            let result = std::panic::AssertUnwindSafe(async {
                pool.execute("CREATE TABLE sessions(id INTEGER, exe_name TEXT, app_name TEXT, start_time INTEGER, end_time INTEGER);
                    CREATE TABLE import_exact_sessions(id INTEGER, exe_name TEXT, app_name TEXT, start_time INTEGER, end_time INTEGER);
                    CREATE TABLE import_time_buckets(id INTEGER, exe_name TEXT, app_name TEXT, bucket_start_time INTEGER, duration INTEGER);").await.unwrap();
                pool.execute(case.sql).await.unwrap();
                let actual = load_legacy_classification_apps(&pool, case.now_ms).await.unwrap();
                let pairs = actual.iter().map(|row| (row.exe_name.as_str(), row.app_name.as_str())).collect::<Vec<_>>();
                assert_eq!(pairs, case.expected, "{}", case.name);
            }).catch_unwind().await;
            pool.close().await;
            if let Err(error) = result {
                std::panic::resume_unwind(error);
            }
        }
    }

    #[tokio::test]
    async fn legacy_classification_apps_bound_output_and_propagate_read_errors() {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        let result = std::panic::AssertUnwindSafe(async {
            pool.execute("CREATE TABLE sessions(id INTEGER, exe_name TEXT, app_name TEXT, start_time INTEGER, end_time INTEGER);
                CREATE TABLE import_exact_sessions(id INTEGER, exe_name TEXT, app_name TEXT, start_time INTEGER, end_time INTEGER);
                CREATE TABLE import_time_buckets(id INTEGER, exe_name TEXT, app_name TEXT, bucket_start_time INTEGER, duration INTEGER);
                WITH RECURSIVE ids(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM ids WHERE n < 10000)
                INSERT INTO sessions SELECT n, 'code.exe', ' Code ', n * 10, n * 10 + 5 FROM ids;
                INSERT INTO sessions VALUES (10001, 'open.exe', ' Open ', 100001, NULL);
                INSERT INTO sessions VALUES (10002, 'open-now.exe', 'Now', 100010, NULL);
                INSERT INTO sessions VALUES (10003, 'open-future.exe', 'Future', 100011, NULL);
                INSERT INTO sessions VALUES (10004, 'zero.exe', 'Zero', 1, 1);
                INSERT INTO import_exact_sessions VALUES (1, 'exact.exe', 'Exact', 1, 5);").await.unwrap();
            let apps = load_legacy_classification_apps(&pool, 100010).await.unwrap();
            assert_eq!(apps, vec![
                LegacyClassificationApp { exe_name: "exact.exe".into(), app_name: "Exact".into() },
                LegacyClassificationApp { exe_name: "code.exe".into(), app_name: "Code".into() },
                LegacyClassificationApp { exe_name: "open.exe".into(), app_name: "Open".into() },
            ]);
            assert!(load_legacy_classification_apps(&pool, -1).await.unwrap_err().contains("timestamp"));
            pool.execute("DROP TABLE import_exact_sessions").await.unwrap();
            assert!(load_legacy_classification_apps(&pool, 100010).await.unwrap_err().contains("failed to read legacy classification facts"));
        }).catch_unwind().await;
        pool.close().await;
        if let Err(error) = result {
            std::panic::resume_unwind(error);
        }
    }

    #[test]
    fn legacy_classification_name_whitespace_matches_ecmascript_trim() {
        assert_eq!(
            "\u{feff}\u{00a0}Word\u{3000}".trim_matches(is_legacy_name_whitespace),
            "Word"
        );
        assert_eq!(
            "\u{0085}Word".trim_matches(is_legacy_name_whitespace),
            "\u{0085}Word"
        );
    }

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
