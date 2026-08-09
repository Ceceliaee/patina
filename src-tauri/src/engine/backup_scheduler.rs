use crate::domain::backup_schedule::{
    latest_due_slot, LogicalBackupSlot, ScheduledBackupConfig, ScheduledBackupRun,
};
use chrono::NaiveDateTime;

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum SchedulerAction {
    Idle,
    Reconcile(ScheduledBackupRun),
    Retry(ScheduledBackupRun),
    Supersede(ScheduledBackupRun, Option<LogicalBackupSlot>),
    Claim(LogicalBackupSlot),
}

pub fn decide_action(
    now_ms: i64,
    now_local: NaiveDateTime,
    anchor_local: NaiveDateTime,
    config: &ScheduledBackupConfig,
    active: Option<ScheduledBackupRun>,
    latest_slot_already_recorded: bool,
) -> SchedulerAction {
    let latest_slot = latest_due_slot(now_local, anchor_local, config);
    if let Some(run) = active {
        return match run.status.as_str() {
            "running" => SchedulerAction::Reconcile(run),
            "retry_wait"
                if latest_slot
                    .is_some_and(|slot| slot.run_key(&config.target_generation) != run.run_key) =>
            {
                SchedulerAction::Supersede(
                    run,
                    (!latest_slot_already_recorded).then_some(latest_slot.expect("checked slot")),
                )
            }
            "retry_wait" if run.retry_at_ms.is_some_and(|retry| retry <= now_ms) => {
                SchedulerAction::Retry(run)
            }
            _ => SchedulerAction::Idle,
        };
    }
    let Some(slot) = latest_slot else {
        return SchedulerAction::Idle;
    };
    if latest_slot_already_recorded {
        SchedulerAction::Idle
    } else {
        SchedulerAction::Claim(slot)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::backup_schedule::{
        ScheduledBackupCadence, ScheduledBackupConfig, ScheduledBackupTarget,
    };
    use chrono::NaiveDate;

    fn config() -> ScheduledBackupConfig {
        ScheduledBackupConfig {
            enabled: true,
            cadence: ScheduledBackupCadence::Daily,
            weekday: None,
            local_time_minutes: 120,
            target: ScheduledBackupTarget::Local {
                target_dir: "C:\\Backups".to_string(),
            },
            target_generation: "g".to_string(),
            schedule_anchor_at_ms: 0,
            updated_at_ms: 0,
        }
    }

    #[test]
    fn an_existing_slot_suppresses_duplicate_claims() {
        let now = NaiveDate::from_ymd_opt(2026, 8, 9)
            .unwrap()
            .and_hms_opt(9, 0, 0)
            .unwrap();
        let anchor = NaiveDate::from_ymd_opt(2026, 8, 1)
            .unwrap()
            .and_hms_opt(0, 0, 0)
            .unwrap();
        assert_eq!(
            decide_action(0, now, anchor, &config(), None, true),
            SchedulerAction::Idle
        );
    }

    #[test]
    fn a_newer_due_slot_supersedes_an_old_retry_without_backlog() {
        let now = NaiveDate::from_ymd_opt(2026, 8, 9)
            .unwrap()
            .and_hms_opt(9, 0, 0)
            .unwrap();
        let anchor = NaiveDate::from_ymd_opt(2026, 8, 1)
            .unwrap()
            .and_hms_opt(0, 0, 0)
            .unwrap();
        let mut stale = crate::domain::backup_schedule::ScheduledBackupRun {
            run_key: "scheduled-backup:g:2026-08-08:0200".to_string(),
            target_generation: "g".to_string(),
            target_kind: "local".to_string(),
            logical_date: "2026-08-08".to_string(),
            logical_time_minutes: 120,
            target_path: "C:\\Backups\\stale.zip".to_string(),
            staging_path: None,
            phase: "claimed".to_string(),
            remote_etag: None,
            status: "retry_wait".to_string(),
            file_state: "conflict".to_string(),
            attempt_count: 1,
            retry_at_ms: Some(0),
            started_at_ms: 0,
            completed_at_ms: Some(0),
            archive_sha256: None,
            size_bytes: None,
            error_code: Some("validation_failed".to_string()),
            error_message: Some("invalid".to_string()),
            cleanup_warning: None,
            updated_at_ms: 0,
        };
        let action = decide_action(1, now, anchor, &config(), Some(stale.clone()), false);
        match action {
            SchedulerAction::Supersede(run, Some(slot)) => {
                assert_eq!(run.run_key, stale.run_key);
                assert_eq!(slot.date, NaiveDate::from_ymd_opt(2026, 8, 9).unwrap());
            }
            other => panic!("expected supersede action, got {other:?}"),
        }

        stale.run_key = "scheduled-backup:g:2026-08-09:0200".to_string();
        assert_eq!(
            decide_action(1, now, anchor, &config(), Some(stale.clone()), false),
            SchedulerAction::Retry(stale)
        );
    }
}
