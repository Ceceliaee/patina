use super::read::{
    fetch_active_activity_reminder_rules_tx, fetch_activity_reminder_rule_by_id,
    fetch_session_usage_facts_tx, fetch_web_usage_facts_tx,
};
use crate::domain::classification::{canonical_exe, normalize_domain_key};
use crate::domain::tools::{
    ActivityReminderNotification, ActivityReminderTarget, ToolActivityReminderRule,
};
use sqlx::{Pool, Sqlite, Transaction};
use std::collections::HashMap;

pub async fn create_activity_reminder_rule(
    pool: &Pool<Sqlite>,
    target: &ActivityReminderTarget,
    label_snapshot: &str,
    limit_ms: i64,
    message: &str,
    now_ms: i64,
) -> Result<ToolActivityReminderRule, String> {
    let normalized_target = normalize_activity_target(target)?;
    if matches!(
        target,
        ActivityReminderTarget::Category { .. } | ActivityReminderTarget::Web { .. }
    ) {
        let classification =
            crate::data::repositories::classification_settings::load_classification_snapshot(pool)
                .await?;
        match target {
            ActivityReminderTarget::Category { category_id }
                if !classification.category_is_available(category_id.trim()) =>
            {
                return Err("activity reminder category is unavailable".to_string());
            }
            ActivityReminderTarget::Web { .. } => {
                let normalized_domain =
                    normalized_target.normalized_domain.as_deref().unwrap_or("");
                if !classification.is_web_domain_enabled(normalized_domain) {
                    return Err("activity reminder web domain is unavailable".to_string());
                }
                let observed: i64 = sqlx::query_scalar(
                    "SELECT EXISTS(
                        SELECT 1 FROM web_activity_segments
                        WHERE LOWER(TRIM(normalized_domain, '.')) = ?
                    )",
                )
                .bind(normalized_domain)
                .fetch_one(pool)
                .await
                .map_err(|error| {
                    format!("failed to validate activity reminder web domain: {error}")
                })?;
                if observed == 0 {
                    return Err("activity reminder web domain has not been observed".to_string());
                }
            }
            _ => {}
        }
    }
    let limit_ms = limit_ms.clamp(60_000, 86_400_000);
    let label_snapshot = label_snapshot.trim();
    let label_snapshot = if label_snapshot.is_empty() {
        normalized_target.default_label.as_str()
    } else {
        label_snapshot
    };

    let result = sqlx::query(
        "INSERT INTO tool_activity_reminder_rules (
            target_kind, app_name, exe_name, category_id, normalized_domain, label_snapshot,
            limit_ms, message, created_at, updated_at, disabled_at, last_fired_date_key
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)",
    )
    .bind(normalized_target.kind)
    .bind(normalized_target.app_name)
    .bind(normalized_target.exe_name)
    .bind(normalized_target.category_id)
    .bind(normalized_target.normalized_domain)
    .bind(label_snapshot)
    .bind(limit_ms)
    .bind(message.trim())
    .bind(now_ms)
    .bind(now_ms)
    .execute(pool)
    .await
    .map_err(|error| format!("failed to create activity reminder rule: {error}"))?;

    fetch_activity_reminder_rule_by_id(pool, result.last_insert_rowid()).await
}

pub async fn disable_activity_reminder_rule(
    pool: &Pool<Sqlite>,
    rule_id: i64,
    now_ms: i64,
) -> Result<(), String> {
    sqlx::query(
        "UPDATE tool_activity_reminder_rules
         SET disabled_at = ?, updated_at = ?
         WHERE id = ? AND disabled_at IS NULL",
    )
    .bind(now_ms)
    .bind(now_ms)
    .bind(rule_id)
    .execute(pool)
    .await
    .map_err(|error| format!("failed to disable activity reminder rule: {error}"))?;
    Ok(())
}

struct NormalizedActivityTarget {
    kind: &'static str,
    app_name: Option<String>,
    exe_name: Option<String>,
    category_id: Option<String>,
    normalized_domain: Option<String>,
    default_label: String,
}

