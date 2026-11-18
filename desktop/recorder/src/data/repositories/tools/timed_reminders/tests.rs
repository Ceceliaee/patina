use super::*;
use crate::data::{repositories::tools::backup_restore, schema};
use sqlx::{Executor, SqlitePool};

async fn database() -> SqlitePool {
    let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
    pool.execute(schema::TOOLS_TABLES_SCHEMA_SQL).await.unwrap();
    pool.execute(schema::REMINDER_RECURRENCE_SQL).await.unwrap();
    pool.execute(crate::data::schema::REMINDER_IDENTITY_SQL)
        .await
        .unwrap();
    pool
}

async fn fire(pool: &SqlitePool, at: i64) -> Vec<ToolReminder> {
    let mut tx = pool.begin().await.unwrap();
    let rows = fire_due_reminders(&mut tx, at).await.unwrap();
    tx.commit().await.unwrap();
    rows
}

#[tokio::test]
async fn calendar_rules_survive_confirmation_pause_and_backup_without_losing_the_anchor() {
    use chrono::TimeZone;
    let at = |year, month, day| {
        Local
            .with_ymd_and_hms(year, month, day, 9, 0, 0)
            .unwrap()
            .timestamp_millis()
    };
    for (rule, anchor, next) in [
        (
            ReminderRecurrence::Monthly,
            at(2026, 1, 31),
            at(2026, 3, 31),
        ),
        (ReminderRecurrence::Yearly, at(2024, 2, 29), at(2028, 2, 29)),
    ] {
        let pool = database().await;
        let row = create_reminder(&pool, "Calendar", anchor, Some(rule.clone()), anchor - 1)
            .await
            .unwrap();
        fire(&pool, anchor).await;
        resolve_reminder_alert(&pool, row.id, anchor, Some(15), anchor)
            .await
            .unwrap();
        fire(&pool, anchor + 900_000).await;
        resolve_reminder_alert(&pool, row.id, anchor + 900_000, None, anchor + 900_000)
            .await
            .unwrap();
        let scheduled = fetch_reminder_by_id(&pool, row.id).await.unwrap();
        assert_eq!(scheduled.scheduled_at, next);
        assert_eq!(scheduled.recurrence_anchor_at, Some(anchor));
        update_reminder(
            &pool,
            row.id,
            "Calendar",
            next,
            false,
            Some(rule.clone()),
            next - 1,
        )
        .await
        .unwrap();
        update_reminder(
            &pool,
            row.id,
            "Calendar",
            next,
            true,
            Some(rule.clone()),
            next,
        )
        .await
        .unwrap();
        let resumed = fetch_reminder_by_id(&pool, row.id).await.unwrap();
        assert!(resumed.scheduled_at > next);
        let rows = backup_restore::fetch_all_reminders_for_backup(&pool)
            .await
            .unwrap();
        let target = database().await;
        let mut tx = target.begin().await.unwrap();
        backup_restore::insert_missing_for_restore(&mut tx, &rows, &[], &[])
            .await
            .unwrap();
        tx.commit().await.unwrap();
        let restored = backup_restore::fetch_all_reminders_for_backup(&target)
            .await
            .unwrap();
        assert_eq!(restored[0].recurrence, Some(rule));
        assert_eq!(restored[0].recurrence_anchor_at, Some(anchor));
        assert_eq!(restored[0].scheduled_at, resumed.scheduled_at);
    }
}

