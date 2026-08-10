use crate::data::backup;
use crate::data::remote_backup::{self, ScheduledRemotePruneOutcome};
use crate::data::repositories::scheduled_backup as repository;
use crate::domain::backup_schedule::{
    next_slot_after, LogicalBackupSlot, ScheduledBackupCadence, ScheduledBackupConfig,
    ScheduledBackupConfigInput, ScheduledBackupRun, ScheduledBackupSnapshot, ScheduledBackupTarget,
    ScheduledBackupTargetInput, DEFAULT_LOCAL_TIME_MINUTES, SCHEDULED_BACKUP_KEEP_COUNT,
};
use crate::engine::backup_scheduler::{decide_action, SchedulerAction};
use crate::platform::app_paths::{self, AppProfile};
use chrono::{Local, LocalResult, NaiveDate, NaiveDateTime, TimeZone};
use sqlx::{Pool, Sqlite};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::AppHandle;
use uuid::Uuid;

const MAX_NAME_CANDIDATES: u8 = 99;
const CLEANUP_RETRY_INTERVAL_MS: i64 = 30 * 60 * 1000;

pub async fn get_snapshot(app: &AppHandle) -> Result<ScheduledBackupSnapshot, String> {
    let pool = crate::data::sqlite_pool::wait_for_sqlite_pool(app).await?;
    let config = load_or_create_config(app, &pool).await?;
    snapshot_from_config(&pool, config, default_local_target_dir(app)?).await
}

pub async fn save_config(
    app: &AppHandle,
    input: ScheduledBackupConfigInput,
) -> Result<ScheduledBackupSnapshot, String> {
    input.validate()?;
    let pool = crate::data::sqlite_pool::wait_for_sqlite_pool(app).await?;
    let next_target = match &input.target {
        ScheduledBackupTargetInput::Local { target_dir } => {
            let normalized = normalize_target_directory(target_dir)?;
            ScheduledBackupTarget::Local {
                target_dir: normalized.to_string_lossy().to_string(),
            }
        }
        ScheduledBackupTargetInput::WebDav => {
            let target =
                remote_backup::load_scheduled_webdav_target(app_paths::app_profile(app), &pool)
                    .await?;
            ScheduledBackupTarget::WebDav {
                target_identity: remote_backup::scheduled_target_identity(&target),
            }
        }
    };
    let current = load_or_create_config(app, &pool).await?;
    let now_ms = now_ms();
    let target_changed = current.target != next_target;
    let schedule_changed = current.schedule_changed_from(&input);
    let should_cancel_active =
        target_changed || schedule_changed || (current.enabled && !input.enabled);
    if should_cancel_active {
        repository::cancel_active_runs(
            &pool,
            "configuration_changed",
            "The scheduled backup configuration changed before this run completed.",
            now_ms,
        )
        .await?;
    }
    let next = ScheduledBackupConfig {
        enabled: input.enabled,
        cadence: input.cadence,
        weekday: input.weekday,
        local_time_minutes: input.local_time_minutes,
        target: next_target,
        target_generation: if target_changed {
            new_generation()
        } else {
            current.target_generation
        },
        schedule_anchor_at_ms: if target_changed || schedule_changed {
            now_ms
        } else {
            current.schedule_anchor_at_ms
        },
        updated_at_ms: now_ms,
    };
    repository::save_config(&pool, &next).await?;
    snapshot_from_config(&pool, next, default_local_target_dir(app)?).await
}

pub async fn tick(app: &AppHandle) -> Result<bool, String> {
    let pool = crate::data::sqlite_pool::wait_for_sqlite_pool(app).await?;
    let mut config = load_or_create_config(app, &pool).await?;
    if matches!(config.target, ScheduledBackupTarget::WebDav { .. })
        && refresh_webdav_target_after_settings_change(app).await?
    {
        config = load_or_create_config(app, &pool).await?;
    }
    if !config.enabled {
        return Ok(false);
    }
    let now = Local::now();
    let now_ms = now.timestamp_millis();
    let anchor_local = Local
        .timestamp_millis_opt(config.schedule_anchor_at_ms)
        .single()
        .unwrap_or(now)
        .naive_local();
    let active = repository::load_active(&pool).await?;
    let latest_slot =
        crate::domain::backup_schedule::latest_due_slot(now.naive_local(), anchor_local, &config);
    let latest_recorded = if let Some(slot) = latest_slot {
        repository::load_run(&pool, &slot.run_key(&config.target_generation))
            .await?
            .is_some()
    } else {
        false
    };
    let action = decide_action(
        now_ms,
        now.naive_local(),
        anchor_local,
        &config,
        active,
        latest_recorded,
    );
    match action {
        SchedulerAction::Idle => {
            if let Some(success) =
                repository::load_recent_by_status(&pool, &config.target_generation, "succeeded")
                    .await?
            {
                if success.cleanup_warning.is_some()
                    && now_ms.saturating_sub(success.updated_at_ms) >= CLEANUP_RETRY_INTERVAL_MS
                {
                    finish_success_maintenance(app, &pool, &config, &success.run_key, now_ms).await;
                    return Ok(true);
                }
            }
            return Ok(false);
        }
        SchedulerAction::Reconcile(run) => {
            reconcile_running_run(app, &pool, &config, &run, now_ms).await?;
            if repository::load_run(&pool, &run.run_key)
                .await?
                .is_some_and(|reconciled| reconciled.status == "succeeded")
                && apply_retention(
                    app_paths::app_profile(app),
                    &pool,
                    &config,
                    &run.run_key,
                    now_ms,
                )
                .await
                .is_err()
            {
                repository::set_cleanup_warning(
                    &pool,
                    &run.run_key,
                    Some("cleanup_pending"),
                    now_ms,
                )
                .await?;
            }
            repository::compact_terminal_history(&pool).await?;
        }
        SchedulerAction::Retry(run) => {
            if repository::start_retry(&pool, &run.run_key, now_ms).await? {
                let retry = repository::load_run(&pool, &run.run_key)
                    .await?
                    .ok_or_else(|| "scheduled backup retry disappeared".to_string())?;
                execute_claimed(app, &pool, &config, retry, now_ms).await?;
            }
        }
        SchedulerAction::Supersede(run, latest_slot) => {
            repository::mark_superseded(&pool, &run.run_key, now_ms).await?;
            if let Some(slot) = latest_slot {
                let latest = new_run(&config, slot, now_ms);
                if repository::claim_run(&pool, &latest).await? {
                    execute_claimed(app, &pool, &config, latest, now_ms).await?;
                }
            }
        }
        SchedulerAction::Claim(slot) => {
            let run = new_run(&config, slot, now_ms);
            if repository::claim_run(&pool, &run).await? {
                execute_claimed(app, &pool, &config, run, now_ms).await?;
            }
        }
    }
    Ok(true)
}

