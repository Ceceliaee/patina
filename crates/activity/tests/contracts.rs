#[path = "contracts/classification_color.rs"]
mod classification_color;
#[path = "contracts/classification_web.rs"]
mod classification_web;
#[path = "../../test-support/recording.rs"]
mod fixture;
#[path = "contracts/history_web.rs"]
mod history_web;
#[path = "contracts/services.rs"]
mod services;
#[path = "contracts/storage.rs"]
mod storage;

use chrono::{Local, TimeZone};
use fixture::{seed, Error};
use sqlx::{sqlite::SqliteConnectOptions, Connection, SqliteConnection};
use std::fs;

#[test]
fn resident_recorder_rebuilds_hourly_activity_from_existing_sessions() -> Result<(), Error> {
    use std::time::Duration;

    let root = tempfile::tempdir()?;
    let db = root.path().join("patina.db");
    seed(&db)?;
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()?;
    let mut connection = runtime.block_on(SqliteConnection::connect_with(
        &SqliteConnectOptions::new().filename(&db),
    ))?;
    let pool = runtime.block_on(patina_activity::open_database(&db))?;
    let signals = patina_activity::RecordingSignals::new(|| {});
    let bridges = std::sync::Arc::new(patina_activity::ActivityBridges::new(
        pool.clone(),
        signals.clone(),
    ));
    let storage = patina_activity::StorageOperations::new(
        root.path(),
        &db,
        pool.clone(),
        signals,
        runtime.handle().clone(),
    );
    let initial = runtime.block_on(patina_activity::load_app_preferences(pool.clone()))?;
    let mut maintenance = patina_activity::ActivityMaintenance::start(
        &runtime,
        pool.clone(),
        bridges,
        storage,
        &initial,
    );
    runtime.block_on(async {
        tokio::time::timeout(Duration::from_secs(20), async {
            loop {
                let duration: i64 = sqlx::query_scalar(
                    "SELECT COALESCE(SUM(effective_duration_ms), 0) FROM activity_hourly_effective
                     WHERE app_key = 'writer.exe' AND EXISTS
                       (SELECT 1 FROM read_model_state WHERE model_name = 'activity_hourly' AND state = 'ready')",
                ).fetch_one(&mut connection).await?;
                if duration > 0 {
                    assert_eq!(duration, 20 * 60_000);
                    return Ok::<_, Error>(());
                }
                tokio::time::sleep(Duration::from_millis(50)).await;
            }
        }).await?
    })?;
    maintenance.shutdown()?;
    maintenance.shutdown()?;
    runtime.block_on(pool.close());
    Ok(())
}

fn seed_history_day(db: &std::path::Path) -> Result<i64, Error> {
    let start = Local
        .with_ymd_and_hms(2024, 1, 15, 0, 0, 0)
        .single()
        .unwrap();
    fixture::seed_profile_on(db, false, start.date_naive())?;
    Ok(start.timestamp_millis())
}

#[test]
fn history_exact_and_bucket_data() -> Result<(), Error> {
    let root = tempfile::tempdir()?;
    let db = root.path().join("patina.db");
    let start = seed_history_day(&db)?;
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()?;
    rt.block_on(async{
        let mut c=SqliteConnection::connect_with(&SqliteConnectOptions::new().filename(&db)).await?;
        sqlx::query("INSERT INTO import_time_buckets(batch_id,fingerprint,exe_name,app_name,bucket_start_time,duration) VALUES('test','bucket','bucket.exe','Bucket',?,120000)").bind(start+2*3600000).execute(&mut c).await?;
        Ok::<_,Error>(())
    })?;
    let queries =
        patina_activity::ActivityQueries::new(rt.block_on(patina_activity::open_database(&db))?);
    let day = rt.block_on(queries.history_source(
        start,
        None,
        false,
        false,
        patina_activity::Locale::EnUs,
        None,
    ))?;
    assert_eq!(day.apps.iter().map(|a| a.2).sum::<i64>(), 72 * 60000);
    assert_eq!(
        day.records.iter().map(|r| r.end - r.start).sum::<i64>(),
        70 * 60000
    );
    assert!(!day.records.iter().any(|r| r.key == "bucket.exe"));
    let writer = rt.block_on(queries.history_source(
        start,
        Some("writer.exe".into()),
        true,
        false,
        patina_activity::Locale::EnUs,
        None,
    ))?;
    assert_eq!(
        writer.records.iter().map(|r| r.end - r.start).sum::<i64>(),
        20 * 60000
    );
    Ok(())
}