#[tokio::test]
async fn recurring_reminder_coalesces_missed_occurrences_and_keeps_cadence_after_snooze() {
    let pool = database().await;
    let rule = ReminderRecurrence::Interval { minutes: 30 };
    let row = create_reminder(&pool, "Break", 60_000, Some(rule.clone()), 0)
        .await
        .unwrap();
    assert_eq!(fire(&pool, 4_000_000).await.len(), 1);
    assert!(fire(&pool, 5_000_000).await.is_empty());
    assert_eq!(
        pending_reminder_alerts(&pool).await.unwrap()[0].recurrence,
        Some(rule.clone())
    );
    resolve_reminder_alert(&pool, row.id, 4_000_000, Some(15), 5_000_000)
        .await
        .unwrap();
    let snoozed = fetch_reminder_by_id(&pool, row.id).await.unwrap();
    assert_eq!(snoozed.scheduled_at, 5_900_000);
    assert_eq!(snoozed.recurrence_anchor_at, Some(60_000));
    resolve_reminder_alert(&pool, row.id, 4_000_000, Some(15), 5_500_000)
        .await
        .unwrap();
    assert_eq!(
        fetch_reminder_by_id(&pool, row.id)
            .await
            .unwrap()
            .scheduled_at,
        5_900_000
    );
    fire(&pool, 5_900_001).await;
    assert!(
        resolve_reminder_alert(&pool, row.id, 4_000_000, None, 6_000_000)
            .await
            .is_err()
    );
    resolve_reminder_alert(&pool, row.id, 5_900_001, None, 6_000_000)
        .await
        .unwrap();
    let next = fetch_reminder_by_id(&pool, row.id).await.unwrap();
    assert_eq!(next.status, ReminderStatus::Scheduled);
    assert_eq!(next.scheduled_at, 7_260_000);
    assert_eq!(next.recurrence, Some(rule));
    assert!(pending_reminder_alerts(&pool).await.unwrap().is_empty());
}

#[tokio::test]
async fn recurring_reminder_pause_resume_edit_and_backup_preserve_rule_identity() {
    let pool = database().await;
    let rule = ReminderRecurrence::Interval { minutes: 30 };
    let row = create_reminder(&pool, "Break", 60_000, Some(rule.clone()), 0)
        .await
        .unwrap();
    fire(&pool, 70_000).await;
    update_reminder(
        &pool,
        row.id,
        "Break",
        60_000,
        false,
        Some(rule.clone()),
        80_000,
    )
    .await
    .unwrap();
    assert!(pending_reminder_alerts(&pool).await.unwrap().is_empty());
    assert!(fire(&pool, 5_000_000).await.is_empty());
    update_reminder(
        &pool,
        row.id,
        "Break",
        60_000,
        true,
        Some(rule.clone()),
        5_000_000,
    )
    .await
    .unwrap();
    let resumed = fetch_reminder_by_id(&pool, row.id).await.unwrap();
    assert_eq!(resumed.scheduled_at, 5_460_000);
    update_reminder(
        &pool,
        row.id,
        "Renamed",
        resumed.scheduled_at,
        true,
        Some(rule.clone()),
        5_100_000,
    )
    .await
    .unwrap();
    assert_eq!(
        fetch_reminder_by_id(&pool, row.id)
            .await
            .unwrap()
            .recurrence_anchor_at,
        Some(60_000)
    );
    let backup = backup_restore::fetch_all_reminders_for_backup(&pool)
        .await
        .unwrap();
    let restored = database().await;
    let mut tx = restored.begin().await.unwrap();
    for _ in 0..2 {
        backup_restore::insert_missing_for_restore(&mut tx, &backup, &[], &[])
            .await
            .unwrap();
    }
    tx.commit().await.unwrap();
    let restored_rows = backup_restore::fetch_all_reminders_for_backup(&restored)
        .await
        .unwrap();
    assert_eq!(restored_rows.len(), 1);
    assert_eq!(restored_rows[0].recurrence, Some(rule));
    assert_eq!(restored_rows[0].recurrence_anchor_at, Some(60_000));
    assert_eq!(fire(&restored, 5_460_000).await.len(), 1);
    update_reminder(&pool, row.id, "Once", 6_000_000, true, None, 5_100_000)
        .await
        .unwrap();
    let once = fetch_reminder_by_id(&pool, row.id).await.unwrap();
    assert_eq!(once.recurrence, None);
    assert_eq!(once.recurrence_anchor_at, None);
}

#[tokio::test]
async fn recurring_reminder_upgrade_and_legacy_backup_keep_one_time_rows_and_reject_corruption() {
    let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
    pool.execute(schema::TOOLS_TABLES_SCHEMA_SQL).await.unwrap();
    pool.execute("INSERT INTO tool_reminders(label,scheduled_at,created_at,status) VALUES('Legacy',1000,0,'fired')").await.unwrap();
    assert!(backup_restore::fetch_all_reminders_for_backup(&pool)
        .await
        .unwrap()[0]
        .recurrence
        .is_none());
    pool.execute(schema::REMINDER_RECURRENCE_SQL).await.unwrap();
    let legacy = fetch_reminder_by_id(&pool, 1).await.unwrap();
    assert_eq!(legacy.status, ReminderStatus::Fired);
    assert_eq!(legacy.recurrence, None);
    assert!(create_reminder(
        &pool,
        "Bad",
        2000,
        Some(ReminderRecurrence::Weekly { weekdays: vec![] }),
        0
    )
    .await
    .is_err());
    pool.execute("INSERT INTO tool_reminder_recurrences(reminder_id,recurrence_anchor_at,recurrence) VALUES(1,1000,'{\"kind\":\"weekly\",\"weekdays\":[]}')")
        .await
        .unwrap();
    assert!(fetch_reminder_by_id(&pool, 1).await.is_err());
    assert!(backup_restore::fetch_all_reminders_for_backup(&pool)
        .await
        .is_err());
}