pub async fn reset_after_replace_restore(app: &AppHandle) -> Result<(), String> {
    let pool = crate::data::sqlite_pool::wait_for_sqlite_pool(app).await?;
    repository::reset_after_replace_restore(&pool, &new_generation(), now_ms()).await
}

pub async fn refresh_webdav_target_after_settings_change(app: &AppHandle) -> Result<bool, String> {
    let pool = crate::data::sqlite_pool::wait_for_sqlite_pool(app).await?;
    let Some(mut config) = repository::load_config(&pool).await? else {
        return Ok(false);
    };
    let ScheduledBackupTarget::WebDav { target_identity } = &config.target else {
        return Ok(false);
    };
    let now_ms = now_ms();
    let next_identity = crate::data::repositories::remote_backup_settings::load_config(&pool)
        .await?
        .map(|target| crate::data::repositories::remote_backup_settings::target_identity(&target));

    match next_identity {
        Some(next_identity) if next_identity == *target_identity => return Ok(false),
        Some(next_identity) => {
            repository::cancel_active_runs(
                &pool,
                "configuration_changed",
                "The WebDAV backup target changed before this run completed.",
                now_ms,
            )
            .await?;
            config.target = ScheduledBackupTarget::WebDav {
                target_identity: next_identity,
            };
            config.target_generation = new_generation();
            config.schedule_anchor_at_ms = now_ms;
            config.updated_at_ms = now_ms;
        }
        None => {
            repository::cancel_active_runs(
                &pool,
                "webdav_not_configured",
                "The WebDAV backup target was removed before this run completed.",
                now_ms,
            )
            .await?;
            config.enabled = false;
            config.target_generation = new_generation();
            config.schedule_anchor_at_ms = now_ms;
            config.updated_at_ms = now_ms;
        }
    }
    repository::save_config(&pool, &config).await?;
    Ok(true)
}

async fn execute_claimed(
    app: &AppHandle,
    pool: &Pool<Sqlite>,
    config: &ScheduledBackupConfig,
    run: ScheduledBackupRun,
    now_ms: i64,
) -> Result<(), String> {
    let slot = slot_from_run(&run)?;
    match execute_run(app, pool, config, &run, slot, now_ms).await {
        Ok(_) => {}
        Err(RunExecutionFailure::BeforePublication(error)) => {
            record_execution_failure(pool, &run, &error, now_ms).await?;
        }
        Err(RunExecutionFailure::OwnedRemoteValidation(error)) => {
            cleanup_owned_webdav_failure(app, pool, config, &run.run_key).await;
            record_execution_failure(pool, &run, &error, now_ms).await?;
        }
        Err(RunExecutionFailure::AfterPublication(error)) => {
            eprintln!(
                "[scheduled-backup] reconciling published snapshot after finalization failed: category={}",
                classify_error(&error)
            );
            reconcile_published_run(app, pool, config, &run.run_key, now_ms).await?;
        }
    }
    Ok(())
}

#[derive(Debug)]
enum RunExecutionFailure {
    BeforePublication(String),
    OwnedRemoteValidation(String),
    AfterPublication(String),
}

async fn reconcile_published_run(
    app: &AppHandle,
    pool: &Pool<Sqlite>,
    config: &ScheduledBackupConfig,
    run_key: &str,
    now_ms: i64,
) -> Result<(), String> {
    let current = repository::load_run(pool, run_key)
        .await?
        .ok_or_else(|| "published scheduled backup run disappeared".to_string())?;
    if current.status == "running" {
        reconcile_running_run(app, pool, config, &current, now_ms).await?;
    }
    let reconciled = repository::load_run(pool, run_key)
        .await?
        .ok_or_else(|| "reconciled scheduled backup run disappeared".to_string())?;
    if reconciled.status == "succeeded" {
        finish_success_maintenance(app, pool, config, run_key, now_ms).await;
    }
    Ok(())
}

