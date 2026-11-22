use super::*;
use patina_plugin_host::{Control, Installed, now_ms};
use std::{fs, path::Path};

type Result<T> = std::result::Result<T, Box<dyn std::error::Error>>;

pub(super) fn test_key() -> ring::signature::Ed25519KeyPair {
    use ring::{rand::SystemRandom, signature::Ed25519KeyPair};
    let bytes = Ed25519KeyPair::generate_pkcs8(&SystemRandom::new()).unwrap();
    Ed25519KeyPair::from_pkcs8(bytes.as_ref()).unwrap()
}

fn install(host: &mut Host, package: &Package, zip: &Path) -> Result<Installed> {
    package.write_zip(fs::File::create(zip)?)?;
    let preview = host.inspect(zip)?;
    Ok(host.install(zip, &preview, "zh-CN")?)
}

#[test]
fn signed_zip_locale_update_and_duplicate_keep_one_installation() -> Result<()> {
    let temp = tempfile::tempdir()?;
    let rt = tokio::runtime::Runtime::new()?;
    let pool = rt.block_on(patina_activity::open_database(
        &temp.path().join("tracker.db"),
    ))?;
    let storage = NativeToolData::new(pool, rt.handle().clone());
    let root = temp.path().join("tools");
    let zip = temp.path().join("plugin.zip");
    let key = test_key();
    for bundle in BUNDLES {
        let mut package = bundle.package()?;
        package.sign(&key)?;
        let original = package.clone();
        let id = package.manifest.id.clone();
        let mut host = Host::open(root.clone())?;
        configure(&mut host, &storage)?;
        host.seed(package.clone(), "zh-CN")?;
        let first = host.bound_installation(&id).unwrap();
        let initial = host.dispatch_panel_event(&id, &first.generation, None, "zh-CN")?;
        let page = initial
            .iter()
            .find_map(|control| match control {
                Control::Page(page) => Some(page),
                _ => None,
            })
            .unwrap();
        let first_tab = page.tabs[0].id.clone();
        let second_tab = page.tabs[1].id.clone();
        assert_eq!(page.selected_tab.as_ref(), Some(&first_tab));
        host.select_tab(&id, &first.generation, second_tab.clone(), "zh-CN")?;
        // The same bundle can be restored through the normal file picker after removal.
        host.uninstall(&id, &first.generation)?;
        let restored = install(&mut host, &package, &zip)?;
        let fresh = host.dispatch_panel_event(&id, &restored.generation, None, "zh-CN")?;
        assert!(
            fresh.iter().any(
                |c| matches!(c, Control::Page(p) if p.selected_tab.as_ref() == Some(&first_tab))
            )
        );
        host.select_tab(&id, &restored.generation, second_tab.clone(), "zh-CN")?;
        assert_eq!(
            restored.generation,
            install(&mut host, &package, &zip)?.generation
        );
        let generation = restored.generation;
        let field = if id.ends_with("focus") {
            "tools.pomodoroTaskCreate"
        } else {
            "tools.newReminder"
        };
        let module = fs::read(root.join("plugins").join(&id).join("plugin.wasm"))?;
        package
            .locales
            .get_mut("zh-CN")
            .unwrap()
            .insert(field.into(), "译文更新".into());
        package
            .locales
            .get_mut("zh-CN")
            .unwrap()
            .insert("plugin.name".into(), "测试名称".into());
        assert!(package.write_zip(std::io::Cursor::new(Vec::new())).is_err());
        package.sign(&key)?;
        let updated = install(&mut host, &package, &zip)?;
        assert_ne!(updated.generation, generation);
        assert_eq!(
            updated.generation,
            install(&mut host, &package, &zip)?.generation
        );
        assert_eq!(
            fs::read(root.join("plugins").join(&id).join("plugin.wasm"))?,
            module
        );
        drop(host);
        let mut host = Host::open(root.clone())?;
        configure(&mut host, &storage)?;
        host.seed(original, "zh-CN")?;
        let installed = host.bound_installation(&id).unwrap();
        assert_eq!(installed.generation, updated.generation);
        assert_eq!(
            installed.manifest.presentation.unwrap().names["zh-CN"],
            "测试名称"
        );
        for locale in ["zh-CN", "es", "ru-RU", "en-US", "xx"] {
            let p = host.dispatch_panel_event(&id, &updated.generation, None, locale)?;
            let page = p
                .iter()
                .find_map(|c| {
                    if let Control::Page(p) = c {
                        Some(p)
                    } else {
                        None
                    }
                })
                .unwrap();
            let messages = &package.locales[if locale == "xx" { "en-US" } else { locale }];
            assert_eq!(page.selected_tab.as_ref(), Some(&second_tab));
            assert_eq!(page.title, messages["plugin.name"]);
            assert_eq!(page.tabs[0].form.as_ref().unwrap().heading, messages[field]);
        }
        host.uninstall(&id, &updated.generation)?;
        host.seed(package, "zh-CN")?;
        assert!(host.bound_installation(&id).is_none());
    }
    Ok(())
}

