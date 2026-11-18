use base64::{Engine, engine::general_purpose::STANDARD};
use patina_tool_host::{Package, ToolData};
use serde_json::Value;

pub(super) use patina_desktop_protocol::tools::BUNDLED_IDS as IDS;

pub(super) fn package(id: &str) -> Result<Package, String> {
    let (manifest, wasm): (&str, &[u8]) = match id {
        "patina.focus" => (
            include_str!("../../../plugins/official/focus/manifest.json"),
            include_bytes!(concat!(
                env!("OUT_DIR"),
                "/guests/wasm32-unknown-unknown/release/patina_focus.wasm"
            )),
        ),
        "patina.reminders" => (
            include_str!("../../../plugins/official/reminders/manifest.json"),
            include_bytes!(concat!(
                env!("OUT_DIR"),
                "/guests/wasm32-unknown-unknown/release/patina_reminders.wasm"
            )),
        ),
        _ => return Err("Unknown bundled tool".into()),
    };
    Ok(Package {
        manifest: serde_json::from_str(manifest).map_err(|e| e.to_string())?,
        wasm: STANDARD.encode(wasm),
        publisher: String::new(),
        signature: String::new(),
    })
}

pub(super) struct Storage(pub patina_recorder::NativeToolData);

impl ToolData for Storage {
    fn read(&self, id: &str, locale: &str, now: i64, state: &Value) -> Result<Value, String> {
        self.0.read(id, locale, now, state)
    }
    fn apply(&self, id: &str, command: Value, now: i64) -> Result<(), String> {
        self.0.apply(id, command, now)
    }
    fn suspend(&self, id: &str, now: i64) -> Result<(), String> {
        self.0.suspend(id, now)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use patina_tool_host::{Control, Host, now_ms};
    use serde_json::json;

    struct Unavailable;

    #[test]
    fn app_category_and_site_thresholds_follow_stored_activity()
    -> Result<(), Box<dyn std::error::Error>> {
        let tmp = tempfile::tempdir()?;
        let path = tmp.path().join("patina.db");
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()?;
        let pool = rt.block_on(patina_recorder::open_database(&path))?;
        let now = now_ms();
        rt.block_on(async{
            sqlx::query("INSERT OR REPLACE INTO settings(key,value) VALUES ('tracking_paused','1'),('web_activity_enabled','true'),('__app_override::editor.exe','{\"category\":\"development\",\"enabled\":true}')").execute(&pool).await?;
            sqlx::query("INSERT INTO sessions(app_name,exe_name,window_title,start_time,end_time,duration,continuity_group_start_time) VALUES('Editor','editor.exe','',?,?,120000,?)")
                .bind(now-120000).bind(now).bind(now-120000).execute(&pool).await?;
            sqlx::query("INSERT INTO web_activity_segments(browser_client_id,browser_kind,browser_exe_name,domain,normalized_domain,start_time,end_time,duration,source,created_at,updated_at) VALUES('fixture','chromium','chrome.exe','example.com','example.com',?,?,120000,'browser-extension',?,?)")
                .bind(now-120000).bind(now).bind(now-120000).bind(now).execute(&pool).await?;
            Ok::<_,sqlx::Error>(())
        })?;
        let recorder = patina_recorder::Recorder::start(&path, || {})?;
        let storage = recorder.tools();
        let mut host = Host::open(tmp.path().join("tools"))?;
        host.bind(Box::new(Storage(storage.clone())))?;
        host.seed(package("patina.reminders")?, "en-US")?;
        let tool = host.list().pop().unwrap();
        let id = &tool.manifest.id;
        for (kind, target) in [
            ("app", "editor.exe"),
            ("category", "development"),
            ("web", "example.com"),
        ] {
            let fields = [
                ("name", kind),
                ("target", kind),
                ("value", target),
                ("limit", "1"),
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
        let rules = storage.read(id, "en-US", now, &Value::Null)?;
        for rule in rules["rules"].as_array().unwrap() {
            assert!(rule["extension_limit_ms"].as_i64().unwrap() >= 900000);
            let action = format!("toggle-usage-{}", rule["id"]);
            host.panel(id, &tool.generation, Some(action), "en-US")?;
        }
        events.evaluate(&host, &storage)?;
        assert!(events.next_usage.is_none());
        recorder.shutdown()?;
        rt.block_on(pool.close());
        Ok(())
    }
    impl ToolData for Unavailable {
        fn read(&self, _: &str, _: &str, _: i64, _: &Value) -> Result<Value, String> {
            Err("store closed".into())
        }
        fn apply(&self, _: &str, _: Value, _: i64) -> Result<(), String> {
            Err("store closed".into())
        }
        fn suspend(&self, _: &str, _: i64) -> Result<(), String> {
            Err("store closed".into())
        }
    }

    #[test]
    fn interrupted_removal_is_resumed_before_reinstall() -> Result<(), Box<dyn std::error::Error>> {
        let tmp = tempfile::tempdir()?;
        let registry = tmp.path().join("tools");
        let mut host = Host::open(registry.clone())?;
        host.seed(package("patina.focus")?, "en-US")?;
        let old = host.list().pop().unwrap();
        host.bind(Box::new(Unavailable))?;
        assert!(host.uninstall("patina.focus", &old.generation).is_err());
        assert!(host.list().is_empty());
        assert!(
            host.panel("patina.focus", &old.generation, None, "en-US")
                .is_err()
        );
        drop(host);
        let recorder = patina_recorder::Recorder::start(&tmp.path().join("db"), || {})?;
        let mut host = Host::open(registry)?;
        host.bind(Box::new(Storage(recorder.tools())))?;
        host.seed(package("patina.focus")?, "en-US")?;
        assert!(host.list().is_empty());
        host.restore_bundled(package("patina.focus")?, "en-US")?;
        assert!(host.uninstall("patina.focus", &old.generation).is_err());
        recorder.shutdown()?;
        Ok(())
    }

    #[test]
    fn old_tasks_keep_identity_and_expired_work_is_consumed_once()
    -> Result<(), Box<dyn std::error::Error>> {
        let root = tempfile::tempdir()?;
        let recorder = patina_recorder::Recorder::start(&root.path().join("patina.db"), || {})?;
        let storage = recorder.tools();
        let start = now_ms() - 120_000;
        storage.apply(
            "patina.focus",
            json!({"kind":"pomodoro","action":{"kind":"save","label":"Deep work",
            "focusMs":60000,"shortBreakMs":60000,"longBreakMs":60000,"longBreakEvery":2}}),
            start,
        )?;
        let snapshot = storage.read("patina.focus", "en-US", start, &Value::Null)?;
        let id = snapshot["pomodoro"][0]["run"]["id"].as_i64().unwrap();
        storage.apply(
            "patina.focus",
            json!({"kind":"pomodoro","action":{"kind":"resume","id":id}}),
            start,
        )?;
        storage.apply("patina.reminders",json!({"kind":"create","at":start+60000,"label":"Weekly report","recurrence":{"kind":"daily"}}),start)?;
        let open = || -> Result<Host, String> {
            let mut host = Host::open(root.path().join("tools"))?;
            host.bind(Box::new(Storage(storage.clone())))?;
            for id in IDS {
                host.seed(package(id)?, "en-US")?;
            }
            Ok(host)
        };
        let mut host = open()?;
        for t in host.list() {
            host.panel(&t.manifest.id, &t.generation, None, "en-US")?;
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
        let after = storage.read(
            "patina.focus",
            "en-US",
            wake,
            &json!({"history_id":id,"kind":"pomodoro"}),
        )?;
        assert_eq!(after["pomodoro"][0]["run"]["id"], id);
        assert_eq!(after["pomodoro"][0]["run"]["completed_focus_count"], 1);
        assert_eq!(after["pomodoro"][0]["run"]["status"], "paused");
        assert_eq!(after["history"].as_array().unwrap().len(), 1);
        let history = host.panel(
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
        assert!(storage.pending()?.is_empty());
        let next = storage.read("patina.reminders", "en-US", wake, &Value::Null)?;
        assert_eq!(next["reminders"][0]["status"], "scheduled");
        assert!(next["reminders"][0]["scheduled_at"].as_i64().unwrap() > wake);
        let expired = notices
            .into_iter()
            .find(|n| n.id == "patina.focus")
            .unwrap();
        host.uninstall("patina.focus", &focus.generation)?;
        drop(host);
        let mut host = open()?;
        assert_eq!(host.list().len(), 1);
        let reinstalled = host.restore_bundled(package("patina.focus")?, "en-US")?;
        assert_ne!(focus.generation, reinstalled.generation);
        assert!(
            events
                .acknowledge(&expired, "start", &mut host, &storage, "en-US")
                .is_err()
        );
        let again = storage.read(
            "patina.focus",
            "en-US",
            wake,
            &json!({"history_id":id,"kind":"pomodoro"}),
        )?;
        assert_eq!(after["history"], again["history"]);
        let mut newer = package("patina.focus")?;
        newer.manifest.version = "0.2.0".into();
        host.seed(newer.clone(), "en-US")?;
        let upgraded = host
            .list()
            .into_iter()
            .find(|t| t.manifest.id == "patina.focus")
            .unwrap();
        assert_ne!(reinstalled.generation, upgraded.generation);
        assert_eq!(upgraded.manifest.version, "0.2.0");
        newer.manifest.version = "0.3.0".into();
        newer.manifest.entry = "missing".into();
        assert!(host.seed(newer.clone(), "en-US").is_err());
        assert!(
            host.panel("patina.focus", &upgraded.generation, None, "en-US")
                .is_ok()
        );
        host.uninstall("patina.focus", &upgraded.generation)?;
        host.seed(newer, "en-US")?;
        assert!(host.list().iter().all(|t| t.manifest.id != "patina.focus"));
        recorder.shutdown()?;
        Ok(())
    }
}
