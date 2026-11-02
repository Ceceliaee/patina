use super::*;
use crate::data::{schema, schema_contracts};
use crate::domain::tools::ActivityReminderTarget;
use sqlx::{Executor, SqlitePool};

async fn database() -> SqlitePool {
    let pool = sqlx::sqlite::SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .unwrap();
    for migration in schema::tracker_migrations() {
        pool.execute(migration.sql).await.unwrap();
    }
    pool.execute("INSERT INTO settings(key,value) VALUES('web_activity_enabled','true');
        INSERT INTO web_activity_segments(browser_client_id,browser_kind,browser_exe_name,domain,normalized_domain,start_time,end_time,duration,source,created_at,updated_at)
        VALUES('client','chromium','chrome.exe','example.com','example.com',0,1,1,'browser-extension',0,1);").await.unwrap();
    pool
}

fn targets() -> [ActivityReminderTarget; 4] {
    [
        ActivityReminderTarget::App {
            app_name: "Editor".into(),
            exe_name: Some("editor.exe".into()),
        },
        ActivityReminderTarget::App {
            app_name: "Legacy".into(),
            exe_name: None,
        },
        ActivityReminderTarget::Category {
            category_id: "development".into(),
        },
        ActivityReminderTarget::Web {
            normalized_domain: "example.com".into(),
        },
    ]
}

#[tokio::test]
async fn duplicate_targets_preserve_disabled_rule_settings_and_allow_recreation_after_delete() {
    let pool = database().await;
    for target in targets() {
        let original =
            create_activity_reminder_rule(&pool, &target, "Original", 120_000, "Keep", 1)
                .await
                .unwrap();
        set_activity_reminder_enabled(&pool, original.id, false, 2)
            .await
            .unwrap();
        sqlx::query("INSERT INTO tool_activity_reminder_extensions(rule_id,last_fired_at,extension_date_key,extension_limit_ms,last_extended_alert_at) VALUES(?,10,'2026-11-02',180000,10)")
            .bind(original.id).execute(&pool).await.unwrap();
        let variant = match target.clone() {
            ActivityReminderTarget::App {
                exe_name: Some(_), ..
            } => ActivityReminderTarget::App {
                app_name: "Renamed".into(),
                exe_name: Some(" \"EDITOR.EXE\" ".into()),
            },
            ActivityReminderTarget::App { .. } => ActivityReminderTarget::App {
                app_name: " LEGACY ".into(),
                exe_name: Some(" ".into()),
            },
            ActivityReminderTarget::Category { .. } => ActivityReminderTarget::Category {
                category_id: " development ".into(),
            },
            ActivityReminderTarget::Web { .. } => ActivityReminderTarget::Web {
                normalized_domain: " EXAMPLE.COM. ".into(),
            },
        };
        let duplicate =
            create_activity_reminder_rule(&pool, &variant, "Replacement", 600_000, "Discard", 3)
                .await
                .unwrap();
        assert_eq!(duplicate.id, original.id);
        assert_eq!(duplicate.label_snapshot, "Original");
        assert_eq!(duplicate.limit_ms, 120_000);
        assert_eq!(duplicate.message, "Keep");
        assert_eq!(duplicate.updated_at, 2);
        assert!(!duplicate.enabled);
        assert_eq!(duplicate.extension_limit_ms, Some(180_000));
        assert_eq!(duplicate.last_extended_alert_at, Some(10));
        disable_activity_reminder_rule(&pool, original.id, 4)
            .await
            .unwrap();
        let recreated = create_activity_reminder_rule(&pool, &target, "New", 60_000, "", 5)
            .await
            .unwrap();
        assert_ne!(recreated.id, original.id);
        assert!(recreated.enabled);
        assert_eq!(recreated.extension_limit_ms, None);
    }
    let rows = fetch_all_activity_reminder_rules(&pool).await.unwrap();
    assert_eq!(rows.len(), 8);
    assert_eq!(
        rows.iter().filter(|row| row.disabled_at.is_none()).count(),
        4
    );
}

#[tokio::test]
async fn concurrent_creates_share_one_rule_but_same_labels_can_have_distinct_targets() {
    let pool = database().await;
    let target = targets()[0].clone();
    let (first, second) = tokio::join!(
        create_activity_reminder_rule(&pool, &target, "Same", 60_000, "", 1),
        create_activity_reminder_rule(&pool, &target, "Same", 120_000, "", 2),
    );
    assert_eq!(first.unwrap().id, second.unwrap().id);
    let other = ActivityReminderTarget::App {
        app_name: "Editor".into(),
        exe_name: Some("different.exe".into()),
    };
    create_activity_reminder_rule(&pool, &other, "Same", 60_000, "", 3)
        .await
        .unwrap();
    assert_eq!(
        fetch_all_activity_reminder_rules(&pool)
            .await
            .unwrap()
            .len(),
        2
    );
}

#[tokio::test]
async fn merge_skips_live_target_conflicts_without_overwriting_state_and_rolls_back() {
    let pool = database().await;
    let mut imported = Vec::new();
    for target in targets() {
        let mut rule = create_activity_reminder_rule(&pool, &target, "Local", 60_000, "", 1)
            .await
            .unwrap();
        set_activity_reminder_enabled(&pool, rule.id, false, 2)
            .await
            .unwrap();
        rule.created_at = 3;
        rule.limit_ms = 120_000;
        rule.enabled = true;
        rule.extension_limit_ms = Some(300_000);
        imported.push(rule);
    }
    for _ in 0..2 {
        let mut tx = pool.begin().await.unwrap();
        merge_activity_reminder_rules(&mut tx, &imported)
            .await
            .unwrap();
        tx.commit().await.unwrap();
    }
    let rows = fetch_all_activity_reminder_rules(&pool).await.unwrap();
    assert_eq!(rows.len(), 4);
    assert!(rows
        .iter()
        .all(|rule| !rule.enabled && rule.limit_ms == 60_000 && rule.extension_limit_ms.is_none()));

    // Deleted backup history remains importable and idempotent.
    imported[0].disabled_at = Some(4);
    for _ in 0..2 {
        let mut tx = pool.begin().await.unwrap();
        merge_activity_reminder_rules(&mut tx, &imported[..1])
            .await
            .unwrap();
        tx.commit().await.unwrap();
    }
    assert_eq!(
        fetch_all_activity_reminder_rules(&pool)
            .await
            .unwrap()
            .len(),
        5
    );
    let mut tx = pool.begin().await.unwrap();
    imported[0].created_at = 5;
    merge_activity_reminder_rules(&mut tx, &imported[..1])
        .await
        .unwrap();
    tx.rollback().await.unwrap();
    assert_eq!(
        fetch_all_activity_reminder_rules(&pool)
            .await
            .unwrap()
            .len(),
        5
    );
}

#[tokio::test]
async fn version_twenty_upgrade_soft_deletes_duplicates_and_validates_unique_index() {
    use crate::data::sqlite_pool::{open_single_connection_sqlite_pool, prepare_pool_schema};
    let path =
        std::env::temp_dir().join(format!("patina-unique-target-{}.db", uuid::Uuid::new_v4()));
    let pool = open_single_connection_sqlite_pool(&path, true)
        .await
        .unwrap();
    for migration in schema::tracker_migrations()
        .into_iter()
        .filter(|m| m.version <= 20)
    {
        pool.execute(migration.sql).await.unwrap();
    }
    pool.execute("INSERT INTO tool_activity_reminder_rules(id,target_kind,app_name,exe_name,category_id,normalized_domain,label_snapshot,limit_ms,message,created_at,updated_at,disabled_at) VALUES
        (1,'app','Editor','editor.exe',NULL,NULL,'Original',120000,'Keep',2,4,NULL),
        (2,'app','Renamed','EDITOR.EXE',NULL,NULL,'Duplicate',60000,'',3,3,NULL),
        (3,'app','Editor','different.exe',NULL,NULL,'Same name',60000,'',2,2,NULL),
        (4,'category',NULL,NULL,'development',NULL,'Original category',60000,'',1,1,NULL),
        (5,'category',NULL,NULL,' development ',NULL,'Duplicate category',60000,'',1,1,NULL),
        (6,'web',NULL,NULL,NULL,'example.com','Original web',60000,'',1,1,NULL),
        (7,'web',NULL,NULL,NULL,'EXAMPLE.COM.','Duplicate web',60000,'',1,1,NULL),
        (8,'app','Legacy',NULL,NULL,NULL,'Original legacy',60000,'',1,1,NULL),
        (9,'app',' legacy ','',NULL,NULL,'Duplicate legacy',60000,'',1,1,NULL),
        (10,'app','Editor','editor.exe',NULL,NULL,'Deleted',60000,'',0,1,1);
        INSERT INTO tool_activity_reminder_states(rule_id,enabled) VALUES(1,0);
        INSERT INTO tool_activity_reminder_extensions(rule_id,last_fired_at,extension_date_key,extension_limit_ms,last_extended_alert_at)
        VALUES(1,3,'2026-11-02',300000,3),(2,3,'2026-11-02',180000,3);").await.unwrap();
    assert!(
        !schema_contracts::has_unique_activity_reminder_targets(&pool)
            .await
            .unwrap()
    );
    prepare_pool_schema(&pool, &path).await.unwrap();
    pool.close().await;
    let pool = open_single_connection_sqlite_pool(&path, false)
        .await
        .unwrap();
    prepare_pool_schema(&pool, &path).await.unwrap();
    let rows = fetch_all_activity_reminder_rules(&pool).await.unwrap();
    assert_eq!(rows.len(), 10);
    let mut active: Vec<i64> = rows
        .iter()
        .filter(|rule| rule.disabled_at.is_none())
        .map(|rule| rule.id)
        .collect();
    active.sort();
    assert_eq!(active, [1, 3, 4, 6, 8]);
    let kept = rows.iter().find(|rule| rule.id == 1).unwrap();
    assert!(!kept.enabled);
    assert_eq!(kept.updated_at, 4);
    assert_eq!(kept.limit_ms, 120_000);
    assert_eq!(kept.message, "Keep");
    assert_eq!(kept.extension_limit_ms, Some(300_000));
    assert_eq!(
        rows.iter()
            .find(|rule| rule.id == 2)
            .unwrap()
            .extension_limit_ms,
        Some(180_000)
    );
    assert!(
        schema_contracts::has_unique_activity_reminder_targets(&pool)
            .await
            .unwrap()
    );
    assert!(
        sqlx::query("UPDATE tool_activity_reminder_rules SET disabled_at = NULL WHERE id = 2")
            .execute(&pool)
            .await
            .is_err()
    );
    pool.execute("DROP INDEX idx_tool_activity_reminder_rules_unique_target;
        CREATE INDEX idx_tool_activity_reminder_rules_unique_target ON tool_activity_reminder_rules(target_kind);").await.unwrap();
    assert!(
        !schema_contracts::has_unique_activity_reminder_targets(&pool)
            .await
            .unwrap()
    );
    assert!(prepare_pool_schema(&pool, &path)
        .await
        .unwrap_err()
        .contains("schema validation failed"));
    pool.close().await;
    std::fs::remove_file(path).unwrap();
}
