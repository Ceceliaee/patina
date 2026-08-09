use crate::data::export::{self, ExportDataRequest};
use crate::data::repositories::scheduled_export as repository;
use crate::domain::export_schedule::{
    latest_due_slot, next_slot_after, period_for_slot, LogicalExportPeriod, LogicalExportSlot,
    ScheduledExportCadence, ScheduledExportConfig, ScheduledExportConfigInput,
    ScheduledExportFormat, ScheduledExportRun, ScheduledExportSnapshot,
    DEFAULT_EXPORT_LOCAL_TIME_MINUTES,
};
use crate::engine::export_scheduler::{decide_action, ExportSchedulerAction};
use chrono::{Local, LocalResult, NaiveDate, NaiveDateTime, TimeZone, Utc};
use parquet::arrow::arrow_reader::ParquetRecordBatchReaderBuilder;
use sha2::{Digest, Sha256};
use sqlx::sqlite::SqliteConnectOptions;
use sqlx::{Connection, Pool, Sqlite, SqliteConnection};
use std::fs::{self, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};
use uuid::Uuid;

pub async fn get_snapshot(app: &AppHandle) -> Result<ScheduledExportSnapshot, String> {
    let pool = crate::data::sqlite_pool::wait_for_sqlite_pool(app).await?;
    let config = load_or_create_config(app, &pool).await?;
    snapshot_from_config(&pool, config).await
}

pub async fn save_config(
    app: &AppHandle,
    mut input: ScheduledExportConfigInput,
) -> Result<ScheduledExportSnapshot, String> {
    input.validate_shape()?;
    input.selected_fields = validate_fields(&input.selected_fields)?;
    let target_dir = normalize_target_directory(&input.target_dir, true)?;
    input.target_dir = target_dir.to_string_lossy().to_string();

    let pool = crate::data::sqlite_pool::wait_for_sqlite_pool(app).await?;
    let current = load_or_create_config(app, &pool).await?;
    let now_ms = current_time_ms();
    let changed = current.materially_differs_from(&input);
    let cancel_active = changed || (current.enabled && !input.enabled);
    let next = ScheduledExportConfig {
        enabled: input.enabled,
        cadence: input.cadence,
        weekday: input.weekday,
        local_time_minutes: input.local_time_minutes,
        target_dir: input.target_dir,
        format: input.format,
        selected_fields: input.selected_fields,
        plan_generation: if changed {
            new_generation()
        } else {
            current.plan_generation
        },
        schedule_anchor_at_ms: if changed {
            now_ms
        } else {
            current.schedule_anchor_at_ms
        },
        updated_at_ms: now_ms,
    };
    repository::save_config_with_cancellation(
        &pool,
        &next,
        cancel_active.then_some((
            "configuration_changed",
            "The scheduled export configuration changed before this run completed.",
            now_ms,
        )),
    )
    .await?;
    snapshot_from_config(&pool, next).await
}

pub async fn tick(app: &AppHandle) -> Result<bool, String> {
    let pool = crate::data::sqlite_pool::wait_for_sqlite_pool(app).await?;
    let config = load_or_create_config(app, &pool).await?;
    if !config.enabled {
        return Ok(false);
    }
    let now = Local::now();
    let now_ms = now.timestamp_millis().max(0);
    let anchor_local = Local
        .timestamp_millis_opt(config.schedule_anchor_at_ms)
        .single()
        .unwrap_or(now)
        .naive_local();
    let active = repository::load_active(&pool).await?;
    let latest_slot = latest_due_slot(now.naive_local(), anchor_local, &config);
    let latest_recorded = if let Some(slot) = latest_slot {
        let period = period_for_slot(slot, config.cadence)
            .ok_or_else(|| "scheduled export period could not be calculated".to_string())?;
        let (start, end) = period_epoch_bounds(period)?;
        repository::load_period(&pool, &config.plan_generation, start, end)
            .await?
            .is_some()
    } else {
        false
    };

    match decide_action(
        now_ms,
        now.naive_local(),
        anchor_local,
        &config,
        active,
        latest_recorded,
    ) {
        ExportSchedulerAction::Idle => return Ok(false),
        ExportSchedulerAction::Reconcile(run) => {
            execute_or_record_failure(app, &pool, &config, run, now_ms).await?;
        }
        ExportSchedulerAction::Retry(run) => {
            if repository::start_retry(&pool, &run.run_key, now_ms).await? {
                let retry = repository::load_run(&pool, &run.run_key)
                    .await?
                    .ok_or_else(|| "scheduled export retry disappeared".to_string())?;
                execute_or_record_failure(app, &pool, &config, retry, now_ms).await?;
            }
        }
        ExportSchedulerAction::Supersede(run, latest_slot) => {
            cleanup_owned_staging(&run);
            repository::mark_superseded(&pool, &run.run_key, now_ms).await?;
            if let Some(slot) = latest_slot {
                claim_and_execute(app, &pool, &config, slot, now_ms).await?;
            }
        }
        ExportSchedulerAction::Claim(slot) => {
            claim_and_execute(app, &pool, &config, slot, now_ms).await?;
        }
    }
    Ok(true)
}

