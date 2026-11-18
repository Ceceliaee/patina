use crate::domain::{tracking::resolve_app_override_executable, web_links::registrable_domain};
use sqlx::{Sqlite, Transaction};
use std::collections::HashSet;

type Tx<'a> = Transaction<'a, Sqlite>;

// A legacy reminder can target a display name. Capture its matching executable
// while the records about to be deleted still supply that name.
pub async fn named_reminder_apps(tx: &mut Tx<'_>) -> Result<HashSet<String>, sqlx::Error> {
    let has_targets: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM tool_activity_reminder_rules WHERE target_kind='app' AND coalesce(exe_name,'')='')",
    ).fetch_one(&mut **tx).await?;
    if !has_targets {
        return Ok(HashSet::new());
    }
    let names: Vec<String> = sqlx::query_scalar(
        "WITH targets AS (SELECT app_name FROM tool_activity_reminder_rules
           WHERE target_kind='app' AND coalesce(exe_name,'')='')
         SELECT exe_name FROM sessions WHERE app_name COLLATE NOCASE IN targets
         UNION SELECT exe_name FROM import_exact_sessions WHERE app_name COLLATE NOCASE IN targets
         UNION SELECT exe_name FROM import_time_buckets WHERE app_name COLLATE NOCASE IN targets
         UNION SELECT app_name FROM targets",
    )
    .fetch_all(&mut **tx)
    .await?;
    Ok(app_keys(&names))
}

fn app_keys(names: &[String]) -> HashSet<String> {
    names
        .iter()
        .filter_map(|name| resolve_app_override_executable(name))
        .collect()
}

pub async fn removable_apps(
    tx: &mut Tx<'_>,
    candidates: &[String],
    named_reminders: &HashSet<String>,
) -> Result<Vec<String>, sqlx::Error> {
    if candidates.is_empty() {
        return Ok(Vec::new());
    }
    let candidates = app_keys(candidates);
    let cached: Vec<String> = sqlx::query_scalar("SELECT exe_name FROM icon_cache")
        .fetch_all(&mut **tx)
        .await?;
    let affected: Vec<_> = cached
        .into_iter()
        .filter_map(|name| {
            let key = resolve_app_override_executable(&name)?;
            (candidates.contains(&key) && !named_reminders.contains(&key)).then_some((name, key))
        })
        .collect();
    if affected.is_empty() {
        return Ok(Vec::new());
    }
    let references: Vec<String> = sqlx::query_scalar(
        "SELECT exe_name FROM sessions UNION SELECT exe_name FROM import_exact_sessions
         UNION SELECT exe_name FROM import_time_buckets
         UNION SELECT browser_exe_name FROM web_activity_segments WHERE browser_exe_name IS NOT NULL
         UNION SELECT substr(key, length('__app_override::')+1) FROM settings WHERE key GLOB '__app_override::*'
         UNION SELECT substr(key, length('__app_link::')+1) FROM settings WHERE key GLOB '__app_link::*'
         UNION SELECT value FROM settings WHERE key GLOB '__app_link::*'
         UNION SELECT exe_name FROM tool_activity_reminder_rules
           WHERE target_kind='app' AND exe_name IS NOT NULL",
    ).fetch_all(&mut **tx).await?;
    let referenced = app_keys(&references);
    Ok(affected
        .into_iter()
        .filter_map(|(name, key)| (!referenced.contains(&key)).then_some(name))
        .collect())
}

pub async fn removable_domains(
    tx: &mut Tx<'_>,
    candidates: &[String],
) -> Result<Vec<String>, sqlx::Error> {
    if candidates.is_empty() {
        return Ok(Vec::new());
    }
    let cached: Vec<String> = sqlx::query_scalar(
        "SELECT normalized_domain FROM web_favicon_cache WHERE normalized_domain IN (SELECT value FROM json_each(?))",
    ).bind(serde_json::json!(candidates).to_string()).fetch_all(&mut **tx).await?;
    if cached.is_empty() {
        return Ok(Vec::new());
    }
    let rules = super::web_links::load_in_tx(tx)
        .await
        .map_err(sqlx::Error::Protocol)?;
    let referenced: HashSet<String> = sqlx::query_scalar::<_, String>(
        "SELECT normalized_domain FROM web_activity_segments
         UNION SELECT substr(key,length('__web_domain_override::')+1) FROM settings WHERE key GLOB '__web_domain_override::*'
         UNION SELECT normalized_domain FROM tool_activity_reminder_rules
           WHERE target_kind='web'",
    ).fetch_all(&mut **tx).await?.into_iter().collect();
    let mut linked = HashSet::new();
    for (root, rule) in &rules {
        linked.insert(root.as_str());
        linked.extend(rule.exceptions.iter().map(String::as_str));
        linked.extend(rule.members.iter().flatten().map(String::as_str));
    }
    Ok(cached
        .into_iter()
        .filter(|key| {
            if referenced.contains(key) || linked.contains(key.as_str()) {
                return false;
            }
            // A persisted automatic group applies to its subdomains. An implicit
            // registrable domain by itself is not a saved relationship.
            !registrable_domain(key).is_some_and(|root| {
                rules.get(&root).is_some_and(|rule| {
                    rule.version == 2 || (rule.enabled && rule.members.is_none())
                }) || referenced.contains(&crate::domain::web_links::group_key(&root))
                    || rules
                        .values()
                        .any(|rule| rule.enabled && rule.auto_root.as_ref() == Some(&root))
            })
        })
        .collect())
}

pub async fn prune_apps(
    tx: &mut Tx<'_>,
    candidates: &[String],
    named_reminders: &HashSet<String>,
) -> Result<(), sqlx::Error> {
    let keys = removable_apps(tx, candidates, named_reminders).await?;
    sqlx::query("DELETE FROM icon_cache WHERE exe_name IN (SELECT value FROM json_each(?))")
        .bind(serde_json::json!(keys).to_string())
        .execute(&mut **tx)
        .await?;
    Ok(())
}

pub async fn prune_domains(tx: &mut Tx<'_>, candidates: &[String]) -> Result<(), sqlx::Error> {
    let keys = removable_domains(tx, candidates).await?;
    sqlx::query(
        "DELETE FROM web_favicon_cache WHERE normalized_domain IN (SELECT value FROM json_each(?))",
    )
    .bind(serde_json::json!(keys).to_string())
    .execute(&mut **tx)
    .await?;
    Ok(())
}