async fn load_or_create_config(
    app: &AppHandle,
    pool: &Pool<Sqlite>,
) -> Result<ScheduledBackupConfig, String> {
    if let Some(config) = repository::load_config(pool).await? {
        return Ok(config);
    }
    let target = default_local_target_dir(app)?;
    let now = Local::now();
    let config = ScheduledBackupConfig {
        enabled: false,
        cadence: ScheduledBackupCadence::Weekly,
        weekday: Some(5),
        local_time_minutes: DEFAULT_LOCAL_TIME_MINUTES,
        target: ScheduledBackupTarget::Local { target_dir: target },
        target_generation: new_generation(),
        schedule_anchor_at_ms: now.timestamp_millis(),
        updated_at_ms: now.timestamp_millis(),
    };
    repository::save_config(pool, &config).await?;
    Ok(config)
}

fn default_local_target_dir(app: &AppHandle) -> Result<String, String> {
    let paths = crate::platform::storage_paths::resolve_storage_paths(app)?;
    Ok(
        normalize_target_directory(&paths.backup_dir.to_string_lossy())?
            .to_string_lossy()
            .to_string(),
    )
}

async fn snapshot_from_config(
    pool: &Pool<Sqlite>,
    config: ScheduledBackupConfig,
    default_local_target_dir: String,
) -> Result<ScheduledBackupSnapshot, String> {
    let next_execution_at_ms = next_slot_after(Local::now().naive_local(), &config)
        .and_then(|slot| local_datetime_ms(slot.local_datetime()));
    let recent_success =
        repository::load_recent_by_status(pool, &config.target_generation, "succeeded").await?;
    let recent_failure =
        repository::load_recent_by_status(pool, &config.target_generation, "failed").await?;
    Ok(ScheduledBackupSnapshot {
        config,
        default_local_target_dir,
        next_execution_at_ms,
        recent_success,
        recent_failure,
        active_run: repository::load_active(pool).await?,
    })
}

fn new_run(
    config: &ScheduledBackupConfig,
    slot: LogicalBackupSlot,
    now_ms: i64,
) -> ScheduledBackupRun {
    let (target_kind, target_path) = match &config.target {
        ScheduledBackupTarget::Local { target_dir } => {
            let first_path = candidate_paths(&PathBuf::from(target_dir), slot)
                .into_iter()
                .find(|path| !path.exists())
                .unwrap_or_else(|| PathBuf::from(target_dir).join("scheduled-backup-conflict.zip"));
            (
                "local".to_string(),
                first_path.to_string_lossy().to_string(),
            )
        }
        ScheduledBackupTarget::WebDav { .. } => {
            ("webdav".to_string(), "pending://webdav".to_string())
        }
    };
    ScheduledBackupRun {
        run_key: slot.run_key(&config.target_generation),
        target_generation: config.target_generation.clone(),
        target_kind,
        logical_date: slot.date_key(),
        logical_time_minutes: slot.local_time_minutes,
        target_path,
        staging_path: None,
        phase: "claimed".to_string(),
        remote_etag: None,
        status: "running".to_string(),
        file_state: "absent".to_string(),
        attempt_count: 1,
        retry_at_ms: None,
        started_at_ms: now_ms,
        completed_at_ms: None,
        archive_sha256: None,
        size_bytes: None,
        error_code: None,
        error_message: None,
        cleanup_warning: None,
        updated_at_ms: now_ms,
    }
}

fn slot_from_run(run: &ScheduledBackupRun) -> Result<LogicalBackupSlot, String> {
    Ok(LogicalBackupSlot {
        date: NaiveDate::parse_from_str(&run.logical_date, "%Y-%m-%d")
            .map_err(|_| "scheduled backup run has an invalid logical date".to_string())?,
        local_time_minutes: run.logical_time_minutes,
    })
}

fn local_datetime_ms(mut value: NaiveDateTime) -> Option<i64> {
    for _ in 0..=180 {
        match Local.from_local_datetime(&value) {
            LocalResult::Single(value) => return Some(value.timestamp_millis()),
            LocalResult::Ambiguous(first, _) => return Some(first.timestamp_millis()),
            LocalResult::None => value += chrono::Duration::minutes(1),
        }
    }
    None
}

pub(crate) fn classify_error(error: &str) -> &'static str {
    let lower = error.to_ascii_lowercase();
    if lower.contains("configuration_changed") {
        "configuration_changed"
    } else if lower.contains("webdav_not_configured")
        || lower.contains("invalid webdav")
        || lower.contains("webdav remote directory contains")
    {
        "webdav_not_configured"
    } else if lower.contains("credential_missing") || lower.contains("password is missing") {
        "credential_missing"
    } else if lower.contains("http 401") || lower.contains("http 403") {
        "authentication_failed"
    } else if lower.contains("remote_name_conflict") {
        "remote_name_conflict"
    } else if lower.contains("remote_index_conflict") {
        "remote_index_conflict"
    } else if lower.contains("exceeds") && lower.contains("limit") {
        "backup_too_large"
    } else if lower.contains("remote_validation_failed")
        || lower.contains("integrity")
        || lower.contains("checksum")
        || lower.contains("restorable")
    {
        "validation_failed"
    } else if lower.contains("webdav") || lower.contains("remote") || lower.contains("http") {
        "remote_target_unavailable"
    } else if lower.contains("file name") || lower.contains("already in use") {
        "target_conflict"
    } else if lower.contains("directory") || lower.contains("path") {
        "target_unavailable"
    } else {
        "backup_failed"
    }
}

