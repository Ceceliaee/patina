use super::*;

#[test]
fn website_rules_share_atomic_drafts_and_preserve_grouping() -> Result<(), Error> {
    let root = tempfile::tempdir()?;
    let db = root.path().join("patina.db");
    seed(&db)?;
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()?;
    rt.block_on(async {
        let mut c = SqliteConnection::connect_with(&SqliteConnectOptions::new().filename(&db)).await?;
        for (key, value) in [
            ("web_activity_enabled", "1"),
            ("__web_site::example.com", r##"{"version":2,"category":"development","displayName":"Example","exceptions":["solo.example.com"]}"##),
            ("__web_domain_override::solo.example.com", r##"{"knownDomain":true,"category":"office","displayName":"Solo","linkedApps":["studio.exe"]}"##),
        ] {
            sqlx::query("INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)").bind(key).bind(value).execute(&mut c).await?;
        }
        for domain in ["a.example.com", "b.example.com", "solo.example.com"] {
            sqlx::query("INSERT INTO web_activity_segments(browser_client_id,browser_kind,browser_exe_name,domain,normalized_domain,start_time,end_time,duration,created_at,updated_at) VALUES('test','chrome','chrome.exe',?,?,0,1000,1000,0,1000)")
                .bind(domain).bind(domain).execute(&mut c).await?;
        }
        Ok::<_, Error>(())
    })?;
    let recorder = patina_recorder::Recorder::start(&db, || {})?;
    rt.block_on(async {
        let rules = recorder.rules().await?;
        assert!(rules.web_enabled);
        let mut restored = rules.websites.clone();
        restored.set_member("a.example.com", false, false);
        assert!(restored.dirty());
        restored.set_member("a.example.com", false, true);
        assert!(!restored.dirty(), "implicit true restored");
        restored.set_independent("a.example.com", true);
        assert!(restored.dirty());
        restored.set_independent("a.example.com", false);
        assert!(!restored.dirty(), "split/merge restored");
        let original = restored
            .cards()
            .into_iter()
            .find(|c| c.domain == "example.com")
            .unwrap();
        let mut renamed = original.clone();
        renamed.name = "Temporary".into();
        restored.assign(&renamed);
        restored.assign(&original);
        assert!(!restored.dirty(), "rename restored");
        assert_eq!(rules.websites.cards().len(), 2);
        let mut group = rules
            .websites
            .cards()
            .into_iter()
            .find(|r| r.domain == "example.com")
            .unwrap()
            .clone();
        assert_eq!(group.members, ["a.example.com", "b.example.com"]);
        assert_eq!(group.category, "development");
        let mut solo = rules
            .websites
            .cards()
            .into_iter()
            .find(|r| r.domain == "solo.example.com")
            .unwrap()
            .clone();
        let mut app = rules
            .apps
            .iter()
            .find(|r| r.exe == "studio.exe")
            .unwrap()
            .clone();
        app.name = "App draft".into();
        group.name = "Website draft".into();
        group.category = "missing-category".into();
        let mut invalid = rules.websites.clone();
        invalid.assign(&group);
        assert!(recorder
            .save_rules(vec![app.clone()], Some(invalid), vec![], vec![])
            .await
            .is_err());
        assert!(recorder
            .rules()
            .await?
            .apps
            .iter()
            .any(|r| r.name == "Studio"));
        group.category = "office".into();
        group.color = "#123456".into();
        group.track = false;
        solo.name = "Independent".into();
        solo.titles = false;
        let mut draft = rules.websites.clone();
        draft.assign(&group);
        draft.assign(&solo);
        recorder
            .save_rules(vec![app], Some(draft.clone()), vec![], vec![])
            .await?;
        let saved = recorder.rules().await?;
        let group_saved = saved
            .websites
            .cards()
            .into_iter()
            .find(|r| r.domain == "example.com")
            .unwrap();
        assert_eq!(group_saved.name, "Website draft");
        assert_eq!(group_saved.color, "#123456");
        assert!(!group_saved.track);
        assert_eq!(group_saved.category, "office");
        assert!(recorder
            .save_rules(vec![], Some(draft), vec![], vec![])
            .await
            .is_err());
        let mut c =
            SqliteConnection::connect_with(&SqliteConnectOptions::new().filename(&db)).await?;
        let raw: String = sqlx::query_scalar(
            "SELECT value FROM settings WHERE key='__web_domain_override::solo.example.com'",
        )
        .fetch_one(&mut c)
        .await?;
        let raw: serde_json::Value = serde_json::from_str(&raw)?;
        assert_eq!(raw["knownDomain"], true);
        assert_eq!(raw["linkedApps"][0], "studio.exe");
        assert_eq!(raw["captureTitle"], false);
        let preview = recorder
            .delete_website(group_saved.identity.clone(), None)
            .await?;
        assert_eq!(preview.members.len(), 2);
        recorder
            .delete_website(group_saved.identity.clone(), Some(preview))
            .await?;
        let remaining = recorder.rules().await?;
        assert_eq!(remaining.websites.cards().len(), 1);
        assert_eq!(remaining.websites.cards()[0].domain, "solo.example.com");
        assert_eq!(remaining.apps.len(), saved.apps.len());
        Ok::<_, Error>(())
    })?;
    recorder.shutdown()?;
    Ok(())
}

#[test]
fn member_drafts_regroup_icons_and_app_associations_are_atomic() -> Result<(), Error> {
    let root = tempfile::tempdir()?;
    let db = root.path().join("patina.db");
    seed(&db)?;
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()?;
    rt.block_on(async {
        let mut c = SqliteConnection::connect_with(&SqliteConnectOptions::new().filename(&db)).await?;
        for (key, value) in [
            ("web_activity_enabled", "1"),
            ("title_recording_enabled", "0"),
            ("__web_site::example.com", r##"{"version":2,"displayName":"Group","category":"office","color":"#123456"}"##),
            ("__web_domain_override::a.example.com", r##"{"displayName":"Independent A","category":"development","color":"#654321","captureTitle":false,"linkedApps":["writer.exe"]}"##),
        ] {
            sqlx::query("INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)").bind(key).bind(value).execute(&mut c).await?;
        }
        for (domain, duration) in [("a.example.com", 1000), ("b.example.com", 3000)] {
            sqlx::query("INSERT INTO web_activity_segments(browser_client_id,browser_kind,browser_exe_name,domain,normalized_domain,start_time,end_time,duration,created_at,updated_at) VALUES('test','chrome','chrome.exe',?,?,0,?,?,0,?)")
                .bind(domain).bind(domain).bind(duration).bind(duration).bind(duration).execute(&mut c).await?;
            sqlx::query("INSERT INTO web_favicon_cache(normalized_domain,favicon_url,updated_at) VALUES(?,?,0)")
                .bind(domain).bind(format!("https://{domain}/favicon.ico")).execute(&mut c).await?;
        }
        Ok::<_, Error>(())
    })?;
    let recorder = patina_recorder::Recorder::start(&db, || {})?;
    rt.block_on(async {
        let initial = recorder.rules().await?;
        assert!(!initial.titles_enabled);
        let mut draft = initial.websites.clone();
        let card = draft.cards().remove(0);
        assert!(card.titles_mixed);
        assert!(!card.tracking_mixed);
        assert_eq!(
            card.favicon.as_deref(),
            Some("https://b.example.com/favicon.ico")
        );
        draft.set_member("b.example.com", false, false);
        let card = draft.cards().remove(0);
        assert!(card.tracking_mixed);
        assert_eq!(
            card.favicon.as_deref(),
            Some("https://a.example.com/favicon.ico")
        );
        draft.set_independent("a.example.com", true);
        let cards = draft.cards();
        assert_eq!(cards.len(), 2);
        let independent = cards.iter().find(|c| c.domain == "a.example.com").unwrap();
        assert_eq!(independent.name, "Independent A");
        assert_eq!(independent.category, "development");
        assert_eq!(independent.color, "#654321");
        assert!(!independent.titles);
        assert_eq!(initial.websites.cards().len(), 1); // Discarding a draft preserves the loaded catalog.
        recorder
            .save_rules(
                vec![],
                Some(draft.clone()),
                vec![patina_recorder::AppLinkEdit {
                    member: "writer.exe".into(),
                    parent: Some("studio.exe".into()),
                    original: None,
                }],
                vec![],
            )
            .await?;
        let saved = recorder.rules().await?;
        assert_eq!(
            saved.app_links.get("writer.exe").map(String::as_str),
            Some("studio.exe")
        );
        let mut writer = saved
            .apps
            .iter()
            .find(|a| a.exe == "writer.exe")
            .unwrap()
            .clone();
        writer.titles = false;
        writer.track = false;
        let mut merged = saved.websites.clone();
        let mut stale_member = saved.websites.clone();
        stale_member.set_member("a.example.com", true, true);
        merged.set_independent("a.example.com", false);
        let group = merged.cards().remove(0);
        assert_eq!(group.name, "Group");
        assert!(group.titles_mixed && group.tracking_mixed);
        // A cycle must roll back both the regroup and member policy change.
        assert!(recorder
            .save_rules(
                vec![writer.clone()],
                Some(merged.clone()),
                vec![patina_recorder::AppLinkEdit {
                    member: "studio.exe".into(),
                    parent: Some("writer.exe".into()),
                    original: None,
                }],
                vec![]
            )
            .await
            .is_err());
        assert_eq!(recorder.rules().await?.websites.cards().len(), 2);
        assert!(
            recorder
                .rules()
                .await?
                .apps
                .iter()
                .find(|a| a.exe == "writer.exe")
                .unwrap()
                .track
        );
        recorder
            .save_rules(vec![writer], Some(merged), vec![], vec![])
            .await?;
        let joined = recorder.rules().await?;
        assert!(recorder
            .save_rules(vec![], Some(stale_member), vec![], vec![])
            .await
            .is_err());
        assert_eq!(joined.websites.cards().len(), 1);
        assert!(
            !joined
                .apps
                .iter()
                .find(|a| a.exe == "writer.exe")
                .unwrap()
                .titles
        );
        // Stale grouping cannot restore the old member rules.
        assert!(recorder
            .save_rules(vec![], Some(draft), vec![], vec![])
            .await
            .is_err());
        recorder
            .save_rules(
                vec![],
                None,
                vec![patina_recorder::AppLinkEdit {
                    member: "writer.exe".into(),
                    parent: None,
                    original: Some("studio.exe".into()),
                }],
                vec![],
            )
            .await?;
        let detached = recorder.rules().await?;
        assert!(detached.app_links.is_empty());
        assert_eq!(detached.apps.len(), initial.apps.len());
        assert!(
            !detached
                .apps
                .iter()
                .find(|a| a.exe == "writer.exe")
                .unwrap()
                .track
        );
        let mut split = detached.websites.clone();
        split.set_independent("a.example.com", true);
        let office = detached
            .categories
            .iter()
            .find(|(id, _)| id == "office")
            .unwrap();
        recorder
            .save_rules(
                vec![],
                Some(split),
                vec![],
                vec![patina_recorder::CategoryEdit {
                    id: "office".into(),
                    previous: Some(office.1.clone()),
                    previous_color: detached.category_colors.get("office").cloned(),
                    label: office.1.clone(),
                    color: None,
                    replacement: Some("other".into()),
                }],
            )
            .await?;
        let recategorized = recorder.rules().await?;
        assert_eq!(recategorized.websites.cards().len(), 2);
        assert_eq!(
            recategorized
                .websites
                .cards()
                .iter()
                .find(|c| c.domain == "example.com")
                .unwrap()
                .category,
            "other"
        );
        assert_eq!(recategorized.apps.len(), initial.apps.len());
        Ok::<_, Error>(())
    })?;
    recorder.shutdown()?;
    Ok(())
}