#[test]
fn providers_with_the_same_capability_own_separate_tasks_and_notifications() -> Result<()> {
    let temp = tempfile::tempdir()?;
    let rt = tokio::runtime::Runtime::new()?;
    let pool = rt.block_on(patina_activity::open_database(
        &temp.path().join("tracker.db"),
    ))?;
    let storage = NativeToolData::new(pool.clone(), rt.handle().clone());
    let root = temp.path().join("tools");
    let zip = temp.path().join("test.zip");
    let mut host = Host::open(root.clone())?;
    configure(&mut host, &storage)?;
    let now = now_ms();
    rt.block_on(sqlx::query("INSERT INTO sessions(app_name,exe_name,window_title,start_time,end_time,duration,continuity_group_start_time) VALUES ('Editor','editor.exe','',?,?,120000,?)").bind(now-120000).bind(now).bind(now-120000).execute(&pool))?;
    let key = test_key();
    let mut events = crate::tool_events::ToolEvents::default();
    for (kind, cap, source) in [
        (
            TaskKind::Reminders,
            Capability::Reminders,
            "patina.reminders",
        ),
        (TaskKind::Focus, Capability::Focus, "patina.focus"),
    ] {
        let original = package(source)?;
        host.seed(original.clone(), "en-US")?;
        let first = host.bound_installation(source).unwrap();
        let mut other = original.clone();
        other.manifest.id = format!("another.{}", source);
        other.sign(&key)?;
        let second = install(&mut host, &other, &zip)?;
        assert_eq!(host.providers(cap).count(), 2);
        for tool in [&first, &second] {
            let id = &tool.manifest.id;
            let fields = match kind {
                TaskKind::Reminders => vec![("name", id.as_str()), ("minutes", "5")],
                TaskKind::Focus => vec![
                    ("pomodoro-name", id.as_str()),
                    ("pomodoro-duration", "25"),
                    ("pomodoro-short", "5"),
                    ("pomodoro-long", "15"),
                    ("pomodoro-rounds", "4"),
                ],
            };
            host.submit(
                id,
                &tool.generation,
                if kind == TaskKind::Focus {
                    "new-pomodoro"
                } else {
                    "new-reminder"
                }
                .into(),
                fields
                    .into_iter()
                    .map(|(k, v)| (k.into(), v.into()))
                    .collect(),
                "en-US",
            )?;
            if kind == TaskKind::Reminders {
                host.submit(
                    id,
                    &tool.generation,
                    "usage".into(),
                    [
                        (
                            "target",
                            serde_json::json!({"kind":"app","value":"editor.exe","label":id})
                                .to_string(),
                        ),
                        ("limit", "1".to_owned()),
                    ]
                    .into_iter()
                    .map(|(k, v)| (k.into(), v))
                    .collect(),
                    "en-US",
                )?;
            }
        }
        let rows = |tool: &Installed| -> Result<Vec<Value>> {
            let db = storage.plugin_tasks(&tool.manifest.id, kind)?;
            let (data, key) = match kind {
                TaskKind::Focus => (db.focus().read("en-US", now, &Value::Null)?, "pomodoro"),
                TaskKind::Reminders => (
                    db.reminders().read("en-US", now, &Value::Null)?,
                    "reminders",
                ),
            };
            Ok(data[key].as_array().unwrap().clone())
        };
        for tool in [&first, &second] {
            let rows = rows(tool)?;
            assert_eq!(rows.len(), 1);
            assert_eq!(rows[0]["label"], tool.manifest.id);
        }
        if kind == TaskKind::Reminders {
            assert!(events.evaluate(&host, &storage)?);
            let notices = events.list(&host, &storage)?;
            assert_eq!(notices.len(), 2);
            assert_ne!(notices[0].id, notices[1].id);
            events.acknowledge(&notices[0], "fifteen_minutes", &mut host, &storage, "en-US")?;
            assert_eq!(events.list(&host, &storage)?.len(), 1);
        }
        let before = rows(&second)?;
        other.manifest.version = "2".into();
        other.sign(&key)?;
        let second = install(&mut host, &other, &zip)?;
        assert_eq!(before, rows(&second)?);
        assert_eq!(
            second.generation,
            install(&mut host, &other, &zip)?.generation
        );
        drop(host);
        host = Host::open(root.clone())?;
        configure(&mut host, &storage)?;
        assert_eq!(host.providers(cap).count(), 2);
        host.uninstall(&second.manifest.id, &second.generation)?;
        assert_eq!(rows(&first)?[0]["label"], source);
        let clean = install(&mut host, &other, &zip)?;
        assert!(rows(&clean)?.is_empty());
        host.uninstall(&clean.manifest.id, &clean.generation)?;
        host.uninstall(source, &first.generation)?;
    }
    assert_eq!(
        rt.block_on(
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM sessions").fetch_one(&pool)
        )?,
        1
    );
    Ok(())
}

