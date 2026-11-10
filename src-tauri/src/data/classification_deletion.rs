use crate::data::repositories::{
    app_links::APP_LINK_PREFIX,
    classification_settings::{APP_OVERRIDE_KEY_PREFIX, WEB_DOMAIN_OVERRIDE_KEY_PREFIX},
    icon_cache::acquire_icon_cache_maintenance,
    web_links,
};
use crate::domain::{
    tracking::resolve_app_override_executable,
    web_links::{group_key, registrable_domain, resolve_owner, SETTING_PREFIX},
};
use serde::{Deserialize, Serialize};
use sqlx::{Sqlite, SqlitePool, Transaction};
use std::collections::BTreeSet;

#[derive(Clone, Deserialize, Serialize, PartialEq, Eq, Debug)]
#[serde(rename_all = "camelCase", tag = "kind", content = "key")]
pub enum Target {
    App(String),
    Web(String),
    Group(String),
}

#[derive(Clone, Deserialize, Serialize, PartialEq, Eq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Reminder {
    id: i64,
    label: String,
    target: String,
    shared: bool,
}

#[derive(Clone, Deserialize, Serialize, PartialEq, Eq, Debug)]
pub struct Impact {
    target: Target,
    members: BTreeSet<String>,
    links: BTreeSet<(String, String)>,
    reminders: Vec<Reminder>,
}

type Tx<'a> = Transaction<'a, Sqlite>;
fn app_matches(raw: &str, key: &str) -> bool {
    resolve_app_override_executable(raw).as_deref() == Some(key)
}

async fn app_impact(tx: &mut Tx<'_>, key: &str) -> Result<Impact, String> {
    let key = resolve_app_override_executable(key).ok_or("empty application identity")?;
    let rows:Vec<(String,String)> = sqlx::query_as(
        "SELECT exe_name,app_name FROM sessions UNION SELECT exe_name,app_name FROM import_exact_sessions
         UNION SELECT exe_name,app_name FROM import_time_buckets"
    ).fetch_all(&mut **tx).await.map_err(|e|e.to_string())?;
    let mut members = BTreeSet::from([key.clone()]);
    let mut names = BTreeSet::new();
    let mut other_names = BTreeSet::new();
    for (exe, name) in rows {
        if app_matches(&exe, &key) {
            members.insert(exe);
            names.insert(name.to_ascii_lowercase());
        } else {
            other_names.insert(name.to_ascii_lowercase());
        }
    }
    let keys:Vec<String>=sqlx::query_scalar("SELECT exe_name FROM icon_cache UNION SELECT substr(key,length('__app_override::')+1) FROM settings WHERE key GLOB '__app_override::*'").fetch_all(&mut **tx).await.map_err(|e|e.to_string())?;
    members.extend(keys.into_iter().filter(|exe| app_matches(exe, &key)));
    let pairs:Vec<(String,String)>=sqlx::query_as("SELECT substr(key,length('__app_link::')+1),value FROM settings WHERE key GLOB '__app_link::*'").fetch_all(&mut **tx).await.map_err(|e|e.to_string())?;
    let links = pairs
        .into_iter()
        .filter(|(member, parent)| app_matches(member, &key) || app_matches(parent, &key))
        .collect();
    let rules:Vec<(i64,String,String,Option<String>)>=sqlx::query_as(
        "SELECT id,label_snapshot,app_name,exe_name FROM tool_activity_reminder_rules WHERE target_kind='app' ORDER BY id"
    ).fetch_all(&mut **tx).await.map_err(|e|e.to_string())?;
    let reminders = rules
        .into_iter()
        .filter_map(|(id, label, name, exe)| {
            if let Some(exe) = exe.filter(|s| !s.trim().is_empty()) {
                return app_matches(&exe, &key).then_some(Reminder {
                    id,
                    label,
                    target: exe,
                    shared: false,
                });
            }
            let lower = name.to_ascii_lowercase();
            (names.contains(&lower) || app_matches(&name, &key)).then(|| Reminder {
                id,
                label,
                target: name,
                shared: other_names.contains(&lower),
            })
        })
        .collect();
    Ok(Impact {
        target: Target::App(key),
        members,
        links,
        reminders,
    })
}