pub async fn reset_after_replace_restore(app: &AppHandle) -> Result<(), String> {
    let pool = crate::data::sqlite_pool::wait_for_sqlite_pool(app).await?;
    repository::reset_after_replace_restore(&pool, &new_generation(), current_time_ms()).await
}

async fn claim_and_execute(
    app: &AppHandle,
    pool: &Pool<Sqlite>,
    config: &ScheduledExportConfig,
    slot: LogicalExportSlot,
    now_ms: i64,
) -> Result<(), String> {
    let run = new_run(config, slot, now_ms)?;
    if repository::claim_run(pool, &run).await? {
        execute_or_record_failure(app, pool, config, run, now_ms).await?;
    }
    Ok(())
}

async fn execute_or_record_failure(
    app: &AppHandle,
    pool: &Pool<Sqlite>,
    config: &ScheduledExportConfig,
    run: ScheduledExportRun,
    now_ms: i64,
) -> Result<(), String> {
    if run.plan_generation != config.plan_generation || !config.enabled {
        repository::mark_failed_or_retry(
            pool,
            &run,
            "configuration_changed",
            "The scheduled export configuration changed before this run completed.",
            false,
            now_ms,
        )
        .await?;
        cleanup_owned_staging(&run);
        return Ok(());
    }
    if let Err(error) = execute_run(app, pool, &run, now_ms).await {
        let current = repository::load_run(pool, &run.run_key)
            .await?
            .unwrap_or(run);
        if current.status == "running" {
            let error_code = classify_error(&error);
            let retryable = is_retryable_error(error_code);
            repository::mark_failed_or_retry(
                pool,
                &current,
                error_code,
                &safe_error_message(error_code),
                retryable,
                current_time_ms(),
            )
            .await?;
            if !retryable {
                cleanup_owned_staging(&current);
            }
        }
    }
    Ok(())
}

async fn execute_run(
    app: &AppHandle,
    pool: &Pool<Sqlite>,
    run: &ScheduledExportRun,
    now_ms: i64,
) -> Result<(), String> {
    let mut current = repository::load_run(pool, &run.run_key)
        .await?
        .ok_or_else(|| "scheduled export run disappeared".to_string())?;
    loop {
        match current.phase.as_str() {
            "claimed" => {
                let staging = staging_path(&current)?;
                if path_entry_exists(&staging) {
                    remove_owned_staging_path(&current, &staging)?;
                }
                let row_count = export::export_data(
                    app,
                    ExportDataRequest {
                        format: current.format.as_str().to_string(),
                        output_path: staging.to_string_lossy().to_string(),
                        start_time: Some(current.period_start_ms),
                        end_time: Some(current.period_end_ms),
                        selected_fields: Some(current.selected_fields.clone()),
                    },
                )
                .await?;
                sync_file(staging.clone()).await?;
                repository::mark_written(
                    pool,
                    &current.run_key,
                    &staging.to_string_lossy(),
                    row_count,
                    now_ms,
                )
                .await?;
            }
            "written" => {
                let staging = staging_path(&current)?;
                if !is_regular_file(&staging) {
                    repository::restart_missing_staging(pool, &current.run_key, current_time_ms())
                        .await?;
                    current = repository::load_run(pool, &run.run_key)
                        .await?
                        .ok_or_else(|| "scheduled export run disappeared".to_string())?;
                    continue;
                }
                validate_export_file(
                    &staging,
                    current.format,
                    &current.selected_fields,
                    current.row_count.unwrap_or(0),
                )
                .await?;
                let (hash, size) = hash_file(staging.clone()).await?;
                repository::mark_validated(pool, &current.run_key, &hash, size, current_time_ms())
                    .await?;
            }
            "validated" => {
                let staging = staging_path(&current)?;
                let target = PathBuf::from(&current.target_path);
                if path_entry_exists(&target) {
                    if published_file_matches(&current, &target).await? {
                        repository::mark_recovered_success(
                            pool,
                            &current.run_key,
                            current_time_ms(),
                        )
                        .await?;
                        if path_entry_exists(&staging) {
                            remove_owned_staging_path(&current, &staging)?;
                        }
                    } else {
                        return Err("target_conflict".to_string());
                    }
                } else if !is_regular_file(&staging) {
                    repository::restart_missing_staging(pool, &current.run_key, current_time_ms())
                        .await?;
                } else {
                    publish_without_overwrite(&staging, &target)?;
                    repository::mark_published(pool, &current.run_key, current_time_ms()).await?;
                }
            }
            "published" => {
                let target = PathBuf::from(&current.target_path);
                if !path_entry_exists(&target) {
                    return Err("published_file_missing".to_string());
                }
                if !published_file_matches(&current, &target).await? {
                    return Err("target_conflict".to_string());
                }
                repository::mark_succeeded(pool, &current.run_key, current_time_ms()).await?;
            }
            "succeeded" => return Ok(()),
            _ => return Err("scheduled export has an invalid persisted phase".to_string()),
        }
        current = repository::load_run(pool, &run.run_key)
            .await?
            .ok_or_else(|| "scheduled export run disappeared".to_string())?;
    }
}

