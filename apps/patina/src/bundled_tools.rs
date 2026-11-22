use patina_activity::{NativeToolData, TaskKind};
use patina_plugin_host::Manifest;
use std::sync::Arc;

use patina_plugin_host::{Capability, CapabilityData, Host, Package};
use serde_json::Value;

pub(super) struct Bundle {
    manifest: &'static str,
    wasm: &'static [u8],
    signature: &'static str,
    locales: &'static [(&'static str, &'static str)],
}

pub(super) const BUNDLES: &[Bundle] = &[
    Bundle {
        manifest: include_str!("../../../plugins/bundled/focus/manifest.json"),
        locales: include!(concat!(env!("OUT_DIR"), "/focus-locales.rs")),
        wasm: include_bytes!("../../../plugins/bundled/focus/plugin.wasm"),
        signature: include_str!("../../../plugins/bundled/focus/signature.json"),
    },
    Bundle {
        manifest: include_str!("../../../plugins/bundled/reminders/manifest.json"),
        locales: include!(concat!(env!("OUT_DIR"), "/reminders-locales.rs")),
        wasm: include_bytes!("../../../plugins/bundled/reminders/plugin.wasm"),
        signature: include_str!("../../../plugins/bundled/reminders/signature.json"),
    },
];

impl Bundle {
    fn package(&self) -> Result<Package, String> {
        let locales = self
            .locales
            .iter()
            .map(|(tag, bytes)| {
                serde_json::from_str(bytes).map(|messages| ((*tag).to_owned(), messages))
            })
            .collect::<Result<_, _>>()
            .map_err(|e| e.to_string())?;
        Package::from_files(
            self.manifest.as_bytes(),
            self.wasm.to_vec(),
            Some(self.signature.as_bytes()),
            locales,
        )
        .map_err(|e| e.to_string())
    }

    fn manifest(&self) -> Result<patina_plugin_host::Manifest, String> {
        serde_json::from_str(self.manifest).map_err(|e| e.to_string())
    }
}

pub(super) fn package(id: &str) -> Result<Package, String> {
    for bundle in BUNDLES {
        let manifest = bundle.manifest()?;
        if manifest.id == id {
            return bundle.package();
        }
    }
    Err("Unknown bundled tool".into())
}