#[test]
fn signed_defaults_upgrade_old_unsigned_installations_and_keep_removals() -> Result<()> {
    let temp = tempfile::tempdir()?;
    let rt = tokio::runtime::Runtime::new()?;
    let pool = rt.block_on(patina_activity::open_database(
        &temp.path().join("tracker.db"),
    ))?;
    let storage = NativeToolData::new(pool, rt.handle().clone());
    let root = temp.path().join("tools");
    fs::create_dir(&root)?;
    let mut old_focus = package("patina.focus")?;
    let bundled_version = old_focus.manifest.version.clone();
    old_focus.publisher.clear();
    old_focus.signature.clear();
    old_focus.locales.clear();
    old_focus.manifest.version = "0.3.0".into();
    let old = serde_json::json!({
        "patina.focus": {"state":{"edit_id":91},"package":old_focus,"generation":"previous-focus"},
        "patina.reminders": {"state":null,"generation":"previous-removal"}
    });
    fs::write(root.join("tools.json"), serde_json::to_vec(&old)?)?;
    let mut host = Host::open(root)?;
    configure(&mut host, &storage)?;
    for bundle in BUNDLES {
        host.seed(bundle.package()?, "en-US")?;
    }
    assert_eq!(host.list().len(), 1);
    let updated = host.bound_installation("patina.focus").unwrap();
    assert_ne!(updated.generation, "previous-focus");
    assert_eq!(updated.manifest.version, bundled_version);
    let record: Value = serde_json::from_slice(&fs::read(temp.path().join("tools/tools.json"))?)?;
    assert_eq!(record["patina.focus"]["state"]["edit_id"], 91);
    let restored = install(
        &mut host,
        &package("patina.reminders")?,
        &temp.path().join("restore.zip"),
    )?;
    assert_eq!(restored.manifest.id, "patina.reminders");
    Ok(())
}

#[test]
fn removed_unsigned_zip_can_be_reinstalled_only_by_the_bundled_publisher() -> Result<()> {
    let temp = tempfile::tempdir()?;
    let rt = tokio::runtime::Runtime::new()?;
    let pool = rt.block_on(patina_activity::open_database(
        &temp.path().join("tracker.db"),
    ))?;
    let storage = NativeToolData::new(pool, rt.handle().clone());
    let root = temp.path().join("tools");
    fs::create_dir(&root)?;
    let id = "patina.reminders";
    let old = serde_json::json!({
        (id): {"state":null,"generation":"removed","publisher":"","installed_from_file":true}
    });
    fs::write(root.join("tools.json"), serde_json::to_vec(&old)?)?;
    let signed = package(id)?;
    let zip = temp.path().join("reminders.zip");
    let mut host = Host::open(root.clone())?;
    configure(&mut host, &storage)?;
    host.seed(signed.clone(), "zh-CN")?;
    drop(host);

    let mut host = Host::open(root)?;
    configure(&mut host, &storage)?;
    assert!(host.list().is_empty());
    let mut other = signed.clone();
    other.sign(&test_key())?;
    other.write_zip(fs::File::create(&zip)?)?;
    assert!(host.inspect(&zip).is_err());
    assert!(host.seed(other, "zh-CN").is_err());
    assert_eq!(install(&mut host, &signed, &zip)?.manifest.id, id);
    Ok(())
}
