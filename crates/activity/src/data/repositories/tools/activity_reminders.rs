mod extensions;
pub use extensions::extend_activity_reminder;

use super::read::{
    fetch_active_activity_reminder_rules_tx, fetch_activity_reminder_rule_by_id,
    fetch_session_usage_facts_tx, fetch_web_usage_facts_tx,
};
use crate::domain::classification::{canonical_exe, normalize_domain_key};
use crate::domain::tools::{
    ActivityReminderCheck, ActivityReminderNotification, ActivityReminderTarget,
    ActivityReminderWatch, ActivityReminderWatchedRule, ToolActivityReminderRule,
};
use sqlx::{Pool, Sqlite, Transaction};

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

    let rule_id: i64 = sqlx::query_scalar(
        "INSERT INTO tool_activity_reminder_rules (
            target_kind, app_name, exe_name, category_id, normalized_domain, label_snapshot,
            limit_ms, message, created_at, updated_at, disabled_at, last_fired_date_key
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)
         ON CONFLICT DO UPDATE SET id = tool_activity_reminder_rules.id
         RETURNING id",
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
    .fetch_one(pool)
    .await
    .map_err(|error| format!("failed to create activity reminder rule: {error}"))?;

    fetch_activity_reminder_rule_by_id(pool, rule_id).await
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

pub async fn set_activity_reminder_enabled(
    pool: &Pool<Sqlite>,
    rule_id: i64,
    enabled: bool,
    now_ms: i64,
) -> Result<(), String> {
    let mut tx = pool.begin().await.map_err(|error| error.to_string())?;
    let result = sqlx::query("UPDATE tool_activity_reminder_rules SET updated_at = ? WHERE id = ? AND disabled_at IS NULL")
        .bind(now_ms).bind(rule_id).execute(&mut *tx).await.map_err(|error| error.to_string())?;
    if result.rows_affected() == 0 {
        return Err("activity reminder is unavailable".into());
    }
    sqlx::query("INSERT INTO tool_activity_reminder_states(rule_id, enabled) VALUES (?, ?) ON CONFLICT(rule_id) DO UPDATE SET enabled = excluded.enabled")
        .bind(rule_id).bind(enabled).execute(&mut *tx).await.map_err(|error| error.to_string())?;
    tx.commit().await.map_err(|error| error.to_string())
}