async fn web_impact(
    tx: &mut Tx<'_>,
    target: &Target,
    key: &str,
    group: bool,
) -> Result<Impact, String> {
    if key.is_empty()
        || key.starts_with('{')
        || key.trim() != key
        || key.to_ascii_lowercase() != key
    {
        return Err("invalid website identity".into());
    }
    let rules = web_links::load_in_tx(tx).await?;
    if rules.values().any(|rule| rule.version != 2) {
        return Err("reload website rules before deleting".into());
    }
    let owner = group_key(key);
    let mut members = BTreeSet::new();
    let mut links = BTreeSet::new();
    if group {
        if registrable_domain(key).as_deref() != Some(key) {
            return Err("invalid website group".into());
        }
        let domains:Vec<String>=sqlx::query_scalar(
            "SELECT normalized_domain FROM web_activity_segments UNION SELECT normalized_domain FROM web_favicon_cache
             UNION SELECT substr(key,length('__web_domain_override::')+1) FROM settings WHERE key GLOB '__web_domain_override::*'
             UNION SELECT normalized_domain FROM tool_activity_reminder_rules WHERE target_kind='web'"
        ).fetch_all(&mut **tx).await.map_err(|e|e.to_string())?;
        members.extend(
            domains
                .into_iter()
                .filter(|d| !d.starts_with('{') && resolve_owner(d, &rules) == owner),
        );
    } else {
        if resolve_owner(key, &rules) != key {
            return Err("website now belongs to a group; refresh before deleting".into());
        }
        members.insert(key.to_owned());
        if let Some(root) = registrable_domain(key)
            .filter(|root| rules.get(root).is_some_and(|r| r.exceptions.contains(key)))
        {
            links.insert((key.to_owned(), root));
        }
    }
    let rows:Vec<(i64,String,String)>=sqlx::query_as("SELECT id,label_snapshot,normalized_domain FROM tool_activity_reminder_rules WHERE target_kind='web' ORDER BY id").fetch_all(&mut **tx).await.map_err(|e|e.to_string())?;
    let reminders = rows
        .into_iter()
        .filter_map(|(id, label, domain)| {
            (members.contains(&domain) || (group && domain == owner)).then_some(Reminder {
                id,
                label,
                target: domain,
                shared: false,
            })
        })
        .collect();
    Ok(Impact {
        target: target.clone(),
        members,
        links,
        reminders,
    })
}

async fn impact(tx: &mut Tx<'_>, target: &Target) -> Result<Impact, String> {
    match target {
        Target::App(key) => app_impact(tx, key).await,
        Target::Web(key) => web_impact(tx, target, key, false).await,
        Target::Group(key) => web_impact(tx, target, key, true).await,
    }
}

async fn delete_apps(tx: &mut Tx<'_>, plan: &Impact) -> Result<(), sqlx::Error> {
    let keys = serde_json::json!(plan.members).to_string();
    for query in [
        "DELETE FROM session_title_samples WHERE session_id IN (SELECT id FROM sessions WHERE exe_name IN (SELECT value FROM json_each(?)))",
        "DELETE FROM sessions WHERE exe_name IN (SELECT value FROM json_each(?))",
        "DELETE FROM import_exact_sessions WHERE exe_name IN (SELECT value FROM json_each(?))",
        "DELETE FROM import_time_buckets WHERE exe_name IN (SELECT value FROM json_each(?))",
        "DELETE FROM icon_cache WHERE exe_name IN (SELECT value FROM json_each(?))",
     ] {
        sqlx::query(query).bind(&keys).execute(&mut **tx).await?;
    }
    sqlx::query("DELETE FROM settings WHERE key IN (SELECT ? || value FROM json_each(?))")
        .bind(APP_OVERRIDE_KEY_PREFIX)
        .bind(keys)
        .execute(&mut **tx)
        .await?;
    for (member, _) in &plan.links {
        sqlx::query("DELETE FROM settings WHERE key=?")
            .bind(format!("{APP_LINK_PREFIX}{member}"))
            .execute(&mut **tx)
            .await?;
    }
    Ok(())
}

