use super::*;
use crate::data::backup::RestoreStrategy;
use crate::data::repositories::{anonymous_activity, tools};
use crate::domain::tools::ActivityReminderTarget;
use futures_util::FutureExt;
use sqlx::Executor;
use std::panic::AssertUnwindSafe;

#[tokio::test]
async fn snapshot_restore_tolerates_retired_background_preferences() {
    use crate::data::repositories::app_settings::load_desktop_behavior_settings;
    use crate::domain::settings::{StartupSource, StartupUiStrategy};
    let dir = tests::SnapshotTestDirectory::new("snapshot-retired-background");
    let mut pools = Vec::new();
    let mut prepared_sources = Vec::new();
    let outcome = AssertUnwindSafe(async {
        let source_path = dir.0.join("source.db");
        let source = crate::data::sqlite_pool::open_single_connection_sqlite_pool(&source_path, true).await.unwrap();
        pools.push(source.clone());
        crate::data::sqlite_pool::prepare_pool_schema(&source, &source_path).await.unwrap();
        source.execute("INSERT INTO settings(key,value) VALUES('language','en-US'),('background_optimization','0'); INSERT INTO sessions(app_name,exe_name,start_time,end_time,duration) VALUES('Source','source.exe',1000,2000,1000);").await.unwrap();
        let archive = dir.0.join("source.zip");
        for source_value in ["0", "1"] {
            sqlx::query("UPDATE settings SET value=? WHERE key='background_optimization'").bind(source_value).execute(&source).await.unwrap();
            write_snapshot_archive(&source, &archive, "test").await.unwrap();
            for strategy in [RestoreStrategy::Replace, RestoreStrategy::Merge] {
                prepared_sources.push(prepare_snapshot_backup(&archive, strategy).await.unwrap());
                let prepared_path = &prepared_sources.last().unwrap().db_path;
                let restored = open_snapshot_pool(prepared_path, false).await.unwrap();
                pools.push(restored.clone());
                assert_eq!(load_desktop_behavior_settings(&restored).await.unwrap().startup_ui_strategy(StartupSource::Manual), StartupUiStrategy::OptimizeHidden);
                assert_eq!(count_table(&restored,"sessions").await.unwrap(),1);
                if strategy == RestoreStrategy::Merge {
                    for target_value in [None, Some("0"), Some("1")] {
                        let target_path = dir.0.join(format!("target-{source_value}-{}.db", target_value.unwrap_or("missing")));
                        let target = crate::data::sqlite_pool::open_single_connection_sqlite_pool(&target_path, true).await.unwrap();
                        pools.push(target.clone());
                        crate::data::sqlite_pool::prepare_pool_schema(&target, &target_path).await.unwrap();
                        target.execute("INSERT INTO settings(key,value) VALUES('language','zh-CN')").await.unwrap();
                        if let Some(value) = target_value {
                            sqlx::query("INSERT INTO settings(key,value) VALUES('background_optimization',?)").bind(value).execute(&target).await.unwrap();
                        }
                        for _ in 0..2 {
                            let candidate = open_snapshot_pool(prepared_path, false).await.unwrap();
                            pools.push(candidate.clone());
                            restore::merge_snapshot_backup(candidate,&target).await.unwrap();
                            assert_eq!(load_desktop_behavior_settings(&target).await.unwrap().startup_ui_strategy(StartupSource::Manual), StartupUiStrategy::OptimizeHidden);
                            let values: Vec<(String,String)> = sqlx::query_as("SELECT key,value FROM settings WHERE key IN ('language','background_optimization') ORDER BY key").fetch_all(&target).await.unwrap();
                            assert_eq!(values,vec![("background_optimization".into(),target_value.unwrap_or(source_value).into()),("language".into(),"zh-CN".into())]);
                            assert_eq!(count_table(&target,"sessions").await.unwrap(),1);
                        }
                    }
                }
            }
        }
    }).catch_unwind().await;
    for pool in pools {
        pool.close().await;
    }
    drop(prepared_sources);
    if let Err(panic) = outcome {
        std::panic::resume_unwind(panic);
    }
}

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
    tools::timed_reminders::create_reminder(&source, "Check", 2000, Some(crate::domain::reminder_schedule::ReminderRecurrence::Interval { minutes: 30 }), 1000)
        .await
        .unwrap();
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
    let recurrence: String = sqlx::query_scalar("SELECT recurrence FROM tool_reminders JOIN tool_reminder_recurrences ON reminder_id=id WHERE label='Check'")
        .fetch_one(&target).await.unwrap();
    assert_eq!(serde_json::from_str::<serde_json::Value>(&recurrence).unwrap(), serde_json::json!({"kind":"interval","minutes":30}));
    let anchor: i64 = sqlx::query_scalar("SELECT recurrence_anchor_at FROM tool_reminders JOIN tool_reminder_recurrences ON reminder_id=id WHERE label='Check'")
        .fetch_one(&target).await.unwrap();
    assert_eq!(anchor, 2000);
    for table in [
        "session_title_samples",
        "tool_reminders",
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

#[tokio::test]
async fn running_focus_merge_seals_elapsed_at_backup_without_displacing_target() {
    let dir = tests::SnapshotTestDirectory::new("focus-progress-merge");
    let source_path = dir.0.join("source.db");
    let target_path = dir.0.join("target.db");
    let source = crate::data::sqlite_pool::open_single_connection_sqlite_pool(&source_path, true)
        .await
        .unwrap();
    let target = crate::data::sqlite_pool::open_single_connection_sqlite_pool(&target_path, true)
        .await
        .unwrap();
    for (pool, path) in [(&source, &source_path), (&target, &target_path)] {
        crate::data::sqlite_pool::prepare_pool_schema(pool, path)
            .await
            .unwrap();
    }
    source.execute("INSERT INTO tool_free_focus(label,rest_mode,rest_minutes,rest_ratio,phase,status,elapsed_ms,rest_remaining_ms,started_at,created_at,updated_at)
        VALUES ('Fresh','fixed',1,2,'focus','running',0,0,1000,1,1),('Resumed','fixed',1,2,'focus','running',2000,0,1000,2,2),
        ('Break','fixed',1,2,'break','running',900,700000,1000,3,3),('Expired','fixed',1,2,'break','running',0,100,1000,4,4),
        ('Reversed','fixed',1,2,'focus','running',3,0,700000,5,5),('Missing','fixed',1,2,'focus','running',19,0,NULL,6,6);
        INSERT INTO tool_pomodoro_runs(phase,status,cycle_index,focus_ms,short_break_ms,long_break_ms,long_break_every,phase_started_at,phase_remaining_ms,completed_focus_count,created_at,updated_at)
        VALUES('focus','running',1,900000,60000,120000,4,1000,900000,0,1,1)").await.unwrap();
    target.execute("INSERT INTO tool_free_focus(label,rest_mode,rest_minutes,rest_ratio,phase,status,started_at,created_at,updated_at)
        VALUES ('Local','fixed',1,2,'focus','running',10,200,200)").await.unwrap();
    let archive = dir.0.join("focus.zip");
    write_snapshot_archive(&source, &archive, "test")
        .await
        .unwrap();
    source.close().await;
    // Use a deterministic export time on the extracted candidate.
    for strategy in [RestoreStrategy::Replace, RestoreStrategy::Merge] {
        let extracted = extract_snapshot_archive(&archive, true).await.unwrap();
        let pool = open_snapshot_pool(&extracted.db_path, false).await.unwrap();
        restore::prepare_snapshot_restore(&pool, 601000, strategy)
            .await
            .unwrap();
        let status: String =
            sqlx::query_scalar("SELECT status FROM tool_free_focus WHERE label='Fresh'")
                .fetch_one(&pool)
                .await
                .unwrap();
        if strategy == RestoreStrategy::Replace {
            assert_eq!(status, "running");
            pool.close().await;
            continue;
        }
        assert_eq!(status, "paused");
        pool.close().await;
        for _ in 0..2 {
            let pool = open_snapshot_pool(&extracted.db_path, false).await.unwrap();
            restore::merge_snapshot_backup(pool, &target).await.unwrap();
        }
    }
    let clocks:Vec<(String,i64,i64)>=sqlx::query_as("SELECT label,elapsed_ms,rest_remaining_ms FROM tool_free_focus WHERE status='paused' AND started_at IS NULL ORDER BY created_at").fetch_all(&target).await.unwrap();
    assert_eq!(
        clocks,
        vec![
            ("Fresh".into(), 600000, 0),
            ("Resumed".into(), 602000, 0),
            ("Break".into(), 900, 100000),
            ("Expired".into(), 0, 0),
            ("Reversed".into(), 3, 0),
            ("Missing".into(), 19, 0)
        ]
    );
    let tomato: (String, i64) =
        sqlx::query_as("SELECT status,phase_remaining_ms FROM tool_pomodoro_runs")
            .fetch_one(&target)
            .await
            .unwrap();
    assert_eq!(tomato, ("paused".into(), 300000));
    let active: Vec<String> =
        sqlx::query_scalar("SELECT label FROM tool_free_focus WHERE status='running'")
            .fetch_all(&target)
            .await
            .unwrap();
    assert_eq!(active, ["Local"]);
    target.close().await;
}

#[tokio::test]
async fn pre_identity_snapshot_replay_preserves_independent_reminders() {
    let dir = tests::SnapshotTestDirectory::new("legacy-reminder-identity");
    let path = dir.0.join("legacy.db");
    let source = crate::data::sqlite_pool::open_single_connection_sqlite_pool(&path, true)
        .await
        .unwrap();
    crate::data::sqlite_pool::prepare_pool_schema(&source, &path)
        .await
        .unwrap();
    source.execute("DROP TRIGGER trg_tool_reminder_identity; DROP TABLE tool_reminder_identities; DELETE FROM _sqlx_migrations WHERE version=26;
        INSERT INTO tool_reminders(label,scheduled_at,created_at,status) VALUES ('A',60000,1000,'scheduled'),('A',60000,1000,'scheduled');").await.unwrap();
    let archive = dir.0.join("old.zip");
    write_snapshot_archive(&source, &archive, "test")
        .await
        .unwrap();
    source.close().await;
    let target = sqlx::SqlitePool::connect("sqlite::memory:").await.unwrap();
    crate::data::sqlite_pool::prepare_pool_schema(&target, Path::new(":memory:"))
        .await
        .unwrap();
    target.execute("INSERT INTO tool_reminders(label,scheduled_at,created_at,status) VALUES('A',60000,1000,'scheduled')").await.unwrap();
    for _ in 0..2 {
        let candidate = prepare_snapshot_backup(&archive, RestoreStrategy::Merge)
            .await
            .unwrap();
        let pool = open_snapshot_pool(&candidate.db_path, false).await.unwrap();
        restore::merge_snapshot_backup(pool, &target).await.unwrap();
    }
    assert_eq!(count_table(&target, "tool_reminders").await.unwrap(), 3);
    target.close().await;
}

#[tokio::test]
async fn restored_snapshot_requires_an_identity_for_every_timed_reminder() {
    let pool = sqlx::SqlitePool::connect("sqlite::memory:").await.unwrap();
    crate::data::sqlite_pool::prepare_pool_schema(&pool, Path::new(":memory:"))
        .await
        .unwrap();
    pool.execute("INSERT INTO tool_reminders(label,scheduled_at,created_at,status) VALUES('A',60000,1000,'scheduled')").await.unwrap();
    validate_current_schema(&pool).await.unwrap();
    pool.execute("DELETE FROM tool_reminder_identities")
        .await
        .unwrap();
    assert!(validate_current_schema(&pool)
        .await
        .unwrap_err()
        .contains("missing its identity"));
    pool.close().await;
}