async fn load_or_create_config(
    app: &AppHandle,
    pool: &Pool<Sqlite>,
) -> Result<ScheduledExportConfig, String> {
    if let Some(config) = repository::load_config(pool).await? {
        let config = migrate_legacy_default_directory(app, pool, config).await?;
        validate_fields(&config.selected_fields)?;
        return Ok(config);
    }
    let default_dir = crate::platform::app_paths::product_roaming_data_dir(app)?.join("exports");
    fs::create_dir_all(&default_dir)
        .map_err(|error| format!("failed to create scheduled export directory: {error}"))?;
    let default_dir = normalize_target_directory(&default_dir.to_string_lossy(), true)?;
    let now_ms = current_time_ms();
    let config = ScheduledExportConfig {
        enabled: false,
        cadence: ScheduledExportCadence::Weekly,
        weekday: Some(1),
        local_time_minutes: DEFAULT_EXPORT_LOCAL_TIME_MINUTES,
        target_dir: default_dir.to_string_lossy().to_string(),
        format: ScheduledExportFormat::Csv,
        selected_fields: crate::data::export::common::DEFAULT_EXPORT_FIELDS
            .iter()
            .map(|field| (*field).to_string())
            .collect(),
        plan_generation: new_generation(),
        schedule_anchor_at_ms: now_ms,
        updated_at_ms: now_ms,
    };
    repository::save_config(pool, &config).await?;
    Ok(config)
}

async fn migrate_legacy_default_directory(
    app: &AppHandle,
    pool: &Pool<Sqlite>,
    mut config: ScheduledExportConfig,
) -> Result<ScheduledExportConfig, String> {
    let legacy_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("failed to resolve legacy scheduled export directory: {error}"))?
        .join("exports");
    if !matches_existing_directory(&config.target_dir, &legacy_dir) {
        return Ok(config);
    }

    let product_dir = crate::platform::app_paths::product_roaming_data_dir(app)?.join("exports");
    fs::create_dir_all(&product_dir)
        .map_err(|error| format!("failed to create scheduled export directory: {error}"))?;
    let product_dir = normalize_target_directory(&product_dir.to_string_lossy(), true)?;
    let now_ms = current_time_ms();
    config.target_dir = product_dir.to_string_lossy().to_string();
    config.plan_generation = new_generation();
    config.schedule_anchor_at_ms = now_ms;
    config.updated_at_ms = now_ms;
    repository::save_config_with_cancellation(
        pool,
        &config,
        Some((
            "configuration_changed",
            "The scheduled export default directory was corrected before this run completed.",
            now_ms,
        )),
    )
    .await?;
    Ok(config)
}

fn matches_existing_directory(configured: &str, expected: &Path) -> bool {
    let configured = fs::canonicalize(configured);
    let expected = fs::canonicalize(expected);
    matches!((configured, expected), (Ok(configured), Ok(expected)) if configured == expected)
}

async fn snapshot_from_config(
    pool: &Pool<Sqlite>,
    config: ScheduledExportConfig,
) -> Result<ScheduledExportSnapshot, String> {
    let next_execution_at_ms = next_slot_after(Local::now().naive_local(), &config)
        .and_then(|slot| local_datetime_ms(slot.local_datetime()));
    Ok(ScheduledExportSnapshot {
        recent_success: repository::load_recent_by_status(
            pool,
            &config.plan_generation,
            "succeeded",
        )
        .await?,
        recent_failure: repository::load_recent_by_status(pool, &config.plan_generation, "failed")
            .await?,
        active_run: repository::load_active(pool).await?,
        config,
        next_execution_at_ms,
    })
}

