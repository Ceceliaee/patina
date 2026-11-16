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

use chrono::Local;
use fixture::{seed, Error};
use sqlx::{sqlite::SqliteConnectOptions, Connection, SqliteConnection};
use std::fs;

#[test]
fn history_exact_and_bucket_data() -> Result<(), Error> {
    let root = tempfile::tempdir()?;
    let db = root.path().join("patina.db");
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
    rt.block_on(async{
        let mut c=SqliteConnection::connect_with(&SqliteConnectOptions::new().filename(&db)).await?;
        sqlx::query("INSERT INTO import_time_buckets(batch_id,fingerprint,exe_name,app_name,bucket_start_time,duration) VALUES('test','bucket','bucket.exe','Bucket',?,120000)").bind(start+2*3600000).execute(&mut c).await?;
        Ok::<_,Error>(())
    })?;
    let r = patina_recorder::Recorder::start(&db, || {})?;
    let day = rt.block_on(r.history(start, None, false))?;
    assert_eq!(day.apps.iter().map(|a| a.2).sum::<i64>(), 72 * 60000);
    assert_eq!(
        day.records.iter().map(|r| r.end - r.start).sum::<i64>(),
        70 * 60000
    );
    assert!(!day.records.iter().any(|r| r.key == "bucket.exe"));
    let writer = rt.block_on(r.history(start, Some("writer.exe".into()), true))?;
    assert_eq!(
        writer.records.iter().map(|r| r.end - r.start).sum::<i64>(),
        20 * 60000
    );
    r.shutdown()?;
    Ok(())
}

#[test]
fn edits_are_atomic_and_detect_stale_inputs() -> Result<(), Error> {
    let root = tempfile::tempdir()?;
    let db = root.path().join("patina.db");
    seed(&db)?;
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()?;
    let recorder = patina_recorder::Recorder::start(&db, || {})?;
    rt.block_on(async {
        let rules = recorder.rules().await?;
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
        assert!(recorder
            .save_rules(vec![studio.clone(), writer], vec![], vec![])
            .await
            .is_err());
        assert!(recorder
            .rules()
            .await?
            .apps
            .iter()
            .any(|a| a.name == "Studio"));
        studio.category = "other".into();
        recorder
            .save_rules(vec![studio.clone()], vec![], vec![])
            .await?;
        let saved = recorder.rules().await?;
        let saved = saved
            .apps
            .iter()
            .find(|rule| rule.exe == "studio.exe")
            .unwrap();
        assert_eq!(saved.category, "other");
        let raw: serde_json::Value = serde_json::from_str(saved.original.as_deref().unwrap())?;
        assert_eq!(raw["category"], "other");
        studio.name = "Stale".into();
        assert!(recorder
            .save_rules(vec![studio], vec![], vec![])
            .await
            .is_err());
        let old = recorder.preferences().await?;
        let mut p = old.clone();
        p.gap = 240;
        recorder.save_preferences(old.clone(), p.clone()).await?;
        p.gap = 60;
        p.theme = patina_recorder::Theme::Dark;
        assert!(recorder.save_preferences(old.clone(), p).await.is_err());
        let saved = recorder.preferences().await?;
        assert_eq!(saved.gap, 240);
        assert_eq!(saved.theme, old.theme);
        Ok::<_, Error>(())
    })?;
    recorder.shutdown()?;
    Ok(())
}

#[test]
fn totals_and_classification() -> Result<(), Error> {
    let root = tempfile::tempdir()?;
    let db = root.path().join("patina.db");
    seed(&db)?;
    let recorder = patina_recorder::Recorder::start(&db, || {})?;
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()?;
    let noon = Local::now()
        .date_naive()
        .and_hms_opt(12, 0, 0)
        .unwrap()
        .and_local_timezone(Local)
        .earliest()
        .unwrap()
        .timestamp_millis();
    let trends =
        rt.block_on(recorder.trends(Some((noon, noon)), patina_recorder::SeriesKind::App))?;
    let day_start = Local::now()
        .date_naive()
        .and_hms_opt(0, 0, 0)
        .unwrap()
        .and_local_timezone(Local)
        .earliest()
        .unwrap()
        .timestamp_millis();
    assert_eq!(trends.earliest, Some(day_start - 30 * 60_000));
    let read = || async {
        let pool = sqlx::SqlitePool::connect_with(SqliteConnectOptions::new().filename(&db))
            .await
            .map_err(|e| e.to_string())?;
        patina_recorder::DaySummary::load(pool, noon, recorder.locale.get()).await
    };
    let data = rt.block_on(read())?;
    let minute = 60_000;
    assert_eq!(data.total, 70 * minute);
    assert_eq!(data.yesterday, 30 * minute);
    assert_eq!(
        data.apps
            .iter()
            .map(|a| a.duration / minute)
            .collect::<Vec<_>>(),
        [45, 20, 5]
    );
    assert_eq!(data.apps[1].hours[..2], [15 * minute, 5 * minute]);
    assert!(data.apps[2].anonymous);
    assert_eq!(data.apps[0].source_color(None), 0x4790cf);
    assert_eq!(data.apps[0].source_color(Some(0x223344)), 0x223344);
    assert_eq!(data.apps[2].source_color(Some(0xff0000)), 0x8f98a8);
    let history = rt.block_on(recorder.history(noon, None, false))?;
    assert_eq!(history.app_source_color("studio.exe", None), 0x4790cf);
    assert_eq!(
        history.app_source_color("studio.exe", Some(0x223344)),
        0x223344
    );
    assert_eq!(
        history.app_source_color("activity:anonymous", Some(0xff0000)),
        0x8f98a8
    );
    rt.block_on(recorder.edit_app(
        "studio.exe".into(),
        patina_recorder::AppEdit::Category("office".into()),
    ))?;
    assert!(rt
        .block_on(recorder.edit_app(
            "activity:anonymous".into(),
            patina_recorder::AppEdit::Category("office".into())
        ))
        .is_err());
    let data = rt.block_on(read())?;
    assert_eq!(data.categories[0].duration, 65 * minute);
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
    let history = rt.block_on(recorder.history(noon, None, false))?;
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
    let history = rt.block_on(recorder.history(noon, None, false))?;
    assert_eq!(
        history.app_source_color("studio.exe", Some(0x223344)),
        0x223344
    );
    assert_eq!(history.app_source_color("studio.exe", None), 0x6f7ae6);
    assert_eq!(history.colors[office], 0x6f7ae6);
    rt.block_on(recorder.edit_app(
        "writer.exe".into(),
        patina_recorder::AppEdit::Category("other".into()),
    ))?;
    let data = rt.block_on(read())?;
    assert_eq!(
        data.apps[1].source_color(None),
        patina_recorder::default_app_color("writer.exe")
    );
    recorder.shutdown()?;
    Ok(())
}
