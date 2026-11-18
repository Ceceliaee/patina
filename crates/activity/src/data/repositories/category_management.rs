use super::classification_settings::ClassificationSettingMutation;
use crate::domain::classification::ClassificationSnapshot;
use sqlx::{Sqlite, Transaction};
use std::collections::{BTreeMap, BTreeSet};

pub use patina_activity_model::views::classification::CategoryEdit;

pub struct CategoryPlan {
    pub labels: BTreeMap<String, String>,
    pub mutations: Vec<ClassificationSettingMutation>,
    replacements: BTreeMap<String, String>,
}

pub fn plan(
    snapshot: &ClassificationSnapshot,
    changes: &[CategoryEdit],
) -> Result<CategoryPlan, String> {
    let original: BTreeMap<_, _> = snapshot
        .available_categories()
        .into_iter()
        .map(|c| (c.id.clone(), c))
        .collect();
    let mut labels: BTreeMap<_, _> = original
        .iter()
        .map(|(id, c)| (id.clone(), c.label.clone()))
        .collect();
    let mut mutations = Vec::new();
    let mut replacements = BTreeMap::new();
    let mut seen = BTreeSet::new();
    for change in changes {
        if !seen.insert(&change.id)
            || matches!(change.id.as_str(), "other" | "system" | "anonymous")
            || original.get(&change.id).map(|c| &c.label) != change.previous.as_ref()
            || original.get(&change.id).map(|c| &c.color) != change.previous_color.as_ref()
        {
            return Err("category changed since loading".into());
        }
        if change.previous.is_none() && !change.id.starts_with("custom:category_") {
            return Err("invalid new category".into());
        }
        if let Some(target) = &change.replacement {
            labels.remove(&change.id);
            replacements.insert(change.id.clone(), target.clone());
            for prefix in [
                "__custom_category::",
                "__category_label_override::",
                "__category_color_override::",
                "__category_default_color_assignment::",
            ] {
                mutations.push(ClassificationSettingMutation {
                    key: format!("{prefix}{}", change.id),
                    value: None,
                });
            }
            mutations.push(ClassificationSettingMutation {
                key: format!("__deleted_category::{}", change.id),
                value: (!change.id.starts_with("custom:")).then(|| "1".into()),
            });
            continue;
        }
        let name = change.label.trim();
        if name.is_empty() || name.encode_utf16().count() > 80 {
            return Err("invalid category name".into());
        }
        labels.insert(change.id.clone(), name.into());
        if change.previous.is_none() {
            mutations.push(ClassificationSettingMutation {
                key: format!("__custom_category::{}", change.id),
                value: Some("1".into()),
            });
            mutations.push(ClassificationSettingMutation {
                key: format!("__category_default_color_assignment::{}", change.id),
                value: Some(crate::domain::classification::default_category_color(
                    &change.id,
                )),
            });
        }
        mutations.push(ClassificationSettingMutation {
            key: format!("__category_label_override::{}", change.id),
            value: Some(name.into()),
        });
        if let Some(color) = &change.color {
            if !color.is_empty()
                && !(color.len() == 7
                    && color.starts_with('#')
                    && color[1..].bytes().all(|b| b.is_ascii_hexdigit()))
            {
                return Err("invalid category color".into());
            }
            mutations.push(ClassificationSettingMutation {
                key: format!("__category_color_override::{}", change.id),
                value: (!color.is_empty()).then(|| color.to_uppercase()),
            });
        }
    }
    for change in changes.iter().filter(|change| change.replacement.is_none()) {
        if labels.iter().any(|(id, label)| {
            id != &change.id && label.to_lowercase() == change.label.trim().to_lowercase()
        }) {
            return Err("duplicate category name".into());
        }
    }
    for id in replacements.keys().cloned().collect::<Vec<_>>() {
        let mut target = replacements[&id].clone();
        let mut visited = BTreeSet::from([id.clone()]);
        while let Some(next) = replacements.get(&target) {
            if !visited.insert(target.clone()) {
                return Err("category merge cycle".into());
            }
            target = next.clone();
        }
        if !labels.contains_key(&target) || target == "system" {
            return Err("invalid replacement category".into());
        }
        replacements.insert(id, target);
    }
    Ok(CategoryPlan {
        labels,
        mutations,
        replacements,
    })
}