fn new_run(
    config: &ScheduledExportConfig,
    slot: LogicalExportSlot,
    now_ms: i64,
) -> Result<ScheduledExportRun, String> {
    let period = period_for_slot(slot, config.cadence)
        .ok_or_else(|| "scheduled export period could not be calculated".to_string())?;
    let (period_start_ms, period_end_ms) = period_epoch_bounds(period)?;
    let file_name = format!(
        "{}.{}",
        period.compact_file_stem(),
        config.format.extension()
    );
    let target_path = PathBuf::from(&config.target_dir).join(file_name);
    let staging_name = format!(
        ".patina-scheduled-export-{}.{}.part",
        Uuid::new_v4().simple(),
        config.format.extension()
    );
    let staging_path = PathBuf::from(&config.target_dir).join(staging_name);
    Ok(ScheduledExportRun {
        run_key: period.run_key(&config.plan_generation, config.cadence),
        plan_generation: config.plan_generation.clone(),
        cadence: config.cadence,
        logical_start_date: period.start_key(),
        logical_end_date: period.end_key(),
        period_start_ms,
        period_end_ms,
        format: config.format,
        selected_fields: config.selected_fields.clone(),
        target_path: target_path.to_string_lossy().to_string(),
        staging_path: Some(staging_path.to_string_lossy().to_string()),
        phase: "claimed".to_string(),
        status: "running".to_string(),
        file_state: "absent".to_string(),
        attempt_count: 1,
        retry_at_ms: None,
        row_count: None,
        size_bytes: None,
        sha256: None,
        error_code: None,
        error_message: None,
        started_at_ms: now_ms,
        completed_at_ms: None,
        updated_at_ms: now_ms,
    })
}

fn validate_fields(fields: &[String]) -> Result<Vec<String>, String> {
    let resolved = crate::data::export::common::resolve_export_fields(Some(fields))?;
    if resolved.len() != fields.len() {
        return Err("scheduled export fields must be unique".to_string());
    }
    Ok(resolved.into_iter().map(str::to_string).collect())
}

pub fn normalize_target_directory(path: &str, verify_writable: bool) -> Result<PathBuf, String> {
    let path = PathBuf::from(path.trim());
    if !path.is_absolute() {
        return Err("target_not_directory".to_string());
    }
    let canonical = path
        .canonicalize()
        .map_err(|_| "target_missing".to_string())?;
    if !canonical.is_dir() {
        return Err("target_not_directory".to_string());
    }
    if verify_writable {
        let probe = canonical.join(format!(
            ".patina-export-write-test-{}",
            Uuid::new_v4().simple()
        ));
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&probe)
            .map_err(|error| classify_io_error(&error).to_string())?;
        let write_result = file.write_all(b"patina").and_then(|_| file.sync_all());
        drop(file);
        let cleanup_result = fs::remove_file(&probe);
        if let Err(error) = write_result {
            return Err(classify_io_error(&error).to_string());
        }
        cleanup_result.map_err(|error| classify_io_error(&error).to_string())?;
    }
    Ok(canonical)
}

fn period_epoch_bounds(period: LogicalExportPeriod) -> Result<(i64, i64), String> {
    let start = local_date_start_ms(period.start_date)
        .ok_or_else(|| "scheduled export start boundary is invalid".to_string())?;
    let end = local_date_start_ms(period.end_date_exclusive)
        .ok_or_else(|| "scheduled export end boundary is invalid".to_string())?;
    if end <= start {
        return Err("scheduled export calendar boundaries are invalid".to_string());
    }
    Ok((start, end))
}

fn local_date_start_ms(date: NaiveDate) -> Option<i64> {
    local_datetime_ms(date.and_hms_opt(0, 0, 0)?)
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

fn staging_path(run: &ScheduledExportRun) -> Result<PathBuf, String> {
    run.staging_path
        .as_deref()
        .map(PathBuf::from)
        .ok_or_else(|| "scheduled export lost its staging path".to_string())
}

fn cleanup_owned_staging(run: &ScheduledExportRun) {
    if let Some(path) = run.staging_path.as_deref().map(PathBuf::from) {
        let _ = remove_owned_staging_path(run, &path);
    }
}

fn remove_owned_staging_path(run: &ScheduledExportRun, path: &Path) -> Result<(), String> {
    let expected_parent = Path::new(&run.target_path)
        .parent()
        .ok_or_else(|| "scheduled export target has no parent".to_string())?;
    let parent = path
        .parent()
        .ok_or_else(|| "scheduled export staging path has no parent".to_string())?;
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("");
    if parent != expected_parent || !name.starts_with(".patina-scheduled-export-") {
        return Err("scheduled export refused to remove an unowned staging file".to_string());
    }
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!(
            "failed to remove scheduled export staging file: {error}"
        )),
    }
}