pub async fn update_activity_reminder_limit(
    pool: &Pool<Sqlite>,
    rule_id: i64,
    limit_ms: i64,
    now_ms: i64,
) -> Result<(), String> {
    if !(60_000..=86_400_000).contains(&limit_ms) {
        return Err("activity reminder limit must be between 1 and 1440 minutes".into());
    }
    let mut tx = pool.begin().await.map_err(|error| error.to_string())?;
    let previous: i64 = sqlx::query_scalar(
        "SELECT limit_ms FROM tool_activity_reminder_rules WHERE id = ? AND disabled_at IS NULL",
    )
    .bind(rule_id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|error| error.to_string())?
    .ok_or("activity reminder is unavailable")?;
    if previous != limit_ms {
        sqlx::query("UPDATE tool_activity_reminder_rules SET limit_ms = ?, updated_at = ?, last_fired_date_key = NULL WHERE id = ?")
            .bind(limit_ms).bind(now_ms).bind(rule_id).execute(&mut *tx).await.map_err(|error| error.to_string())?;
        sqlx::query("DELETE FROM tool_activity_reminder_extensions WHERE rule_id = ?")
            .bind(rule_id)
            .execute(&mut *tx)
            .await
            .map_err(|error| error.to_string())?;
    }
    tx.commit().await.map_err(|error| error.to_string())
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

#[derive(Default)]
pub(super) struct ActivityReminderUsage {
    pub entries: Vec<(ToolActivityReminderRule, i64, String, Option<i64>)>,
    pub classification: crate::domain::classification::ClassificationSnapshot,
}

pub(super) async fn load_activity_reminder_usage(
    tx: &mut Transaction<'_, Sqlite>,
    rules: Vec<ToolActivityReminderRule>,
    day_start_ms: i64,
    now_ms: i64,
) -> Result<ActivityReminderUsage, String> {
    if rules.is_empty() {
        return Ok(ActivityReminderUsage::default());
    }
    let classification =
        crate::data::repositories::classification_settings::load_classification_snapshot_in_tx(tx)
            .await?;
    let web_activity_enabled = sqlx::query_scalar::<_, String>(
        "SELECT value FROM settings WHERE key = 'web_activity_enabled' LIMIT 1",
    )
    .fetch_optional(&mut **tx)
    .await
    .map_err(|error| format!("failed to read web activity setting: {error}"))?
    .is_some_and(|value| value == "1" || value.eq_ignore_ascii_case("true"));
    let needs_session_facts = rules.iter().any(|rule| {
        matches!(
            rule.target,
            ActivityReminderTarget::App { .. } | ActivityReminderTarget::Category { .. }
        )
    });
    let needs_web_facts = web_activity_enabled
        && rules
            .iter()
            .any(|rule| matches!(rule.target, ActivityReminderTarget::Web { .. }));
    let session_facts = if needs_session_facts {
        fetch_session_usage_facts_tx(tx, day_start_ms, now_ms, &rules, &classification).await?
    } else {
        Vec::new()
    };
    let web_facts = if needs_web_facts {
        fetch_web_usage_facts_tx(tx, day_start_ms, now_ms, &rules).await?
    } else {
        Vec::new()
    };
    let mut result = Vec::new();

    for rule in rules {
        let (usage_ms, target_label, active_since) = match &rule.target {
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
                    .fold((0, None), |(usage, active_since), fact| {
                        (usage + fact.usage_ms, active_since.max(fact.active_since))
                    });
                (usage.0, rule.label_snapshot.clone(), usage.1)
            }
            ActivityReminderTarget::Category { category_id } => {
                let Some(category) = classification.resolve_category_by_id(category_id) else {
                    continue;
                };
                let (usage_ms, active_since) = session_facts
                    .iter()
                    .filter(|fact| {
                        classification
                            .resolve_tracked_session_category(&fact.exe_name)
                            .is_some_and(|category| category.id == *category_id)
                    })
                    .fold((0, None), |(usage, active_since), fact| {
                        (usage + fact.usage_ms, active_since.max(fact.active_since))
                    });
                (usage_ms, category.label, active_since)
            }
            ActivityReminderTarget::Web { normalized_domain } => {
                if !web_activity_enabled || !classification.is_web_domain_enabled(normalized_domain)
                {
                    continue;
                }
                let fact = web_facts.iter().find(|fact| {
                    fact.normalized_domain
                        .eq_ignore_ascii_case(normalized_domain)
                });
                (
                    fact.map_or(0, |fact| fact.usage_ms),
                    rule.label_snapshot.clone(),
                    fact.and_then(|fact| fact.active_since),
                )
            }
        };
        result.push((rule, usage_ms, target_label, active_since));
    }
    Ok(ActivityReminderUsage {
        entries: result,
        classification,
    })
}

#[derive(Debug, Default)]
pub struct ActivityReminderEvaluation {
    pub notifications: Vec<ActivityReminderNotification>,
    pub watch: ActivityReminderWatch,
}