fn is_retryable_error(error_code: &str) -> bool {
    matches!(
        error_code,
        "remote_target_unavailable" | "target_unavailable" | "backup_failed"
    )
}

async fn record_execution_failure(
    pool: &Pool<Sqlite>,
    run: &ScheduledBackupRun,
    error: &str,
    now_ms: i64,
) -> Result<(), String> {
    let error_code = classify_error(error);
    let message = if run.target_kind == "webdav" {
        format!("scheduled WebDAV backup failed: {error_code}")
    } else {
        safe_error_message(error)
    };
    if run.target_kind != "webdav" || is_retryable_error(error_code) {
        repository::mark_failed_or_retry(
            pool,
            &run.run_key,
            run.attempt_count,
            error_code,
            &message,
            now_ms,
        )
        .await
    } else {
        repository::mark_failed(pool, &run.run_key, error_code, &message, now_ms).await
    }
}

async fn cleanup_owned_webdav_failure(
    app: &AppHandle,
    pool: &Pool<Sqlite>,
    config: &ScheduledBackupConfig,
    run_key: &str,
) {
    let ScheduledBackupTarget::WebDav { target_identity } = &config.target else {
        return;
    };
    let Ok(Some(run)) = repository::load_run(pool, run_key).await else {
        return;
    };
    let Ok(target) =
        remote_backup::load_scheduled_webdav_target(app_paths::app_profile(app), pool).await
    else {
        return;
    };
    if remote_backup::scheduled_target_identity(&target) != *target_identity {
        return;
    }
    if let Err(cleanup_error) =
        remote_backup::discard_failed_scheduled_snapshot(&target, &run).await
    {
        eprintln!(
            "[scheduled-backup] failed to discard an invalid remote object: category={}",
            classify_error(&cleanup_error)
        );
    }
    if let Some(staging) = run.staging_path.as_deref() {
        if let Err(cleanup_error) = remote_backup::cleanup_scheduled_temp(app, Path::new(staging)) {
            eprintln!(
                "[scheduled-backup] failed to discard invalid staging data: category={}",
                classify_error(&cleanup_error)
            );
        }
    }
}

fn new_generation() -> String {
    Uuid::new_v4().simple().to_string()
}

fn now_ms() -> i64 {
    crate::platform::clock::unix_timestamp_millis_i64()
}

pub fn normalize_target_directory(path: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(path.trim());
    if !path.is_absolute() {
        return Err("scheduled backup directory must be an absolute path".to_string());
    }
    fs::create_dir_all(&path)
        .map_err(|error| format!("failed to create scheduled backup directory: {error}"))?;
    path.canonicalize()
        .map_err(|error| format!("failed to access scheduled backup directory: {error}"))
}

pub fn candidate_paths(target_dir: &Path, slot: LogicalBackupSlot) -> Vec<PathBuf> {
    let stem = format!("Patina-scheduled-backup-{}", slot.compact_timestamp());
    (1..=MAX_NAME_CANDIDATES)
        .map(|index| {
            if index == 1 {
                target_dir.join(format!("{stem}.zip"))
            } else {
                target_dir.join(format!("{stem}-{index:02}.zip"))
            }
        })
        .collect()
}

async fn execute_run(
    app: &AppHandle,
    pool: &Pool<Sqlite>,
    config: &ScheduledBackupConfig,
    run: &ScheduledBackupRun,
    slot: LogicalBackupSlot,
    now_ms: i64,
) -> Result<ScheduledBackupRun, RunExecutionFailure> {
    match (&config.target, run.target_kind.as_str()) {
        (ScheduledBackupTarget::Local { target_dir }, "local") => {
            execute_local_run(app, pool, config, run, slot, now_ms, target_dir).await
        }
        (ScheduledBackupTarget::WebDav { .. }, "webdav") => {
            execute_webdav_run(app, pool, config, run, now_ms).await
        }
        _ => Err(RunExecutionFailure::BeforePublication(
            "configuration_changed".to_string(),
        )),
    }
}

async fn execute_local_run(
    app: &AppHandle,
    pool: &Pool<Sqlite>,
    config: &ScheduledBackupConfig,
    run: &ScheduledBackupRun,
    slot: LogicalBackupSlot,
    now_ms: i64,
    target_dir: &str,
) -> Result<ScheduledBackupRun, RunExecutionFailure> {
    let target_dir =
        normalize_target_directory(target_dir).map_err(RunExecutionFailure::BeforePublication)?;
    let candidates = candidate_paths(&target_dir, slot);
    let mut last_collision = false;
    for candidate in candidates {
        if candidate.exists() {
            last_collision = true;
            continue;
        }
        let target = candidate.to_string_lossy().to_string();
        repository::update_target_path(pool, &run.run_key, &target, now_ms)
            .await
            .map_err(RunExecutionFailure::BeforePublication)?;
        match backup::export_scheduled_backup_create_new(app, &candidate).await {
            Ok(()) => {
                let (hash, size) = backup::validate_scheduled_snapshot(&candidate)
                    .await
                    .map_err(RunExecutionFailure::AfterPublication)?;
                repository::mark_succeeded(pool, &run.run_key, &hash, size, now_ms)
                    .await
                    .map_err(RunExecutionFailure::AfterPublication)?;
                finish_success_maintenance(app, pool, config, &run.run_key, now_ms).await;
                return repository::load_run(pool, &run.run_key)
                    .await
                    .map_err(RunExecutionFailure::AfterPublication)?
                    .ok_or_else(|| "scheduled backup run disappeared after success".to_string())
                    .map_err(RunExecutionFailure::AfterPublication);
            }
            Err(error) if error == "all scheduled backup file names are already in use" => {
                last_collision = true;
                continue;
            }
            Err(error) => return Err(RunExecutionFailure::BeforePublication(error)),
        }
    }
    if last_collision {
        Err(RunExecutionFailure::BeforePublication(
            "scheduled backup could not allocate a new file name without overwriting an existing file"
                .to_string(),
        ))
    } else {
        Err(RunExecutionFailure::BeforePublication(
            "scheduled backup could not allocate a target file".to_string(),
        ))
    }
}

