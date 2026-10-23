use super::*;
use crate::data::backup::RestoreStrategy;
use crate::data::repositories::{anonymous_activity, tools};
use crate::domain::tools::{ActivityReminderTarget, TimerMode};
use futures_util::FutureExt;
use sqlx::Executor;
use std::panic::AssertUnwindSafe;

#[tokio::test]
async fn snapshot_preparation_seals_open_activity_using_source_evidence() {
    for strategy in [RestoreStrategy::Replace, RestoreStrategy::Merge] {
        let source = sqlx::SqlitePool::connect("sqlite::memory:").await.unwrap();
        let target = sqlx::SqlitePool::connect("sqlite::memory:").await.unwrap();
        let outcome = AssertUnwindSafe(async {
            for migration in schema::tracker_migrations() {
                source.execute(migration.sql).await.unwrap();
                target.execute(migration.sql).await.unwrap();
            }
            source.execute("INSERT INTO sessions(id,app_name,exe_name,start_time) VALUES(1,'Edge','msedge.exe',1000);
                INSERT INTO session_title_samples(session_id,title,start_time) VALUES(1,'Page',1000);
                INSERT INTO settings(key,value) VALUES('__tracker_last_successful_sample_ms','8000');
                INSERT INTO web_activity_segments(id,browser_client_id,browser_kind,browser_exe_name,domain,normalized_domain,start_time,created_at,updated_at) VALUES(1,'client','edge','msedge.exe','example.com','example.com',2000,2000,9000);
                INSERT INTO web_activity_native_sessions(segment_id,session_id) VALUES(1,1);").await.unwrap();
            target.execute("INSERT INTO sessions(id,app_name,exe_name,start_time,end_time,duration) VALUES(1,'Target','target.exe',0,100,100);
                INSERT INTO settings(key,value) VALUES('__tracker_last_successful_sample_ms','900000');").await.unwrap();
            restore::prepare_snapshot_restore(&source,10000,strategy).await.unwrap();
            let native: (i64,i64) = sqlx::query_as("SELECT end_time,duration FROM sessions").fetch_one(&source).await.unwrap();
            assert_eq!(native,(8000,7000));
            restore::merge_snapshot_backup(source.clone(),&target).await.unwrap();
            let child: (i64,i64,i64) = sqlx::query_as("SELECT s.end_time,w.end_time,t.end_time FROM sessions s JOIN web_activity_native_sessions r ON r.session_id=s.id JOIN web_activity_segments w ON w.id=r.segment_id JOIN session_title_samples t ON t.session_id=s.id WHERE s.exe_name='msedge.exe'").fetch_one(&target).await.unwrap();
            assert_eq!(child,(8000,8000,8000));
        }).catch_unwind().await;
        source.close().await;
        target.close().await;
        if let Err(panic) = outcome {
            std::panic::resume_unwind(panic);
        }
    }
}

#[tokio::test]
async fn snapshot_merge_preserves_all_record_domains_and_rolls_back_late_failure() {
    let dir = tests::SnapshotTestDirectory::new("snapshot-merge");
    let source_path = dir.0.join("source.db");
    let source = crate::data::sqlite_pool::open_single_connection_sqlite_pool(&source_path, true)
        .await
        .unwrap();
    crate::data::sqlite_pool::prepare_pool_schema(&source, &source_path)
        .await
        .unwrap();
    let target_path = dir.0.join("target.db");
    let target = crate::data::sqlite_pool::open_single_connection_sqlite_pool(&target_path, true)
        .await
        .unwrap();
    crate::data::sqlite_pool::prepare_pool_schema(&target, &target_path)
        .await
        .unwrap();
    let outcome = AssertUnwindSafe(async {
    source.execute("INSERT INTO sessions(id,app_name,exe_name,start_time,end_time,duration) VALUES(1,'Source','source.exe',1000,2000,1000);
        INSERT INTO session_title_samples(session_id,title,start_time,end_time) VALUES(1,'Source title',1000,2000);
        INSERT INTO settings(key,value) VALUES('language','en-US');
        INSERT INTO icon_cache(exe_name,icon_base64,last_updated) VALUES('source.exe','icon',1);
        INSERT INTO import_batches(id,imported_at,source_name,source_kind,source_fingerprint,exact_session_count,hour_bucket_count) VALUES('batch',1,'file.csv','patina-csv','fingerprint',1,0);
        INSERT INTO import_exact_sessions(batch_id,fingerprint,app_name,exe_name,window_title,start_time,end_time,duration) VALUES('batch','exact','External','external.exe','',10,20,10);
        INSERT INTO web_activity_segments(id,browser_client_id,browser_kind,browser_exe_name,domain,normalized_domain,start_time,end_time,duration,created_at,updated_at) VALUES(1,'client','chromium','chrome.exe','Example.com','example.com',1000,2000,1000,1000,2000);
        INSERT INTO web_activity_native_sessions(segment_id,session_id) VALUES(1,1);").await.unwrap();
    tools::create_reminder(&source, "Check", 2000, 1000)
        .await
        .unwrap();
    tools::start_timer(&source, TimerMode::Stopwatch, None, Some("Source"), 1000)
        .await
        .unwrap();
    tools::add_timer_lap(&source, 1500).await.unwrap();
    tools::start_pomodoro(&source, 1000, 500, 700, 4, 1000)
        .await
        .unwrap();
    let mut tick = source.begin().await.unwrap();
    tools::complete_due_pomodoro_phase(&mut tick, "2026-06-07", 2100)
        .await
        .unwrap();
    tick.commit().await.unwrap();
    for target in [
        ActivityReminderTarget::App {
            app_name: "Editor".into(),
            exe_name: Some("editor.exe".into()),
        },
        ActivityReminderTarget::Category {
            category_id: "other".into(),
        },
        ActivityReminderTarget::Web {
            normalized_domain: "example.com".into(),
        },
    ] {
        tools::create_activity_reminder_rule(&source, &target, "Target", 60000, "Break", 1000)
            .await
            .unwrap();
    }
    source.execute("UPDATE tool_activity_reminder_rules SET disabled_at=3000,last_fired_date_key='2026-06-07' WHERE target_kind='web'").await.unwrap();
    let rules = tools::fetch_all_activity_reminder_rules(&source)
        .await
        .unwrap();
    anonymous_activity::observe(&source, 30, true)
        .await
        .unwrap();
    anonymous_activity::seal(&source, 60).await.unwrap();
    let anonymous = anonymous_activity::read_range(&source, 0, 100)
        .await
        .unwrap();
    let archive = dir.0.join("snapshot.zip");
    write_snapshot_archive(&source, &archive, "test")
        .await
        .unwrap();
    source.close().await;
    target.execute("INSERT INTO sessions(id,app_name,exe_name,start_time,end_time,duration) VALUES(1,'Target','target.exe',10,20,10);
        INSERT INTO settings(key,value) VALUES('language','zh-CN');
        CREATE TRIGGER reject_anonymous BEFORE INSERT ON anonymous_activity BEGIN SELECT RAISE(ABORT,'late merge failure'); END;").await.unwrap();
    tools::start_timer(&target, TimerMode::Stopwatch, None, Some("Target"), 5000)
        .await
        .unwrap();
    let prepared = prepare_snapshot_backup(&archive, RestoreStrategy::Merge)
        .await
        .unwrap();
    let candidate = open_snapshot_pool(&prepared.db_path, false).await.unwrap();
    assert!(restore::merge_snapshot_backup(candidate, &target)
        .await
        .unwrap_err()
        .contains("late merge failure"));
    for table in [
        "session_title_samples",
        "tool_reminders",
        "tool_activity_reminder_rules",
        "import_batches",
        "web_activity_segments",
    ] {
        assert_eq!(
            count_table(&target, table).await.unwrap(),
            0,
            "{table} must roll back"
        );
    }
    assert_eq!(count_table(&target, "sessions").await.unwrap(), 1);
    target
        .execute("DROP TRIGGER reject_anonymous")
        .await
        .unwrap();
    for _ in 0..2 {
        let candidate = open_snapshot_pool(&prepared.db_path, false).await.unwrap();
        restore::merge_snapshot_backup(candidate, &target)
            .await
            .unwrap();
    }
    assert_eq!(count_table(&target, "sessions").await.unwrap(), 2);
    assert_eq!(count_table(&target, "tool_timers").await.unwrap(), 2);
    for table in [
        "session_title_samples",
        "tool_reminders",
        "tool_timer_laps",
        "tool_pomodoro_runs",
        "tool_daily_stats",
        "import_batches",
        "import_exact_sessions",
        "web_activity_segments",
    ] {
        assert_eq!(count_table(&target, table).await.unwrap(), 1, "{table}");
    }
    let title_owner: String = sqlx::query_scalar(
        "SELECT exe_name FROM sessions JOIN session_title_samples s ON sessions.id=s.session_id",
    )
    .fetch_one(&target)
    .await
    .unwrap();
    assert_eq!(title_owner, "source.exe");
    let web_owner: String = sqlx::query_scalar("SELECT exe_name FROM sessions JOIN web_activity_native_sessions w ON sessions.id=w.session_id").fetch_one(&target).await.unwrap();
    assert_eq!(web_owner, "source.exe");
    let lap_owner: String = sqlx::query_scalar(
        "SELECT label FROM tool_timers JOIN tool_timer_laps l ON tool_timers.id=l.timer_id",
    )
    .fetch_one(&target)
    .await
    .unwrap();
    assert_eq!(lap_owner, "Source");
    let language: String = sqlx::query_scalar("SELECT value FROM settings WHERE key='language'")
        .fetch_one(&target)
        .await
        .unwrap();
    assert_eq!(language, "zh-CN");
    assert_eq!(
        serde_json::to_value(
            tools::fetch_all_activity_reminder_rules(&target)
                .await
                .unwrap()
        )
        .unwrap(),
        serde_json::to_value(rules).unwrap()
    );
    assert_eq!(
        anonymous_activity::read_range(&target, 0, 100)
            .await
            .unwrap(),
        anonymous
    );
    }).catch_unwind().await;
    source.close().await;
    target.close().await;
    if let Err(panic) = outcome {
        std::panic::resume_unwind(panic);
    }
}