async fn validate_export_file(
    path: &Path,
    format: ScheduledExportFormat,
    selected_fields: &[String],
    expected_rows: u64,
) -> Result<(), String> {
    if !is_regular_file(path) {
        return Err("format_validation_failed".to_string());
    }
    match format {
        ScheduledExportFormat::Sqlite => {
            validate_sqlite(path, selected_fields, expected_rows).await
        }
        _ => {
            let path = path.to_path_buf();
            let fields = selected_fields.to_vec();
            tauri::async_runtime::spawn_blocking(move || match format {
                ScheduledExportFormat::Csv => validate_csv(&path, &fields, expected_rows),
                ScheduledExportFormat::Markdown => validate_markdown(&path, &fields, expected_rows),
                ScheduledExportFormat::Parquet => validate_parquet(&path, &fields, expected_rows),
                ScheduledExportFormat::Sqlite => unreachable!(),
            })
            .await
            .map_err(|_| "format_validation_failed".to_string())?
        }
    }
}

fn validate_csv(path: &Path, fields: &[String], expected_rows: u64) -> Result<(), String> {
    let mut reader =
        csv::Reader::from_path(path).map_err(|_| "format_validation_failed".to_string())?;
    let headers = reader
        .headers()
        .map_err(|_| "format_validation_failed".to_string())?
        .iter()
        .map(str::to_string)
        .collect::<Vec<_>>();
    if headers != fields {
        return Err("format_validation_failed".to_string());
    }
    let mut rows = 0_u64;
    for record in reader.records() {
        record.map_err(|_| "format_validation_failed".to_string())?;
        rows = rows.saturating_add(1);
    }
    (rows == expected_rows)
        .then_some(())
        .ok_or_else(|| "format_validation_failed".to_string())
}

fn validate_markdown(path: &Path, fields: &[String], expected_rows: u64) -> Result<(), String> {
    let content = fs::read_to_string(path).map_err(|_| "format_validation_failed".to_string())?;
    if !content.starts_with("# ")
        || content
            .lines()
            .filter(|line| line.starts_with("- "))
            .count()
            < 4
    {
        return Err("format_validation_failed".to_string());
    }
    let day_groups = content
        .lines()
        .filter(|line| line.starts_with("## "))
        .count();
    let table_lines = content
        .lines()
        .filter(|line| line.starts_with("| ") && line.ends_with(" |"))
        .collect::<Vec<_>>();
    let structural_lines = day_groups.saturating_mul(2);
    if table_lines.len() < structural_lines
        || (expected_rows > 0 && day_groups == 0)
        || table_lines
            .iter()
            .any(|line| markdown_column_count(line) != Some(fields.len()))
    {
        return Err("format_validation_failed".to_string());
    }
    let rows = u64::try_from(table_lines.len() - structural_lines)
        .map_err(|_| "format_validation_failed".to_string())?;
    (rows == expected_rows)
        .then_some(())
        .ok_or_else(|| "format_validation_failed".to_string())
}

fn markdown_column_count(line: &str) -> Option<usize> {
    if !line.starts_with('|') || !line.ends_with('|') {
        return None;
    }
    let mut separators = 0_usize;
    let mut escaped = false;
    for character in line.chars() {
        if escaped {
            escaped = false;
        } else if character == '\\' {
            escaped = true;
        } else if character == '|' {
            separators = separators.saturating_add(1);
        }
    }
    separators.checked_sub(1)
}

fn validate_parquet(path: &Path, fields: &[String], expected_rows: u64) -> Result<(), String> {
    let file = fs::File::open(path).map_err(|_| "format_validation_failed".to_string())?;
    let builder = ParquetRecordBatchReaderBuilder::try_new(file)
        .map_err(|_| "format_validation_failed".to_string())?;
    let schema = builder.schema();
    let names = schema
        .fields()
        .iter()
        .map(|field| field.name().to_string())
        .collect::<Vec<_>>();
    let expected_schema = crate::data::export::parquet_exporter::resolved_parquet_schema(fields)
        .map_err(|_| "format_validation_failed".to_string())?;
    if names != fields || schema.as_ref() != &expected_schema {
        return Err("format_validation_failed".to_string());
    }
    let reader = builder
        .build()
        .map_err(|_| "format_validation_failed".to_string())?;
    let mut rows = 0_u64;
    for batch in reader {
        let batch = batch.map_err(|_| "format_validation_failed".to_string())?;
        rows = rows.saturating_add(
            u64::try_from(batch.num_rows()).map_err(|_| "format_validation_failed".to_string())?,
        );
    }
    if rows == expected_rows {
        Ok(())
    } else {
        Err("format_validation_failed".to_string())
    }
}

