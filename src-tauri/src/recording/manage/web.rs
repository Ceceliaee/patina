use super::*;
use crate::domain::web_links::{group_domain, resolve_owner, SETTING_PREFIX};
use sqlx::{Sqlite, Transaction};
use std::collections::BTreeSet;

#[derive(Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WebRule {
    pub identity: String,
    pub domain: String,
    pub name: String,
    pub category: String,
    pub color: String,
    pub track: bool,
    pub titles: bool,
    pub members: Vec<String>,
    pub original: BTreeMap<String, Option<String>>,
}

pub(super) async fn read(tx: &mut Transaction<'_, Sqlite>) -> Result<Vec<WebRule>, String> {
    let snapshot = crate::data::repositories::web_links::snapshot_in_tx(tx).await?;
    let stored: BTreeMap<String, String> = sqlx::query_as::<_, (String, String)>(
        "SELECT key,value FROM settings WHERE key GLOB '__web_domain_override::*' OR key GLOB '__web_site::*'",
    ).fetch_all(&mut **tx).await.map_err(|e| e.to_string())?.into_iter().collect();
    let mut groups = BTreeMap::<String, BTreeSet<String>>::new();
    for domain in snapshot.domains.iter().chain(snapshot.overrides.keys()) {
        groups
            .entry(resolve_owner(domain, &snapshot.rules))
            .or_default()
            .insert(domain.clone());
    }
    let mut result = Vec::new();
    for (identity, members) in groups {
        let root = group_domain(&identity);
        let domain = root.clone().unwrap_or_else(|| identity.clone());
        let appearance_key = if root.is_some() {
            format!("{SETTING_PREFIX}{domain}")
        } else {
            format!("__web_domain_override::{domain}")
        };
        let raw: serde_json::Value = serde_json::from_str(
            stored
                .get(&appearance_key)
                .map(String::as_str)
                .unwrap_or("{}"),
        )
        .map_err(|e| e.to_string())?;
        let original_value = stored.get(&appearance_key).cloned();
        let mut original = BTreeMap::from([(appearance_key, original_value)]);
        for member in &members {
            let key = format!("__web_domain_override::{member}");
            original.insert(key.clone(), stored.get(&key).cloned());
        }
        let enabled = |member: &String, key: &str| {
            snapshot
                .overrides
                .get(member)
                .and_then(|v| v[key].as_bool())
                .unwrap_or(true)
        };
        result.push(WebRule {
            identity,
            domain: domain.clone(),
            name: raw["displayName"]
                .as_str()
                .filter(|s| !s.trim().is_empty())
                .unwrap_or(&domain)
                .into(),
            category: raw["category"].as_str().unwrap_or("other").into(),
            color: raw["color"].as_str().unwrap_or("").into(),
            track: members.iter().any(|m| enabled(m, "enabled")),
            titles: members.iter().all(|m| enabled(m, "captureTitle")),
            members: members.into_iter().collect(),
            original,
        });
    }
    Ok(result)
}

pub(super) async fn changes(
    tx: &mut Transaction<'_, Sqlite>,
    edits: &[WebRule],
    labels: &BTreeMap<String, String>,
) -> Result<Vec<ClassificationSettingMutation>, String> {
    if edits.is_empty() {
        return Ok(vec![]);
    }
    let current = read(tx).await?;
    let mut mutations = Vec::new();
    let mut identities = BTreeSet::new();
    for edit in edits {
        let old = current
            .iter()
            .find(|r| r.identity == edit.identity)
            .ok_or("website no longer exists")?;
        if !identities.insert(&edit.identity)
            || old.original != edit.original
            || old.members != edit.members
            || old.domain != edit.domain
        {
            return Err("website changed since loading".into());
        }
        if edit.name.trim().encode_utf16().count() > 80
            || !labels.contains_key(&edit.category)
            || (!edit.color.is_empty()
                && !(edit.color.len() == 7
                    && edit.color.starts_with('#')
                    && edit.color[1..].bytes().all(|b| b.is_ascii_hexdigit())))
        {
            return Err("invalid website change".into());
        }
        let grouped = group_domain(&edit.identity).is_some();
        let appearance_key = if grouped {
            format!("{SETTING_PREFIX}{}", edit.domain)
        } else {
            format!("__web_domain_override::{}", edit.domain)
        };
        let mut writes = BTreeMap::<String, serde_json::Map<String, serde_json::Value>>::new();
        let mut appearance: serde_json::Map<String, serde_json::Value> = serde_json::from_str(
            old.original
                .get(&appearance_key)
                .and_then(|v| v.as_deref())
                .unwrap_or("{}"),
        )
        .map_err(|e| e.to_string())?;
        for (key, value) in [
            ("displayName", edit.name.trim()),
            ("category", &edit.category),
            ("color", &edit.color),
        ] {
            if value.is_empty() {
                appearance.remove(key);
            } else {
                appearance.insert(key.into(), value.into());
            }
        }
        if grouped {
            appearance.insert("version".into(), 2.into());
        }
        writes.insert(appearance_key, appearance);
        for member in &edit.members {
            if edit.track == old.track && edit.titles == old.titles {
                continue;
            }
            let key = format!("__web_domain_override::{member}");
            let raw = writes.entry(key.clone()).or_insert(
                serde_json::from_str(
                    old.original
                        .get(&key)
                        .and_then(|v| v.as_deref())
                        .unwrap_or("{}"),
                )
                .map_err(|e| e.to_string())?,
            );
            if edit.track != old.track {
                raw.insert("enabled".into(), edit.track.into());
            }
            if edit.titles != old.titles {
                raw.insert("captureTitle".into(), edit.titles.into());
            }
        }
        for (key, value) in writes {
            let value = if key.starts_with(SETTING_PREFIX) {
                let previous: serde_json::Value = old
                    .original
                    .get(&key)
                    .and_then(|v| v.as_deref())
                    .map(serde_json::from_str)
                    .transpose()
                    .map_err(|e| e.to_string())?
                    .unwrap_or(serde_json::Value::Null);
                serde_json::json!({"previous": previous, "next": value})
            } else {
                serde_json::Value::Object(value)
            };
            mutations.push(ClassificationSettingMutation {
                key,
                value: Some(value.to_string()),
            });
        }
        let now = crate::platform::clock::unix_timestamp_millis_i64();
        for member in &edit.members {
            if !edit.track {
                sqlx::query("UPDATE web_activity_segments SET end_time=MAX(start_time,MIN(?,updated_at+?)), duration=MAX(0,MIN(?,updated_at+?)-start_time) WHERE normalized_domain=? AND end_time IS NULL")
                    .bind(now).bind(crate::domain::web_activity::WEB_ACTIVITY_OBSERVATION_TTL_MS)
                    .bind(now).bind(crate::domain::web_activity::WEB_ACTIVITY_OBSERVATION_TTL_MS).bind(member)
                    .execute(&mut **tx).await.map_err(|e| e.to_string())?;
            }
            if !edit.titles {
                sqlx::query("UPDATE web_activity_segments SET title=NULL WHERE normalized_domain=? AND end_time IS NULL")
                    .bind(member).execute(&mut **tx).await.map_err(|e| e.to_string())?;
            }
        }
    }
    Ok(mutations)
}