async fn execute_webdav_run(
    app: &AppHandle,
    pool: &Pool<Sqlite>,
    config: &ScheduledBackupConfig,
    run: &ScheduledBackupRun,
    now_ms: i64,
) -> Result<ScheduledBackupRun, RunExecutionFailure> {
    let _transfer_guard = remote_backup::lock_remote_transfer().await;
    let target = remote_backup::load_scheduled_webdav_target(app_paths::app_profile(app), pool)
        .await
        .map_err(RunExecutionFailure::BeforePublication)?;
    let expected_identity = match &config.target {
        ScheduledBackupTarget::WebDav { target_identity } => target_identity,
        _ => {
            return Err(RunExecutionFailure::BeforePublication(
                "configuration_changed".to_string(),
            ))
        }
    };
    if remote_backup::scheduled_target_identity(&target) != *expected_identity {
        return Err(RunExecutionFailure::BeforePublication(
            "configuration_changed".to_string(),
        ));
    }

    let mut current = repository::load_run(pool, &run.run_key)
        .await
        .map_err(RunExecutionFailure::BeforePublication)?
        .ok_or_else(|| "scheduled WebDAV run disappeared".to_string())
        .map_err(RunExecutionFailure::BeforePublication)?;
    let mut created_remote_in_this_execution = false;

    loop {
        match current.phase.as_str() {
            "claimed" => {
                let (default_staging, _) = remote_backup::scheduled_temp_paths(app, &current)
                    .map_err(RunExecutionFailure::BeforePublication)?;
                let staging = current
                    .staging_path
                    .as_deref()
                    .map(PathBuf::from)
                    .unwrap_or(default_staging);
                if !staging.is_file() {
                    backup::export_scheduled_backup_create_new(app, &staging)
                        .await
                        .map_err(RunExecutionFailure::BeforePublication)?;
                }
                let (hash, size) = backup::validate_scheduled_snapshot(&staging)
                    .await
                    .map_err(RunExecutionFailure::BeforePublication)?;
                repository::mark_staged(
                    pool,
                    &current.run_key,
                    &staging.to_string_lossy(),
                    &hash,
                    size,
                    now_ms,
                )
                .await
                .map_err(RunExecutionFailure::BeforePublication)?;
            }
            "staged" => {
                let staging = PathBuf::from(current.staging_path.as_deref().ok_or_else(|| {
                    RunExecutionFailure::BeforePublication(
                        "scheduled WebDAV backup lost its staging path".to_string(),
                    )
                })?);
                let (hash, size) = backup::validate_scheduled_snapshot(&staging)
                    .await
                    .map_err(RunExecutionFailure::BeforePublication)?;
                if current.archive_sha256.as_deref() != Some(hash.as_str())
                    || current.size_bytes != Some(size)
                {
                    return Err(RunExecutionFailure::BeforePublication(
                        "staged scheduled backup no longer matches its recorded checksum"
                            .to_string(),
                    ));
                }
                let upload = if current.target_path == "pending://webdav" {
                    let mut selected = None;
                    for remote_path in
                        remote_backup::scheduled_remote_backup_paths(&target, &current)
                    {
                        repository::update_target_path(
                            pool,
                            &current.run_key,
                            &remote_path,
                            now_ms,
                        )
                        .await
                        .map_err(RunExecutionFailure::BeforePublication)?;
                        match remote_backup::upload_scheduled_snapshot(
                            &target,
                            &staging,
                            &remote_path,
                            size,
                            false,
                        )
                        .await
                        {
                            Ok(upload) => {
                                selected = Some(upload);
                                break;
                            }
                            Err(error) if error == "remote_name_conflict" => continue,
                            Err(error) => {
                                return Err(RunExecutionFailure::BeforePublication(error));
                            }
                        }
                    }
                    selected.ok_or_else(|| {
                        RunExecutionFailure::BeforePublication(
                            "scheduled WebDAV backup could not allocate a unique filename after 99 attempts"
                                .to_string(),
                        )
                    })?
                } else {
                    remote_backup::upload_scheduled_snapshot(
                        &target,
                        &staging,
                        &current.target_path,
                        size,
                        true,
                    )
                    .await
                    .map_err(RunExecutionFailure::BeforePublication)?
                };
                created_remote_in_this_execution = upload.created_new;
                repository::mark_uploaded(pool, &current.run_key, upload.etag.as_deref(), now_ms)
                    .await
                    .map_err(RunExecutionFailure::BeforePublication)?;
            }
            "uploaded" => {
                let (_, verification) = remote_backup::scheduled_temp_paths(app, &current)
                    .map_err(RunExecutionFailure::BeforePublication)?;
                if let Err(error) = remote_backup::verify_scheduled_snapshot(
                    &target,
                    &current.target_path,
                    &verification,
                    current.archive_sha256.as_deref().ok_or_else(|| {
                        RunExecutionFailure::BeforePublication(
                            "scheduled WebDAV backup has no recorded checksum".to_string(),
                        )
                    })?,
                    current.size_bytes.ok_or_else(|| {
                        RunExecutionFailure::BeforePublication(
                            "scheduled WebDAV backup has no recorded size".to_string(),
                        )
                    })?,
                )
                .await
                {
                    return Err(if created_remote_in_this_execution {
                        RunExecutionFailure::OwnedRemoteValidation(error)
                    } else {
                        RunExecutionFailure::BeforePublication(error)
                    });
                }
                repository::mark_remote_verified(pool, &current.run_key, now_ms)
                    .await
                    .map_err(RunExecutionFailure::BeforePublication)?;
            }
            "remote_verified" => {
                let staging = PathBuf::from(current.staging_path.as_deref().ok_or_else(|| {
                    RunExecutionFailure::BeforePublication(
                        "scheduled WebDAV backup lost its staging path".to_string(),
                    )
                })?);
                if !staging.is_file() {
                    target
                        .client
                        .download_file(&current.target_path, &staging)
                        .await
                        .map_err(RunExecutionFailure::BeforePublication)?;
                }
                let (hash, size) = backup::validate_scheduled_snapshot(&staging)
                    .await
                    .map_err(RunExecutionFailure::BeforePublication)?;
                if current.archive_sha256.as_deref() != Some(hash.as_str())
                    || current.size_bytes != Some(size)
                {
                    return Err(RunExecutionFailure::BeforePublication(
                        "remote_validation_failed".to_string(),
                    ));
                }
                remote_backup::publish_scheduled_snapshot(&target, &current, &staging)
                    .await
                    .map_err(RunExecutionFailure::BeforePublication)?;
                repository::mark_indexed(pool, &current.run_key, now_ms)
                    .await
                    .map_err(RunExecutionFailure::BeforePublication)?;
            }
            "indexed" => {
                repository::mark_succeeded(
                    pool,
                    &current.run_key,
                    current.archive_sha256.as_deref().ok_or_else(|| {
                        RunExecutionFailure::BeforePublication(
                            "scheduled WebDAV backup has no recorded checksum".to_string(),
                        )
                    })?,
                    current.size_bytes.ok_or_else(|| {
                        RunExecutionFailure::BeforePublication(
                            "scheduled WebDAV backup has no recorded size".to_string(),
                        )
                    })?,
                    now_ms,
                )
                .await
                .map_err(RunExecutionFailure::BeforePublication)?;
                if let Some(staging) = current.staging_path.as_deref() {
                    let _ = remote_backup::cleanup_scheduled_temp(app, Path::new(staging));
                }
                finish_success_maintenance(app, pool, config, &current.run_key, now_ms).await;
            }
            "succeeded" => return Ok(current),
            _ => {
                return Err(RunExecutionFailure::BeforePublication(
                    "scheduled WebDAV backup has an invalid persisted phase".to_string(),
                ))
            }
        }
        current = repository::load_run(pool, &run.run_key)
            .await
            .map_err(RunExecutionFailure::BeforePublication)?
            .ok_or_else(|| "scheduled WebDAV run disappeared".to_string())
            .map_err(RunExecutionFailure::BeforePublication)?;
    }
}