async fn validate_sqlite(
    path: &Path,
    selected_fields: &[String],
    expected_rows: u64,
) -> Result<(), String> {
    let options = SqliteConnectOptions::new().filename(path).read_only(true);
    let mut connection = SqliteConnection::connect_with(&options)
        .await
        .map_err(|_| "format_validation_failed".to_string())?;
    let integrity: String = sqlx::query_scalar("PRAGMA integrity_check")
        .fetch_one(&mut connection)
        .await
        .map_err(|_| "format_validation_failed".to_string())?;
    if integrity != "ok" {
        return Err("format_validation_failed".to_string());
    }
    let (session_fields, web_fields) =
        crate::data::export::sqlite_exporter::resolved_sqlite_column_names(selected_fields)
            .map_err(|_| "format_validation_failed".to_string())?;
    validate_sqlite_table_columns(&mut connection, "sessions", &session_fields).await?;
    validate_sqlite_table_columns(&mut connection, "web_activity_segments", &web_fields).await?;
    let session_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM sessions")
        .fetch_one(&mut connection)
        .await
        .map_err(|_| "format_validation_failed".to_string())?;
    let web_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM web_activity_segments")
        .fetch_one(&mut connection)
        .await
        .map_err(|_| "format_validation_failed".to_string())?;
    let rows = u64::try_from(session_count.saturating_add(web_count))
        .map_err(|_| "format_validation_failed".to_string())?;
    (rows == expected_rows)
        .then_some(())
        .ok_or_else(|| "format_validation_failed".to_string())
}

async fn validate_sqlite_table_columns(
    connection: &mut SqliteConnection,
    table: &str,
    expected_fields: &[String],
) -> Result<(), String> {
    let rows = sqlx::query(&format!("PRAGMA table_info({table})"))
        .fetch_all(&mut *connection)
        .await
        .map_err(|_| "format_validation_failed".to_string())?;
    let actual = rows
        .into_iter()
        .map(|row| sqlx::Row::get::<String, _>(&row, "name"))
        .collect::<Vec<_>>();
    let expected = std::iter::once("id".to_string())
        .chain(expected_fields.iter().cloned())
        .collect::<Vec<_>>();
    (actual == expected)
        .then_some(())
        .ok_or_else(|| "format_validation_failed".to_string())
}

async fn sync_file(path: PathBuf) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        fs::File::open(path)
            .and_then(|file| file.sync_all())
            .map_err(|error| format!("sync_failed: {error}"))
    })
    .await
    .map_err(|_| "sync_failed".to_string())?
}

async fn hash_file(path: PathBuf) -> Result<(String, u64), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut file = fs::File::open(path).map_err(|error| format!("hash_failed: {error}"))?;
        let mut hasher = Sha256::new();
        let mut buffer = [0_u8; 64 * 1024];
        let mut size = 0_u64;
        loop {
            let read = file
                .read(&mut buffer)
                .map_err(|error| format!("hash_failed: {error}"))?;
            if read == 0 {
                break;
            }
            hasher.update(&buffer[..read]);
            size = size.saturating_add(read as u64);
        }
        Ok((format!("{:x}", hasher.finalize()), size))
    })
    .await
    .map_err(|_| "hash_failed".to_string())?
}

async fn published_file_matches(run: &ScheduledExportRun, path: &Path) -> Result<bool, String> {
    if !is_regular_file(path) {
        return Ok(false);
    }
    let expected_hash = run
        .sha256
        .as_deref()
        .ok_or_else(|| "scheduled export has no recorded checksum".to_string())?;
    let expected_size = run
        .size_bytes
        .ok_or_else(|| "scheduled export has no recorded size".to_string())?;
    let (hash, size) = hash_file(path.to_path_buf()).await?;
    Ok(hash == expected_hash && size == expected_size)
}

