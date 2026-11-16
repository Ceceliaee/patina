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
        assert_eq!(rules.websites.len(), 2);
        let mut group = rules
            .websites
            .iter()
            .find(|r| r.domain == "example.com")
            .unwrap()
            .clone();
        assert_eq!(group.members, ["a.example.com", "b.example.com"]);
        assert_eq!(group.category, "development");
        let mut solo = rules
            .websites
            .iter()
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
        assert!(recorder
            .save_rules(vec![app.clone()], vec![group.clone()], vec![])
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
        recorder
            .save_rules(vec![app], vec![group.clone(), solo], vec![])
            .await?;
        let saved = recorder.rules().await?;
        let group_saved = saved
            .websites
            .iter()
            .find(|r| r.domain == "example.com")
            .unwrap();
        assert_eq!(group_saved.name, "Website draft");
        assert_eq!(group_saved.color, "#123456");
        assert!(!group_saved.track);
        assert_eq!(group_saved.category, "office");
        assert!(recorder
            .save_rules(vec![], vec![group], vec![])
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
        assert_eq!(remaining.websites.len(), 1);
        assert_eq!(remaining.websites[0].domain, "solo.example.com");
        assert_eq!(remaining.apps.len(), saved.apps.len());
        Ok::<_, Error>(())
    })?;
    recorder.shutdown()?;
    Ok(())
}
