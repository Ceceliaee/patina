use super::*;
use crate::data::sqlite_pool::prepare_pool_schema;
use sqlx::{sqlite::SqlitePoolOptions, Executor};
use std::path::Path;

async fn pool() -> Pool<Sqlite> {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .unwrap();
    prepare_pool_schema(&pool, Path::new(":memory:"))
        .await
        .unwrap();
    pool
}

#[tokio::test]
async fn mini_activity_separates_day_aggregate_from_exact_recent_facts() {
    let pool = pool().await;
    pool.execute("INSERT INTO sessions(app_name,exe_name,start_time,end_time,duration) VALUES
      ('Earlier','earlier.exe',1000,61000,60000),('Recent','recent.exe',9400000,9700000,300000);
      INSERT INTO anonymous_activity(id,start_time,end_time,observed_until,is_web) VALUES('anonymous',9800000,9860000,9860000,0);
      INSERT INTO settings(key,value) VALUES('web_activity_token','private-token'),('remote_status_bridge_token','private-remote');").await.unwrap();
    let today = load(&pool, MiniActivityKind::Today, 10_000_000, (0, 86_400_000))
        .await
        .unwrap();
    assert!(today.sessions.is_empty() && today.web.is_none());
    let aggregate = today.aggregate.unwrap();
    assert_eq!(
        aggregate
            .records
            .iter()
            .map(|row| row.end_time - row.start_time)
            .sum::<i64>(),
        420_000
    );
    let recent = load(
        &pool,
        MiniActivityKind::Activity,
        10_000_000,
        (0, 86_400_000),
    )
    .await
    .unwrap();
    assert_eq!((recent.start_ms, recent.end_ms), (6_400_000, 10_000_000));
    assert_eq!(recent.sessions.len(), 2);
    assert!(recent.aggregate.is_none() && recent.web.is_none());
    let json = serde_json::to_string(&recent).unwrap();
    assert!(
        !json.contains("private-token")
            && !json.contains("private-remote")
            && !json.contains("earlier.exe")
    );
    assert!(json.contains("activity:anonymous"));
    pool.execute("DELETE FROM read_model_state WHERE model_name='activity_hourly'")
        .await
        .unwrap();
    let fallback = load(&pool, MiniActivityKind::Today, 10_000_000, (0, 86_400_000))
        .await
        .unwrap()
        .aggregate
        .unwrap();
    assert_eq!(
        fallback
            .records
            .iter()
            .map(|row| row.end_time - row.start_time)
            .sum::<i64>(),
        420_000
    );
    assert_eq!(fallback.read_path, "facts");
}

#[tokio::test]
async fn mini_activity_handles_midnight_and_different_local_day_lengths() {
    let pool = pool().await;
    pool.execute(
        "INSERT INTO sessions(app_name,exe_name,start_time,end_time,duration) VALUES
      ('Cross','cross.exe',85400000,87400000,2000000)",
    )
    .await
    .unwrap();
    for hours in [23, 24, 25] {
        let today = load(
            &pool,
            MiniActivityKind::Today,
            86_400_000,
            (86_400_000, 86_400_000 + hours * 3_600_000),
        )
        .await
        .unwrap();
        assert!(today.aggregate.unwrap().records.is_empty());
        let recent = load(
            &pool,
            MiniActivityKind::Activity,
            87_000_000,
            (86_400_000, 86_400_000 + hours * 3_600_000),
        )
        .await
        .unwrap();
        assert_eq!(recent.sessions.len(), 1);
        assert!(recent.sessions[0].start_time < 86_400_000);
    }
    assert!(load(&pool, MiniActivityKind::Today, -1, (0, 86_400_000))
        .await
        .is_err());
}

#[tokio::test]
async fn mini_activity_loads_web_only_for_enabled_web_mode() {
    let pool = pool().await;
    pool.execute("INSERT INTO settings(key,value) VALUES('history_timeline_mode','web'),('web_activity_enabled','1'),('web_activity_token','private-token')").await.unwrap();
    let web = load(
        &pool,
        MiniActivityKind::Activity,
        10_000_000,
        (0, 86_400_000),
    )
    .await
    .unwrap();
    assert!(web.web.is_some() && web.sessions.is_empty() && web.icons.is_empty());
    pool.execute("UPDATE settings SET value='0' WHERE key='web_activity_enabled'")
        .await
        .unwrap();
    let app = load(
        &pool,
        MiniActivityKind::Activity,
        10_000_000,
        (0, 86_400_000),
    )
    .await
    .unwrap();
    assert!(app.web.is_none() && !app.bootstrap.settings.web_activity_available);
}

#[tokio::test]
async fn mini_activity_mode_migration_never_overwrites_a_canonical_selection() {
    let pool = pool().await;
    let migrate = super::super::app_settings::migrate_history_timeline_mode;
    pool.execute("CREATE TRIGGER reject_migration BEFORE INSERT ON settings WHEN NEW.key='history_timeline_mode' BEGIN SELECT RAISE(ABORT,'migration failure'); END").await.unwrap();
    assert!(migrate(&pool, "category").await.is_err());
    pool.execute("DROP TRIGGER reject_migration").await.unwrap();
    assert_eq!(migrate(&pool, "category").await.unwrap(), "category");
    pool.execute("UPDATE settings SET value='web' WHERE key='history_timeline_mode'")
        .await
        .unwrap();
    assert_eq!(migrate(&pool, "app").await.unwrap(), "web");
    assert!(migrate(&pool, "invalid").await.is_err());
    assert_eq!(migrate(&pool, "category").await.unwrap(), "web");
}

#[tokio::test]
async fn mini_activity_web_metadata_matches_main_without_unrelated_catalog_entries() {
    let pool = pool().await;
    pool.execute("INSERT INTO settings(key,value) VALUES
      ('history_timeline_mode','web'),('web_activity_enabled','1'),('web_activity_token','private-token'),
      ('__web_site::example.com','{\"version\":2,\"exceptions\":[],\"displayName\":\"Group\"}');").await.unwrap();
    for (domain, start, end) in [
        ("a.example.com", 9_000_000_i64, 9_500_000_i64),
        ("b.example.com", 1_000, 3_000_000),
        ("unrelated.org", 1_000, 4_000_000),
    ] {
        sqlx::query("INSERT INTO web_activity_segments(browser_client_id,browser_kind,browser_exe_name,domain,normalized_domain,start_time,end_time,duration,created_at,updated_at) VALUES('fixture','chromium','browser.exe',?,?,?,?,?,?,?)")
            .bind(domain).bind(domain).bind(start).bind(end).bind(end-start).bind(start).bind(end)
            .execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO web_favicon_cache(normalized_domain,favicon_url,updated_at) VALUES(?,'data:image/png;base64,Zg==',?)")
            .bind(domain).bind(end).execute(&pool).await.unwrap();
    }
    let main = web_links::snapshot_range(&pool, 6_400_000, 10_000_000, 10_000_000)
        .await
        .unwrap();
    let mini = load(
        &pool,
        MiniActivityKind::Activity,
        10_000_000,
        (0, 86_400_000),
    )
    .await
    .unwrap()
    .web
    .unwrap();
    assert_eq!(
        serde_json::to_value(&mini.segments).unwrap(),
        serde_json::to_value(&main.segments).unwrap()
    );
    for domain in ["a.example.com", "b.example.com"] {
        assert_eq!(mini.totals.get(domain), main.totals.get(domain));
        assert_eq!(mini.favicons.get(domain), main.favicons.get(domain));
        assert_eq!(mini.roots.get(domain), main.roots.get(domain));
    }
    assert!(!mini.domains.iter().any(|domain| domain == "unrelated.org"));
    assert!(!mini.favicons.contains_key("unrelated.org"));
    assert_eq!(
        serde_json::to_value(mini.rules).unwrap(),
        serde_json::to_value(main.rules).unwrap()
    );
}