fn normalize_activity_target(
    target: &ActivityReminderTarget,
) -> Result<NormalizedActivityTarget, String> {
    match target {
        ActivityReminderTarget::App { app_name, exe_name } => {
            let app_name = app_name.trim();
            if app_name.is_empty() {
                return Err("activity reminder app is required".to_string());
            }
            let exe_name = exe_name
                .as_deref()
                .map(canonical_exe)
                .filter(|value| !value.is_empty());
            Ok(NormalizedActivityTarget {
                kind: "app",
                app_name: Some(app_name.to_string()),
                exe_name,
                category_id: None,
                normalized_domain: None,
                default_label: app_name.to_string(),
            })
        }
        ActivityReminderTarget::Category { category_id } => {
            let category_id = category_id.trim();
            if category_id.is_empty() {
                return Err("activity reminder category is required".to_string());
            }
            Ok(NormalizedActivityTarget {
                kind: "category",
                app_name: None,
                exe_name: None,
                category_id: Some(category_id.to_string()),
                normalized_domain: None,
                default_label: category_id.to_string(),
            })
        }
        ActivityReminderTarget::Web { normalized_domain } => {
            let normalized_domain = normalize_domain_key(normalized_domain);
            if normalized_domain.is_empty() {
                return Err("activity reminder web domain is required".to_string());
            }
            Ok(NormalizedActivityTarget {
                kind: "web",
                app_name: None,
                exe_name: None,
                category_id: None,
                normalized_domain: Some(normalized_domain.clone()),
                default_label: normalized_domain,
            })
        }
    }
}

pub async fn fire_due_activity_reminders(
    pool: &Pool<Sqlite>,
    date_key: &str,
    day_start_ms: i64,
    now_ms: i64,
) -> Result<Vec<ActivityReminderNotification>, String> {
    let mut tx = pool
        .begin()
        .await
        .map_err(|error| format!("failed to start activity reminder transaction: {error}"))?;
    let rules = fetch_active_activity_reminder_rules_tx(&mut tx).await?;
    let classification =
        crate::data::repositories::classification_settings::load_classification_snapshot_in_tx(
            &mut tx,
        )
        .await?;
    let web_activity_enabled = sqlx::query_scalar::<_, String>(
        "SELECT value FROM settings WHERE key = 'web_activity_enabled' LIMIT 1",
    )
    .fetch_optional(&mut *tx)
    .await
    .map_err(|error| format!("failed to read web activity setting: {error}"))?
    .is_some_and(|value| value == "1" || value.eq_ignore_ascii_case("true"));
    let needs_session_facts = rules.iter().any(|rule| {
        rule.last_fired_date_key.as_deref() != Some(date_key)
            && matches!(
                rule.target,
                ActivityReminderTarget::App { .. } | ActivityReminderTarget::Category { .. }
            )
    });
    let needs_web_facts = web_activity_enabled
        && rules.iter().any(|rule| {
            rule.last_fired_date_key.as_deref() != Some(date_key)
                && matches!(rule.target, ActivityReminderTarget::Web { .. })
        });
    let session_facts = if needs_session_facts {
        fetch_session_usage_facts_tx(&mut tx, day_start_ms, now_ms).await?
    } else {
        Vec::new()
    };
    let web_facts = if needs_web_facts {
        fetch_web_usage_facts_tx(&mut tx, day_start_ms, now_ms).await?
    } else {
        Vec::new()
    };
    let mut category_usage = HashMap::<String, i64>::new();
    for fact in &session_facts {
        if let Some(category) = classification.resolve_tracked_session_category(&fact.exe_name) {
            *category_usage.entry(category.id).or_default() += fact.usage_ms;
        }
    }
    let mut notifications = Vec::new();

    for rule in rules {
        if rule.last_fired_date_key.as_deref() == Some(date_key) {
            continue;
        }

        let (usage_ms, target_label) = match &rule.target {
            ActivityReminderTarget::App { app_name, exe_name } => {
                if exe_name
                    .as_deref()
                    .is_some_and(|exe| !classification.is_app_enabled(exe))
                {
                    continue;
                }
                let usage = session_facts
                    .iter()
                    .filter(|fact| {
                        exe_name.as_deref().map_or_else(
                            || fact.app_name.eq_ignore_ascii_case(app_name),
                            |exe| fact.exe_name.eq_ignore_ascii_case(exe),
                        )
                    })
                    .map(|fact| fact.usage_ms)
                    .sum();
                (usage, rule.label_snapshot.clone())
            }
            ActivityReminderTarget::Category { category_id } => {
                let Some(category) = classification.resolve_category_by_id(category_id) else {
                    continue;
                };
                (
                    *category_usage.get(category_id).unwrap_or(&0),
                    category.label,
                )
            }
            ActivityReminderTarget::Web { normalized_domain } => {
                if !web_activity_enabled || !classification.is_web_domain_enabled(normalized_domain)
                {
                    continue;
                }
                let usage = web_facts
                    .iter()
                    .find(|fact| {
                        fact.normalized_domain
                            .eq_ignore_ascii_case(normalized_domain)
                    })
                    .map(|fact| fact.usage_ms)
                    .unwrap_or(0);
                (usage, rule.label_snapshot.clone())
            }
        };
        if usage_ms < rule.limit_ms {
            continue;
        }

        let update = sqlx::query(
            "UPDATE tool_activity_reminder_rules
             SET last_fired_date_key = ?, updated_at = ?
             WHERE id = ? AND disabled_at IS NULL
               AND (last_fired_date_key IS NULL OR last_fired_date_key <> ?)",
        )
        .bind(date_key)
        .bind(now_ms)
        .bind(rule.id)
        .bind(date_key)
        .execute(&mut *tx)
        .await
        .map_err(|error| format!("failed to mark activity reminder fired: {error}"))?;
        if update.rows_affected() == 0 {
            continue;
        }

        notifications.push(ActivityReminderNotification {
            rule_id: rule.id,
            target: rule.target,
            target_label,
            limit_ms: rule.limit_ms,
            usage_ms,
            message: rule.message,
        });
    }

    tx.commit()
        .await
        .map_err(|error| format!("failed to commit activity reminder transaction: {error}"))?;

    Ok(notifications)
}