pub async fn fire_due_activity_reminders(
    tx: &mut Transaction<'_, Sqlite>,
    date_key: &str,
    day_start_ms: i64,
    now_ms: i64,
    pending_rule_ids: &[i64],
    check: &ActivityReminderCheck,
) -> Result<ActivityReminderEvaluation, String> {
    let rules = fetch_active_activity_reminder_rules_tx(tx, check).await?;
    let enabled = rules
        .into_iter()
        .filter(|rule| rule.limit_for_date(date_key).is_some())
        .collect();
    let usage = load_activity_reminder_usage(tx, enabled, day_start_ms, now_ms).await?;
    let keep_classification = matches!(check, ActivityReminderCheck::All)
        && usage
            .entries
            .iter()
            .any(|(rule, ..)| matches!(rule.target, ActivityReminderTarget::Category { .. }));
    let mut evaluation = ActivityReminderEvaluation {
        watch: ActivityReminderWatch {
            classification: if keep_classification {
                usage.classification
            } else {
                Default::default()
            },
            ..Default::default()
        },
        ..Default::default()
    };
    for (rule, usage_ms, target_label, active_since) in usage.entries {
        let Some(limit_ms) = rule.limit_for_date(date_key) else {
            continue;
        };
        let pending = pending_rule_ids.contains(&rule.id);
        evaluation.watch.rules.push(ActivityReminderWatchedRule {
            id: rule.id,
            target: rule.target.clone(),
            active: active_since.is_some(),
            next_check_at: (!pending && usage_ms < limit_ms && active_since.is_some())
                .then(|| now_ms.saturating_add(limit_ms - usage_ms)),
        });
        if pending || usage_ms < limit_ms {
            continue;
        }
        if rule.last_fired_date_key.as_deref() == Some(date_key)
            && !active_since.is_some_and(|started_at| {
                started_at > rule.last_fired_at.unwrap_or(rule.updated_at)
            })
        {
            continue;
        }

        let update = sqlx::query(
            "UPDATE tool_activity_reminder_rules
             SET last_fired_date_key = ?, updated_at = ?
             WHERE id = ? AND disabled_at IS NULL AND NOT EXISTS (SELECT 1 FROM tool_activity_reminder_states WHERE rule_id = tool_activity_reminder_rules.id AND enabled = 0)",
        )
        .bind(date_key)
        .bind(now_ms)
        .bind(rule.id)
        .execute(&mut **tx)
        .await
        .map_err(|error| format!("failed to mark activity reminder fired: {error}"))?;
        if update.rows_affected() == 0 {
            continue;
        }

        sqlx::query(
            "INSERT INTO tool_activity_reminder_extensions(rule_id,last_fired_at) VALUES(?,?)
            ON CONFLICT(rule_id) DO UPDATE SET last_fired_at=excluded.last_fired_at",
        )
        .bind(rule.id)
        .bind(now_ms)
        .execute(&mut **tx)
        .await
        .map_err(|error| error.to_string())?;
        evaluation.notifications.push(ActivityReminderNotification {
            rule_id: rule.id,
            target: rule.target,
            target_label,
            limit_ms,
            usage_ms,
            message: rule.message,
        });
    }

    Ok(evaluation)
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
        let inserted: Option<i64> = sqlx::query_scalar(
            "INSERT INTO tool_activity_reminder_rules (
                target_kind, app_name, exe_name, category_id, normalized_domain,
                label_snapshot, limit_ms, message, created_at, updated_at,
                disabled_at, last_fired_date_key
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT DO NOTHING RETURNING id",
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
        .fetch_optional(&mut **tx)
        .await
        .map_err(|error| format!("failed to merge activity reminder snapshot rules: {error}"))?;
        let Some(rule_id) = inserted else { continue };
        sqlx::query("INSERT INTO tool_activity_reminder_states(rule_id,enabled) VALUES(?,?)")
            .bind(rule_id)
            .bind(rule.enabled)
            .execute(&mut **tx)
            .await
            .map_err(|error| error.to_string())?;
        sqlx::query("INSERT INTO tool_activity_reminder_extensions
            (rule_id,last_fired_at,extension_date_key,extension_limit_ms,last_extended_alert_at) VALUES(?,?,?,?,?)")
            .bind(rule_id).bind(rule.last_fired_at).bind(&rule.extension_date_key)
            .bind(rule.extension_limit_ms).bind(rule.last_extended_alert_at)
            .execute(&mut **tx).await.map_err(|error| error.to_string())?;
    }
    Ok(())
}
