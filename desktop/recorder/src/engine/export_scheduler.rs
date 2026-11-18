use crate::domain::export_schedule::{
    latest_due_slot, period_for_slot, LogicalExportSlot, ScheduledExportConfig, ScheduledExportRun,
};
use chrono::NaiveDateTime;

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ExportSchedulerAction {
    Idle,
    Reconcile(ScheduledExportRun),
    Retry(ScheduledExportRun),
    Supersede(ScheduledExportRun, Option<LogicalExportSlot>),
    Claim(LogicalExportSlot),
}

pub fn decide_action(
    now_ms: i64,
    now_local: NaiveDateTime,
    anchor_local: NaiveDateTime,
    config: &ScheduledExportConfig,
    active: Option<ScheduledExportRun>,
    latest_period_already_recorded: bool,
) -> ExportSchedulerAction {
    let latest_slot = latest_due_slot(now_local, anchor_local, config);
    if let Some(run) = active {
        let latest_run_key = latest_slot.and_then(|slot| {
            period_for_slot(slot, config.cadence)
                .map(|period| period.run_key(&config.plan_generation, config.cadence))
        });
        return match run.status.as_str() {
            "running"
                if matches!(run.phase.as_str(), "claimed" | "written")
                    && latest_run_key
                        .as_deref()
                        .is_some_and(|latest| latest != run.run_key) =>
            {
                ExportSchedulerAction::Supersede(
                    run,
                    (!latest_period_already_recorded)
                        .then_some(latest_slot.expect("checked scheduled export slot")),
                )
            }
            "running" => ExportSchedulerAction::Reconcile(run),
            "retry_wait"
                if latest_run_key
                    .as_deref()
                    .is_some_and(|latest| latest != run.run_key) =>
            {
                ExportSchedulerAction::Supersede(
                    run,
                    (!latest_period_already_recorded)
                        .then_some(latest_slot.expect("checked scheduled export slot")),
                )
            }
            "retry_wait" if run.retry_at_ms.is_some_and(|retry| retry <= now_ms) => {
                ExportSchedulerAction::Retry(run)
            }
            _ => ExportSchedulerAction::Idle,
        };
    }
    let Some(slot) = latest_slot else {
        return ExportSchedulerAction::Idle;
    };
    if latest_period_already_recorded {
        ExportSchedulerAction::Idle
    } else {
        ExportSchedulerAction::Claim(slot)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::export_schedule::{ScheduledExportCadence, ScheduledExportFormat};
    use chrono::NaiveDate;

    fn config() -> ScheduledExportConfig {
        ScheduledExportConfig {
            enabled: true,
            cadence: ScheduledExportCadence::Daily,
            weekday: None,
            local_time_minutes: 120,
            target_dir: "C:\\Exports".to_string(),
            format: ScheduledExportFormat::Csv,
            selected_fields: vec!["record_type".to_string()],
            plan_generation: "g".to_string(),
            schedule_anchor_at_ms: 0,
            updated_at_ms: 0,
        }
    }

    fn retry(run_key: &str) -> ScheduledExportRun {
        ScheduledExportRun {
            run_key: run_key.to_string(),
            plan_generation: "g".to_string(),
            cadence: ScheduledExportCadence::Daily,
            logical_start_date: "2026-08-07".to_string(),
            logical_end_date: "2026-08-07".to_string(),
            period_start_ms: 1,
            period_end_ms: 2,
            format: ScheduledExportFormat::Csv,
            selected_fields: vec!["record_type".to_string()],
            target_path: "C:\\Exports\\old.csv".to_string(),
            staging_path: None,
            phase: "claimed".to_string(),
            status: "retry_wait".to_string(),
            file_state: "absent".to_string(),
            attempt_count: 1,
            retry_at_ms: Some(0),
            row_count: None,
            size_bytes: None,
            sha256: None,
            error_code: Some("export_failed".to_string()),
            error_message: Some("failed".to_string()),
            started_at_ms: 0,
            completed_at_ms: Some(0),
            updated_at_ms: 0,
        }
    }

    #[test]
    fn recorded_latest_period_suppresses_duplicate_claim() {
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
            ExportSchedulerAction::Idle
        );
    }

    #[test]
    fn a_new_period_supersedes_an_old_retry_instead_of_building_backlog() {
        let now = NaiveDate::from_ymd_opt(2026, 8, 9)
            .unwrap()
            .and_hms_opt(9, 0, 0)
            .unwrap();
        let anchor = NaiveDate::from_ymd_opt(2026, 8, 1)
            .unwrap()
            .and_hms_opt(0, 0, 0)
            .unwrap();
        let old = retry("scheduled-export:g:daily:2026-08-07:2026-08-07");
        assert!(matches!(
            decide_action(1, now, anchor, &config(), Some(old), false),
            ExportSchedulerAction::Supersede(_, Some(_))
        ));
    }

    #[test]
    fn a_retry_waits_for_its_persisted_deadline() {
        let now = NaiveDate::from_ymd_opt(2026, 8, 9)
            .unwrap()
            .and_hms_opt(12, 0, 0)
            .unwrap();
        let mut pending = retry("scheduled-export:g:daily:2026-08-08:2026-08-08");
        pending.retry_at_ms = Some(11);
        assert_eq!(
            decide_action(10, now, now, &config(), Some(pending.clone()), false),
            ExportSchedulerAction::Idle
        );
        assert_eq!(
            decide_action(11, now, now, &config(), Some(pending.clone()), false),
            ExportSchedulerAction::Retry(pending)
        );
    }

    #[test]
    fn a_disabled_plan_never_claims_a_period() {
        let now = NaiveDate::from_ymd_opt(2026, 8, 9)
            .unwrap()
            .and_hms_opt(12, 0, 0)
            .unwrap();
        let anchor = NaiveDate::from_ymd_opt(2026, 8, 1)
            .unwrap()
            .and_hms_opt(0, 0, 0)
            .unwrap();
        let mut disabled = config();
        disabled.enabled = false;
        assert_eq!(
            decide_action(1, now, anchor, &disabled, None, false),
            ExportSchedulerAction::Idle
        );
    }

    #[test]
    fn a_stale_unpublished_running_period_is_superseded() {
        let now = NaiveDate::from_ymd_opt(2026, 8, 9)
            .unwrap()
            .and_hms_opt(12, 0, 0)
            .unwrap();
        let anchor = NaiveDate::from_ymd_opt(2026, 8, 1)
            .unwrap()
            .and_hms_opt(0, 0, 0)
            .unwrap();
        let mut stale = retry("scheduled-export:g:daily:2026-08-07:2026-08-07");
        stale.status = "running".to_string();
        stale.phase = "written".to_string();
        assert!(matches!(
            decide_action(1, now, anchor, &config(), Some(stale), false),
            ExportSchedulerAction::Supersede(_, Some(_))
        ));
    }

    #[test]
    fn a_stale_published_running_period_is_reconciled_before_new_work() {
        let now = NaiveDate::from_ymd_opt(2026, 8, 9)
            .unwrap()
            .and_hms_opt(12, 0, 0)
            .unwrap();
        let anchor = NaiveDate::from_ymd_opt(2026, 8, 1)
            .unwrap()
            .and_hms_opt(0, 0, 0)
            .unwrap();
        let mut stale = retry("scheduled-export:g:daily:2026-08-07:2026-08-07");
        stale.status = "running".to_string();
        stale.phase = "published".to_string();
        assert_eq!(
            decide_action(1, now, anchor, &config(), Some(stale.clone()), false),
            ExportSchedulerAction::Reconcile(stale)
        );
    }
}