async fn finish_success_maintenance(
    app: &AppHandle,
    pool: &Pool<Sqlite>,
    config: &ScheduledBackupConfig,
    run_key: &str,
    now_ms: i64,
) {
    if apply_retention(app_paths::app_profile(app), pool, config, run_key, now_ms)
        .await
        .is_err()
    {
        if let Err(record_error) =
            repository::set_cleanup_warning(pool, run_key, Some("cleanup_pending"), now_ms).await
        {
            eprintln!(
                "[scheduled-backup] failed to record cleanup warning after successful backup: {record_error}"
            );
        }
    }
    if let Err(error) = repository::compact_terminal_history(pool).await {
        eprintln!("[scheduled-backup] failed to compact terminal history: {error}");
    }
}

pub async fn reconcile_running_run(
    app: &AppHandle,
    pool: &Pool<Sqlite>,
    config: &ScheduledBackupConfig,
    run: &ScheduledBackupRun,
    now_ms: i64,
) -> Result<(), String> {
    if run.target_kind == "webdav" {
        return match execute_webdav_run(app, pool, config, run, now_ms).await {
            Ok(_) => Ok(()),
            Err(RunExecutionFailure::OwnedRemoteValidation(error)) => {
                cleanup_owned_webdav_failure(app, pool, config, &run.run_key).await;
                record_execution_failure(pool, run, &error, now_ms).await
            }
            Err(
                RunExecutionFailure::BeforePublication(error)
                | RunExecutionFailure::AfterPublication(error),
            ) => record_execution_failure(pool, run, &error, now_ms).await,
        };
    }
    let path = PathBuf::from(&run.target_path);
    if path.is_file() {
        match backup::validate_scheduled_snapshot(&path).await {
            Ok((hash, size)) => {
                repository::mark_recovered_success(pool, &run.run_key, &hash, size, now_ms).await
            }
            Err(error) => {
                repository::mark_validation_conflict(
                    pool,
                    &run.run_key,
                    run.attempt_count,
                    &safe_error_message(&error),
                    now_ms,
                )
                .await
            }
        }
    } else {
        repository::mark_interrupted_for_retry(pool, &run.run_key, run.attempt_count, now_ms).await
    }
}

