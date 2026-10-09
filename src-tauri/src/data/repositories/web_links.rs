use crate::data::sqlite_error::SqliteOperationError;
use crate::domain::web_links::{validate_rule, WebLinkRule, WebLinkRules, SETTING_PREFIX};
use serde::{Deserialize, Serialize};
use sqlx::{Sqlite, Transaction};
use std::collections::BTreeMap;

fn invalid(message: impl Into<String>) -> SqliteOperationError {
    SqliteOperationError::invalid_input("save website grouping", message)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::data::repositories::classification_settings::{
        commit_classification_setting_mutations, ClassificationSettingMutation,
    };
    use serde_json::json;
    async fn database() -> sqlx::Pool<Sqlite> {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::query("CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT NOT NULL)")
            .execute(&pool)
            .await
            .unwrap();
        pool
    }
    fn change(
        next: serde_json::Value,
        previous: serde_json::Value,
    ) -> ClassificationSettingMutation {
        ClassificationSettingMutation {
            key: "__web_site::example.com".into(),
            value: Some(json!({"next":next,"previous":previous}).to_string()),
        }
    }
    #[tokio::test]
    async fn automatic_rules_replay_conflict_and_atomic_rejection() {
        let pool = database().await;
        let rule = json!({"version":2,"exceptions":["mail.example.com"]});
        let first = change(rule.clone(), json!(null));
        commit_classification_setting_mutations(&pool, &[first.clone()])
            .await
            .unwrap();
        commit_classification_setting_mutations(&pool, &[first])
            .await
            .unwrap();
        assert!(commit_classification_setting_mutations(
            &pool,
            &[change(json!({"version":2}), json!(null))]
        )
        .await
        .is_err());
        let raw = ClassificationSettingMutation {
            key: "__web_domain_override::mail.example.com".into(),
            value: Some(json!({"captureTitle":false}).to_string()),
        };
        assert!(commit_classification_setting_mutations(
            &pool,
            &[
                raw,
                change(
                    json!({"version":2,"exceptions":["other.com"]}),
                    rule.clone()
                )
            ]
        )
        .await
        .is_err());
        let count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM settings WHERE key='__web_domain_override::mail.example.com'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(count, 0);
        commit_classification_setting_mutations(&pool, &[change(json!(null), rule)])
            .await
            .unwrap();
        pool.close().await;
    }
    #[tokio::test]
    async fn migration_discards_manual_links_preserves_raw_settings_and_is_idempotent() {
        let pool = database().await;
        for (key, value) in [
            (
                "__web_site::chat.example.com",
                json!({"members":["other.com"],"displayName":"Old group"}),
            ),
            (
                "__web_site::legacy.org",
                json!({"enabled":true,"exceptions":["mail.legacy.org"],"color":"#123456"}),
            ),
            (
                "__web_domain_override::chat.example.com",
                json!({"displayName":"Original","captureTitle":false}),
            ),
        ] {
            sqlx::query("INSERT INTO settings VALUES(?,?)")
                .bind(key)
                .bind(value.to_string())
                .execute(&pool)
                .await
                .unwrap();
        }
        let mut tx = pool.begin().await.unwrap();
        migrate_legacy_web_grouping(&mut tx).await.unwrap();
        tx.rollback().await.unwrap();
        let original: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM settings WHERE key='__web_site::chat.example.com'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(original, 1);
        let mut tx = pool.begin().await.unwrap();
        migrate_legacy_web_grouping(&mut tx).await.unwrap();
        let rules = load_in_tx(&mut tx).await.unwrap();
        assert!(!rules.contains_key("chat.example.com"));
        assert_eq!(
            rules["legacy.org"].exceptions,
            std::collections::BTreeSet::from(["mail.legacy.org".into()])
        );
        assert!(rules["legacy.org"].color.is_none());
        let raw: String = sqlx::query_scalar(
            "SELECT value FROM settings WHERE key='__web_domain_override::chat.example.com'",
        )
        .fetch_one(&mut *tx)
        .await
        .unwrap();
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&raw).unwrap()["displayName"],
            "Original"
        );
        let backup: String =
            sqlx::query_scalar("SELECT value FROM settings WHERE key='__web_grouping_backup_v2'")
                .fetch_one(&mut *tx)
                .await
                .unwrap();
        assert!(backup.contains("Old group"));
        migrate_legacy_web_grouping(&mut tx).await.unwrap();
        assert_eq!(load_in_tx(&mut tx).await.unwrap(), rules);
        tx.commit().await.unwrap();
        pool.close().await;
    }

    #[tokio::test]
    async fn large_automatic_exception_sets_save_and_restore_without_truncation() {
        let pool = database().await;
        let domains: Vec<String> = (0..1500)
            .map(|index| format!("member-{index}.example.com"))
            .collect();
        let rule = json!({"version":2,"exceptions":domains});
        commit_classification_setting_mutations(&pool, &[change(rule.clone(), json!(null))])
            .await
            .unwrap();
        let mut tx = pool.begin().await.unwrap();
        migrate_legacy_web_grouping(&mut tx).await.unwrap();
        assert_eq!(
            load_in_tx(&mut tx).await.unwrap()["example.com"]
                .exceptions
                .len(),
            1500
        );
        tx.commit().await.unwrap();
        commit_classification_setting_mutations(&pool, &[change(json!(null), rule)])
            .await
            .unwrap();
        pool.close().await;
    }

    #[tokio::test]
    async fn lifetime_icon_totals_union_same_source_and_keep_independent_sources() {
        use sqlx::Executor;
        let pool = database().await;
        pool.execute(crate::data::schema::WEB_ACTIVITY_SCHEMA_SQL)
            .await
            .unwrap();
        pool.execute(crate::data::schema::WEB_FAVICON_CACHE_SCHEMA_SQL)
            .await
            .unwrap();
        for (source, start, end) in [
            ("a", 0, 1000),
            ("a", 500, 1500),
            ("a", 600, 700),
            ("b", 0, 1000),
        ] {
            sqlx::query("INSERT INTO web_activity_segments(browser_client_id,browser_kind,browser_exe_name,domain,normalized_domain,start_time,end_time,duration,created_at,updated_at) VALUES(?,'chrome','chrome.exe','chat.example.com','chat.example.com',?,?,?,0,?)")
                .bind(source).bind(start).bind(end).bind(end-start).bind(end).execute(&pool).await.unwrap();
        }
        let result = snapshot(&pool).await.unwrap();
        assert_eq!(result.totals["chat.example.com"], 2500);
        assert_eq!(result.roots["chat.example.com"], "example.com");
        assert_eq!(result.domains, ["chat.example.com"]);
        sqlx::query("INSERT INTO settings(key,value) VALUES('__web_domain_override::chat.example.com','broken-json')").execute(&pool).await.unwrap();
        assert!(snapshot(&pool)
            .await
            .unwrap_err()
            .contains("invalid website override"));
        pool.close().await;
    }

    #[tokio::test]
    async fn merge_restore_preserves_new_exceptions_and_rejects_unknown_versions() {
        use crate::data::repositories::settings::insert_missing_for_restore;
        use crate::domain::backup::BackupSetting;
        let pool = database().await;
        let current =
            json!({"version":2,"exceptions":["keep.example.com"],"displayName":"Current"});
        commit_classification_setting_mutations(&pool, &[change(current.clone(), json!(null))])
            .await
            .unwrap();
        let mut tx = pool.begin().await.unwrap();
        insert_missing_for_restore(
            &mut tx,
            &[
                BackupSetting {
                    key: "__web_site::example.com".into(),
                    value: json!({"members":["other.com"]}).to_string(),
                },
                BackupSetting {
                    key: "__web_site::chat.example.com".into(),
                    value: json!({"enabled":true,"exceptions":["old.chat.example.com"]})
                        .to_string(),
                },
            ],
        )
        .await
        .unwrap();
        migrate_legacy_web_grouping(&mut tx).await.unwrap();
        assert_eq!(
            serde_json::to_value(&load_in_tx(&mut tx).await.unwrap()["example.com"]).unwrap(),
            current
        );
        tx.commit().await.unwrap();
        let mut tx = pool.begin().await.unwrap();
        assert!(insert_missing_for_restore(
            &mut tx,
            &[BackupSetting {
                key: "__web_site::future.com".into(),
                value: json!({"version":3}).to_string()
            }]
        )
        .await
        .is_err());
        tx.rollback().await.unwrap();
        let mut tx = pool.begin().await.unwrap();
        assert_eq!(load_in_tx(&mut tx).await.unwrap().len(), 1);
        tx.rollback().await.unwrap();
        pool.close().await;
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Change {
    previous: Option<WebLinkRule>,
    next: Option<WebLinkRule>,
}

pub async fn apply_change(
    tx: &mut Transaction<'_, Sqlite>,
    key: &str,
    value: Option<&str>,
) -> Result<(), SqliteOperationError> {
    let root = key
        .strip_prefix(SETTING_PREFIX)
        .ok_or_else(|| invalid("invalid website key"))?;
    let value = value.ok_or_else(|| invalid("missing website change"))?;
    if value.len() > 2 * crate::domain::web_links::MAX_AUTOMATIC_RULE_BYTES + 64 {
        return Err(invalid("website change is too large"));
    }
    let change: Change =
        serde_json::from_str(value).map_err(|_| invalid("invalid website change"))?;
    if let Some(rule) = &change.next {
        if rule.version != 2 {
            return Err(invalid("only automatic website grouping can be saved"));
        }
        validate_rule(root, rule).map_err(invalid)?;
    }
    let current: Option<String> = sqlx::query_scalar("SELECT value FROM settings WHERE key=?")
        .bind(key)
        .fetch_optional(&mut **tx)
        .await
        .map_err(|e| SqliteOperationError::from_sqlx("read website grouping", e))?;
    let current: Option<WebLinkRule> = current
        .as_deref()
        .map(serde_json::from_str)
        .transpose()
        .map_err(|_| invalid("stored website rule is invalid"))?;
    if current != change.previous && current != change.next {
        return Err(invalid("website grouping changed; reload before saving"));
    }
    if let Some(rule) = change.next {
        let value = serde_json::to_string(&rule).map_err(|e| invalid(e.to_string()))?;
        sqlx::query("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
            .bind(key).bind(value).execute(&mut **tx).await.map_err(|e| SqliteOperationError::from_sqlx("save website grouping", e))?;
    } else {
        sqlx::query("DELETE FROM settings WHERE key=?")
            .bind(key)
            .execute(&mut **tx)
            .await
            .map_err(|e| SqliteOperationError::from_sqlx("remove website grouping", e))?;
    }
    Ok(())
}

pub async fn load_in_tx(tx: &mut Transaction<'_, Sqlite>) -> Result<WebLinkRules, String> {
    let rows: Vec<(String, String)> =
        sqlx::query_as("SELECT key,value FROM settings WHERE substr(key,1,12)='__web_site::'")
            .fetch_all(&mut **tx)
            .await
            .map_err(|e| format!("read website rules: {e}"))?;
    let mut rules = WebLinkRules::new();
    for (key, value) in rows {
        let root = key
            .strip_prefix(SETTING_PREFIX)
            .ok_or("invalid website key")?;
        let rule: WebLinkRule =
            serde_json::from_str(&value).map_err(|e| format!("invalid website rule: {e}"))?;
        validate_rule(root, &rule)?;
        rules.insert(root.to_string(), rule);
    }
    crate::domain::web_links::validate_rules(&rules)?;
    Ok(rules)
}

/// Convert supported older relationships atomically without touching activity facts.
pub async fn migrate_legacy_web_grouping(tx: &mut Transaction<'_, Sqlite>) -> Result<(), String> {
    let previous = load_in_tx(tx).await?;
    if previous.values().all(|rule| rule.version == 2) {
        return Ok(());
    }
    // A local recovery copy retains old group-only presentation settings.
    sqlx::query("INSERT OR IGNORE INTO settings(key,value) VALUES('__web_grouping_backup_v2',?)")
        .bind(serde_json::to_string(&previous).map_err(|e| e.to_string())?)
        .execute(&mut **tx)
        .await
        .map_err(|e| e.to_string())?;
    let mut next: WebLinkRules = previous
        .iter()
        .filter(|(_, rule)| rule.version == 2)
        .map(|(root, rule)| (root.clone(), rule.clone()))
        .collect();
    for (parent, rule) in &previous {
        if rule.version == 2 {
            continue;
        }
        if let Some(root) = crate::domain::web_links::registrable_domain(parent) {
            if let std::collections::btree_map::Entry::Vacant(entry) = next.entry(root.clone()) {
                let exceptions: std::collections::BTreeSet<String> = previous
                    .values()
                    .filter(|legacy| legacy.version == 0 && legacy.enabled)
                    .flat_map(|legacy| legacy.exceptions.iter())
                    .filter(|domain| {
                        crate::domain::web_links::registrable_domain(domain).as_deref()
                            == Some(&root)
                    })
                    .cloned()
                    .collect();
                if !exceptions.is_empty() {
                    let converted = serde_json::from_value(
                        serde_json::json!({"version":2,"exceptions":exceptions}),
                    )
                    .map_err(|e| e.to_string())?;
                    entry.insert(converted);
                }
            }
        }
    }
    for parent in previous.keys() {
        sqlx::query("DELETE FROM settings WHERE key=?")
            .bind(format!("{SETTING_PREFIX}{parent}"))
            .execute(&mut **tx)
            .await
            .map_err(|e| e.to_string())?;
    }
    for (parent, rule) in next {
        validate_rule(&parent, &rule)?;
        sqlx::query("INSERT INTO settings(key,value) VALUES(?,?)")
            .bind(format!("{SETTING_PREFIX}{parent}"))
            .bind(serde_json::to_string(&rule).map_err(|e| e.to_string())?)
            .execute(&mut **tx)
            .await
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebLinksSnapshot {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub anonymous_activity: Option<Vec<super::anonymous_activity::AnonymousActivityRecord>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub segments: Option<Vec<WebActivityDetailSegment>>,
    pub rules: WebLinkRules,
    pub overrides: BTreeMap<String, serde_json::Value>,
    /// Domains with stored activity, independent of the recent candidate limit.
    pub domains: Vec<String>,
    pub roots: BTreeMap<String, String>,
    pub totals: BTreeMap<String, i64>,
    pub favicons: BTreeMap<String, String>,
}

pub async fn snapshot(pool: &sqlx::Pool<Sqlite>) -> Result<WebLinksSnapshot, String> {
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    snapshot_in_tx(&mut tx).await
}

pub async fn snapshot_in_tx(tx: &mut Transaction<'_, Sqlite>) -> Result<WebLinksSnapshot, String> {
    let rules = load_in_tx(tx).await?;
    let rows: Vec<(String, String)> = sqlx::query_as("SELECT substr(key,24),value FROM settings WHERE substr(key,1,23)='__web_domain_override::'")
        .fetch_all(&mut **tx).await.map_err(|error| error.to_string())?;
    let overrides: BTreeMap<String, serde_json::Value> = rows
        .into_iter()
        .map(|(key, value)| {
            let value: serde_json::Value = serde_json::from_str(&value)
                .map_err(|error| format!("invalid website override: {error}"))?;
            if !value.is_object() {
                return Err("invalid website override object".to_string());
            }
            Ok((key, value))
        })
        .collect::<Result<_, String>>()?;
    let domains: Vec<String> = sqlx::query_scalar(
        "SELECT DISTINCT normalized_domain FROM web_activity_segments ORDER BY normalized_domain",
    )
    .fetch_all(&mut **tx)
    .await
    .map_err(|e| e.to_string())?;
    let roots = domains
        .iter()
        .chain(overrides.keys())
        .filter_map(|domain| {
            crate::domain::web_links::registrable_domain(domain).map(|root| (domain.clone(), root))
        })
        .collect();
    let totals: Vec<(String, i64)> = sqlx::query_as(
        "WITH ordered AS (SELECT normalized_domain, browser_client_id, browser_kind, browser_exe_name, start_time, COALESCE(end_time, updated_at) finish, MAX(COALESCE(end_time, updated_at)) OVER (PARTITION BY normalized_domain,browser_client_id,browser_kind,browser_exe_name ORDER BY start_time,id ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) previous_end FROM web_activity_segments) SELECT normalized_domain,SUM(MAX(0,finish-MAX(start_time,COALESCE(previous_end,start_time)))) FROM ordered GROUP BY normalized_domain")
        .fetch_all(&mut **tx).await.map_err(|e| e.to_string())?;
    let favicons: Vec<(String, String)> = sqlx::query_as(
        "SELECT normalized_domain,favicon_url FROM web_favicon_cache WHERE trim(favicon_url) <> ''",
    )
    .fetch_all(&mut **tx)
    .await
    .map_err(|e| e.to_string())?;
    Ok(WebLinksSnapshot {
        anonymous_activity: None,
        segments: None,
        rules,
        overrides,
        domains,
        roots,
        totals: totals.into_iter().collect(),
        favicons: favicons.into_iter().collect(),
    })
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct WebActivityDetailSegment {
    id: i64,
    browser_client_id: String,
    browser_kind: String,
    browser_exe_name: String,
    domain: String,
    normalized_domain: String,
    url: Option<String>,
    title: Option<String>,
    favicon_url: Option<String>,
    start_time: i64,
    end_time: i64,
    duration: i64,
}

pub async fn snapshot_range(
    pool: &sqlx::Pool<Sqlite>,
    start: i64,
    end: i64,
    now: i64,
) -> Result<WebLinksSnapshot, String> {
    if start < 0 || end <= start || now < 0 {
        return Err("invalid website detail range".into());
    }
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    let mut snapshot = snapshot_in_tx(&mut tx).await?;
    snapshot.anonymous_activity = Some(
        super::anonymous_activity::read_range_tx(&mut tx, start, end)
            .await
            .map_err(|error| error.to_string())?
            .into_iter()
            .filter(|row| row.is_web)
            .collect(),
    );
    snapshot.segments = Some(sqlx::query_as("SELECT id,browser_client_id,browser_kind,browser_exe_name,domain,normalized_domain,url,title,NULL AS favicon_url,start_time,COALESCE(end_time, MAX(start_time, MIN(?, updated_at+45000))) AS end_time,COALESCE(duration, MAX(0, MIN(?, updated_at+45000)-start_time)) AS duration FROM web_activity_segments WHERE start_time < ? AND COALESCE(end_time, MIN(?,updated_at+45000)) > ? ORDER BY start_time,id")
        .bind(now).bind(now).bind(end).bind(now).bind(start).fetch_all(&mut *tx).await.map_err(|error| error.to_string())?);
    Ok(snapshot)
}