#[test]
fn detail_preferences_and_current_activity() -> Result<(), Error> {
    let root = tempfile::tempdir()?;
    let db = root.path().join("patina.db");
    seed(&db)?;
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()?;
    let pool = rt.block_on(patina_activity::open_database(&db))?;
    let preferences =
        patina_activity::Preferences::new(pool.clone(), patina_activity::Locale::EnUs);
    let queries = patina_activity::ActivityQueries::new(pool.clone());
    rt.block_on(async {
        assert_eq!(preferences.detail_zoom(None).await?, 24.0);
        assert_eq!(preferences.history_zoom(None).await?, 4.0);
        assert_eq!(preferences.history_modes(None).await?.0, [0,0]);
        preferences.history_modes(Some([2,1])).await?;
        assert_eq!(preferences.history_modes(None).await?.0, [2,1]);
        assert!(preferences.history_modes(Some([0,3])).await.is_err());
        assert_eq!(preferences.history_modes(None).await?.0, [2,1]);
        preferences.history_zoom(Some(8.)).await?;
        preferences.detail_zoom(Some(8.2)).await?;
        assert_eq!(preferences.detail_zoom(None).await?, 8.2);
        assert_eq!(preferences.history_zoom(None).await?, 8.0);
        for value in [0.0, 25.0, f32::NAN] {
            assert!(preferences.detail_zoom(Some(value)).await.is_err());
        }
        assert_eq!(preferences.detail_zoom(None).await?, 8.2);
        preferences.set_history_minimum(true, 120).await?;
        let now = Local::now().timestamp_millis();
        let mut c = SqliteConnection::connect_with(&SqliteConnectOptions::new().filename(&db)).await?;
        sqlx::query("INSERT INTO sessions(exe_name,app_name,start_time,end_time,duration) VALUES('live-fixture.exe','Live fixture',?,NULL,0)")
            .bind(now - 120_000).execute(&mut c).await?;
        let day = queries.history_source(now, Some("live-fixture.exe".into()), true, false, patina_activity::Locale::EnUs, Some(now)).await?;
        assert_eq!(day.minimum_seconds, 120);
        assert!(day.records.iter().any(|r| r.current));
        assert!(day.records.iter().all(|r| r.end <= Local::now().timestamp_millis()));
        sqlx::query("UPDATE sessions SET end_time=?,duration=120000 WHERE exe_name='live-fixture.exe'")
            .bind(now).execute(&mut c).await?;
        let closed = queries.history_source(now, Some("live-fixture.exe".into()), true, false, patina_activity::Locale::EnUs, Some(now)).await?;
        assert!(!closed.records.is_empty());
        assert!(closed.records.iter().all(|r| !r.current));
        Ok::<_, Error>(())
    })?;
    rt.block_on(pool.close());
    let reopened = patina_activity::Preferences::new(
        rt.block_on(patina_activity::open_database(&db))?,
        patina_activity::Locale::EnUs,
    );
    assert_eq!(rt.block_on(reopened.detail_zoom(None))?, 8.2);
    assert_eq!(rt.block_on(reopened.history_zoom(None))?, 8.0);
    assert_eq!(rt.block_on(reopened.history_modes(None))?.0, [2, 1]);
    Ok(())
}