#[tokio::test]
async fn recurring_reminder_reopen_recovers_pending_confirmation_and_backup_keeps_target_rule() {
    use crate::data::sqlite_pool::{open_single_connection_sqlite_pool, prepare_pool_schema};
    let path = std::env::temp_dir().join(format!("patina-recurring-{}.db", uuid::Uuid::new_v4()));
    let pool = open_single_connection_sqlite_pool(&path, true)
        .await
        .unwrap();
    prepare_pool_schema(&pool, &path).await.unwrap();
    let row = create_reminder(
        &pool,
        "Persisted",
        60_000,
        Some(ReminderRecurrence::Interval { minutes: 30 }),
        0,
    )
    .await
    .unwrap();
    let backup = backup_restore::fetch_all_reminders_for_backup(&pool)
        .await
        .unwrap();
    update_reminder(
        &pool,
        row.id,
        "Persisted",
        60_000,
        true,
        Some(ReminderRecurrence::Daily),
        0,
    )
    .await
    .unwrap();
    let mut tx = pool.begin().await.unwrap();
    backup_restore::insert_missing_for_restore(&mut tx, &backup, &[], &[])
        .await
        .unwrap();
    tx.commit().await.unwrap();
    assert_eq!(
        backup_restore::fetch_all_reminders_for_backup(&pool)
            .await
            .unwrap()
            .len(),
        1
    );
    fire(&pool, 70_000).await;
    pool.close().await;

    let pool = open_single_connection_sqlite_pool(&path, false)
        .await
        .unwrap();
    prepare_pool_schema(&pool, &path).await.unwrap();
    let pending = pending_reminder_alerts(&pool).await.unwrap();
    assert_eq!(pending.len(), 1);
    assert_eq!(pending[0].recurrence, Some(ReminderRecurrence::Daily));
    assert_eq!(pending[0].recurrence_anchor_at, Some(60_000));
    assert!(fire(&pool, 80_000).await.is_empty());
    resolve_reminder_alert(&pool, row.id, 70_000, None, 80_000)
        .await
        .unwrap();
    assert_eq!(
        fetch_reminder_by_id(&pool, row.id).await.unwrap().status,
        ReminderStatus::Scheduled
    );
    pool.close().await;
    std::fs::remove_file(path).unwrap();
}

#[tokio::test]
async fn merge_after_recurrence_advances_keeps_one_future_firing() {
    let pool = database().await;
    let rule = Some(ReminderRecurrence::Interval { minutes: 5 });
    let row = create_reminder(&pool, "A", 60000, rule.clone(), 1000)
        .await
        .unwrap();
    let old = backup_restore::fetch_all_reminders_for_backup(&pool)
        .await
        .unwrap();
    assert_eq!(fire(&pool, 60000).await.len(), 1);
    resolve_reminder_alert(&pool, row.id, 60000, None, 61000)
        .await
        .unwrap();
    update_reminder(&pool, row.id, "Renamed", 360000, true, rule, 61000)
        .await
        .unwrap();
    for _ in 0..2 {
        let mut tx = pool.begin().await.unwrap();
        backup_restore::insert_missing_for_restore(&mut tx, &old, &[], &[])
            .await
            .unwrap();
        tx.commit().await.unwrap();
    }
    let current = fetch_reminder_by_id(&pool, row.id).await.unwrap();
    assert_eq!(
        (current.label.as_str(), current.scheduled_at),
        ("Renamed", 360000)
    );
    assert!(fire(&pool, 62000).await.is_empty());
    assert_eq!(fire(&pool, 360000).await.len(), 1);
    assert_eq!(
        backup_restore::fetch_all_reminders_for_backup(&pool)
            .await
            .unwrap()
            .len(),
        1
    );
    pool.close().await;
}