#[cfg(target_os = "windows")]
fn publish_without_overwrite(staging: &Path, target: &Path) -> Result<(), String> {
    if path_entry_exists(target) {
        return Err("target_conflict".to_string());
    }
    fs::rename(staging, target).map_err(|error| {
        if path_entry_exists(target) {
            "target_conflict".to_string()
        } else {
            format!("publish_failed: {error}")
        }
    })
}

#[cfg(not(target_os = "windows"))]
fn publish_without_overwrite(staging: &Path, target: &Path) -> Result<(), String> {
    fs::hard_link(staging, target).map_err(|error| {
        if path_entry_exists(target) {
            "target_conflict".to_string()
        } else {
            format!("publish_failed: {error}")
        }
    })?;
    fs::remove_file(staging).map_err(|error| format!("publish_failed: {error}"))
}

fn path_entry_exists(path: &Path) -> bool {
    match fs::symlink_metadata(path) {
        Ok(_) => true,
        Err(error) => error.kind() != std::io::ErrorKind::NotFound,
    }
}

fn is_regular_file(path: &Path) -> bool {
    fs::symlink_metadata(path)
        .map(|metadata| metadata.file_type().is_file())
        .unwrap_or(false)
}

pub(crate) fn classify_error(error: &str) -> &'static str {
    let lower = error.to_ascii_lowercase();
    if lower.contains("configuration_changed") {
        "configuration_changed"
    } else if lower.contains("target_conflict") || lower.contains("already exists") {
        "target_conflict"
    } else if lower.contains("target_missing") || lower.contains("not found") {
        "target_missing"
    } else if lower.contains("target_not_directory") {
        "target_not_directory"
    } else if lower.contains("permission") || lower.contains("access is denied") {
        "permission_denied"
    } else if (lower.contains("disk") && lower.contains("full"))
        || lower.contains("not enough space")
        || lower.contains("no space left")
        || lower.contains("os error 112")
    {
        "disk_full"
    } else if lower.contains("database is locked") || lower.contains("database is busy") {
        "database_busy"
    } else if lower.contains("database") || lower.contains("sqlite pool") {
        "database_unavailable"
    } else if lower.contains("format_validation_failed") {
        "format_validation_failed"
    } else if lower.contains("publish_failed") || lower.contains("published_file_missing") {
        "publish_failed"
    } else if lower.contains("interrupted") {
        "interrupted"
    } else {
        "export_failed"
    }
}

fn classify_io_error(error: &std::io::Error) -> &'static str {
    match error.kind() {
        std::io::ErrorKind::NotFound => "target_missing",
        std::io::ErrorKind::PermissionDenied => "permission_denied",
        std::io::ErrorKind::AlreadyExists => "target_conflict",
        _ if error.raw_os_error() == Some(112) => "disk_full",
        _ => "target_unavailable",
    }
}

fn is_retryable_error(error_code: &str) -> bool {
    matches!(
        error_code,
        "database_busy" | "database_unavailable" | "disk_full" | "export_failed" | "interrupted"
    )
}

fn safe_error_message(error_code: &str) -> String {
    match error_code {
        "configuration_changed" => "The export plan changed before this run completed.",
        "target_conflict" => "A different file already uses this export name.",
        "target_missing" => "The export folder is no longer available.",
        "target_not_directory" => "The export destination is not a folder.",
        "permission_denied" => "Patina cannot write to the export folder.",
        "disk_full" => "The export destination does not have enough free space.",
        "database_busy" | "database_unavailable" => "Activity data is temporarily unavailable.",
        "format_validation_failed" => "The generated export did not pass validation.",
        "publish_failed" => "The validated export could not be published.",
        "interrupted" => "The export was interrupted and will be retried.",
        _ => "The scheduled export could not be completed.",
    }
    .to_string()
}

fn new_generation() -> String {
    Uuid::new_v4().simple().to_string()
}

