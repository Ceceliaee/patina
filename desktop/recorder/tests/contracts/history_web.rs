use super::*;

#[test]
fn websites_preserve_sources_grouping_icons_and_privacy() -> Result<(), Error> {
    let root = tempfile::tempdir()?;
    let db = root.path().join("history.db");
    seed(&db)?;
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()?;
    let start = Local::now()
        .date_naive()
        .and_hms_opt(0, 0, 0)
        .unwrap()
        .and_local_timezone(Local)
        .earliest()
        .unwrap()
        .timestamp_millis();
    let icon = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEUlEQVR4nGNQSDjwH4QZYAwASvQI/dnllI8AAAAASUVORK5CYII=";
    rt.block_on(async {
        let mut c = SqliteConnection::connect_with(&SqliteConnectOptions::new().filename(&db)).await?;
        for (key, value) in [
            ("__web_site::example.com", r##"{"version":2,"exceptions":["mail.example.com"],"displayName":"Example","category":"office","color":"#123456"}"##),
            ("__web_domain_override::b.example.com", r#"{"captureTitle":false}"#),
            ("__web_domain_override::hidden.example.com", r#"{"enabled":false}"#),
        ] { sqlx::query("INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)").bind(key).bind(value).execute(&mut c).await?; }
        for (client, domain, lo, hi) in [
            ("a", "a.example.com", 5, 15), ("a", "b.example.com", 10, 20),
            ("b", "a.example.com", 8, 10), ("a", "mail.example.com", 20, 25),
            ("a", "hidden.example.com", 0, 60),
        ] {
            sqlx::query("INSERT INTO web_activity_segments(browser_client_id,browser_kind,browser_exe_name,domain,normalized_domain,title,start_time,end_time,duration,created_at,updated_at) VALUES(?,'chromium','chrome.exe',?,?,'Page title',?,?,?,?,?)")
                .bind(client).bind(domain).bind(domain).bind(start+lo*60000).bind(start+hi*60000)
                .bind((hi-lo)*60000).bind(start+lo*60000).bind(start+hi*60000).execute(&mut c).await?;
        }
        for (domain, value) in [("a.example.com", icon), ("hidden.example.com", "data:image/png;base64,hidden")] {
            sqlx::query("INSERT INTO web_favicon_cache(normalized_domain,favicon_url,updated_at) VALUES(?,?,?)")
                .bind(domain).bind(value).bind(start).execute(&mut c).await?;
        }
        sqlx::query("INSERT INTO anonymous_activity(id,start_time,end_time,observed_until,is_web) VALUES('web-anon',?,?,?,1)")
            .bind(start+65*60000).bind(start+70*60000).bind(start+70*60000).execute(&mut c).await?;
        Ok::<_, Error>(())
    })?;
    let recorder = patina_recorder::Recorder::start(&db, || {})?;
    let day = rt.block_on(recorder.history_source(start, None, true, true))?;
    let group = r#"{"kind":"group","domain":"example.com"}"#;
    assert_eq!(day.apps.iter().map(|a| a.2).sum::<i64>(), 27 * 60000);
    assert_eq!(day.hours.iter().sum::<i64>(), 27 * 60000);
    assert_eq!(day.categories.iter().map(|a| a.1).sum::<i64>(), 27 * 60000);
    assert_eq!(
        day.apps.iter().find(|a| a.0 == group).map(|a| (&*a.1, a.2)),
        Some(("Example", 17 * 60000))
    );
    assert!(day.apps.iter().any(|a| a.0 == "mail.example.com"));
    assert!(!day
        .apps
        .iter()
        .any(|a| a.0.contains("hidden") || a.0.ends_with(".exe")));
    assert_eq!(day.favicons[group], icon);
    assert_eq!(day.app_source_color(group, Some(0xabcdef)), 0x123456);
    let trends =
        rt.block_on(recorder.trends(Some((start, start)), patina_recorder::SeriesKind::Web))?;
    assert_eq!(trends.earliest, Some(start));
    let series = trends.series.iter().find(|s| s.key == group).unwrap();
    assert_eq!(series.name, "Example");
    assert_eq!(series.daily.values().sum::<i64>(), 17 * 60000);
    assert_eq!(series.favicon.as_deref(), Some(icon));
    assert_eq!(series.source_color(Some(0xabcdef)), 0x123456);
    let anon = trends
        .series
        .iter()
        .find(|s| s.key == "activity:anonymous")
        .unwrap();
    assert_eq!(anon.source_color(Some(0xff0000)), 0x8f98a8);
    assert_eq!(
        day.app_source_color("activity:anonymous", Some(0xabcdef)),
        0x8f98a8
    );
    let detail = rt.block_on(recorder.history_source(start, Some(group.into()), true, true))?;
    assert_eq!(
        detail.records.iter().map(|r| r.end - r.start).sum::<i64>(),
        17 * 60000
    );
    assert!(detail.records.iter().all(|r| r.key == group));
    assert!(detail
        .records
        .iter()
        .filter(|r| r.start >= start + 15 * 60000)
        .all(|r| r.titles.is_empty()));
    assert!(detail
        .records
        .iter()
        .any(|r| r.group_duration == 15 * 60000));
    recorder.shutdown()?;
    Ok(())
}