fn tasks(manifest: &Manifest) -> impl Iterator<Item = (TaskKind, &'static str)> + '_ {
    manifest.capabilities.iter().filter_map(|c| match c {
        Capability::Focus => Some((TaskKind::Focus, "focus")),
        Capability::Reminders => Some((TaskKind::Reminders, "reminders")),
        _ => None,
    })
}

struct PluginTasks {
    storage: NativeToolData,
    manifest: Manifest,
}

impl PluginTasks {
    fn each<T>(
        &self,
        mut action: impl FnMut(NativeToolData, TaskKind) -> Result<T, String>,
    ) -> Result<Vec<T>, String> {
        tasks(&self.manifest)
            .map(|(kind, _)| action(self.storage.plugin_tasks(&self.manifest.id, kind)?, kind))
            .collect()
    }
}

impl CapabilityData for PluginTasks {
    fn read(&self, locale: &str, now: i64, state: &Value) -> Result<Value, String> {
        let mut values = serde_json::Map::new();
        for (kind, name) in tasks(&self.manifest) {
            let db = self.storage.plugin_tasks(&self.manifest.id, kind)?;
            let data = match kind {
                TaskKind::Focus => db.focus().read(locale, now, state)?,
                TaskKind::Reminders => db.reminders().read(locale, now, state)?,
            };
            values.insert(name.into(), data);
        }
        if values.len() == 1 {
            Ok(values.into_iter().next().unwrap().1)
        } else {
            Ok(Value::Object(values))
        }
    }
    fn apply(&self, command: Value, now: i64) -> Result<(), String> {
        let mut granted = tasks(&self.manifest);
        let (first, _) = granted.next().ok_or("Missing task capability")?;
        let (kind, command) = if granted.next().is_some() {
            let (kind, _) = tasks(&self.manifest)
                .find(|(_, name)| command["capability"] == *name)
                .ok_or("Unknown task capability")?;
            (kind, command["command"].clone())
        } else {
            (first, command)
        };
        let db = self.storage.plugin_tasks(&self.manifest.id, kind)?;
        match kind {
            TaskKind::Focus => db.focus().apply(command, now),
            TaskKind::Reminders => db.reminders().apply(command, now),
        }
    }
    fn suspend(&self, now: i64) -> Result<(), String> {
        self.each(|db, kind| match kind {
            TaskKind::Focus => db.focus().suspend(now),
            TaskKind::Reminders => db.reminders().suspend(now),
        })?;
        Ok(())
    }
    fn delete_data(&self) -> Result<(), String> {
        for (kind, _) in tasks(&self.manifest) {
            self.storage.remove_plugin_tasks(&self.manifest.id, kind)?;
        }
        Ok(())
    }
    fn uninstall_impact(
        &self,
        locale: &str,
        now: i64,
        fallback: &str,
    ) -> Result<Vec<String>, String> {
        Ok(self
            .each(|db, kind| match kind {
                TaskKind::Focus => db.focus().uninstall_impact(locale, now, fallback),
                TaskKind::Reminders => db.reminders().uninstall_impact(locale, now, fallback),
            })?
            .into_iter()
            .flatten()
            .collect())
    }
}

pub(super) fn configure(host: &mut Host, storage: &NativeToolData) -> Result<(), String> {
    // The two original datasets live in the tracker database and retain their backup identities.
    let mut legacy = std::collections::BTreeMap::new();
    for bundle in BUNDLES {
        let manifest = bundle.manifest()?;
        for (kind, _) in tasks(&manifest) {
            legacy.insert(kind, manifest.id.clone());
        }
    }
    storage.configure_plugin_storage(host.task_data_directory(), legacy)?;
    let storage = storage.clone();
    host.set_data_provider(Box::new(move |manifest| {
        Ok(Arc::new(PluginTasks {
            storage: storage.clone(),
            manifest: manifest.clone(),
        }))
    }))
}

#[cfg(test)]
fn bind(
    host: &mut Host,
    package: Package,
    storage: &NativeToolData,
    locale: &str,
) -> Result<(), String> {
    configure(host, storage)?;
    host.seed(package, locale)
}

pub(super) fn start(
    host: &mut Host,
    storage: &NativeToolData,
    bundle: &Bundle,
    locale: &str,
) -> Result<(), String> {
    let package = bundle.package()?;
    let id = package.manifest.id.clone();
    #[cfg(debug_assertions)]
    crate::dev_preview::install_staged(host, &package, locale);
    host.seed(package, locale)?;
    if let Some(tool) = host.bound_installation(&id) {
        for (kind, _) in tasks(&tool.manifest) {
            let db = storage.plugin_tasks(&id, kind)?;
            if match kind {
                TaskKind::Focus => db.focus().has_scheduled_work()?,
                TaskKind::Reminders => db.reminders().has_scheduled_work()?,
            } {
                host.dispatch_panel_event(&id, &tool.generation, None, locale)?;
                break;
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod plugin_install_tests;

#[cfg(test)]
mod tests {
    use super::*;
    use patina_plugin_host::{Control, now_ms};
    use serde_json::json;

    struct Unavailable;

    #[test]
    fn free_focus_shows_elapsed_work_then_remaining_break() -> Result<(), Box<dyn std::error::Error>>
    {
        use patina_desktop_protocol::tools::RowClock;
        let root = tempfile::tempdir()?;
        let runtime = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(1)
            .enable_all()
            .build()?;
        let pool =
            runtime.block_on(patina_activity::open_database(&root.path().join("data.db")))?;
        let storage = patina_activity::NativeToolData::new(pool.clone(), runtime.handle().clone());
        let mut host = Host::open(root.path().join("tools"))?;
        let tool = "patina.focus";
        bind(&mut host, package(tool)?, &storage, "en-US")?;
        let generation = host.bound_installation(tool).unwrap().generation;
        let fields = [
            ("free-name", "Reading"),
            ("free-rest-mode", "fixed"),
            ("free-short", "3"),
            ("free-ratio", "5"),
        ]
        .into_iter()
        .map(|(k, v)| (k.to_owned(), v.to_owned()))
        .collect();
        let created = host.submit(tool, &generation, "new-free".into(), fields, "en-US")?;
        let row = created
            .iter()
            .find_map(|c| match c {
                Control::ListRow {
                    id,
                    title,
                    clock: Some(RowClock::Duration(0)),
                    ..
                } if title == "Reading" => Some(id.clone()),
                _ => None,
            })
            .expect("new free task starts at zero");
        let mut action = |op: &str| {
            host.dispatch_panel_event(tool, &generation, Some(format!("{op}-{row}")), "en-US")
        };
        assert!(action("resume")?.iter().any(
            |c| matches!(c,Control::ListRow {id,clock:Some(RowClock::Since(_)),..} if id==&row)
        ));
        assert!(action("finish")?.iter().any(|c| matches!(c,Control::ListRow {id,detail,clock:Some(RowClock::Duration(180_000)),..} if id==&row && detail=="Break")));
        assert!(action("resume")?.iter().any(
            |c| matches!(c,Control::ListRow {id,clock:Some(RowClock::Until(_)),..} if id==&row)
        ));
        assert!(
            !action("delete")?
                .iter()
                .any(|c| matches!(c,Control::ListRow {id,..} if id==&row))
        );
        host.uninstall(tool, &generation)?;
        let remaining: i64 = runtime.block_on(
            sqlx::query_scalar("SELECT COUNT(*) FROM tool_free_focus").fetch_one(&pool),
        )?;
        assert_eq!(remaining, 0);
        Ok(())
    }

    #[test]
    fn weekly_reminder_follows_the_selected_local_date_and_time()
    -> Result<(), Box<dyn std::error::Error>> {
        let root = tempfile::tempdir()?;
        let rt = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(1)
            .enable_all()
            .build()?;
        let pool = rt.block_on(patina_activity::open_database(&root.path().join("data.db")))?;
        let storage = patina_activity::NativeToolData::new(pool.clone(), rt.handle().clone());
        let mut host = Host::open(root.path().join("tools"))?;
        let id = "patina.reminders";
        bind(&mut host, package(id)?, &storage, "en-US")?;
        let generation = host.bound_installation(id).unwrap().generation;
        let mut submit = "new-reminder".to_owned();
        for (local, weekday) in [("2099-01-03 18:22", 6), ("2099-01-06 09:30", 2)] {
            let fields = [
                ("repeat".into(), "weekly".into()),
                ("local".into(), local.into()),
            ]
            .into();
            let panel = host.submit(id, &generation, submit, fields, "en-US")?;
            assert!(
                !panel
                    .iter()
                    .any(|c| matches!(c, Control::Input { id, .. } if id == "weekdays"))
            );
            let data = storage.reminders().read("en-US", now_ms(), &Value::Null)?;
            let reminders = data["reminders"].as_array().unwrap();
            assert_eq!(reminders.len(), 1);
            let row = &reminders[0];
            assert_eq!(row["local_at"], local);
            assert_eq!(
                row["recurrence"],
                json!({"kind":"weekly", "weekdays":[weekday]})
            );
            let edit = format!("edit-{}", row["id"]);
            let panel = host.dispatch_panel_event(id, &generation, Some(edit), "en-US")?;
            submit = panel
                .iter()
                .find_map(|c| match c {
                    Control::Submit { id, .. } if id.starts_with("save-reminder-") => {
                        Some(id.clone())
                    }
                    _ => None,
                })
                .unwrap();
        }
        host.uninstall(id, &generation)?;
        let counts: (i64, i64) = rt.block_on(
            sqlx::query_as(
                "SELECT (SELECT COUNT(*) FROM tool_reminder_recurrences),
                    (SELECT COUNT(*) FROM tool_reminder_identities)",
            )
            .fetch_one(&pool),
        )?;
        assert_eq!(counts, (0, 0));
        Ok(())
    }

    #[test]
    fn app_category_and_site_thresholds_follow_stored_activity()
    -> Result<(), Box<dyn std::error::Error>> {
        let tmp = tempfile::tempdir()?;
        let path = tmp.path().join("patina.db");
        let rt = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(1)
            .enable_all()
            .build()?;
        let pool = rt.block_on(patina_activity::open_database(&path))?;
        let now = now_ms();
        rt.block_on(async{
            sqlx::query("INSERT OR REPLACE INTO settings(key,value) VALUES ('tracking_paused','1'),('web_activity_enabled','true'),('__app_override::editor.exe','{\"category\":\"development\",\"enabled\":true}')").execute(&pool).await?;
            sqlx::query("INSERT INTO sessions(app_name,exe_name,window_title,start_time,end_time,duration,continuity_group_start_time) VALUES('Editor','editor.exe','',?,?,120000,?)")
                .bind(now-120000).bind(now).bind(now-120000).execute(&pool).await?;
            sqlx::query("INSERT INTO web_activity_segments(browser_client_id,browser_kind,browser_exe_name,domain,normalized_domain,start_time,end_time,duration,source,created_at,updated_at) VALUES('fixture','chromium','chrome.exe','example.com','example.com',?,?,120000,'browser-extension',?,?)")
                .bind(now-120000).bind(now).bind(now-120000).bind(now).execute(&pool).await?;
            Ok::<_,sqlx::Error>(())
        })?;
        let storage = patina_activity::NativeToolData::new(pool.clone(), rt.handle().clone());
        let mut host = Host::open(tmp.path().join("tools"))?;
        bind(&mut host, package("patina.reminders")?, &storage, "en-US")?;
        let tool = host.list().pop().unwrap();
        let id = &tool.manifest.id;
        for (kind, target) in [
            ("app", "editor.exe"),
            ("category", "development"),
            ("web", "example.com"),
        ] {
            let fields = [
                (
                    "target",
                    serde_json::json!({"kind":kind,"value":target,"label":kind}).to_string(),
                ),
                ("limit", "1".to_owned()),
            ]
            .into_iter()
            .map(|(k, v)| (k.to_owned(), v.to_owned()))
            .collect();
            host.submit(id, &tool.generation, "usage".into(), fields, "en-US")?;
        }
        let mut events = crate::tool_events::ToolEvents::default();
        assert!(events.evaluate(&host, &storage)?);
        let notices = events.list(&host, &storage)?;
        assert_eq!(notices.len(), 3);
        for notice in notices {
            events.acknowledge(&notice, "fifteen_minutes", &mut host, &storage, "en-US")?;
            assert!(
                events
                    .acknowledge(&notice, "fifteen_minutes", &mut host, &storage, "en-US")
                    .is_err()
            );
        }
        assert!(!events.evaluate(&host, &storage)?);
        let rules = storage.reminders().read("en-US", now, &Value::Null)?;
        for rule in rules["rules"].as_array().unwrap() {
            assert!(rule["extension_limit_ms"].as_i64().unwrap() >= 900000);
            let action = format!("pause-usage-{}", rule["id"]);
            host.dispatch_panel_event(id, &tool.generation, Some(action), "en-US")?;
        }
        events.evaluate(&host, &storage)?;
        assert!(events.next_usage.is_none());
        let rule = rules["rules"][0]["id"].as_i64().unwrap();
        let action = |host: &mut Host, button| {
            host.dispatch_panel_event(id, &tool.generation, Some(button), "en-US")
        };
        let edit = action(&mut host, format!("edit-rule-{rule}"))?;
        let save = format!("limit-{rule}");
        assert!(
            edit.iter()
                .any(|c| matches!(c, Control::Submit { id, .. } if id == &save))
        );
        let saved = host.submit(
            id,
            &tool.generation,
            save,
            [("limit".into(), "45".into())].into(),
            "en-US",
        )?;
        let row = format!("rule-{rule}");
        assert!(saved.iter().any(|c| matches!(c, Control::ListRow { id, detail, .. } if id == &row && detail.contains("45"))));
        let remaining = action(&mut host, format!("delete-rule-{rule}"))?;
        assert_eq!(
            remaining
                .iter()
                .filter(|c| matches!(c, Control::ListRow { id, .. } if id.starts_with("rule-")))
                .count(),
            2
        );
        assert!(
            !remaining
                .iter()
                .any(|c| matches!(c, Control::ListRow { id, .. } if id == &row))
        );
        host.uninstall(id, &tool.generation)?;
        let counts: (i64, i64, i64, i64, i64) = rt.block_on(
            sqlx::query_as(
                "SELECT (SELECT COUNT(*) FROM tool_activity_reminder_rules),
                    (SELECT COUNT(*) FROM tool_activity_reminder_states),
                    (SELECT COUNT(*) FROM tool_activity_reminder_extensions),
                    (SELECT COUNT(*) FROM sessions),
                    (SELECT COUNT(*) FROM web_activity_segments)",
            )
            .fetch_one(&pool),
        )?;
        assert_eq!(counts, (0, 0, 0, 1, 1));
        rt.block_on(pool.close());
        Ok(())
    }
    impl CapabilityData for Unavailable {
        fn uninstall_impact(&self, _: &str, _: i64, _: &str) -> Result<Vec<String>, String> {
            Err("store closed".into())
        }
        fn read(&self, _: &str, _: i64, _: &Value) -> Result<Value, String> {
            Err("store closed".into())
        }
        fn apply(&self, _: Value, _: i64) -> Result<(), String> {
            Err("store closed".into())
        }
        fn suspend(&self, _: i64) -> Result<(), String> {
            Err("store closed".into())
        }
        fn delete_data(&self) -> Result<(), String> {
            Err("store closed".into())
        }
    }

    #[test]
    fn interrupted_removal_is_resumed_before_reinstall() -> Result<(), Box<dyn std::error::Error>> {
        let tmp = tempfile::tempdir()?;
        let registry = tmp.path().join("tools");
        let mut host = Host::open(registry.clone())?;
        host.set_data_provider(Box::new(|_| Ok(Arc::new(Unavailable))))?;
        host.seed(package("patina.focus")?, "en-US")?;
        let old = host.list().pop().unwrap();
        assert!(host.uninstall("patina.focus", &old.generation).is_err());
        assert!(host.list().is_empty());
        assert!(
            host.dispatch_panel_event("patina.focus", &old.generation, None, "en-US")
                .is_err()
        );
        drop(host);
        let runtime = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(1)
            .enable_all()
            .build()?;
        let pool = runtime.block_on(patina_activity::open_database(&tmp.path().join("db")))?;
        let storage = patina_activity::NativeToolData::new(pool, runtime.handle().clone());
        let file = registry.join("tools.json");
        let pending: Value = serde_json::from_slice(&std::fs::read(&file)?)?;
        for legacy in [false, true] {
            if legacy {
                let mut historical = pending.clone();
                historical["patina.focus"]
                    .as_object_mut()
                    .unwrap()
                    .remove("delete_data_on_removal");
                std::fs::write(&file, serde_json::to_vec(&historical)?)?;
            }
            storage.focus().apply(
                json!({"kind":"pomodoro","action":{"kind":"save","label":"Draft",
                "focusMs":60000,"shortBreakMs":60000,"longBreakMs":60000,"longBreakEvery":2}}),
                now_ms(),
            )?;
            let mut host = Host::open(registry.clone())?;
            bind(&mut host, package("patina.focus")?, &storage, "en-US")?;
            assert!(host.list().is_empty());
            host.restore_default(package("patina.focus")?, "en-US")?;
            assert!(host.uninstall("patina.focus", &old.generation).is_err());
            let data = storage.focus().read("en-US", now_ms(), &Value::Null)?;
            assert_eq!(
                data["pomodoro"].as_array().unwrap().len(),
                usize::from(legacy)
            );
        }
        Ok(())
    }

    #[test]
    fn native_capabilities_are_scoped_to_the_current_installation()
    -> Result<(), Box<dyn std::error::Error>> {
        let root = tempfile::tempdir()?;
        let runtime = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(1)
            .enable_all()
            .build()?;
        let pool =
            runtime.block_on(patina_activity::open_database(&root.path().join("data.db")))?;
        let storage = patina_activity::NativeToolData::new(pool, runtime.handle().clone());
        let mut host = Host::open(root.path().join("tools"))?;
        let focus = package("patina.focus")?;
        let reminders = package("patina.reminders")?;
        bind(&mut host, focus.clone(), &storage, "en-US")?;
        bind(&mut host, reminders.clone(), &storage, "en-US")?;
        let first = host.bound_installation("patina.focus").unwrap();
        let other = host.bound_installation("patina.reminders").unwrap();
        assert!(
            host.dispatch_panel_event("patina.focus", &other.generation, None, "en-US")
                .is_err()
        );
        host.uninstall("patina.focus", &first.generation)?;
        assert!(host.bound_installation("patina.focus").is_none());
        assert!(
            host.dispatch_panel_event("patina.reminders", &other.generation, None, "en-US")
                .is_ok()
        );
        let restored = host.restore_default(focus, "en-US")?;
        assert_ne!(restored.generation, first.generation);
        assert!(
            host.dispatch_panel_event("patina.focus", &first.generation, None, "en-US")
                .is_err()
        );
        Ok(())
    }

    #[test]
    fn old_tasks_keep_identity_and_expired_work_is_consumed_once()
    -> Result<(), Box<dyn std::error::Error>> {
        let root = tempfile::tempdir()?;
        let runtime = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(1)
            .enable_all()
            .build()?;
        let pool = runtime.block_on(patina_activity::open_database(
            &root.path().join("patina.db"),
        ))?;
        let storage = patina_activity::NativeToolData::new(pool.clone(), runtime.handle().clone());
        let start = now_ms() - 120_000;
        storage.focus().apply(
            json!({"kind":"pomodoro","action":{"kind":"save","label":"Deep work",
            "focusMs":60000,"shortBreakMs":60000,"longBreakMs":60000,"longBreakEvery":2}}),
            start,
        )?;
        let snapshot = storage.focus().read("en-US", start, &Value::Null)?;
        let id = snapshot["pomodoro"][0]["run"]["id"].as_i64().unwrap();
        storage.focus().apply(
            json!({"kind":"pomodoro","action":{"kind":"resume","id":id}}),
            start,
        )?;
        storage.reminders().apply(json!({"kind":"create","at":start+60000,"label":"Weekly report","recurrence":{"kind":"daily"}}),start)?;
        let key = super::plugin_install_tests::test_key();
        let signed = |mut package: Package| -> Result<Package, String> {
            package.sign(&key)?;
            Ok(package)
        };
        let open = || -> Result<Host, String> {
            let mut host = Host::open(root.path().join("tools"))?;
            for bundle in BUNDLES {
                bind(&mut host, signed(bundle.package()?)?, &storage, "en-US")?;
            }
            Ok(host)
        };
        let mut host = open()?;
        for t in host.list() {
            host.dispatch_panel_event(&t.manifest.id, &t.generation, None, "en-US")?;
        }
        drop(host);
        let mut host = open()?;
        let wake = now_ms();
        assert!(host.fire_due(wake, "en-US").is_empty());
        assert!(host.fire_due(wake + 400, "en-US").is_empty());
        let focus = host
            .list()
            .into_iter()
            .find(|t| t.manifest.id == "patina.focus")
            .unwrap();
        let after =
            storage
                .focus()
                .read("en-US", wake, &json!({"history_id":id,"kind":"pomodoro"}))?;
        assert_eq!(after["pomodoro"][0]["run"]["id"], id);
        assert_eq!(after["pomodoro"][0]["run"]["completed_focus_count"], 1);
        assert_eq!(after["pomodoro"][0]["run"]["status"], "paused");
        assert_eq!(after["history"].as_array().unwrap().len(), 1);
        let history = host.dispatch_panel_event(
            "patina.focus",
            &focus.generation,
            Some(format!("history-pomodoro-{id}")),
            "en-US",
        )?;
        assert!(
            history
                .iter()
                .any(|c| matches!(c,Control::Text(s) if s.contains("min")))
        );
        let mut events = crate::tool_events::ToolEvents::default();
        let notices = events.list(&host, &storage)?;
        let reminder = notices.iter().find(|n| n.id == "patina.reminders").unwrap();
        events.acknowledge(reminder, "dismiss", &mut host, &storage, "en-US")?;
        assert!(
            events
                .acknowledge(reminder, "dismiss", &mut host, &storage, "en-US")
                .is_err()
        );
        assert!(storage.reminders().pending()?.is_empty());
        let next = storage.reminders().read("en-US", wake, &Value::Null)?;
        assert_eq!(next["reminders"][0]["status"], "scheduled");
        assert!(next["reminders"][0]["scheduled_at"].as_i64().unwrap() > wake);
        let expired = notices
            .into_iter()
            .find(|n| n.id == "patina.focus")
            .unwrap();
        runtime.block_on(
            sqlx::query(
                "CREATE TRIGGER reject_history_delete BEFORE DELETE ON focus_history_groups
             BEGIN SELECT RAISE(ABORT, 'history unavailable'); END",
            )
            .execute(&pool),
        )?;
        assert!(host.uninstall("patina.focus", &focus.generation).is_err());
        assert_eq!(
            storage.focus().read("en-US", wake, &Value::Null)?["pomodoro"],
            after["pomodoro"]
        );
        runtime.block_on(sqlx::query("DROP TRIGGER reject_history_delete").execute(&pool))?;
        host.uninstall("patina.focus", &focus.generation)?;
        drop(host);
        let mut host = open()?;
        assert_eq!(host.list().len(), 1);
        let reinstalled = host.restore_default(signed(package("patina.focus")?)?, "en-US")?;
        assert_ne!(focus.generation, reinstalled.generation);
        assert!(
            events
                .acknowledge(&expired, "start", &mut host, &storage, "en-US")
                .is_err()
        );
        let again =
            storage
                .focus()
                .read("en-US", wake, &json!({"history_id":id,"kind":"pomodoro"}))?;
        assert_eq!(again["history"], json!([]));
        assert_eq!(again["pomodoro"], json!([]));
        assert_eq!(again["free"], json!([]));
        assert_eq!(
            storage.reminders().read("en-US", wake, &Value::Null)?["reminders"],
            next["reminders"]
        );
        let stats: i64 = runtime.block_on(
            sqlx::query_scalar("SELECT COUNT(*) FROM tool_daily_stats").fetch_one(&pool),
        )?;
        assert_eq!(stats, 0);
        let mut newer = package("patina.focus")?;
        newer.manifest.version = "99.0.0".into();
        newer.sign(&key)?;
        bind(&mut host, newer.clone(), &storage, "en-US")?;
        let upgraded = host
            .list()
            .into_iter()
            .find(|t| t.manifest.id == "patina.focus")
            .unwrap();
        assert_ne!(reinstalled.generation, upgraded.generation);
        assert_eq!(upgraded.manifest.version, "99.0.0");
        newer.manifest.version = "100.0.0".into();
        newer.manifest.entry = "missing".into();
        newer.sign(&key)?;
        assert!(bind(&mut host, newer.clone(), &storage, "en-US").is_err());
        assert!(
            host.dispatch_panel_event("patina.focus", &upgraded.generation, None, "en-US")
                .is_ok()
        );
        host.uninstall("patina.focus", &upgraded.generation)?;
        bind(&mut host, newer, &storage, "en-US")?;
        assert!(host.list().iter().all(|t| t.manifest.id != "patina.focus"));
        Ok(())
    }
}