#[test]
fn classification_and_preferences_reject_stale_edits_without_partial_writes() -> Result<(), Error> {
    let root = tempfile::tempdir()?;
    let db = root.path().join("patina.db");
    seed(&db)?;
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()?;
    let pool = rt.block_on(patina_activity::open_database(&db))?;
    let classification = patina_activity::Classification::new(pool.clone());
    let preferences = patina_activity::Preferences::new(pool, patina_activity::Locale::EnUs);
    rt.block_on(async {
        let rules = classification.load_classification_rules().await?;
        let mut studio = rules
            .apps
            .iter()
            .find(|r| r.exe == "studio.exe")
            .unwrap()
            .clone();
        let mut writer = rules
            .apps
            .iter()
            .find(|r| r.exe == "writer.exe")
            .unwrap()
            .clone();
        studio.name = "Draft".into();
        writer.category = "missing-category".into();
        assert!(classification
            .save_classification_rules(vec![studio.clone(), writer], None, vec![], vec![])
            .await
            .is_err());
        assert!(classification
            .load_classification_rules()
            .await?
            .apps
            .iter()
            .any(|a| a.name == "Studio"));
        studio.category = "other".into();
        classification
            .save_classification_rules(vec![studio.clone()], None, vec![], vec![])
            .await?;
        let saved = classification.load_classification_rules().await?;
        let saved = saved
            .apps
            .iter()
            .find(|rule| rule.exe == "studio.exe")
            .unwrap();
        assert_eq!(saved.category, "other");
        let raw: serde_json::Value = serde_json::from_str(saved.original.as_deref().unwrap())?;
        assert_eq!(raw["category"], "other");
        studio.name = "Stale".into();
        assert!(matches!(
            classification
                .save_classification_rules(vec![studio], None, vec![], vec![])
                .await,
            Err(patina_activity::ActivityError::Conflict(_))
        ));
        let old = preferences.preferences().await?;
        let mut p = old.clone();
        p.timeline_merge_gap_secs = 240;
        preferences.save_preferences(old.clone(), p.clone()).await?;
        p.timeline_merge_gap_secs = 60;
        p.theme = patina_activity::Theme::Dark;
        assert!(matches!(
            preferences.save_preferences(old.clone(), p).await,
            Err(patina_activity::ActivityError::Conflict(_))
        ));
        let saved = preferences.preferences().await?;
        assert_eq!(saved.timeline_merge_gap_secs, 240);
        assert_eq!(saved.theme, old.theme);
        let mut translated = saved.clone();
        translated.locale = patina_activity::Locale::RuRu;
        preferences
            .save_preferences(saved.clone(), translated)
            .await?;
        let mut concurrent = saved.clone();
        concurrent.theme = patina_activity::Theme::Dark;
        preferences.save_preferences(saved, concurrent).await?;
        assert_eq!(preferences.locale(), patina_activity::Locale::RuRu);
        assert_eq!(
            preferences.preferences().await?.locale,
            preferences.locale()
        );
        Ok::<_, Error>(())
    })?;
    Ok(())
}