async fn delete_web(tx: &mut Tx<'_>, plan: &Impact) -> Result<(), String> {
    let keys = serde_json::json!(plan.members).to_string();
    for query in [
        "DELETE FROM web_activity_segments WHERE normalized_domain IN (SELECT value FROM json_each(?))",
        "DELETE FROM web_favicon_cache WHERE normalized_domain IN (SELECT value FROM json_each(?))",
     ] {
        sqlx::query(query).bind(&keys).execute(&mut **tx).await.map_err(|e|e.to_string())?;
    }
    sqlx::query("DELETE FROM settings WHERE key IN (SELECT ? || value FROM json_each(?))")
        .bind(WEB_DOMAIN_OVERRIDE_KEY_PREFIX)
        .bind(&keys)
        .execute(&mut **tx)
        .await
        .map_err(|e| e.to_string())?;
    let root = match &plan.target {
        Target::Group(key) => Some(key),
        _ => plan.links.first().map(|(_, root)| root),
    };
    if let Some(root) = root {
        if let Some(mut rule) = web_links::load_in_tx(tx).await?.remove(root) {
            match &plan.target {
                Target::Group(_) => {
                    rule.display_name = None;
                    rule.category = None;
                    rule.color = None;
                }
                Target::Web(key) => {
                    rule.exceptions.remove(key);
                }
                _ => unreachable!(),
            }
            let setting = format!("{SETTING_PREFIX}{root}");
            if rule.exceptions.is_empty()
                && rule.display_name.is_none()
                && rule.category.is_none()
                && rule.color.is_none()
            {
                sqlx::query("DELETE FROM settings WHERE key=?")
                    .bind(setting)
                    .execute(&mut **tx)
                    .await
                    .map_err(|e| e.to_string())?;
            } else {
                sqlx::query("UPDATE settings SET value=? WHERE key=?")
                    .bind(serde_json::json!(rule).to_string())
                    .bind(setting)
                    .execute(&mut **tx)
                    .await
                    .map_err(|e| e.to_string())?;
            }
        }
    }
    Ok(())
}