pub async fn merge_activity_reminder_rules(
    tx: &mut Transaction<'_, Sqlite>,
    rules: &[ToolActivityReminderRule],
) -> Result<(), String> {
    for rule in rules {
        let target = normalize_activity_target(&rule.target)?;
        let existing_id: Option<i64> = sqlx::query_scalar(
            "SELECT id FROM tool_activity_reminder_rules
             WHERE target_kind = ?
               AND app_name IS ? AND exe_name IS ? AND category_id IS ? AND normalized_domain IS ?
               AND created_at = ?
             LIMIT 1",
        )
        .bind(target.kind)
        .bind(&target.app_name)
        .bind(&target.exe_name)
        .bind(&target.category_id)
        .bind(&target.normalized_domain)
        .bind(rule.created_at)
        .fetch_optional(&mut **tx)
        .await
        .map_err(|error| format!("failed to inspect activity reminder snapshot merge: {error}"))?;
        if existing_id.is_some() {
            continue;
        }
        sqlx::query(
            "INSERT INTO tool_activity_reminder_rules (
                target_kind, app_name, exe_name, category_id, normalized_domain,
                label_snapshot, limit_ms, message, created_at, updated_at,
                disabled_at, last_fired_date_key
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(target.kind)
        .bind(target.app_name)
        .bind(target.exe_name)
        .bind(target.category_id)
        .bind(target.normalized_domain)
        .bind(&rule.label_snapshot)
        .bind(rule.limit_ms)
        .bind(&rule.message)
        .bind(rule.created_at)
        .bind(rule.updated_at)
        .bind(rule.disabled_at)
        .bind(&rule.last_fired_date_key)
        .execute(&mut **tx)
        .await
        .map_err(|error| format!("failed to merge activity reminder snapshot rules: {error}"))?;
    }
    Ok(())
}