#[test]
fn day_summary_splits_usage_at_midnight_and_reflects_classification_edits() -> Result<(), Error> {
    let root = tempfile::tempdir()?;
    let db = root.path().join("patina.db");
    seed(&db)?;
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()?;
    let pool = rt.block_on(patina_activity::open_database(&db))?;
    let queries = patina_activity::ActivityQueries::new(pool.clone());
    let classification = patina_activity::Classification::new(pool.clone());
    let noon = Local::now()
        .date_naive()
        .and_hms_opt(12, 0, 0)
        .unwrap()
        .and_local_timezone(Local)
        .earliest()
        .unwrap()
        .timestamp_millis();
    let trends = rt.block_on(queries.trends(
        Some((noon, noon)),
        patina_activity::SeriesKind::App,
        patina_activity::Locale::EnUs,
    ))?;
    let day_start = Local::now()
        .date_naive()
        .and_hms_opt(0, 0, 0)
        .unwrap()
        .and_local_timezone(Local)
        .earliest()
        .unwrap()
        .timestamp_millis();
    assert_eq!(trends.earliest, Some(day_start - 30 * 60_000));
    let read = || queries.load_day_summary_at(noon, patina_activity::Locale::EnUs);
    let data = rt.block_on(read())?;
    let minute = 60_000;
    assert_eq!(data.total_duration_ms, 70 * minute);
    assert_eq!(data.yesterday_duration_ms, 30 * minute);
    assert_eq!(
        data.apps
            .iter()
            .map(|a| a.duration_ms / minute)
            .collect::<Vec<_>>(),
        [45, 20, 5]
    );
    assert_eq!(
        data.apps[1].hourly_duration_ms[..2],
        [15 * minute, 5 * minute]
    );
    assert!(data.apps[2].anonymous);
    assert_eq!(data.apps[0].source_color(None), 0x4790cf);
    assert_eq!(data.apps[0].source_color(Some(0x223344)), 0x223344);
    assert_eq!(data.apps[2].source_color(Some(0xff0000)), 0x8f98a8);
    let history = rt.block_on(queries.history_source(
        noon,
        None,
        false,
        false,
        patina_activity::Locale::EnUs,
        None,
    ))?;
    assert_eq!(history.app_source_color("studio.exe", None), 0x4790cf);
    assert_eq!(
        history.app_source_color("studio.exe", Some(0x223344)),
        0x223344
    );
    assert_eq!(
        history.app_source_color("activity:anonymous", Some(0xff0000)),
        0x8f98a8
    );
    rt.block_on(classification.edit_app(
        "studio.exe".into(),
        patina_activity::AppEdit::Category("office".into()),
    ))?;
    assert!(rt
        .block_on(classification.edit_app(
            "activity:anonymous".into(),
            patina_activity::AppEdit::Category("office".into())
        ))
        .is_err());
    let data = rt.block_on(read())?;
    assert_eq!(data.categories[0].duration_ms, 65 * minute);
    assert_eq!(data.apps[0].name, "Studio");
    assert_eq!(data.apps[0].source_color(None), 0x6f7ae6);
    assert_eq!(data.apps[0].source_color(Some(0x223344)), 0x223344);
    rt.block_on(async {
        let mut connection = SqliteConnection::connect_with(&SqliteConnectOptions::new().filename(&db)).await?;
        sqlx::query("UPDATE settings SET value=json_set(value, '$.color', '#fefefe') WHERE key='__app_override::studio.exe'")
            .execute(&mut connection).await?;
        Ok::<(), sqlx::Error>(())
    })?;
    let data = rt.block_on(read())?;
    assert_eq!(data.apps[0].source_color(Some(0x223344)), 0xfefefe);
    assert_eq!(data.apps[0].source_color(None), 0xfefefe);
    let history = rt.block_on(queries.history_source(
        noon,
        None,
        false,
        false,
        patina_activity::Locale::EnUs,
        None,
    ))?;
    assert_eq!(
        history.app_source_color("studio.exe", Some(0x223344)),
        0xfefefe
    );
    assert_eq!(history.app_source_color("studio.exe", None), 0xfefefe);
    let office = &data
        .categories
        .iter()
        .find(|category| category.id == "office")
        .unwrap()
        .label;
    assert_eq!(history.colors[office], 0x6f7ae6);
    rt.block_on(async {
        let mut connection = SqliteConnection::connect_with(&SqliteConnectOptions::new().filename(&db)).await?;
        sqlx::query("UPDATE settings SET value=json_remove(value, '$.color') WHERE key='__app_override::studio.exe'")
            .execute(&mut connection).await?;
        Ok::<(), sqlx::Error>(())
    })?;
    let history = rt.block_on(queries.history_source(
        noon,
        None,
        false,
        false,
        patina_activity::Locale::EnUs,
        None,
    ))?;
    assert_eq!(
        history.app_source_color("studio.exe", Some(0x223344)),
        0x223344
    );
    assert_eq!(history.app_source_color("studio.exe", None), 0x6f7ae6);
    assert_eq!(history.colors[office], 0x6f7ae6);
    rt.block_on(classification.edit_app(
        "writer.exe".into(),
        patina_activity::AppEdit::Category("other".into()),
    ))?;
    let data = rt.block_on(read())?;
    assert_eq!(
        data.apps[1].source_color(None),
        patina_activity::default_app_color("writer.exe")
    );
    rt.block_on(pool.close());
    let reopened = rt.block_on(patina_activity::open_database(&db))?;
    let history = rt.block_on(
        patina_activity::ActivityQueries::new(reopened.clone()).history_source(
            noon,
            None,
            false,
            false,
            patina_activity::Locale::EnUs,
            None,
        ),
    )?;
    assert_eq!(history.app_source_color("studio.exe", None), 0x6f7ae6);
    let rules = rt.block_on(
        patina_activity::Classification::new(reopened.clone()).load_classification_rules(),
    )?;
    assert_eq!(
        rules
            .apps
            .iter()
            .find(|app| app.exe == "writer.exe")
            .unwrap()
            .category,
        "other"
    );
    rt.block_on(reopened.close());
    Ok(())
}