pub async fn run(
    pool: &SqlitePool,
    target: &Target,
    confirmed: Option<Impact>,
) -> Result<Impact, String> {
    let _guard = if confirmed.is_some() && matches!(target, Target::App(_)) {
        Some(acquire_icon_cache_maintenance(pool).await)
    } else {
        None
    };
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    let plan = impact(&mut tx, target).await?;
    if let Some(expected) = confirmed {
        if expected != plan {
            return Err("deletion scope changed; preview again".into());
        }
        match target {
            Target::App(_) => {
                delete_apps(&mut tx, &plan)
                    .await
                    .map_err(|e| e.to_string())?;
                super::user_data_maintenance::refresh_import_batch_counts(&mut tx)
                    .await
                    .map_err(|e| e.to_string())?;
            }
            _ => delete_web(&mut tx, &plan).await?,
        }
        for r in plan.reminders.iter().filter(|r| !r.shared) {
            sqlx::query("DELETE FROM tool_activity_reminder_rules WHERE id=?")
                .bind(r.id)
                .execute(&mut *tx)
                .await
                .map_err(|e| e.to_string())?;
        }
    }
    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(plan)
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::Executor;

    async fn database() -> SqlitePool {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        crate::data::sqlite_pool::prepare_pool_schema(&pool, std::path::Path::new(":memory:"))
            .await
            .unwrap();
        pool
    }

    #[tokio::test]
    async fn selected_application_only_and_recheck_before_erasing() {
        let pool = database().await;
        pool.execute("INSERT INTO sessions(app_name,exe_name,start_time,end_time,duration) VALUES ('Editor','root.exe',0,10,10),('Editor','child.exe',10,20,10);
            INSERT INTO icon_cache(exe_name,icon_base64,last_updated) VALUES ('ROOT.EXE','i',1),('child.exe','i',1);
            INSERT INTO settings(key,value) VALUES ('__app_link::child.exe','root.exe'),('__app_override::root.exe','{}'),('__app_override::child.exe','{}');
            INSERT INTO tool_activity_reminder_rules(target_kind,app_name,exe_name,label_snapshot,limit_ms,message,created_at,updated_at)
                VALUES ('app','Editor','root.exe','Dedicated',60000,'',1,1),('app','Editor',NULL,'Shared',60000,'',1,1)").await.unwrap();
        let target = Target::App("root.exe".into());
        let stale = run(&pool, &target, None).await.unwrap();
        assert_eq!(stale.links.len(), 1);
        assert!(stale
            .reminders
            .iter()
            .any(|r| r.shared && r.label == "Shared"));
        pool.execute(
            "INSERT INTO settings(key,value) VALUES ('__app_link::second.exe','root.exe')",
        )
        .await
        .unwrap();
        assert!(run(&pool, &target, Some(stale)).await.is_err());
        let plan = run(&pool, &target, None).await.unwrap();
        pool.execute("CREATE TRIGGER refuse_icon BEFORE DELETE ON icon_cache BEGIN SELECT RAISE(ABORT,'fixture'); END").await.unwrap();
        assert!(run(&pool, &target, Some(plan.clone())).await.is_err());
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT count(*) FROM sessions")
                .fetch_one(&pool)
                .await
                .unwrap(),
            2
        );
        pool.execute("DROP TRIGGER refuse_icon").await.unwrap();
        run(&pool, &target, Some(plan)).await.unwrap();
        for (query,expected) in [("SELECT count(*) FROM sessions WHERE exe_name='child.exe'",1),("SELECT count(*) FROM sessions WHERE exe_name='root.exe'",0),("SELECT count(*) FROM icon_cache",1),("SELECT count(*) FROM settings WHERE key GLOB '__app_link::*'",0),("SELECT count(*) FROM settings WHERE key='__app_override::root.exe'",0),("SELECT count(*) FROM tool_activity_reminder_rules WHERE label_snapshot='Shared'",1),("SELECT count(*) FROM tool_activity_reminder_rules WHERE label_snapshot='Dedicated'",0)]{
            assert_eq!(sqlx::query_scalar::<_,i64>(query).fetch_one(&pool).await.unwrap(),expected);
        }
    }

    #[tokio::test]
    async fn group_deletion_erases_members_and_keeps_independent_sites() {
        let pool = database().await;
        pool.execute("INSERT INTO settings(key,value) VALUES ('__web_site::example.com','{\"version\":2,\"category\":\"office\",\"exceptions\":[\"example.com\"]}'),
            ('__web_domain_override::example.com','{}'),('__web_domain_override::docs.example.com','{}');
            INSERT INTO web_favicon_cache(normalized_domain,favicon_url,updated_at) VALUES ('example.com','i',1),('docs.example.com','i',1),('cache.example.com','i',1);
            INSERT INTO web_activity_segments(browser_client_id,browser_kind,browser_exe_name,domain,normalized_domain,start_time,end_time,duration,created_at,updated_at)
            VALUES ('one','chrome','chrome.exe','example.com','example.com',0,10,10,1,1),('one','chrome','chrome.exe','docs.example.com','docs.example.com',10,20,10,1,1);
            INSERT INTO tool_activity_reminder_rules(target_kind,normalized_domain,label_snapshot,limit_ms,message,created_at,updated_at)
            VALUES ('web','docs.example.com','Docs',60000,'',1,1),('web','example.com','Independent',60000,'',1,1)").await.unwrap();
        let group = Target::Group("example.com".into());
        let plan = run(&pool, &group, None).await.unwrap();
        assert_eq!(
            plan.members.into_iter().collect::<Vec<_>>(),
            ["cache.example.com", "docs.example.com"]
        );
        let plan = run(&pool, &group, None).await.unwrap();
        assert_eq!(plan.reminders.len(), 1);
        run(&pool, &group, Some(plan)).await.unwrap();
        let independent = Target::Web("example.com".into());
        let plan = run(&pool, &independent, None).await.unwrap();
        assert_eq!((plan.links.len(), plan.reminders.len()), (1, 1));
        assert_eq!(
            sqlx::query_scalar::<_, String>("SELECT normalized_domain FROM web_activity_segments")
                .fetch_one(&pool)
                .await
                .unwrap(),
            "example.com"
        );
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT count(*) FROM web_favicon_cache")
                .fetch_one(&pool)
                .await
                .unwrap(),
            1
        );
        run(&pool, &independent, Some(plan)).await.unwrap();
        for table in [
            "web_activity_segments",
            "web_favicon_cache",
            "tool_activity_reminder_rules",
        ] {
            assert_eq!(
                sqlx::query_scalar::<_, i64>(sqlx::AssertSqlSafe(format!(
                    "SELECT count(*) FROM {table}"
                )))
                .fetch_one(&pool)
                .await
                .unwrap(),
                0
            );
        }
    }
}