pub async fn apply_retention(
    profile: AppProfile,
    pool: &Pool<Sqlite>,
    config: &ScheduledBackupConfig,
    newest_run_key: &str,
    now_ms: i64,
) -> Result<(), String> {
    match &config.target {
        ScheduledBackupTarget::Local { target_dir } => {
            apply_local_retention(pool, config, target_dir, newest_run_key, now_ms).await
        }
        ScheduledBackupTarget::WebDav { target_identity } => {
            apply_webdav_retention(
                profile,
                pool,
                config,
                target_identity,
                newest_run_key,
                now_ms,
            )
            .await
        }
    }
}

async fn apply_local_retention(
    pool: &Pool<Sqlite>,
    config: &ScheduledBackupConfig,
    target_dir: &str,
    newest_run_key: &str,
    now_ms: i64,
) -> Result<(), String> {
    let target_dir = normalize_target_directory(target_dir)?;
    let candidates = repository::list_retention_candidates(pool, &config.target_generation).await?;
    let mut warnings = Vec::new();
    for candidate in candidates
        .into_iter()
        .skip(usize::from(SCHEDULED_BACKUP_KEEP_COUNT))
    {
        match prune_owned_candidate(&target_dir, &config.target_generation, &candidate).await {
            Ok(PruneOutcome::Pruned) => {
                repository::mark_pruned(pool, &candidate.run_key, now_ms).await?;
            }
            Ok(PruneOutcome::Missing) => {
                warnings.push(
                    "An older scheduled backup was already missing; no unrelated files were touched."
                        .to_string(),
                );
                repository::mark_missing(
                    pool,
                    &candidate.run_key,
                    "An older scheduled backup was already missing; no unrelated files were touched.",
                    now_ms,
                )
                .await?;
            }
            Err(error) => warnings.push(error),
        }
    }
    let warning = (!warnings.is_empty()).then(|| warnings.join(" "));
    repository::set_cleanup_warning(pool, newest_run_key, warning.as_deref(), now_ms).await
}

async fn apply_webdav_retention(
    profile: AppProfile,
    pool: &Pool<Sqlite>,
    config: &ScheduledBackupConfig,
    target_identity: &str,
    newest_run_key: &str,
    now_ms: i64,
) -> Result<(), String> {
    let target = remote_backup::load_scheduled_webdav_target(profile, pool).await?;
    if remote_backup::scheduled_target_identity(&target) != target_identity {
        return Err("configuration_changed".to_string());
    }
    let candidates = repository::list_retention_candidates(pool, &config.target_generation).await?;
    let mut cleanup_pending = false;
    for candidate in candidates
        .into_iter()
        .filter(|candidate| candidate.target_kind == "webdav")
        .skip(usize::from(SCHEDULED_BACKUP_KEEP_COUNT))
    {
        match remote_backup::prune_scheduled_snapshot(&target, &candidate).await {
            Ok(ScheduledRemotePruneOutcome::Pruned) => {
                repository::mark_pruned(pool, &candidate.run_key, now_ms).await?;
            }
            Ok(ScheduledRemotePruneOutcome::Missing) => {
                repository::mark_missing(
                    pool,
                    &candidate.run_key,
                    "An older automatic WebDAV backup was already missing; no unrelated objects were touched.",
                    now_ms,
                )
                .await?;
                cleanup_pending = true;
            }
            Ok(ScheduledRemotePruneOutcome::Conflict) | Err(_) => cleanup_pending = true,
        }
    }
    let warning = cleanup_pending.then_some("cleanup_pending");
    repository::set_cleanup_warning(pool, newest_run_key, warning, now_ms).await
}

enum PruneOutcome {
    Pruned,
    Missing,
}

async fn prune_owned_candidate(
    target_dir: &Path,
    generation: &str,
    run: &ScheduledBackupRun,
) -> Result<PruneOutcome, String> {
    if run.target_generation != generation
        || run.status != "succeeded"
        || run.file_state != "present"
    {
        return Err(
            "Skipped cleanup because an old backup no longer has valid ownership metadata."
                .to_string(),
        );
    }
    let path = PathBuf::from(&run.target_path);
    if path.parent() != Some(target_dir)
        || path.extension().and_then(|value| value.to_str()) != Some("zip")
    {
        return Err(
            "Skipped cleanup because an old backup path is outside the current target directory."
                .to_string(),
        );
    }
    if !path.exists() {
        return Ok(PruneOutcome::Missing);
    }
    let prune_file = open_candidate_for_prune(&path)?;
    let expected_hash = run.archive_sha256.as_deref().ok_or_else(|| {
        "Skipped cleanup because an old backup has no recorded checksum.".to_string()
    })?;
    let (actual_hash, actual_size) = backup::validate_scheduled_snapshot(&path)
        .await
        .map_err(|_| "Skipped cleanup because an old backup could not be verified.".to_string())?;
    if actual_hash != expected_hash || run.size_bytes != Some(actual_size) {
        return Err(
            "Skipped cleanup because an old backup no longer matches its recorded checksum."
                .to_string(),
        );
    }
    delete_verified_candidate(prune_file, &path)?;
    Ok(PruneOutcome::Pruned)
}

