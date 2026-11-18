use crate::data::repositories::classification_settings::{
    apply_classification_setting_mutations_in_tx, load_classification_snapshot_in_tx,
    ClassificationSettingMutation,
};
use patina_activity_model::views::website_rules;
use sqlx::SqlitePool;
use std::collections::BTreeMap;
mod web;
pub use patina_activity_model::views::classification::{AppLinkEdit, AppRule, ClassificationRules};
pub use website_rules::{WebsiteRule, WebsiteRuleDraft};

pub(super) async fn load_classification_rules(
    pool: SqlitePool,
) -> Result<ClassificationRules, String> {
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    let classification = load_classification_snapshot_in_tx(&mut tx).await?;
    let websites = web::load_draft_in_tx(&mut tx).await?;
    let titles_enabled: Option<String> =
        sqlx::query_scalar("SELECT value FROM settings WHERE key='title_recording_enabled'")
            .fetch_optional(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;
    let titles_enabled = titles_enabled
        .as_deref()
        .is_none_or(|v| crate::domain::settings::parse_boolean_setting(v, true));
    let web_enabled: Option<String> =
        sqlx::query_scalar("SELECT value FROM settings WHERE key='web_activity_enabled'")
            .fetch_optional(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;
    let web_enabled = web_enabled
        .as_deref()
        .is_some_and(|v| crate::domain::settings::parse_boolean_setting(v, false));
    let web_mode: Option<String> =
        sqlx::query_scalar("SELECT value FROM settings WHERE key='classification_object_mode'")
            .fetch_optional(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;
    let web_mode = web_mode.as_deref() == Some("web");
    let identities:Vec<(String,String)>=sqlx::query_as("SELECT exe_name,MAX(app_name) FROM (SELECT exe_name,app_name FROM sessions UNION ALL SELECT exe_name,app_name FROM import_exact_sessions UNION ALL SELECT exe_name,app_name FROM import_time_buckets UNION ALL SELECT substr(key,17),'' FROM settings WHERE key GLOB '__app_override::*') GROUP BY exe_name ORDER BY exe_name").fetch_all(&mut *tx).await.map_err(|e|e.to_string())?;
    let overrides: BTreeMap<String, String> = sqlx::query_as::<_, (String, String)>(
        "SELECT substr(key,17),value FROM settings WHERE key GLOB '__app_override::*'",
    )
    .fetch_all(&mut *tx)
    .await
    .map_err(|e| e.to_string())?
    .into_iter()
    .collect();
    let app_links: BTreeMap<String, String> = sqlx::query_as::<_, (String, String)>(
        "SELECT substr(key,13),value FROM settings WHERE key GLOB '__app_link::*'",
    )
    .fetch_all(&mut *tx)
    .await
    .map_err(|e| e.to_string())?
    .into_iter()
    .collect();
    tx.commit().await.map_err(|e| e.to_string())?;
    let mut names_by_exe = BTreeMap::<String, String>::new();
    for (exe, name) in identities {
        let exe = crate::domain::classification::canonical_exe(&exe);
        if exe.is_empty() || exe == "activity:anonymous" {
            continue;
        }
        let fallback = names_by_exe.entry(exe).or_default();
        if name > *fallback {
            *fallback = name;
        }
    }
    for identity in app_links.keys().chain(app_links.values()) {
        names_by_exe.entry(identity.clone()).or_default();
    }
    let mut apps = Vec::with_capacity(names_by_exe.len());
    for (exe, fallback) in names_by_exe {
        let original = overrides.get(&exe).cloned();
        let raw: serde_json::Value =
            serde_json::from_str(original.as_deref().unwrap_or("{}")).map_err(|e| e.to_string())?;
        let resolved_category = classification.resolve_session_category(&exe);
        let (name, color) = classification.app_appearance(&exe);
        apps.push(AppRule {
            name: name
                .unwrap_or(if fallback.is_empty() {
                    exe.trim_end_matches(".exe")
                } else {
                    &fallback
                })
                .to_owned(),
            category: crate::domain::classification::normalize_category_id(
                raw["category"]
                    .as_str()
                    .unwrap_or(if app_links.contains_key(&exe) {
                        "other"
                    } else {
                        &resolved_category.id
                    }),
            )
            .to_owned(),
            color: color.unwrap_or("").into(),
            track: classification.is_app_enabled(&exe),
            titles: raw["captureTitle"].as_bool().unwrap_or(true),
            exe,
            original,
        });
    }
    let available = classification.available_categories();
    let category_colors = available
        .iter()
        .map(|c| (c.id.clone(), c.color.clone()))
        .collect();
    let category_color_overrides = available
        .iter()
        .filter_map(|c| {
            classification
                .category_color_override(&c.id)
                .map(|color| (c.id.clone(), color.to_owned()))
        })
        .collect();
    let category_default_colors = available
        .iter()
        .map(|c| (c.id.clone(), classification.default_category_color(&c.id)))
        .collect();
    let categories = available.into_iter().map(|c| (c.id, c.label)).collect();
    Ok(ClassificationRules {
        websites,
        titles_enabled,
        web_enabled,
        web_mode,
        category_color_overrides,
        category_default_colors,
        apps,
        app_links,
        categories,
        category_colors,
    })
}
pub use crate::data::repositories::category_management::CategoryEdit;
pub(super) async fn save_classification_rules(
    pool: &SqlitePool,
    apps: &[AppRule],
    websites: Option<&WebsiteRuleDraft>,
    links: &[AppLinkEdit],
    categories: &[CategoryEdit],
) -> Result<(), crate::ActivityError> {
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    let classification = load_classification_snapshot_in_tx(&mut tx).await?;
    let category_plan =
        crate::data::repositories::category_management::plan(&classification, categories)?;
    let labels = &category_plan.labels;
    let mut mutations = category_plan.mutations.clone();
    mutations.extend(web::plan_mutations_in_tx(&mut tx, websites, labels, categories).await?);
    for link in links {
        mutations.push(ClassificationSettingMutation {
            key: format!("__app_link::{}", link.member),
            value: Some(
                serde_json::json!({"parent":link.parent,"previous":link.original}).to_string(),
            ),
        });
    }
    for app in apps {
        if app.exe.is_empty()
            || app.exe == "activity:anonymous"
            || app.name.trim().encode_utf16().count() > 80
            || !labels.contains_key(&app.category)
        {
            return Err("invalid application change".into());
        }
        if !app.color.is_empty()
            && !(app.color.len() == 7
                && app.color.starts_with('#')
                && app.color[1..].bytes().all(|b| b.is_ascii_hexdigit()))
        {
            return Err("invalid color".into());
        }
        let key = format!("__app_override::{}", app.exe);
        let old: Option<String> = sqlx::query_scalar("SELECT value FROM settings WHERE key=?")
            .bind(&key)
            .fetch_optional(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;
        if old != app.original {
            return Err(crate::ActivityError::Conflict(
                "application changed since loading".into(),
            ));
        }
        let mut raw: serde_json::Map<String, serde_json::Value> =
            serde_json::from_str(old.as_deref().unwrap_or("{}")).map_err(|e| e.to_string())?;
        for (field, v) in [
            ("displayName", app.name.trim()),
            ("category", &app.category),
            ("color", &app.color),
        ] {
            if v.is_empty() {
                raw.remove(field);
            } else {
                raw.insert(field.into(), v.into());
            }
        }
        for (field, value) in [("track", app.track), ("captureTitle", app.titles)] {
            if value {
                raw.remove(field);
            } else {
                raw.insert(field.into(), false.into());
            }
        }
        raw.insert(
            "updatedAt".into(),
            crate::platform::clock::unix_timestamp_millis_i64().into(),
        );
        mutations.push(ClassificationSettingMutation {
            key,
            value: Some(serde_json::Value::Object(raw).to_string()),
        });
    }
    category_plan
        .rewrite_assignments(&mut tx, &mut mutations)
        .await?;
    apply_classification_setting_mutations_in_tx(&mut tx, &mutations).await?;
    let now = crate::platform::clock::unix_timestamp_millis_i64();
    for rule in apps {
        if !rule.track {
            crate::data::repositories::sessions::end_active_session_for_exe_tx(
                &mut tx, &rule.exe, now,
            )
            .await
            .map_err(|e| e.to_string())?;
        }
        if !rule.titles {
            crate::data::repositories::sessions::disable_active_title_for_exe_tx(
                &mut tx, &rule.exe, now,
            )
            .await
            .map_err(|e| e.to_string())?;
        }
    }
    Ok(tx.commit().await.map_err(|e| e.to_string())?)
}
