use super::*;
use crate::domain::web_links::{registrable_domain, SETTING_PREFIX};
use sqlx::{Sqlite, Transaction};

pub(super) async fn read(tx: &mut Transaction<'_, Sqlite>) -> Result<WebDraft, String> {
    let snapshot = crate::data::repositories::web_links::snapshot_in_tx(tx).await?;
    let stored: Vec<(String, String)> = sqlx::query_as(
        "SELECT key,value FROM settings WHERE key GLOB '__web_domain_override::*' OR key GLOB '__web_site::*'",
    ).fetch_all(&mut **tx).await.map_err(|e| e.to_string())?;
    let mut draft = WebDraft {
        original: stored.into_iter().map(|(k, v)| (k, Some(v))).collect(),
        domains: snapshot
            .domains
            .iter()
            .chain(snapshot.overrides.keys())
            .cloned()
            .collect(),
        totals: snapshot.totals,
        favicons: snapshot.favicons,
        ..WebDraft::default()
    };
    for domain in &draft.domains {
        draft
            .original
            .entry(format!("__web_domain_override::{domain}"))
            .or_default();
        if let Some(root) = registrable_domain(domain) {
            draft
                .original
                .entry(format!("{SETTING_PREFIX}{root}"))
                .or_default();
        }
    }
    Ok(draft)
}

pub(super) async fn changes(
    tx: &mut Transaction<'_, Sqlite>,
    draft: Option<&WebDraft>,
    labels: &BTreeMap<String, String>,
    categories: &[CategoryEdit],
) -> Result<Vec<ClassificationSettingMutation>, String> {
    let Some(draft) = draft.filter(|d| d.dirty()) else {
        return Ok(vec![]);
    };
    let current = read(tx).await?;
    let mut mutations = Vec::new();
    for (key, value) in draft.changed() {
        let mut value = value.clone();
        if let Some(target) = value
            .get("category")
            .and_then(serde_json::Value::as_str)
            .and_then(|id| categories.iter().find(|c| c.id == id))
            .and_then(|c| c.replacement.as_ref())
        {
            value.insert("category".into(), target.clone().into());
        }
        if !current.original.contains_key(key)
            || current.original.get(key) != draft.original.get(key)
        {
            return Err("website changed since loading".into());
        }
        // A newly observed member must not silently escape a group-wide policy edit.
        let domain = key
            .strip_prefix(SETTING_PREFIX)
            .or_else(|| key.strip_prefix("__web_domain_override::"))
            .ok_or("invalid website setting")?;
        let root = registrable_domain(domain);
        if let Some(root) = &root {
            let group_key = format!("{SETTING_PREFIX}{root}");
            if current.original.get(&group_key) != draft.original.get(&group_key) {
                return Err("website grouping changed since loading".into());
            }
        }
        let same_group = |candidate: &&String| {
            root.as_ref().map_or(*candidate == domain, |r| {
                registrable_domain(candidate).as_ref() == Some(r)
            })
        };
        if current
            .domains
            .iter()
            .filter(same_group)
            .ne(draft.domains.iter().filter(same_group))
        {
            return Err("website members changed since loading".into());
        }
        if value
            .get("category")
            .and_then(serde_json::Value::as_str)
            .is_some_and(|c| !labels.contains_key(c))
            || value
                .get("displayName")
                .and_then(serde_json::Value::as_str)
                .is_some_and(|n| n.encode_utf16().count() > 80)
        {
            return Err("invalid website change".into());
        }
        let next = serde_json::Value::Object(value.clone());
        let stored = if key.starts_with(SETTING_PREFIX) {
            let previous: serde_json::Value = current
                .original
                .get(key)
                .and_then(|v| v.as_deref())
                .map(serde_json::from_str)
                .transpose()
                .map_err(|e| e.to_string())?
                .unwrap_or(serde_json::Value::Null);
            serde_json::json!({"previous": previous, "next": next})
        } else {
            next
        };
        mutations.push(ClassificationSettingMutation {
            key: key.clone(),
            value: Some(stored.to_string()),
        });
        if key.starts_with("__web_domain_override::") {
            let now = crate::platform::clock::unix_timestamp_millis_i64();
            if value.get("enabled").and_then(serde_json::Value::as_bool) == Some(false) {
                sqlx::query("UPDATE web_activity_segments SET end_time=MAX(start_time,MIN(?,updated_at+?)), duration=MAX(0,MIN(?,updated_at+?)-start_time) WHERE normalized_domain=? AND end_time IS NULL")
                    .bind(now).bind(crate::domain::web_activity::WEB_ACTIVITY_OBSERVATION_TTL_MS)
                    .bind(now).bind(crate::domain::web_activity::WEB_ACTIVITY_OBSERVATION_TTL_MS).bind(domain)
                    .execute(&mut **tx).await.map_err(|e| e.to_string())?;
            }
            if value
                .get("captureTitle")
                .and_then(serde_json::Value::as_bool)
                == Some(false)
            {
                sqlx::query("UPDATE web_activity_segments SET title=NULL WHERE normalized_domain=? AND end_time IS NULL")
                    .bind(domain).execute(&mut **tx).await.map_err(|e| e.to_string())?;
            }
        }
    }
    Ok(mutations)
}
