use patina_activity_model::views::storage::StorageReply;

pub(super) struct Schedule<'a> {
    pub enabled: bool,
    pub weekly: bool,
    pub remote: bool,
    pub minutes: u16,
    pub weekday: Option<u8>,
    pub directory: &'a str,
    pub next: Option<i64>,
    pub success: Option<i64>,
    pub failure: Option<i64>,
    pub size: Option<u64>,
    pub error: Option<&'a str>,
    pub cleanup: Option<&'a str>,
    pub active: Option<&'a str>,
    pub retry: Option<i64>,
    pub active_error: Option<&'a str>,
}
pub(super) fn schedule(reply: &StorageReply) -> Option<Schedule<'_>> {
    match reply {
        StorageReply::BackupSchedule(s) => Some(Schedule {
            enabled: s.config.enabled,
            weekly: s.config.cadence.as_str() == "weekly",
            remote: s.config.target.kind() == "webdav",
            minutes: s.config.local_time_minutes,
            weekday: s.config.weekday,
            directory: s
                .config
                .target
                .local_target_dir()
                .unwrap_or(&s.default_local_target_dir),
            next: s.next_execution_at_ms,
            success: s.recent_success.as_ref().and_then(|r| r.completed_at_ms),
            failure: s.recent_failure.as_ref().and_then(|r| r.completed_at_ms),
            size: s.recent_success.as_ref().and_then(|r| r.size_bytes),
            error: s
                .recent_failure
                .as_ref()
                .and_then(|r| r.error_code.as_deref()),
            cleanup: s
                .recent_success
                .as_ref()
                .and_then(|r| r.cleanup_warning.as_deref()),
            active: s.active_run.as_ref().map(|r| r.status.as_str()),
            retry: s.active_run.as_ref().and_then(|r| r.retry_at_ms),
            active_error: s.active_run.as_ref().and_then(|r| r.error_code.as_deref()),
        }),
        StorageReply::ExportSchedule(s) => Some(Schedule {
            enabled: s.config.enabled,
            weekly: s.config.cadence.as_str() == "weekly",
            remote: false,
            minutes: s.config.local_time_minutes,
            weekday: s.config.weekday,
            directory: &s.config.target_dir,
            next: s.next_execution_at_ms,
            success: s.recent_success.as_ref().and_then(|r| r.completed_at_ms),
            failure: s.recent_failure.as_ref().and_then(|r| r.completed_at_ms),
            size: s.recent_success.as_ref().and_then(|r| r.size_bytes),
            error: s
                .recent_failure
                .as_ref()
                .and_then(|r| r.error_code.as_deref()),
            cleanup: None,
            active: s.active_run.as_ref().map(|r| r.status.as_str()),
            retry: s.active_run.as_ref().and_then(|r| r.retry_at_ms),
            active_error: s.active_run.as_ref().and_then(|r| r.error_code.as_deref()),
        }),
        _ => None,
    }
}