fn current_time_ms() -> i64 {
    Utc::now().timestamp_millis().max(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(label: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "patina-scheduled-export-{label}-{}-{}",
            std::process::id(),
            Uuid::new_v4().simple()
        ));
        fs::create_dir_all(&path).unwrap();
        path
    }

    #[test]
    fn target_directory_must_exist_and_be_writable() {
        let dir = temp_dir("target");
        assert_eq!(
            normalize_target_directory(&dir.to_string_lossy(), true).unwrap(),
            dir.canonicalize().unwrap()
        );
        let missing = dir.join("missing");
        assert_eq!(
            normalize_target_directory(&missing.to_string_lossy(), true).unwrap_err(),
            "target_missing"
        );
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn legacy_default_directory_match_requires_the_same_existing_directory() {
        let legacy = temp_dir("legacy-default");
        let configured = legacy.to_string_lossy().to_string();
        assert!(matches_existing_directory(&configured, &legacy));

        let other = temp_dir("product-default");
        assert!(!matches_existing_directory(&configured, &other));
        assert!(!matches_existing_directory(
            &legacy.join("missing").to_string_lossy(),
            &legacy
        ));

        fs::remove_dir_all(legacy).unwrap();
        fs::remove_dir_all(other).unwrap();
    }

    #[test]
    fn publish_never_overwrites_an_existing_file() {
        let dir = temp_dir("publish");
        let staging = dir.join(".patina-scheduled-export-owned.csv.part");
        let target = dir.join("target.csv");
        fs::write(&staging, b"new").unwrap();
        fs::write(&target, b"original").unwrap();
        assert_eq!(
            publish_without_overwrite(&staging, &target).unwrap_err(),
            "target_conflict"
        );
        assert_eq!(fs::read(&target).unwrap(), b"original");
        fs::remove_file(&target).unwrap();
        fs::create_dir(&target).unwrap();
        assert_eq!(
            publish_without_overwrite(&staging, &target).unwrap_err(),
            "target_conflict"
        );
        assert!(target.is_dir());
        assert!(is_regular_file(&staging));
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn csv_validation_preserves_the_selected_field_order_and_zero_rows() {
        let dir = temp_dir("csv");
        let path = dir.join("empty.csv");
        fs::write(&path, b"url,record_type\n").unwrap();
        assert!(validate_csv(&path, &["url".to_string(), "record_type".to_string()], 0).is_ok());
        fs::write(&path, b"url,record_type\n\"unterminated,session\n").unwrap();
        assert!(validate_csv(&path, &["url".to_string(), "record_type".to_string()], 1,).is_err());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn markdown_validation_rejects_truncated_or_wrong_count_documents() {
        let dir = temp_dir("markdown");
        let path = dir.join("export.md");
        fs::write(
            &path,
            "# Patina Activity Records\n\n- Range: 2026-08-08\n- Exported: now\n- Records: 1\n- Total: 1m\n\n## 2026-08-08\n\n| Type |\n| --- |\n| session |\n",
        )
        .unwrap();
        let fields = vec!["record_type".to_string()];
        assert!(validate_markdown(&path, &fields, 1).is_ok());
        assert!(validate_markdown(&path, &fields, 2).is_err());
        assert!(validate_markdown(
            &path,
            &["record_type".to_string(), "app_name".to_string()],
            1,
        )
        .is_err());
        fs::write(
            &path,
            "# Patina Activity Records\n\n- Range: 2026-08-08\n- Exported: now\n- Records: 1\n- Total: 1m\n",
        )
        .unwrap();
        assert!(validate_markdown(&path, &fields, 1).is_err());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn error_messages_are_stable_and_do_not_echo_internal_details() {
        let code = classify_error("database is locked: SELECT secret FROM settings");
        assert_eq!(code, "database_busy");
        assert!(!safe_error_message(code).contains("SELECT"));
        assert_eq!(
            classify_error(
                "failed to write export: There is not enough space on the disk. (os error 112)"
            ),
            "disk_full"
        );
    }

    #[tokio::test]
    async fn sqlite_validation_rejects_selected_field_schema_drift() {
        let dir = temp_dir("sqlite-schema");
        let path = dir.join("export.sqlite");
        let options = SqliteConnectOptions::new()
            .filename(&path)
            .create_if_missing(true);
        let mut connection = SqliteConnection::connect_with(&options).await.unwrap();
        sqlx::query(
            "CREATE TABLE sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                record_type TEXT NOT NULL,
                app_name TEXT NOT NULL
             )",
        )
        .execute(&mut connection)
        .await
        .unwrap();
        sqlx::query(
            "CREATE TABLE web_activity_segments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                record_type TEXT NOT NULL
             )",
        )
        .execute(&mut connection)
        .await
        .unwrap();
        connection.close().await.unwrap();
        let fields = vec!["record_type".to_string(), "app_name".to_string()];
        assert!(validate_sqlite(&path, &fields, 0).await.is_ok());

        let mut connection = SqliteConnection::connect(&path.to_string_lossy())
            .await
            .unwrap();
        sqlx::query("ALTER TABLE sessions RENAME COLUMN app_name TO wrong_name")
            .execute(&mut connection)
            .await
            .unwrap();
        connection.close().await.unwrap();
        assert!(validate_sqlite(&path, &fields, 0).await.is_err());
        fs::remove_dir_all(dir).unwrap();
    }
}