impl CategoryPlan {
    /// Rewrite only classification references, preserving appearance, privacy and site metadata.
    pub async fn rewrite_assignments(
        &self,
        tx: &mut Transaction<'_, Sqlite>,
        mutations: &mut Vec<ClassificationSettingMutation>,
    ) -> Result<(), String> {
        if self.replacements.is_empty() {
            return Ok(());
        }
        let rows: Vec<(String, String)> = sqlx::query_as("SELECT key,value FROM settings WHERE key GLOB '__app_override::*' OR key GLOB '__web_domain_override::*' OR key GLOB '__web_site::*'")
            .fetch_all(&mut **tx).await.map_err(|e| e.to_string())?;
        let mut values: BTreeMap<_, _> = rows.into_iter().map(|(k, v)| (k, Some(v))).collect();
        for change in mutations.iter() {
            if change.key.starts_with("__app_override::")
                || change.key.starts_with("__web_domain_override::")
                || change.key.starts_with("__web_site::")
            {
                values.insert(change.key.clone(), change.value.clone());
            }
        }
        for (key, value) in values {
            let Some(value) = value else { continue };
            let mut raw: serde_json::Map<String, serde_json::Value> =
                serde_json::from_str(&value).map_err(|e| e.to_string())?;
            let Some(target) = raw.get("category").and_then(|v| v.as_str()).and_then(|id| {
                self.replacements
                    .get(crate::domain::classification::normalize_category_id(id))
            }) else {
                continue;
            };
            raw.insert("category".into(), target.clone().into());
            mutations.retain(|m| m.key != key);
            let next = serde_json::Value::Object(raw);
            let next = if key.starts_with("__web_site::") {
                let previous: serde_json::Value =
                    serde_json::from_str(&value).map_err(|e| e.to_string())?;
                serde_json::json!({"previous": previous, "next": next})
            } else {
                next
            };
            mutations.push(ClassificationSettingMutation {
                key,
                value: Some(next.to_string()),
            });
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::super::classification_settings::apply_classification_setting_mutations_in_tx;
    use super::*;

    fn edit(snapshot: &ClassificationSnapshot, id: &str) -> CategoryEdit {
        let category = snapshot.resolve_category_by_id(id).unwrap();
        CategoryEdit {
            id: id.into(),
            previous: Some(category.label.clone()),
            previous_color: Some(category.color),
            label: category.label,
            color: None,
            replacement: None,
        }
    }

    #[test]
    fn category_defaults_match_frontend_and_keep_persisted_assignments() {
        use crate::domain::classification::default_category_color;
        for (id, color) in [
            ("office", "#6F7AE6"),
            ("development", "#4790CF"),
            ("custom:category_research", "#5A9861"),
            ("custom:category_alpha", "#B6688B"),
            ("custom:category_beta", "#4F5FD7"),
        ] {
            assert_eq!(default_category_color(id), color);
        }
        let snapshot = ClassificationSnapshot::from_settings([
            (
                "__category_default_color_assignment::office".into(),
                "#35a69e".into(),
            ),
            ("__category_color_override::office".into(), "#112233".into()),
        ]);
        assert_eq!(snapshot.default_category_color("office"), "#35A69E");
        assert_eq!(
            snapshot.resolve_category_by_id("office").unwrap().color,
            "#112233"
        );
    }

    #[test]
    fn category_conflicts_and_protected_categories_fail_closed() {
        let snapshot = ClassificationSnapshot::default();
        let mut change = edit(&snapshot, "office");
        change.color = Some("invalid".into());
        assert!(plan(&snapshot, &[change.clone()]).is_err());
        change.color = None;
        change.previous_color = Some("#112233".into());
        assert!(plan(&snapshot, &[change]).is_err());
        assert!(plan(&snapshot, &[edit(&snapshot, "other")]).is_err());
        let mut change = edit(&snapshot, "office");
        change.label = snapshot.resolve_category_by_id("game").unwrap().label;
        assert!(plan(&snapshot, &[change]).is_err());
        let mut a = edit(&snapshot, "office");
        a.replacement = Some("game".into());
        let mut b = edit(&snapshot, "game");
        b.replacement = Some("office".into());
        assert!(plan(&snapshot, &[a, b]).is_err());
    }

    #[tokio::test]
    async fn category_removal_preserves_history_and_unrelated_settings() {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::query("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("CREATE TABLE sessions (id INTEGER)")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO sessions VALUES (1)")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::raw_sql(crate::data::schema::WEB_ACTIVITY_SCHEMA_SQL)
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO web_activity_segments (browser_client_id,browser_kind,browser_exe_name,domain,normalized_domain,url,title,start_time,end_time,duration,created_at,updated_at) VALUES ('client','chrome','chrome.exe','example.org','example.org','https://example.org/kept','Kept title',1000,61000,60000,1000,61000)")
            .execute(&pool).await.unwrap();
        for (key, value) in [
            (
                "__app_override::studio.exe",
                r##"{"category":"ai","color":"#112233","displayName":"Studio","captureTitle":false}"##,
            ),
            (
                "__web_domain_override::example.com",
                r#"{"category":"ai","enabled":false,"knownDomain":true}"#,
            ),
            (
                "__app_override::taskmgr.exe",
                r#"{"category":"office","displayName":"Task Manager"}"#,
            ),
            (
                "__web_site::example.org",
                r#"{"version":2,"category":"office","displayName":"Example","exceptions":["keep.example.org"]}"#,
            ),
            ("__category_color_override::office", "#234567"),
        ] {
            sqlx::query("INSERT INTO settings VALUES (?,?)")
                .bind(key)
                .bind(value)
                .execute(&pool)
                .await
                .unwrap();
        }
        let rows: Vec<(String, String)> = sqlx::query_as("SELECT key,value FROM settings")
            .fetch_all(&pool)
            .await
            .unwrap();
        let snapshot = ClassificationSnapshot::from_settings(rows);
        let mut change = edit(&snapshot, "office");
        change.replacement = Some("other".into());
        let plan = plan(&snapshot, &[change]).unwrap();
        let mut mutations = plan.mutations.clone();
        let mut tx = pool.begin().await.unwrap();
        plan.rewrite_assignments(&mut tx, &mut mutations)
            .await
            .unwrap();
        for key in [
            "__app_override::studio.exe",
            "__web_domain_override::example.com",
            "__web_site::example.org",
        ] {
            let value: serde_json::Value = serde_json::from_str(
                mutations
                    .iter()
                    .find(|m| m.key == key)
                    .unwrap()
                    .value
                    .as_ref()
                    .unwrap(),
            )
            .unwrap();
            let value = if key.starts_with("__web_site::") {
                &value["next"]
            } else {
                &value
            };
            assert_eq!(value["category"], "other");
            if key.starts_with("__app") {
                assert_eq!(value["color"], "#112233");
                assert_eq!(value["captureTitle"], false);
            }
            if key.starts_with("__web_domain") {
                assert_eq!(value["enabled"], false);
                assert_eq!(value["knownDomain"], true);
            }
            if key.starts_with("__web_site") {
                assert_eq!(value["exceptions"][0], "keep.example.org");
            }
        }
        apply_classification_setting_mutations_in_tx(&mut tx, &mutations)
            .await
            .unwrap();
        tx.commit().await.unwrap();
        let history: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM sessions")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(history, 1);
        let web_history: Vec<(String, String, i64, i64, i64)> = sqlx::query_as(
            "SELECT url,title,start_time,end_time,duration FROM web_activity_segments",
        )
        .fetch_all(&pool)
        .await
        .unwrap();
        assert_eq!(
            web_history,
            vec![(
                "https://example.org/kept".into(),
                "Kept title".into(),
                1000,
                61000,
                60000
            )]
        );
        let rows: Vec<(String, String)> = sqlx::query_as("SELECT key,value FROM settings")
            .fetch_all(&pool)
            .await
            .unwrap();
        let updated = ClassificationSnapshot::from_settings(rows);
        assert!(updated.resolve_category_by_id("office").is_none());
        assert_eq!(updated.resolve_session_category("studio.exe").id, "other");
        assert_eq!(updated.resolve_session_category("taskmgr.exe").id, "other");
        assert_eq!(updated.resolve_web_category("example.org").id, "other");
        assert_eq!(updated.resolve_web_category("www.example.org").id, "other");
        assert_eq!(updated.resolve_web_category("example.com").id, "other");
        assert!(!updated.is_web_domain_enabled("example.com"));
    }

    #[test]
    fn merge_chains_resolve_to_the_surviving_category() {
        let snapshot = ClassificationSnapshot::default();
        let mut a = edit(&snapshot, "office");
        a.replacement = Some("game".into());
        let mut b = edit(&snapshot, "game");
        b.replacement = Some("design".into());
        let result = plan(&snapshot, &[a, b]).unwrap();
        assert_eq!(result.replacements["office"], "design");
        assert_eq!(result.replacements["game"], "design");
        assert!(!result.labels.contains_key("office"));
    }
}
