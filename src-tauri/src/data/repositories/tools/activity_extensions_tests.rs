use super::*;
use crate::data::schema;
use crate::domain::tools::{
    ActivityReminderCheck, ActivityReminderExtension, ActivityReminderTarget,
};
use sqlx::{Executor, SqlitePool};

async fn database() -> SqlitePool {
    let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
    for migration in schema::tracker_migrations() {
        pool.execute(migration.sql).await.unwrap();
    }
    pool.execute("INSERT INTO settings(key,value) VALUES
        ('web_activity_enabled','true'),
        ('__app_override::editor.exe','{\"category\":\"development\",\"enabled\":true}');
        INSERT INTO sessions(app_name,exe_name,window_title,start_time,end_time,duration,continuity_group_start_time)
        VALUES('Editor','editor.exe','',0,9780000,9780000,0);
        INSERT INTO web_activity_segments(browser_client_id,browser_kind,browser_exe_name,domain,normalized_domain,start_time,end_time,duration,source,created_at,updated_at)
        VALUES('client','chromium','chrome.exe','example.com','example.com',0,9780000,9780000,'browser-extension',0,9780000);")
        .await.unwrap();
    pool
}

async fn fire(
    pool: &SqlitePool,
    day: &str,
    start: i64,
    now: i64,
) -> Vec<crate::domain::tools::ActivityReminderNotification> {
    let mut tx = pool.begin().await.unwrap();
    let events =
        fire_due_activity_reminders(&mut tx, day, start, now, &[], &ActivityReminderCheck::All)
            .await
            .unwrap();
    tx.commit().await.unwrap();
    events.notifications
}

fn targets() -> [ActivityReminderTarget; 3] {
    [
        ActivityReminderTarget::App {
            app_name: "Editor".into(),
            exe_name: Some("editor.exe".into()),
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
async fn selected_activity_rules_skip_unrelated_rules_and_usage_sources() {
    for selected_index in 0..3 {
        let pool = database().await;
        let mut ids = Vec::new();
        for target in targets() {
            ids.push(
                create_activity_reminder_rule(&pool, &target, "Target", 60_000, "", 1)
                    .await
                    .unwrap()
                    .id,
            );
        }
        let selected_id = ids[selected_index];
        let mut tx = pool.begin().await.unwrap();
        // If the selected query decodes unrelated rules, this invalid target makes it fail.
        sqlx::query("PRAGMA ignore_check_constraints = ON")
            .execute(&mut *tx)
            .await
            .unwrap();
        sqlx::query(
            "UPDATE tool_activity_reminder_rules SET target_kind = 'invalid' WHERE id != ?",
        )
        .bind(selected_id)
        .execute(&mut *tx)
        .await
        .unwrap();
        sqlx::query("PRAGMA ignore_check_constraints = OFF")
            .execute(&mut *tx)
            .await
            .unwrap();
        let unused_source = if selected_index == 2 {
            "sessions"
        } else {
            "web_activity_segments"
        };
        sqlx::query(sqlx::AssertSqlSafe(format!(
            "ALTER TABLE {unused_source} RENAME TO unused_usage"
        )))
        .execute(&mut *tx)
        .await
        .unwrap();
        let events = fire_due_activity_reminders(
            &mut tx,
            "2026-10-30",
            0,
            9_780_000,
            &[],
            &ActivityReminderCheck::Rules(vec![selected_id]),
        )
        .await
        .unwrap();
        assert_eq!(events.notifications.len(), 1);
        assert_eq!(events.notifications[0].rule_id, selected_id);
        assert_eq!(events.watch.rules.len(), 1);
        let untouched: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM tool_activity_reminder_rules WHERE id != ? AND last_fired_date_key IS NULL")
            .bind(selected_id).fetch_one(&mut *tx).await.unwrap();
        assert_eq!(untouched, 2);
        tx.rollback().await.unwrap();
        set_activity_reminder_enabled(&pool, selected_id, false, 2)
            .await
            .unwrap();
        let mut tx = pool.begin().await.unwrap();
        sqlx::query("ALTER TABLE settings RENAME TO unused_settings")
            .execute(&mut *tx)
            .await
            .unwrap();
        let events = fire_due_activity_reminders(
            &mut tx,
            "2026-10-30",
            0,
            9_780_000,
            &[],
            &ActivityReminderCheck::Rules(vec![selected_id]),
        )
        .await
        .unwrap();
        assert!(events.watch.rules.is_empty());
        assert!(events.notifications.is_empty());
        tx.rollback().await.unwrap();
        pool.close().await;
    }
}

#[tokio::test]
async fn selected_usage_facts_retain_only_matching_apps_category_members_or_domains() {
    let pool = database().await;
    pool.execute("INSERT INTO settings(key,value) VALUES ('__app_link::helper.exe','editor.exe');
        INSERT INTO sessions(app_name,exe_name,window_title,start_time,end_time,duration,continuity_group_start_time)
        VALUES('Helper','helper.exe','',0,100000,100000,0), ('Other','other.exe','',0,200000,200000,0);
        INSERT INTO web_activity_segments(browser_client_id,browser_kind,browser_exe_name,domain,normalized_domain,start_time,end_time,duration,source,created_at,updated_at)
        VALUES('client','chromium','chrome.exe','other.test','other.test',0,200000,200000,'browser-extension',0,200000);")
        .await.unwrap();
    for (index, target) in targets().into_iter().enumerate() {
        let rule = create_activity_reminder_rule(&pool, &target, "Target", 60_000, "", 1)
            .await
            .unwrap();
        let mut tx = pool.begin().await.unwrap();
        let classification =
            crate::data::repositories::classification_settings::load_classification_snapshot_in_tx(
                &mut tx,
            )
            .await
            .unwrap();
        if index == 2 {
            let facts = super::read::fetch_web_usage_facts_tx(&mut tx, 0, 9_780_000, &[rule])
                .await
                .unwrap();
            assert_eq!(facts.len(), 1);
            assert_eq!(facts[0].normalized_domain, "example.com");
        } else {
            let facts = super::read::fetch_session_usage_facts_tx(
                &mut tx,
                0,
                9_780_000,
                &[rule],
                &classification,
            )
            .await
            .unwrap();
            assert_eq!(facts.len(), index + 1);
            assert!(facts.iter().all(|fact| fact.exe_name != "other.exe"));
        }
        tx.rollback().await.unwrap();
    }
    pool.close().await;
}

#[tokio::test]
async fn activity_watch_only_contains_enabled_and_limited_rules() {
    for target in targets() {
        let pool = database().await;
        let rule = create_activity_reminder_rule(&pool, &target, "Target", 1_800_000, "", 1)
            .await
            .unwrap();
        let mut tx = pool.begin().await.unwrap();
        let enabled = fire_due_activity_reminders(
            &mut tx,
            "2026-10-30",
            0,
            9_780_000,
            &[],
            &ActivityReminderCheck::All,
        )
        .await
        .unwrap();
        assert_eq!(
            enabled
                .watch
                .rules
                .iter()
                .map(|rule| rule.target.clone())
                .collect::<Vec<_>>(),
            vec![target.clone()]
        );
        tx.commit().await.unwrap();
        set_activity_reminder_enabled(&pool, rule.id, false, 9_780_001)
            .await
            .unwrap();
        let mut tx = pool.begin().await.unwrap();
        // Disabled reminders must not even load the usage facts or classification settings.
        sqlx::query("ALTER TABLE sessions RENAME TO unused_sessions")
            .execute(&mut *tx)
            .await
            .unwrap();
        sqlx::query("ALTER TABLE settings RENAME TO unused_settings")
            .execute(&mut *tx)
            .await
            .unwrap();
        let disabled = fire_due_activity_reminders(
            &mut tx,
            "2026-10-30",
            0,
            9_780_002,
            &[],
            &ActivityReminderCheck::All,
        )
        .await
        .unwrap();
        assert!(disabled.watch.rules.is_empty());
        assert_eq!(disabled.watch.next_check_at(), None);
        tx.rollback().await.unwrap();
        set_activity_reminder_enabled(&pool, rule.id, true, 9_780_003)
            .await
            .unwrap();
        let mut tx = pool.begin().await.unwrap();
        let pending = fire_due_activity_reminders(
            &mut tx,
            "2026-10-30",
            0,
            9_780_004,
            &[rule.id],
            &ActivityReminderCheck::All,
        )
        .await
        .unwrap();
        assert_eq!(
            pending
                .watch
                .rules
                .iter()
                .map(|rule| rule.target.clone())
                .collect::<Vec<_>>(),
            vec![target.clone()],
            "pending alerts still track departures"
        );
        assert!(pending.notifications.is_empty());
        tx.commit().await.unwrap();
        extend_activity_reminder(
            &pool,
            rule.id,
            9_780_000,
            ActivityReminderExtension::Today,
            "2026-10-30",
            0,
            9_780_005,
        )
        .await
        .unwrap();
        let mut tx = pool.begin().await.unwrap();
        assert!(fire_due_activity_reminders(
            &mut tx,
            "2026-10-30",
            0,
            9_780_006,
            &[],
            &ActivityReminderCheck::All
        )
        .await
        .unwrap()
        .watch
        .rules
        .is_empty());
        assert_eq!(
            fire_due_activity_reminders(
                &mut tx,
                "2026-10-31",
                9_780_007,
                9_780_008,
                &[],
                &ActivityReminderCheck::All
            )
            .await
            .unwrap()
            .watch
            .rules
            .iter()
            .map(|rule| rule.target.clone())
            .collect::<Vec<_>>(),
            vec![target]
        );
        tx.rollback().await.unwrap();
        pool.close().await;
    }
}

#[tokio::test]
async fn activity_deadlines_follow_active_usage_and_extensions() {
    for target in targets() {
        let pool = database().await;
        let rule = create_activity_reminder_rule(&pool, &target, "Target", 9_840_000, "", 1)
            .await
            .unwrap();
        let mut tx = pool.begin().await.unwrap();
        let idle = fire_due_activity_reminders(
            &mut tx,
            "2026-10-30",
            0,
            9_800_000,
            &[],
            &ActivityReminderCheck::All,
        )
        .await
        .unwrap();
        assert_eq!(
            idle.watch.next_check_at(),
            None,
            "inactive targets must not poll"
        );
        tx.commit().await.unwrap();
        pool.execute("INSERT INTO sessions(app_name,exe_name,window_title,start_time,continuity_group_start_time)
            VALUES('Editor','editor.exe','',9800000,9800000);
            INSERT INTO web_activity_segments(browser_client_id,browser_kind,browser_exe_name,domain,normalized_domain,start_time,source,created_at,updated_at)
            VALUES('client','chromium','chrome.exe','example.com','example.com',9800000,'browser-extension',9800000,9800000);")
            .await.unwrap();
        for now in [9_800_000, 9_830_000, 9_859_999] {
            let mut tx = pool.begin().await.unwrap();
            let active = fire_due_activity_reminders(
                &mut tx,
                "2026-10-30",
                0,
                now,
                &[],
                &ActivityReminderCheck::All,
            )
            .await
            .unwrap();
            assert!(active.notifications.is_empty());
            assert_eq!(active.watch.next_check_at(), Some(9_860_000), "{target:?}");
            tx.commit().await.unwrap();
        }
        let mut tx = pool.begin().await.unwrap();
        let due = fire_due_activity_reminders(
            &mut tx,
            "2026-10-30",
            0,
            9_860_000,
            &[],
            &ActivityReminderCheck::All,
        )
        .await
        .unwrap();
        assert_eq!(due.notifications.len(), 1);
        assert_eq!(due.watch.next_check_at(), None);
        tx.commit().await.unwrap();
        extend_activity_reminder(
            &pool,
            rule.id,
            9_860_000,
            ActivityReminderExtension::FifteenMinutes,
            "2026-10-30",
            0,
            9_870_000,
        )
        .await
        .unwrap();
        let mut tx = pool.begin().await.unwrap();
        let pending = fire_due_activity_reminders(
            &mut tx,
            "2026-10-30",
            0,
            9_870_000,
            &[rule.id],
            &ActivityReminderCheck::All,
        )
        .await
        .unwrap();
        assert_eq!(pending.watch.next_check_at(), None);
        let extended = fire_due_activity_reminders(
            &mut tx,
            "2026-10-30",
            0,
            9_870_000,
            &[],
            &ActivityReminderCheck::All,
        )
        .await
        .unwrap();
        assert_eq!(extended.watch.next_check_at(), Some(10_770_000));
        tx.commit().await.unwrap();
        pool.execute(
            "UPDATE sessions SET end_time=9870000 WHERE end_time IS NULL;
            UPDATE web_activity_segments SET end_time=9870000 WHERE end_time IS NULL;",
        )
        .await
        .unwrap();
        let mut tx = pool.begin().await.unwrap();
        let stopped = fire_due_activity_reminders(
            &mut tx,
            "2026-10-30",
            0,
            9_880_000,
            &[],
            &ActivityReminderCheck::All,
        )
        .await
        .unwrap();
        assert_eq!(
            stopped.watch.next_check_at(),
            None,
            "stopping must cancel the deadline"
        );
        tx.commit().await.unwrap();
        pool.close().await;
    }
}

#[tokio::test]
async fn activity_reminder_reentry_alerts_once_per_new_use() {
    for target in targets() {
        let pool = database().await;
        let rule = create_activity_reminder_rule(&pool, &target, "Target", 1_800_000, "", 1)
            .await
            .unwrap();
        assert_eq!(fire(&pool, "2026-10-30", 0, 9_780_000).await.len(), 1);
        assert!(
            fire(&pool, "2026-10-30", 0, 9_790_000).await.is_empty(),
            "closed usage must not repeat while the user stays on the desktop"
        );

        pool.execute("INSERT INTO sessions(app_name,exe_name,window_title,start_time,continuity_group_start_time)
            VALUES('Editor','editor.exe','',9800000,0);
            INSERT INTO web_activity_segments(browser_client_id,browser_kind,browser_exe_name,domain,normalized_domain,start_time,source,created_at,updated_at)
            VALUES('client','chromium','chrome.exe','example.com','example.com',9800000,'browser-extension',9800000,9800000);")
            .await.unwrap();
        let mut tx = pool.begin().await.unwrap();
        assert!(
            fire_due_activity_reminders(
                &mut tx,
                "2026-10-30",
                0,
                9_800_001,
                &[rule.id],
                &ActivityReminderCheck::All
            )
            .await
            .unwrap()
            .notifications
            .is_empty(),
            "an unanswered alert must not be replaced by a later visit"
        );
        tx.commit().await.unwrap();
        assert_eq!(
            fetch_all_activity_reminder_rules(&pool).await.unwrap()[0].last_fired_at,
            Some(9_780_000)
        );
        let reopened = fire(&pool, "2026-10-30", 0, 9_800_001).await;
        assert_eq!(
            reopened.len(),
            1,
            "returning to an over-limit target must alert again: {target:?}"
        );
        assert_eq!(reopened[0].rule_id, rule.id);
        assert!(
            fire(&pool, "2026-10-30", 0, 9_810_000).await.is_empty(),
            "continued use must not produce another alert on each tick"
        );

        pool.execute("UPDATE sessions SET window_title='New title' WHERE end_time IS NULL;
            UPDATE web_activity_segments SET end_time=9810000,duration=10000 WHERE end_time IS NULL;
            INSERT INTO web_activity_segments(browser_client_id,browser_kind,browser_exe_name,domain,normalized_domain,title,start_time,source,created_at,updated_at)
            VALUES('client','chromium','chrome.exe','example.com','example.com','New title',9810000,'browser-extension',9810000,9810000);")
            .await.unwrap();
        assert!(fire(&pool, "2026-10-30", 0, 9_820_000).await.is_empty());
        assert!(
            extend_activity_reminder(
                &pool,
                rule.id,
                9_780_000,
                ActivityReminderExtension::Today,
                "2026-10-30",
                0,
                9_820_001
            )
            .await
            .is_err(),
            "the earlier alert must not extend a new visit"
        );
        extend_activity_reminder(
            &pool,
            rule.id,
            9_800_001,
            ActivityReminderExtension::Today,
            "2026-10-30",
            0,
            9_820_001,
        )
        .await
        .unwrap();
        pool.execute("UPDATE sessions SET start_time=9830000 WHERE end_time IS NULL;
            UPDATE web_activity_segments SET start_time=9830000,updated_at=9830000 WHERE end_time IS NULL;")
            .await.unwrap();
        assert!(
            fire(&pool, "2026-10-30", 0, 9_840_000).await.is_empty(),
            "today's unlimited extension must survive another activation"
        );
    }
}

#[tokio::test]
async fn extensions_use_confirmation_usage_and_rearm_all_target_types_once() {
    for target in targets() {
        let pool = database().await;
        let rule = create_activity_reminder_rule(&pool, &target, "Target", 30 * 60_000, "Rest", 1)
            .await
            .unwrap();
        assert_eq!(fire(&pool, "2026-10-30", 0, 9_780_000).await.len(), 1);
        // Usage continues while the dialog is open; the grant starts when confirmed.
        pool.execute(
            "UPDATE sessions SET end_time=9900000,duration=9900000;
            UPDATE web_activity_segments SET end_time=9900000,duration=9900000;",
        )
        .await
        .unwrap();
        extend_activity_reminder(
            &pool,
            rule.id,
            9_780_000,
            ActivityReminderExtension::FifteenMinutes,
            "2026-10-30",
            0,
            9_900_000,
        )
        .await
        .unwrap();
        extend_activity_reminder(
            &pool,
            rule.id,
            9_780_000,
            ActivityReminderExtension::FifteenMinutes,
            "2026-10-30",
            0,
            10_000_000,
        )
        .await
        .unwrap();
        let snapshot = fetch_tools_snapshot(&pool, 10_000_000, "2026-10-30")
            .await
            .unwrap();
        let saved = &snapshot.activity_reminder_rules[0];
        assert_eq!(saved.limit_ms, 30 * 60_000);
        assert_eq!(saved.extension_limit_ms, Some(10_800_000));
        assert!(
            fire(&pool, "2026-10-30", 0, 20_000_000).await.is_empty(),
            "wall time alone must not consume the extension"
        );
        pool.execute(
            "UPDATE sessions SET end_time=10800000,duration=10800000;
            UPDATE web_activity_segments SET end_time=10800000,duration=10800000;",
        )
        .await
        .unwrap();
        let events = fire(&pool, "2026-10-30", 0, 20_000_001).await;
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].limit_ms, 10_800_000);
        assert!(fire(&pool, "2026-10-30", 0, 20_000_002).await.is_empty());
        extend_activity_reminder(
            &pool,
            rule.id,
            20_000_001,
            ActivityReminderExtension::OneHour,
            "2026-10-30",
            0,
            20_000_003,
        )
        .await
        .unwrap();
        assert_eq!(
            fetch_tools_snapshot(&pool, 20_000_003, "2026-10-30")
                .await
                .unwrap()
                .activity_reminder_rules[0]
                .extension_limit_ms,
            Some(14_400_000)
        );
        assert!(
            extend_activity_reminder(
                &pool,
                rule.id,
                9_780_000,
                ActivityReminderExtension::Today,
                "2026-10-30",
                0,
                20_000_004
            )
            .await
            .is_err(),
            "an older alert cannot replace a newer grant"
        );
    }
}

#[tokio::test]
async fn extension_after_usage_recovery_never_shortens_limit() {
    for target in targets() {
        for previous_extension in [None, Some(3_600_000)] {
            let pool = database().await;
            let rule = create_activity_reminder_rule(&pool, &target, "Target", 1_800_000, "", 1)
                .await
                .unwrap();
            if let Some(limit) = previous_extension {
                sqlx::query("INSERT INTO tool_activity_reminder_extensions(rule_id, extension_date_key, extension_limit_ms) VALUES(?, '2026-11-03', ?)")
                    .bind(rule.id).bind(limit).execute(&pool).await.unwrap();
            }
            assert_eq!(fire(&pool, "2026-11-03", 0, 9_780_000).await.len(), 1);
            // Recovery corrects the usage while the earlier alert is still open.
            pool.execute(
                "UPDATE sessions SET end_time=1000,duration=1000;
                UPDATE web_activity_segments SET end_time=1000,duration=1000;",
            )
            .await
            .unwrap();
            extend_activity_reminder(
                &pool,
                rule.id,
                9_780_000,
                ActivityReminderExtension::FifteenMinutes,
                "2026-11-03",
                0,
                9_780_001,
            )
            .await
            .unwrap();
            let saved = fetch_all_activity_reminder_rules(&pool)
                .await
                .unwrap()
                .remove(0);
            let expected = previous_extension.unwrap_or(1_800_000);
            assert_eq!(saved.limit_ms, 1_800_000);
            assert_eq!(
                saved.extension_limit_ms,
                Some(expected),
                "extension shortened {target:?}"
            );
            pool.execute(
                "UPDATE sessions SET end_time=901000,duration=901000;
                UPDATE web_activity_segments SET end_time=901000,duration=901000;",
            )
            .await
            .unwrap();
            assert!(fire(&pool, "2026-11-03", 0, 10_000_000).await.is_empty());
            pool.close().await;
        }
    }
}

#[tokio::test]
async fn persisted_extension_below_daily_limit_cannot_fire_early() {
    for target in targets() {
        let pool = database().await;
        let rule = create_activity_reminder_rule(&pool, &target, "Target", 1_800_000, "", 1)
            .await
            .unwrap();
        sqlx::query("INSERT INTO tool_activity_reminder_extensions(rule_id, extension_date_key, extension_limit_ms) VALUES(?, '2026-11-03', 900000)")
            .bind(rule.id).execute(&pool).await.unwrap();
        for usage in [900_000_i64, 1_799_999, 1_800_000] {
            sqlx::query("UPDATE sessions SET end_time=?,duration=?")
                .bind(usage)
                .bind(usage)
                .execute(&pool)
                .await
                .unwrap();
            sqlx::query("UPDATE web_activity_segments SET end_time=?,duration=?")
                .bind(usage)
                .bind(usage)
                .execute(&pool)
                .await
                .unwrap();
            let events = fire(&pool, "2026-11-03", 0, 9_780_000).await;
            if usage < 1_800_000 {
                assert!(
                    events.is_empty(),
                    "a 30-minute rule fired after {usage} ms for {target:?}"
                );
            } else {
                assert_eq!(events.len(), 1);
                assert_eq!(events[0].usage_ms, usage);
                assert_eq!(events[0].limit_ms, 1_800_000);
            }
        }
        pool.close().await;
    }
}

#[tokio::test]
async fn unlimited_is_date_scoped_and_stale_or_disabled_rules_cannot_extend() {
    let pool = database().await;
    let rule = create_activity_reminder_rule(&pool, &targets()[0], "Target", 1_800_000, "", 1)
        .await
        .unwrap();
    assert_eq!(fire(&pool, "2026-10-30", 0, 9_780_000).await.len(), 1);
    assert!(extend_activity_reminder(
        &pool,
        rule.id,
        9_780_000,
        ActivityReminderExtension::Today,
        "2026-10-31",
        86_400_000,
        86_400_001
    )
    .await
    .is_err());
    extend_activity_reminder(
        &pool,
        rule.id,
        9_780_000,
        ActivityReminderExtension::Today,
        "2026-10-30",
        0,
        9_780_001,
    )
    .await
    .unwrap();
    assert!(fire(&pool, "2026-10-30", 0, 30_000_000).await.is_empty());
    let saved = fetch_tools_snapshot(&pool, 30_000_000, "2026-10-30")
        .await
        .unwrap()
        .activity_reminder_rules
        .remove(0);
    assert_eq!(saved.limit_for_date("2026-10-30"), None);
    assert_eq!(saved.limit_for_date("2026-10-31"), Some(1_800_000));
    pool.execute("INSERT INTO sessions(app_name,exe_name,window_title,start_time,end_time,duration,continuity_group_start_time)
        VALUES('Editor','editor.exe','',86400000,88200000,1800000,86400000);").await.unwrap();
    assert_eq!(
        fire(&pool, "2026-10-31", 86_400_000, 88_200_000)
            .await
            .len(),
        1
    );
    disable_activity_reminder_rule(&pool, rule.id, 88_200_001)
        .await
        .unwrap();
    assert!(extend_activity_reminder(
        &pool,
        rule.id,
        88_200_000,
        ActivityReminderExtension::OneHour,
        "2026-10-31",
        86_400_000,
        88_200_002
    )
    .await
    .is_err());
}

#[tokio::test]
async fn extension_failure_rolls_back_and_snapshot_merge_keeps_the_grant() {
    let pool = database().await;
    let rule = create_activity_reminder_rule(&pool, &targets()[0], "Target", 1_800_000, "", 1)
        .await
        .unwrap();
    fire(&pool, "2026-10-30", 0, 9_780_000).await;
    pool.execute("CREATE TRIGGER fail_extension BEFORE UPDATE OF extension_date_key ON tool_activity_reminder_extensions BEGIN SELECT RAISE(ABORT,'injected failure'); END;").await.unwrap();
    assert!(extend_activity_reminder(
        &pool,
        rule.id,
        9_780_000,
        ActivityReminderExtension::OneHour,
        "2026-10-30",
        0,
        9_780_001
    )
    .await
    .is_err());
    let prior = fetch_tools_snapshot(&pool, 9_780_001, "2026-10-30")
        .await
        .unwrap();
    assert_eq!(
        prior.activity_reminder_rules[0]
            .last_fired_date_key
            .as_deref(),
        Some("2026-10-30")
    );
    assert!(prior.activity_reminder_rules[0]
        .extension_date_key
        .is_none());
    pool.execute("DROP TRIGGER fail_extension;").await.unwrap();
    extend_activity_reminder(
        &pool,
        rule.id,
        9_780_000,
        ActivityReminderExtension::OneHour,
        "2026-10-30",
        0,
        9_780_002,
    )
    .await
    .unwrap();
    let saved = fetch_tools_snapshot(&pool, 9_780_002, "2026-10-30")
        .await
        .unwrap();
    let destination = database().await;
    let mut tx = destination.begin().await.unwrap();
    merge_activity_reminder_rules(&mut tx, &saved.activity_reminder_rules)
        .await
        .unwrap();
    tx.commit().await.unwrap();
    let restored = fetch_tools_snapshot(&destination, 10_000_000, "2026-10-30")
        .await
        .unwrap();
    assert_eq!(
        restored.activity_reminder_rules[0],
        saved.activity_reminder_rules[0]
    );
    assert!(fire(&destination, "2026-10-30", 0, 20_000_000)
        .await
        .is_empty());
}

#[tokio::test]
async fn version_seventeen_upgrade_and_reopen_preserve_rules_and_extensions() {
    use crate::data::sqlite_pool::{open_single_connection_sqlite_pool, prepare_pool_schema};
    let path = std::env::temp_dir().join(format!(
        "patina-usage-extension-{}.db",
        uuid::Uuid::new_v4()
    ));
    let pool = open_single_connection_sqlite_pool(&path, true)
        .await
        .unwrap();
    for migration in schema::tracker_migrations()
        .into_iter()
        .filter(|m| m.version <= 17)
    {
        pool.execute(migration.sql).await.unwrap();
    }
    pool.execute("INSERT INTO tool_activity_reminder_rules(target_kind,app_name,exe_name,label_snapshot,limit_ms,message,created_at,updated_at)
        VALUES('app','Editor','editor.exe','Editor',1800000,'Break',1,1);
        INSERT INTO sessions(app_name,exe_name,start_time,end_time,duration) VALUES('Editor','editor.exe',0,1800000,1800000);").await.unwrap();
    prepare_pool_schema(&pool, &path).await.unwrap();
    let before = fetch_tools_snapshot(&pool, 1800000, "2026-10-30")
        .await
        .unwrap();
    let rule = &before.activity_reminder_rules[0];
    assert_eq!(rule.message, "Break");
    assert_eq!(rule.limit_ms, 1800000);
    assert!(rule.extension_date_key.is_none());
    fire(&pool, "2026-10-30", 0, 1800000).await;
    extend_activity_reminder(
        &pool,
        rule.id,
        1800000,
        ActivityReminderExtension::FifteenMinutes,
        "2026-10-30",
        0,
        1800001,
    )
    .await
    .unwrap();
    set_activity_reminder_enabled(&pool, rule.id, false, 1800001)
        .await
        .unwrap();
    let expected = fetch_tools_snapshot(&pool, 1800001, "2026-10-30")
        .await
        .unwrap()
        .activity_reminder_rules;
    pool.close().await;
    let reopened = open_single_connection_sqlite_pool(&path, false)
        .await
        .unwrap();
    prepare_pool_schema(&reopened, &path).await.unwrap();
    assert_eq!(
        fetch_tools_snapshot(&reopened, 1800001, "2026-10-30")
            .await
            .unwrap()
            .activity_reminder_rules,
        expected
    );
    assert!(fire(&reopened, "2026-10-30", 0, 3600000).await.is_empty());
    assert_eq!(expected[0].limit_for_date("2026-10-31"), Some(1800000));
    reopened.close().await;
    std::fs::remove_file(path).unwrap();
}

#[tokio::test]
async fn activity_rule_controls_preserve_identity_and_do_not_fire_while_off() {
    let pool = database().await;
    for target in targets() {
        let rule = create_activity_reminder_rule(&pool, &target, "Rule", 60_000, "", 1)
            .await
            .unwrap();
        set_activity_reminder_enabled(&pool, rule.id, false, 2)
            .await
            .unwrap();
        let visible = fetch_tools_snapshot(&pool, 9_780_000, "2026-10-31")
            .await
            .unwrap();
        assert!(visible
            .activity_reminder_rules
            .iter()
            .any(|row| row.id == rule.id && !row.enabled));
        assert!(fire(&pool, "2026-10-31", 0, 9_780_000).await.is_empty());
        assert!(update_activity_reminder_limit(&pool, rule.id, 0, 3)
            .await
            .is_err());
        update_activity_reminder_limit(&pool, rule.id, 18_000_000, 4)
            .await
            .unwrap();
        set_activity_reminder_enabled(&pool, rule.id, true, 5)
            .await
            .unwrap();
        assert!(fire(&pool, "2026-10-31", 0, 9_780_000).await.is_empty());
        update_activity_reminder_limit(&pool, rule.id, 60_000, 6)
            .await
            .unwrap();
        let fired = fire(&pool, "2026-10-31", 0, 9_780_000).await;
        assert_eq!(fired.len(), 1);
        assert_eq!(fired[0].rule_id, rule.id);
        set_activity_reminder_enabled(&pool, rule.id, false, 7)
            .await
            .unwrap();
        set_activity_reminder_enabled(&pool, rule.id, true, 8)
            .await
            .unwrap();
        assert!(fire(&pool, "2026-10-31", 0, 9_780_001).await.is_empty());
        disable_activity_reminder_rule(&pool, rule.id, 9)
            .await
            .unwrap();
        assert!(set_activity_reminder_enabled(&pool, rule.id, true, 10)
            .await
            .is_err());
        assert!(update_activity_reminder_limit(&pool, rule.id, 120_000, 10)
            .await
            .is_err());
        assert!(fetch_tools_snapshot(&pool, 10, "2026-10-31")
            .await
            .unwrap()
            .activity_reminder_rules
            .is_empty());
    }
}

#[tokio::test]
async fn editing_activity_limit_invalidates_extensions_only_when_the_limit_changes() {
    let pool = database().await;
    let rule = create_activity_reminder_rule(&pool, &targets()[0], "Rule", 60_000, "", 1)
        .await
        .unwrap();
    fire(&pool, "2026-10-31", 0, 9_780_000).await;
    extend_activity_reminder(
        &pool,
        rule.id,
        9_780_000,
        ActivityReminderExtension::Today,
        "2026-10-31",
        0,
        9_780_001,
    )
    .await
    .unwrap();
    update_activity_reminder_limit(&pool, rule.id, 60_000, 9_780_002)
        .await
        .unwrap();
    assert_eq!(
        fetch_all_activity_reminder_rules(&pool).await.unwrap()[0]
            .extension_date_key
            .as_deref(),
        Some("2026-10-31")
    );
    update_activity_reminder_limit(&pool, rule.id, 18_000_000, 9_780_003)
        .await
        .unwrap();
    let current = fetch_all_activity_reminder_rules(&pool)
        .await
        .unwrap()
        .remove(0);
    assert_eq!(current.id, rule.id);
    assert!(current.extension_date_key.is_none());
    assert!(current.last_fired_date_key.is_none());
    assert!(extend_activity_reminder(
        &pool,
        rule.id,
        9_780_000,
        ActivityReminderExtension::Today,
        "2026-10-31",
        0,
        9_780_004
    )
    .await
    .is_err());
    assert!(fire(&pool, "2026-10-31", 0, 9_780_005).await.is_empty());
}

#[tokio::test]
async fn merged_activity_rules_preserve_enabled_state_and_existing_target_state() {
    let source = database().await;
    let destination = database().await;
    let rule = create_activity_reminder_rule(&source, &targets()[0], "Rule", 60_000, "", 1)
        .await
        .unwrap();
    set_activity_reminder_enabled(&source, rule.id, false, 2)
        .await
        .unwrap();
    let source_rules = fetch_all_activity_reminder_rules(&source).await.unwrap();
    let mut tx = destination.begin().await.unwrap();
    merge_activity_reminder_rules(&mut tx, &source_rules)
        .await
        .unwrap();
    tx.commit().await.unwrap();
    let restored = fetch_all_activity_reminder_rules(&destination)
        .await
        .unwrap();
    assert_eq!(restored.len(), 1);
    assert!(!restored[0].enabled);
    set_activity_reminder_enabled(&destination, restored[0].id, true, 3)
        .await
        .unwrap();
    let mut tx = destination.begin().await.unwrap();
    merge_activity_reminder_rules(&mut tx, &source_rules)
        .await
        .unwrap();
    tx.commit().await.unwrap();
    let retained = fetch_all_activity_reminder_rules(&destination)
        .await
        .unwrap();
    assert_eq!(retained.len(), 1);
    assert!(retained[0].enabled);
}