#[cfg(target_os = "windows")]
fn open_candidate_for_prune(path: &Path) -> Result<std::fs::File, String> {
    use std::os::windows::fs::{MetadataExt, OpenOptionsExt};
    use windows::Win32::Foundation::GENERIC_READ;
    use windows::Win32::Storage::FileSystem::{
        DELETE, FILE_ATTRIBUTE_REPARSE_POINT, FILE_FLAG_OPEN_REPARSE_POINT, FILE_SHARE_READ,
    };

    let file = std::fs::OpenOptions::new()
        .access_mode(GENERIC_READ.0 | DELETE.0)
        .share_mode(FILE_SHARE_READ.0)
        .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT.0)
        .open(path)
        .map_err(|_| {
            "Skipped cleanup because an old backup is in use or cannot be locked safely."
                .to_string()
        })?;
    let metadata = file.metadata().map_err(|_| {
        "Skipped cleanup because an old backup identity could not be verified.".to_string()
    })?;
    if !metadata.is_file() || metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT.0 != 0 {
        return Err("Skipped cleanup because an old backup is not a regular file.".to_string());
    }
    Ok(file)
}

#[cfg(target_os = "windows")]
fn delete_verified_candidate(file: std::fs::File, _path: &Path) -> Result<(), String> {
    use std::os::windows::io::AsRawHandle;
    use windows::Win32::Foundation::HANDLE;
    use windows::Win32::Storage::FileSystem::{
        FileDispositionInfo, SetFileInformationByHandle, FILE_DISPOSITION_INFO,
    };

    let disposition = FILE_DISPOSITION_INFO { DeleteFile: true };
    unsafe {
        SetFileInformationByHandle(
            HANDLE(file.as_raw_handle()),
            FileDispositionInfo,
            std::ptr::from_ref(&disposition).cast(),
            std::mem::size_of::<FILE_DISPOSITION_INFO>() as u32,
        )
    }
    .map_err(|_| {
        "Could not remove an old scheduled backup; the new backup remains valid.".to_string()
    })?;
    drop(file);
    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn open_candidate_for_prune(path: &Path) -> Result<std::fs::File, String> {
    let metadata = fs::symlink_metadata(path).map_err(|_| {
        "Skipped cleanup because an old backup identity could not be verified.".to_string()
    })?;
    if !metadata.file_type().is_file() || metadata.file_type().is_symlink() {
        return Err("Skipped cleanup because an old backup is not a regular file.".to_string());
    }
    std::fs::File::open(path).map_err(|_| {
        "Skipped cleanup because an old backup is in use or cannot be locked safely.".to_string()
    })
}

#[cfg(not(target_os = "windows"))]
fn delete_verified_candidate(file: std::fs::File, path: &Path) -> Result<(), String> {
    use std::os::unix::fs::MetadataExt;

    let opened = file.metadata().map_err(|_| {
        "Skipped cleanup because an old backup identity could not be verified.".to_string()
    })?;
    let current = fs::symlink_metadata(path).map_err(|_| {
        "Skipped cleanup because an old backup changed before deletion.".to_string()
    })?;
    if !current.file_type().is_file()
        || opened.dev() != current.dev()
        || opened.ino() != current.ino()
        || opened.len() != current.len()
        || opened.mtime() != current.mtime()
        || opened.mtime_nsec() != current.mtime_nsec()
    {
        return Err("Skipped cleanup because an old backup changed before deletion.".to_string());
    }
    drop(file);
    fs::remove_file(path).map_err(|_| {
        "Could not remove an old scheduled backup; the new backup remains valid.".to_string()
    })
}

pub fn safe_error_message(error: &str) -> String {
    const MAX_CHARS: usize = 240;
    let normalized = error.replace(['\r', '\n'], " ");
    normalized.chars().take(MAX_CHARS).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::NaiveDate;

    #[test]
    fn candidate_names_are_deterministic_and_never_reuse_the_base_name() {
        let slot = LogicalBackupSlot {
            date: NaiveDate::from_ymd_opt(2026, 8, 9).unwrap(),
            local_time_minutes: 125,
        };
        let paths = candidate_paths(Path::new("C:\\Backups"), slot);
        assert!(paths[0]
            .to_string_lossy()
            .ends_with("Patina-scheduled-backup-20260809-020500.zip"));
        assert!(paths[1]
            .to_string_lossy()
            .ends_with("Patina-scheduled-backup-20260809-020500-02.zip"));
        assert_eq!(paths.len(), 99);
    }

    #[test]
    fn user_visible_errors_are_single_line_and_bounded() {
        let error = format!("secret\n{}", "x".repeat(400));
        let safe = safe_error_message(&error);
        assert!(!safe.contains('\n'));
        assert_eq!(safe.chars().count(), 240);
    }

    #[test]
    fn target_generations_are_opaque_and_unique() {
        let first = new_generation();
        let second = new_generation();
        assert_eq!(first.len(), 32);
        assert_ne!(first, second);
        assert!(first.chars().all(|value| value.is_ascii_hexdigit()));
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn prune_guard_deletes_the_locked_file_identity() {
        let directory = std::env::temp_dir().join(format!(
            "patina-scheduled-prune-{}",
            Uuid::new_v4().simple()
        ));
        fs::create_dir_all(&directory).unwrap();
        let path = directory.join("owned.zip");
        fs::write(&path, b"owned").unwrap();

        let locked = open_candidate_for_prune(&path).unwrap();
        assert!(fs::remove_file(&path).is_err());
        delete_verified_candidate(locked, &path).unwrap();
        assert!(!path.exists());
        fs::remove_dir(&directory).unwrap();
    }
}
