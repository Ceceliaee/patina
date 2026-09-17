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
    use crate::domain::backup::BackupSetting;
    use serde_json::json;

    fn change(
        root: &str,
        next: serde_json::Value,
        previous: serde_json::Value,
    ) -> ClassificationSettingMutation {
        ClassificationSettingMutation {
            key: format!("{SETTING_PREFIX}{root}"),
            value: Some(json!({"next":next,"previous":previous}).to_string()),
        }
    }

    #[tokio::test]
    async fn manual_links_replay_conflicts_restore_and_exact_controls() {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::query("CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT NOT NULL)")
            .execute(&pool)
            .await
            .unwrap();
        let rule = json!({"members":["other.com"],"displayName":"Example"});
        let first = change("chat.example.com", rule.clone(), serde_json::Value::Null);
        commit_classification_setting_mutations(&pool, &[first.clone()])
            .await
            .unwrap();
        commit_classification_setting_mutations(&pool, &[first])
            .await
            .unwrap();
        for next in [
            json!({"members":["chat.example.com"]}),
            json!({"enabled":true,"members":[]}),
            json!({"members":["other.com"],"exceptions":["mail.example.com"]}),
        ] {
            assert!(commit_classification_setting_mutations(
                &pool,
                &[change("chat.example.com", next, rule.clone())]
            )
            .await
            .is_err());
        }
        assert!(commit_classification_setting_mutations(
            &pool,
            &[change(
                "chat.example.com",
                json!({"members":[]}),
                serde_json::Value::Null
            )]
        )
        .await
        .is_err());
        let raw = ClassificationSettingMutation {
            key: "__web_domain_override::other.com".into(),
            value: Some(json!({"enabled":false,"captureTitle":false}).to_string()),
        };
        let nested = change(
            "other.com",
            json!({"members":["third.com"]}),
            serde_json::Value::Null,
        );
        assert!(
            commit_classification_setting_mutations(&pool, &[raw.clone(), nested])
                .await
                .is_err()
        );
        let count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM settings WHERE key='__web_domain_override::other.com'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(count, 0);
        commit_classification_setting_mutations(&pool, &[raw])
            .await
            .unwrap();
        let mut tx = pool.begin().await.unwrap();
        let conflicting = BackupSetting {
            key: "__web_site::another.com".into(),
            value: json!({"members":["other.com"]}).to_string(),
        };
        assert!(
            super::super::settings::insert_missing_for_restore(&mut tx, &[conflicting])
                .await
                .is_err()
        );
        tx.rollback().await.unwrap();
        let mut tx = pool.begin().await.unwrap();
        let rules = load_in_tx(&mut tx).await.unwrap();
        assert_eq!(
            crate::domain::web_links::resolve_owner("other.com", &rules),
            "site:chat.example.com"
        );
        assert_eq!(
            crate::domain::web_links::resolve_owner("new.example.com", &rules),
            "new.example.com"
        );
        assert!(!rules.contains_key("another.com"));
        tx.rollback().await.unwrap();
        pool.close().await;
    }

    #[tokio::test]
    async fn legacy_upgrade_keeps_observed_members_without_linking_future_domains() {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::query("CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT NOT NULL)")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("CREATE TABLE web_activity_segments(normalized_domain TEXT NOT NULL)")
            .execute(&pool)
            .await
            .unwrap();
        for domain in ["chat.example.com", "www.example.com", "mail.example.com"] {
            sqlx::query("INSERT INTO web_activity_segments VALUES(?)")
                .bind(domain)
                .execute(&pool)
                .await
                .unwrap();
        }
        let legacy = json!({"enabled":true,"exceptions":["mail.example.com"],"color":"#123456","displayName":"Example"});
        sqlx::query("INSERT INTO settings VALUES('__web_site::chat.example.com',?)")
            .bind(
                json!({"enabled":false,"exceptions":[],"displayName":"Earlier settings"})
                    .to_string(),
            )
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO settings VALUES('__web_site::example.com',?)")
            .bind(legacy.to_string())
            .execute(&pool)
            .await
            .unwrap();
        let mut tx = pool.begin().await.unwrap();
        migrate_legacy_web_grouping(&mut tx).await.unwrap();
        tx.commit().await.unwrap();
        sqlx::query("INSERT INTO web_activity_segments VALUES('future.example.com')")
            .execute(&pool)
            .await
            .unwrap();
        let mut tx = pool.begin().await.unwrap();
        migrate_legacy_web_grouping(&mut tx).await.unwrap();
        let rules = load_in_tx(&mut tx).await.unwrap();
        assert!(!rules.contains_key("example.com"));
        assert!(!rules.contains_key("chat.example.com"));
        let raw: String = sqlx::query_scalar(
            "SELECT value FROM settings WHERE key='__web_domain_override::chat.example.com'",
        )
        .fetch_one(&mut *tx)
        .await
        .unwrap();
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&raw).unwrap()["displayName"],
            "Earlier settings"
        );
        let rule = &rules["www.example.com"];
        assert!(!rule.enabled);
        assert_eq!(
            rule.members.as_ref().unwrap(),
            &std::collections::BTreeSet::from(["chat.example.com".into()])
        );
        assert_eq!(rule.color.as_deref(), Some("#123456"));
        assert_eq!(rule.display_name.as_deref(), Some("Example"));
        for separate in ["future.example.com", "mail.example.com"] {
            assert_eq!(
                crate::domain::web_links::resolve_owner(separate, &rules),
                separate
            );
        }
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
    if value.len() > 8256 {
        return Err(invalid("website change is too large"));
    }
    let change: Change =
        serde_json::from_str(value).map_err(|_| invalid("invalid website change"))?;
    if let Some(rule) = &change.next {
        if rule.enabled
            || rule.members.is_none()
            || !rule.exceptions.is_empty()
            || rule.auto_root.is_some()
        {
            return Err(invalid("only explicit website members can be saved"));
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

/// Freeze earlier automatic rules once, retaining only domains already observed.
pub async fn migrate_legacy_web_grouping(tx: &mut Transaction<'_, Sqlite>) -> Result<(), String> {
    let previous = load_in_tx(tx).await?;
    if !previous.values().any(|rule| {
        rule.enabled
            || rule.members.is_none()
            || !rule.exceptions.is_empty()
            || rule.auto_root.is_some()
    }) {
        return Ok(());
    }
    let domains: Vec<String> = sqlx::query_scalar(
        "SELECT DISTINCT normalized_domain FROM web_activity_segments ORDER BY normalized_domain",
    )
    .fetch_all(&mut **tx)
    .await
    .map_err(|error| error.to_string())?;
    let mut next = previous.clone();
    for (parent, rule) in &previous {
        if !rule.enabled
            && rule.members.is_some()
            && rule.exceptions.is_empty()
            && rule.auto_root.is_none()
        {
            continue;
        }
        let mut members = rule.members.clone().unwrap_or_default();
        if rule.enabled {
            members.extend(
                domains
                    .iter()
                    .filter(|domain| {
                        crate::domain::web_links::resolve_legacy_owner(domain, &previous)
                            == format!("site:{parent}")
                    })
                    .cloned(),
            );
        }
        let main = if !rule.enabled || rule.members.is_some() || members.contains(parent) {
            parent.clone()
        } else {
            members
                .iter()
                .find(|member| !previous.contains_key(*member))
                .cloned()
                .unwrap_or_else(|| parent.clone())
        };
        members.remove(&main);
        let mut converted = rule.clone();
        converted.enabled = false;
        converted.members = Some(members);
        converted.auto_root = None;
        converted.exceptions.clear();
        validate_rule(&main, &converted)?;
        next.remove(parent);
        if converted
            .members
            .as_ref()
            .is_some_and(|members| members.is_empty())
        {
            let key = format!("__web_domain_override::{main}");
            let raw: Option<String> = sqlx::query_scalar("SELECT value FROM settings WHERE key=?")
                .bind(&key)
                .fetch_optional(&mut **tx)
                .await
                .map_err(|error| error.to_string())?;
            let mut value: serde_json::Map<String, serde_json::Value> = raw
                .as_deref()
                .map(serde_json::from_str)
                .transpose()
                .map_err(|error| error.to_string())?
                .unwrap_or_default();
            for (field, text) in [
                ("displayName", &converted.display_name),
                ("category", &converted.category),
                ("color", &converted.color),
            ] {
                if let Some(text) = text {
                    value
                        .entry(field)
                        .or_insert_with(|| serde_json::Value::String(text.clone()));
                }
            }
            if !value.is_empty() {
                sqlx::query("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
                    .bind(key).bind(serde_json::to_string(&value).map_err(|error| error.to_string())?)
                    .execute(&mut **tx).await.map_err(|error| error.to_string())?;
            }
            continue;
        }
        next.insert(main, converted);
    }
    crate::domain::web_links::validate_rules(&next)?;
    for parent in previous.keys() {
        sqlx::query("DELETE FROM settings WHERE key=?")
            .bind(format!("{SETTING_PREFIX}{parent}"))
            .execute(&mut **tx)
            .await
            .map_err(|error| error.to_string())?;
    }
    for (parent, rule) in next {
        sqlx::query("INSERT INTO settings(key,value) VALUES(?,?)")
            .bind(format!("{SETTING_PREFIX}{parent}"))
            .bind(serde_json::to_string(&rule).map_err(|error| error.to_string())?)
            .execute(&mut **tx)
            .await
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebLinksSnapshot {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub segments: Option<Vec<WebActivityDetailSegment>>,
    pub rules: WebLinkRules,
    pub overrides: BTreeMap<String, serde_json::Value>,
    /// Domains with stored activity, independent of the recent candidate limit.
    pub domains: Vec<String>,
}

pub async fn snapshot(pool: &sqlx::Pool<Sqlite>) -> Result<WebLinksSnapshot, String> {
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    snapshot_in_tx(&mut tx).await
}

pub async fn snapshot_in_tx(tx: &mut Transaction<'_, Sqlite>) -> Result<WebLinksSnapshot, String> {
    let rules = load_in_tx(tx).await?;
    let rows: Vec<(String, String)> = sqlx::query_as("SELECT substr(key,24),value FROM settings WHERE substr(key,1,23)='__web_domain_override::'")
        .fetch_all(&mut **tx).await.map_err(|error| error.to_string())?;
    let overrides = rows
        .into_iter()
        .filter_map(|(key, value)| serde_json::from_str(&value).ok().map(|value| (key, value)))
        .collect();
    let domains: Vec<String> = sqlx::query_scalar(
        "SELECT DISTINCT normalized_domain FROM web_activity_segments ORDER BY normalized_domain",
    )
    .fetch_all(&mut **tx)
    .await
    .map_err(|e| e.to_string())?;
    Ok(WebLinksSnapshot {
        segments: None,
        rules,
        overrides,
        domains,
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
    snapshot.segments = Some(sqlx::query_as("SELECT id,browser_client_id,browser_kind,browser_exe_name,domain,normalized_domain,url,title,NULL AS favicon_url,start_time,COALESCE(end_time, MAX(start_time, MIN(?, updated_at+45000))) AS end_time,COALESCE(duration, MAX(0, MIN(?, updated_at+45000)-start_time)) AS duration FROM web_activity_segments WHERE start_time < ? AND COALESCE(end_time, MIN(?,updated_at+45000)) > ? ORDER BY start_time,id")
        .bind(now).bind(now).bind(end).bind(now).bind(start).fetch_all(&mut *tx).await.map_err(|error| error.to_string())?);
    Ok(snapshot)
}
