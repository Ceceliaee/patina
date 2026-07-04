use crate::data::schema;
use crate::platform::storage_paths;
use futures_util::future::BoxFuture;
use sqlx::error::BoxDynError;
use sqlx::migrate::{Migration as SqlxMigration, MigrationSource, MigrationType, Migrator};
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::{Pool, Row, Sqlite};
use std::fs::create_dir_all;
use std::future::Future;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager, Runtime};
use tauri_plugin_sql::{DbInstances, DbPool, MigrationKind};
use tokio::time::{sleep, Duration};

pub const SQLITE_DB_NAME: &str = "sqlite:patina.db";

#[derive(Debug)]
struct InlineMigrationList(Vec<tauri_plugin_sql::Migration>);

impl MigrationSource<'static> for InlineMigrationList {
    fn resolve(self) -> BoxFuture<'static, Result<Vec<SqlxMigration>, BoxDynError>> {
        Box::pin(async move {
            let mut migrations = Vec::new();
            for migration in self.0 {
                if matches!(migration.kind, MigrationKind::Up) {
                    migrations.push(SqlxMigration::new(
                        migration.version,
                        migration.description.into(),
                        MigrationType::ReversibleUp,
                        migration.sql.into(),
                        false,
                    ));
                }
            }
            Ok(migrations)
        })
    }
}

fn expected_migration_metadata() -> Vec<(i64, &'static str, Vec<u8>)> {
    schema::tracker_migrations()
        .into_iter()
        .map(|migration| {
            let sqlx_migration = SqlxMigration::new(
                migration.version,
                migration.description.into(),
                MigrationType::ReversibleUp,
                migration.sql.into(),
                false,
            );
            (
                migration.version,
                migration.description,
                sqlx_migration.checksum.into_owned(),
            )
        })
        .collect()
}

pub(crate) fn resolve_product_db_path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let paths = storage_paths::resolve_storage_paths(app)?;
    create_dir_all(&paths.data_root).map_err(|error| {
        format!(
            "failed to create app data dir `{}`: {error}",
            paths.data_root.display()
        )
    })?;
    Ok(paths.db_path)
}

pub(crate) async fn open_single_connection_sqlite_pool(
    db_path: &Path,
    create_if_missing: bool,
) -> Result<Pool<Sqlite>, String> {
    let connect_options = SqliteConnectOptions::new()
        .filename(db_path)
        .create_if_missing(create_if_missing)
        .pragma("busy_timeout", "5000")
        .pragma("foreign_keys", "ON");

    SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(connect_options)
        .await
        .map_err(|error| format!("failed to open sqlite db `{}`: {error}", db_path.display()))
}

pub fn is_recoverable_sqlite_error(error: &str) -> bool {
    let normalized = error.to_ascii_lowercase();
    normalized.contains("database is locked")
        || normalized.contains("database is busy")
        || normalized.contains("sqlite_busy")
        || normalized.contains("sqlite_locked")
        || normalized.contains("pool closed")
        || normalized.contains("pooltimedout")
}

pub async fn reopen_sqlite_pool<R: Runtime>(app: &AppHandle<R>) -> Result<Pool<Sqlite>, String> {
    let db_path = resolve_product_db_path(app)?;
    let next_pool = open_single_connection_sqlite_pool(&db_path, true).await?;

    register_sqlite_pool(app, next_pool.clone()).await?;

    Ok(next_pool)
}

pub async fn run_recoverable_sqlite_write<R, F, Fut>(
    app: &AppHandle<R>,
    context: &'static str,
    write: F,
) -> Result<(), String>
where
    R: Runtime,
    F: Fn(Pool<Sqlite>) -> Fut,
    Fut: Future<Output = Result<(), String>>,
{
    let pool = wait_for_sqlite_pool(app).await?;
    match write(pool).await {
        Ok(()) => Ok(()),
        Err(error) if is_recoverable_sqlite_error(&error) => {
            let reopened_pool = reopen_sqlite_pool(app).await?;
            write(reopened_pool)
                .await
                .map_err(|error| format!("{context}: {error}"))
        }
        Err(error) => Err(format!("{context}: {error}")),
    }
}

async fn register_sqlite_pool<R: Runtime>(
    app: &AppHandle<R>,
    next_pool: Pool<Sqlite>,
) -> Result<(), String> {
    let instances = app
        .try_state::<DbInstances>()
        .ok_or_else(|| "sqlite db instances state is not available".to_string())?;

    let previous_pool = {
        let mut instances = instances.0.write().await;
        match instances.insert(
            SQLITE_DB_NAME.to_string(),
            DbPool::Sqlite(next_pool.clone()),
        ) {
            Some(DbPool::Sqlite(pool)) => Some(pool),
            _ => None,
        }
    };

    if let Some(pool) = previous_pool {
        pool.close().await;
    }

    Ok(())
}

pub async fn initialize_app_sqlite<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let db_path = resolve_product_db_path(app)?;
    let pool = open_single_connection_sqlite_pool(&db_path, true).await?;

    prepare_pool_schema(&pool, &db_path).await?;

    register_sqlite_pool(app, pool).await?;

    Ok(())
}

pub(crate) async fn prepare_pool_schema(pool: &Pool<Sqlite>, db_path: &Path) -> Result<(), String> {
    if repair_legacy_schema_before_baseline_normalization(pool).await? {
        eprintln!("[sql] repaired legacy sqlite schema before baseline normalization");
    }

    if normalize_current_baseline_migration_history_for_pool(pool).await? {
        eprintln!("[sql] normalized sqlite migration history to the current baseline");
    }

    run_current_migrations(pool).await?;

    if normalize_current_baseline_migration_history_for_pool(pool).await? {
        eprintln!("[sql] normalized sqlite migration history to the current baseline");
    }

    if !has_current_baseline_schema(pool).await? {
        return Err(format!(
            "sqlite schema validation failed for `{}`",
            db_path.display()
        ));
    }

    Ok(())
}

async fn run_current_migrations(pool: &Pool<Sqlite>) -> Result<(), String> {
    let migrator = Migrator::new(InlineMigrationList(schema::tracker_migrations()))
        .await
        .map_err(|error| format!("failed to prepare sqlite migrations: {error}"))?;
    migrator
        .run(pool)
        .await
        .map_err(|error| format!("failed to run sqlite migrations: {error}"))
}

async fn table_exists(pool: &Pool<Sqlite>, table_name: &str) -> Result<bool, String> {
    sqlx::query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1")
        .bind(table_name)
        .fetch_optional(pool)
        .await
        .map(|row| row.is_some())
        .map_err(|error| format!("failed to inspect sqlite table `{table_name}`: {error}"))
}

async fn table_has_columns(
    pool: &Pool<Sqlite>,
    table_name: &str,
    required_columns: &[&str],
) -> Result<bool, String> {
    let pragma = match table_name {
        "sessions" => "PRAGMA table_info(sessions)",
        "session_title_samples" => "PRAGMA table_info(session_title_samples)",
        "settings" => "PRAGMA table_info(settings)",
        "icon_cache" => "PRAGMA table_info(icon_cache)",
        "tool_reminders" => "PRAGMA table_info(tool_reminders)",
        "tool_timers" => "PRAGMA table_info(tool_timers)",
        "tool_timer_laps" => "PRAGMA table_info(tool_timer_laps)",
        "tool_pomodoro_runs" => "PRAGMA table_info(tool_pomodoro_runs)",
        "tool_daily_stats" => "PRAGMA table_info(tool_daily_stats)",
        "tool_software_reminder_rules" => "PRAGMA table_info(tool_software_reminder_rules)",
        "web_activity_segments" => "PRAGMA table_info(web_activity_segments)",
        "web_favicon_cache" => "PRAGMA table_info(web_favicon_cache)",
        _ => {
            return Err(format!(
                "unsupported schema inspection table `{table_name}`"
            ))
        }
    };

    let rows = sqlx::query(pragma).fetch_all(pool).await.map_err(|error| {
        format!("failed to inspect sqlite table `{table_name}` columns: {error}")
    })?;
    let columns = rows
        .iter()
        .map(|row| row.get::<String, _>("name"))
        .collect::<Vec<_>>();

    Ok(required_columns
        .iter()
        .all(|required| columns.iter().any(|column| column == required)))
}

async fn sessions_has_column(pool: &Pool<Sqlite>, column_name: &str) -> Result<bool, String> {
    table_has_columns(pool, "sessions", &[column_name]).await
}

async fn sessions_has_index(pool: &Pool<Sqlite>, index_name: &str) -> Result<bool, String> {
    table_has_index(pool, "sessions", index_name).await
}

async fn table_has_index(
    pool: &Pool<Sqlite>,
    table_name: &str,
    index_name: &str,
) -> Result<bool, String> {
    let pragma = match table_name {
        "sessions" => "PRAGMA index_list(sessions)",
        "session_title_samples" => "PRAGMA index_list(session_title_samples)",
        "tool_reminders" => "PRAGMA index_list(tool_reminders)",
        "tool_timers" => "PRAGMA index_list(tool_timers)",
        "tool_timer_laps" => "PRAGMA index_list(tool_timer_laps)",
        "tool_pomodoro_runs" => "PRAGMA index_list(tool_pomodoro_runs)",
        "tool_daily_stats" => "PRAGMA index_list(tool_daily_stats)",
        "tool_software_reminder_rules" => "PRAGMA index_list(tool_software_reminder_rules)",
        "web_activity_segments" => "PRAGMA index_list(web_activity_segments)",
        _ => return Err(format!("unsupported index inspection table `{table_name}`")),
    };

    let rows = sqlx::query(pragma)
        .fetch_all(pool)
        .await
        .map_err(|error| format!("failed to inspect {table_name} indexes: {error}"))?;

    Ok(rows
        .iter()
        .any(|row| row.get::<String, _>("name") == index_name))
}

async fn ensure_sessions_continuity_group_start_time(pool: &Pool<Sqlite>) -> Result<bool, String> {
    if sessions_has_column(pool, "continuity_group_start_time").await? {
        return Ok(false);
    }

    let mut tx = pool
        .begin()
        .await
        .map_err(|error| format!("failed to start sqlite legacy schema repair: {error}"))?;

    sqlx::query("ALTER TABLE sessions ADD COLUMN continuity_group_start_time INTEGER")
        .execute(&mut *tx)
        .await
        .map_err(|error| {
            format!(
                "failed to add sessions.continuity_group_start_time during schema repair: {error}"
            )
        })?;
    sqlx::query(
        "UPDATE sessions
         SET continuity_group_start_time = start_time
         WHERE continuity_group_start_time IS NULL",
    )
    .execute(&mut *tx)
    .await
    .map_err(|error| {
        format!(
            "failed to backfill sessions.continuity_group_start_time during schema repair: {error}"
        )
    })?;

    tx.commit()
        .await
        .map_err(|error| format!("failed to commit sqlite legacy schema repair: {error}"))?;

    Ok(true)
}

async fn ensure_current_indexes(pool: &Pool<Sqlite>) -> Result<bool, String> {
    let mut changed = false;

    if !sessions_has_index(pool, "idx_sessions_date").await? {
        sqlx::query("CREATE INDEX IF NOT EXISTS idx_sessions_date ON sessions(start_time)")
            .execute(pool)
            .await
            .map_err(|error| format!("failed to create sessions date index: {error}"))?;
        changed = true;
    }

    if !sessions_has_index(pool, "idx_sessions_single_active").await? {
        sqlx::query(
            "UPDATE sessions
             SET end_time = start_time,
                 duration = 0
             WHERE end_time IS NULL
               AND id NOT IN (
                 SELECT id
                 FROM sessions
                 WHERE end_time IS NULL
                 ORDER BY start_time DESC, id DESC
                 LIMIT 1
               )",
        )
        .execute(pool)
        .await
        .map_err(|error| {
            format!("failed to seal duplicate active sessions before index repair: {error}")
        })?;
        sqlx::query(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_single_active
             ON sessions((1))
             WHERE end_time IS NULL",
        )
        .execute(pool)
        .await
        .map_err(|error| format!("failed to create single active session index: {error}"))?;
        changed = true;
    }

    Ok(changed)
}

async fn ensure_session_title_samples_schema(pool: &Pool<Sqlite>) -> Result<bool, String> {
    let mut changed = false;

    if !table_exists(pool, "session_title_samples").await? {
        sqlx::query(
            "CREATE TABLE IF NOT EXISTS session_title_samples (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id INTEGER NOT NULL,
                title TEXT NOT NULL,
                start_time INTEGER NOT NULL,
                end_time INTEGER,
                FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE
            )",
        )
        .execute(pool)
        .await
        .map_err(|error| format!("failed to create session_title_samples table: {error}"))?;
        changed = true;
    }

    if !table_has_index(
        pool,
        "session_title_samples",
        "idx_session_title_samples_session_time",
    )
    .await?
    {
        sqlx::query(
            "CREATE INDEX IF NOT EXISTS idx_session_title_samples_session_time
             ON session_title_samples(session_id, start_time)",
        )
        .execute(pool)
        .await
        .map_err(|error| {
            format!("failed to create session_title_samples session/time index: {error}")
        })?;
        changed = true;
    }

    if !table_has_index(
        pool,
        "session_title_samples",
        "idx_session_title_samples_time",
    )
    .await?
    {
        sqlx::query(
            "CREATE INDEX IF NOT EXISTS idx_session_title_samples_time
             ON session_title_samples(start_time, end_time)",
        )
        .execute(pool)
        .await
        .map_err(|error| format!("failed to create session_title_samples time index: {error}"))?;
        changed = true;
    }

    let inserted = sqlx::query(
        "INSERT INTO session_title_samples (session_id, title, start_time, end_time)
         SELECT id, TRIM(window_title), start_time, end_time
         FROM sessions
         WHERE TRIM(COALESCE(window_title, '')) <> ''
           AND NOT EXISTS (
             SELECT 1
             FROM session_title_samples
             WHERE session_title_samples.session_id = sessions.id
           )",
    )
    .execute(pool)
    .await
    .map_err(|error| format!("failed to backfill legacy title samples: {error}"))?
    .rows_affected();

    Ok(changed || inserted > 0)
}

async fn repair_legacy_schema_before_baseline_normalization(
    pool: &Pool<Sqlite>,
) -> Result<bool, String> {
    if !table_exists(pool, "sessions").await? {
        return Ok(false);
    }

    let mut changed = ensure_sessions_continuity_group_start_time(pool).await?;
    changed = ensure_session_title_samples_schema(pool).await? || changed;

    if has_current_baseline_schema(pool).await? {
        return Ok(changed);
    }

    let sessions_base_ready = table_has_columns(
        pool,
        "sessions",
        &[
            "id",
            "app_name",
            "exe_name",
            "window_title",
            "start_time",
            "end_time",
            "duration",
            "continuity_group_start_time",
        ],
    )
    .await?;

    if sessions_base_ready {
        changed = ensure_current_indexes(pool).await? || changed;
    }

    Ok(changed)
}

async fn has_current_baseline_schema(pool: &Pool<Sqlite>) -> Result<bool, String> {
    if !table_exists(pool, "sessions").await?
        || !table_exists(pool, "settings").await?
        || !table_exists(pool, "icon_cache").await?
    {
        return Ok(false);
    }

    let sessions_ready = table_has_columns(
        pool,
        "sessions",
        &[
            "id",
            "app_name",
            "exe_name",
            "window_title",
            "start_time",
            "end_time",
            "duration",
            "continuity_group_start_time",
        ],
    )
    .await?;
    let title_samples_ready = table_has_columns(
        pool,
        "session_title_samples",
        &["id", "session_id", "title", "start_time", "end_time"],
    )
    .await?;
    let settings_ready = table_has_columns(pool, "settings", &["key", "value"]).await?;
    let icon_cache_ready = table_has_columns(
        pool,
        "icon_cache",
        &["exe_name", "icon_base64", "last_updated"],
    )
    .await?;
    let date_index_ready = sessions_has_index(pool, "idx_sessions_date").await?;
    let active_index_ready = sessions_has_index(pool, "idx_sessions_single_active").await?;
    let title_sample_session_index_ready = table_has_index(
        pool,
        "session_title_samples",
        "idx_session_title_samples_session_time",
    )
    .await?;
    let title_sample_time_index_ready = table_has_index(
        pool,
        "session_title_samples",
        "idx_session_title_samples_time",
    )
    .await?;

    Ok(sessions_ready
        && title_samples_ready
        && settings_ready
        && icon_cache_ready
        && date_index_ready
        && active_index_ready
        && title_sample_session_index_ready
        && title_sample_time_index_ready)
}

async fn has_base_tools_schema(pool: &Pool<Sqlite>) -> Result<bool, String> {
    if !table_exists(pool, "tool_reminders").await?
        || !table_exists(pool, "tool_timers").await?
        || !table_exists(pool, "tool_timer_laps").await?
        || !table_exists(pool, "tool_pomodoro_runs").await?
        || !table_exists(pool, "tool_daily_stats").await?
    {
        return Ok(false);
    }

    let reminders_ready = table_has_columns(
        pool,
        "tool_reminders",
        &[
            "id",
            "label",
            "scheduled_at",
            "created_at",
            "status",
            "fired_at",
            "cancelled_at",
        ],
    )
    .await?;
    let timers_ready = table_has_columns(
        pool,
        "tool_timers",
        &[
            "id",
            "mode",
            "label",
            "duration_ms",
            "accumulated_ms",
            "started_at",
            "paused_at",
            "completed_at",
            "status",
            "created_at",
            "updated_at",
        ],
    )
    .await?;
    let laps_ready = table_has_columns(
        pool,
        "tool_timer_laps",
        &[
            "id",
            "timer_id",
            "lap_index",
            "started_at",
            "ended_at",
            "duration_ms",
        ],
    )
    .await?;
    let pomodoros_ready = table_has_columns(
        pool,
        "tool_pomodoro_runs",
        &[
            "id",
            "phase",
            "status",
            "cycle_index",
            "focus_ms",
            "short_break_ms",
            "long_break_ms",
            "long_break_every",
            "phase_started_at",
            "phase_paused_at",
            "phase_remaining_ms",
            "completed_focus_count",
            "created_at",
            "updated_at",
        ],
    )
    .await?;
    let daily_ready = table_has_columns(
        pool,
        "tool_daily_stats",
        &["date_key", "completed_pomodoros", "updated_at"],
    )
    .await?;
    let reminder_index_ready =
        table_has_index(pool, "tool_reminders", "idx_tool_reminders_schedule_status").await?;
    let timer_index_ready =
        table_has_index(pool, "tool_timers", "idx_tool_timers_status_updated").await?;
    let lap_index_ready =
        table_has_index(pool, "tool_timer_laps", "idx_tool_timer_laps_timer_id").await?;
    let pomodoro_index_ready = table_has_index(
        pool,
        "tool_pomodoro_runs",
        "idx_tool_pomodoro_runs_status_updated",
    )
    .await?;
    let daily_index_ready =
        table_has_index(pool, "tool_daily_stats", "idx_tool_daily_stats_updated").await?;

    Ok(reminders_ready
        && timers_ready
        && laps_ready
        && pomodoros_ready
        && daily_ready
        && reminder_index_ready
        && timer_index_ready
        && lap_index_ready
        && pomodoro_index_ready
        && daily_index_ready)
}

async fn has_software_reminder_rules_schema(pool: &Pool<Sqlite>) -> Result<bool, String> {
    if !table_exists(pool, "tool_software_reminder_rules").await? {
        return Ok(false);
    }

    let software_rules_ready = table_has_columns(
        pool,
        "tool_software_reminder_rules",
        &[
            "id",
            "app_name",
            "exe_name",
            "limit_ms",
            "message",
            "created_at",
            "updated_at",
            "disabled_at",
            "last_fired_date_key",
        ],
    )
    .await?;
    let software_rules_index_ready = table_has_index(
        pool,
        "tool_software_reminder_rules",
        "idx_tool_software_reminder_rules_active",
    )
    .await?;
    let sessions_app_usage_index_ready =
        table_has_index(pool, "sessions", "idx_sessions_app_usage_time").await?;
    let sessions_exe_usage_index_ready =
        table_has_index(pool, "sessions", "idx_sessions_exe_usage_time").await?;

    Ok(software_rules_ready
        && software_rules_index_ready
        && sessions_app_usage_index_ready
        && sessions_exe_usage_index_ready)
}

async fn has_web_activity_schema(pool: &Pool<Sqlite>) -> Result<bool, String> {
    if !table_exists(pool, "web_activity_segments").await? {
        return Ok(false);
    }

    let segments_ready = table_has_columns(
        pool,
        "web_activity_segments",
        &[
            "id",
            "browser_client_id",
            "browser_kind",
            "browser_exe_name",
            "domain",
            "normalized_domain",
            "url",
            "title",
            "favicon_url",
            "start_time",
            "end_time",
            "duration",
            "source",
            "created_at",
            "updated_at",
        ],
    )
    .await?;
    let time_index_ready = table_has_index(
        pool,
        "web_activity_segments",
        "idx_web_activity_segments_time",
    )
    .await?;
    let domain_time_index_ready = table_has_index(
        pool,
        "web_activity_segments",
        "idx_web_activity_segments_domain_time",
    )
    .await?;
    let single_active_index_ready = table_has_index(
        pool,
        "web_activity_segments",
        "idx_web_activity_segments_single_active",
    )
    .await?;

    Ok(segments_ready && time_index_ready && domain_time_index_ready && single_active_index_ready)
}

async fn has_web_favicon_cache_schema(pool: &Pool<Sqlite>) -> Result<bool, String> {
    if !table_exists(pool, "web_favicon_cache").await? {
        return Ok(false);
    }

    table_has_columns(
        pool,
        "web_favicon_cache",
        &["normalized_domain", "favicon_url", "updated_at"],
    )
    .await
}

async fn normalize_current_baseline_migration_history_for_pool(
    pool: &Pool<Sqlite>,
) -> Result<bool, String> {
    if !table_exists(pool, "_sqlx_migrations").await? {
        return Ok(false);
    }

    if !has_current_baseline_schema(pool).await? {
        return Ok(false);
    }

    let mut expected = expected_migration_metadata();
    if !has_base_tools_schema(pool).await? {
        expected.truncate(1);
    } else if !has_software_reminder_rules_schema(pool).await? {
        expected.truncate(2);
    } else if !has_web_activity_schema(pool).await? {
        expected.truncate(3);
    } else if !has_web_favicon_cache_schema(pool).await? {
        expected.truncate(4);
    }
    if expected.is_empty() {
        return Ok(false);
    }

    let applied_rows = sqlx::query("SELECT version, description, checksum FROM _sqlx_migrations")
        .fetch_all(pool)
        .await
        .map_err(|error| format!("failed to load applied sqlite migrations: {error}"))?;

    let already_normalized = applied_rows.len() == expected.len()
        && expected.iter().all(|(version, description, checksum)| {
            applied_rows.iter().any(|row| {
                row.get::<i64, _>("version") == *version
                    && row.get::<String, _>("description") == *description
                    && row.get::<Vec<u8>, _>("checksum") == *checksum
            })
        });

    if already_normalized {
        return Ok(false);
    }

    let mut tx = pool.begin().await.map_err(|error| {
        format!("failed to start sqlite migration history normalization: {error}")
    })?;
    sqlx::query("DELETE FROM _sqlx_migrations")
        .execute(&mut *tx)
        .await
        .map_err(|error| format!("failed to clear sqlite migration history: {error}"))?;
    for (version, description, checksum) in expected {
        sqlx::query(
            "INSERT INTO _sqlx_migrations (version, description, success, checksum, execution_time)
             VALUES (?, ?, 1, ?, 0)",
        )
        .bind(version)
        .bind(description)
        .bind(checksum)
        .execute(&mut *tx)
        .await
        .map_err(|error| format!("failed to write sqlite current migration history: {error}"))?;
    }
    tx.commit().await.map_err(|error| {
        format!("failed to commit sqlite migration history normalization: {error}")
    })?;

    Ok(true)
}

pub async fn wait_for_sqlite_pool<R: Runtime>(app: &AppHandle<R>) -> Result<Pool<Sqlite>, String> {
    let mut wait_cycles: u64 = 0;

    loop {
        if let Some(instances) = app.try_state::<DbInstances>() {
            let instances = instances.0.read().await;
            if let Some(DbPool::Sqlite(pool)) = instances.get(SQLITE_DB_NAME) {
                return Ok(pool.clone());
            }
        }

        wait_cycles += 1;
        if wait_cycles > 300 {
            return Err("sqlite pool not available in time".to_string());
        }

        sleep(Duration::from_millis(100)).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::{Executor, SqlitePool};

    async fn create_sqlx_migrations_table(pool: &SqlitePool) {
        pool.execute(
            "CREATE TABLE _sqlx_migrations (
                version BIGINT PRIMARY KEY,
                description TEXT NOT NULL,
                installed_on TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                success BOOLEAN NOT NULL,
                checksum BLOB NOT NULL,
                execution_time BIGINT NOT NULL
            )",
        )
        .await
        .unwrap();
    }

    #[test]
    fn current_baseline_migration_creates_complete_schema() {
        tauri::async_runtime::block_on(async {
            let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
            pool.execute(schema::CURRENT_BASELINE_SCHEMA_SQL)
                .await
                .unwrap();

            assert!(has_current_baseline_schema(&pool).await.unwrap());
        });
    }

    #[test]
    fn tools_schema_creates_complete_tool_tables() {
        tauri::async_runtime::block_on(async {
            let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
            pool.execute(schema::TOOLS_TABLES_SCHEMA_SQL).await.unwrap();

            assert!(has_base_tools_schema(&pool).await.unwrap());
            assert!(!has_software_reminder_rules_schema(&pool).await.unwrap());
        });
    }

    #[test]
    fn software_reminder_schema_creates_rule_table() {
        tauri::async_runtime::block_on(async {
            let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
            pool.execute(schema::CURRENT_BASELINE_SCHEMA_SQL)
                .await
                .unwrap();
            pool.execute(schema::SOFTWARE_REMINDER_RULES_SCHEMA_SQL)
                .await
                .unwrap();

            assert!(has_software_reminder_rules_schema(&pool).await.unwrap());
        });
    }

    #[test]
    fn web_activity_schema_creates_complete_table() {
        tauri::async_runtime::block_on(async {
            let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
            pool.execute(schema::WEB_ACTIVITY_SCHEMA_SQL).await.unwrap();

            assert!(has_web_activity_schema(&pool).await.unwrap());
        });
    }

    #[test]
    fn web_favicon_cache_schema_creates_table_and_backfills_segments() {
        tauri::async_runtime::block_on(async {
            let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
            pool.execute(schema::WEB_ACTIVITY_SCHEMA_SQL).await.unwrap();
            pool.execute(
                "INSERT INTO web_activity_segments (
                    browser_client_id, browser_kind, browser_exe_name, domain,
                    normalized_domain, url, title, favicon_url, start_time,
                    end_time, duration, source, created_at, updated_at
                 ) VALUES
                    ('client', 'chrome', 'chrome.exe', 'GitHub', 'github.com',
                     NULL, 'Newer URL icon', 'https://github.com/favicon.ico', 200, 250, 50,
                     'browser-extension', 200, 200),
                    ('client', 'chrome', 'chrome.exe', 'GitHub', 'github.com',
                     NULL, 'Older data icon', 'data:image/png;base64,github', 100, 150, 50,
                     'browser-extension', 100, 100),
                    ('client', 'chrome', 'chrome.exe', 'Docs', 'docs.rs',
                     NULL, 'Docs', 'https://docs.rs/favicon.ico', 300, 350, 50,
                     'browser-extension', 300, 300)",
            )
            .await
            .unwrap();

            pool.execute(schema::WEB_FAVICON_CACHE_SCHEMA_SQL)
                .await
                .unwrap();

            assert!(has_web_favicon_cache_schema(&pool).await.unwrap());

            let github: (String, i64) = sqlx::query_as(
                "SELECT favicon_url, updated_at
                 FROM web_favicon_cache
                 WHERE normalized_domain = 'github.com'",
            )
            .fetch_one(&pool)
            .await
            .unwrap();
            let docs: (String, i64) = sqlx::query_as(
                "SELECT favicon_url, updated_at
                 FROM web_favicon_cache
                 WHERE normalized_domain = 'docs.rs'",
            )
            .fetch_one(&pool)
            .await
            .unwrap();

            assert_eq!(github, ("data:image/png;base64,github".to_string(), 100));
            assert_eq!(docs, ("https://docs.rs/favicon.ico".to_string(), 300));
        });
    }

    #[test]
    fn current_schema_history_is_normalized_to_single_baseline_row() {
        tauri::async_runtime::block_on(async {
            let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
            pool.execute(schema::CURRENT_BASELINE_SCHEMA_SQL)
                .await
                .unwrap();
            create_sqlx_migrations_table(&pool).await;
            pool.execute(
                "INSERT INTO _sqlx_migrations (version, description, success, checksum, execution_time)
                 VALUES (1, 'old_v1', 1, x'01', 0),
                        (2, 'old_v2', 1, x'02', 0),
                        (7, 'old_v7', 1, x'07', 0)",
            )
            .await
            .unwrap();

            let normalized = normalize_current_baseline_migration_history_for_pool(&pool)
                .await
                .unwrap();

            assert!(normalized);
            let rows = sqlx::query("SELECT version, description, checksum FROM _sqlx_migrations")
                .fetch_all(&pool)
                .await
                .unwrap();
            let expected = expected_migration_metadata();

            assert_eq!(rows.len(), 1);
            assert_eq!(rows[0].get::<i64, _>("version"), expected[0].0);
            assert_eq!(rows[0].get::<String, _>("description"), expected[0].1);
            assert_eq!(rows[0].get::<Vec<u8>, _>("checksum"), expected[0].2);
        });
    }

    #[test]
    fn current_schema_history_preserves_tools_schema_row() {
        tauri::async_runtime::block_on(async {
            let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
            pool.execute(schema::CURRENT_BASELINE_SCHEMA_SQL)
                .await
                .unwrap();
            pool.execute(schema::TOOLS_TABLES_SCHEMA_SQL).await.unwrap();
            create_sqlx_migrations_table(&pool).await;
            pool.execute(
                "INSERT INTO _sqlx_migrations (version, description, success, checksum, execution_time)
                 VALUES (1, 'old_v1', 1, x'01', 0),
                        (2, 'old_v2', 1, x'02', 0)",
            )
            .await
            .unwrap();

            let normalized = normalize_current_baseline_migration_history_for_pool(&pool)
                .await
                .unwrap();

            assert!(normalized);
            let rows = sqlx::query("SELECT version, description, checksum FROM _sqlx_migrations")
                .fetch_all(&pool)
                .await
                .unwrap();
            let mut expected = expected_migration_metadata();
            expected.truncate(2);

            assert_eq!(rows.len(), expected.len());
            for (version, description, checksum) in expected {
                assert!(rows.iter().any(|row| {
                    row.get::<i64, _>("version") == version
                        && row.get::<String, _>("description") == description
                        && row.get::<Vec<u8>, _>("checksum") == checksum
                }));
            }
        });
    }

    #[test]
    fn current_schema_history_preserves_software_reminder_schema_row() {
        tauri::async_runtime::block_on(async {
            let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
            pool.execute(schema::CURRENT_BASELINE_SCHEMA_SQL)
                .await
                .unwrap();
            pool.execute(schema::TOOLS_TABLES_SCHEMA_SQL).await.unwrap();
            pool.execute(schema::SOFTWARE_REMINDER_RULES_SCHEMA_SQL)
                .await
                .unwrap();
            create_sqlx_migrations_table(&pool).await;
            pool.execute(
                "INSERT INTO _sqlx_migrations (version, description, success, checksum, execution_time)
                 VALUES (1, 'old_v1', 1, x'01', 0),
                        (2, 'old_v2', 1, x'02', 0),
                        (3, 'old_v3', 1, x'03', 0)",
            )
            .await
            .unwrap();

            let normalized = normalize_current_baseline_migration_history_for_pool(&pool)
                .await
                .unwrap();

            assert!(normalized);
            let rows = sqlx::query("SELECT version, description, checksum FROM _sqlx_migrations")
                .fetch_all(&pool)
                .await
                .unwrap();
            let mut expected = expected_migration_metadata();
            expected.truncate(3);

            assert_eq!(rows.len(), expected.len());
            for (version, description, checksum) in expected {
                assert!(rows.iter().any(|row| {
                    row.get::<i64, _>("version") == version
                        && row.get::<String, _>("description") == description
                        && row.get::<Vec<u8>, _>("checksum") == checksum
                }));
            }
        });
    }

    #[test]
    fn current_schema_history_does_not_mark_missing_web_activity_schema_as_applied() {
        tauri::async_runtime::block_on(async {
            let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
            pool.execute(schema::CURRENT_BASELINE_SCHEMA_SQL)
                .await
                .unwrap();
            pool.execute(schema::TOOLS_TABLES_SCHEMA_SQL).await.unwrap();
            pool.execute(schema::SOFTWARE_REMINDER_RULES_SCHEMA_SQL)
                .await
                .unwrap();
            create_sqlx_migrations_table(&pool).await;
            pool.execute(
                "INSERT INTO _sqlx_migrations (version, description, success, checksum, execution_time)
                 VALUES (1, 'old_v1', 1, x'01', 0),
                        (2, 'old_v2', 1, x'02', 0),
                        (3, 'old_v3', 1, x'03', 0),
                        (4, 'old_v4_without_table', 1, x'04', 0)",
            )
            .await
            .unwrap();

            let normalized = normalize_current_baseline_migration_history_for_pool(&pool)
                .await
                .unwrap();

            assert!(normalized);
            assert!(!has_web_activity_schema(&pool).await.unwrap());

            let rows = sqlx::query("SELECT version, description, checksum FROM _sqlx_migrations")
                .fetch_all(&pool)
                .await
                .unwrap();
            let mut expected = expected_migration_metadata();
            expected.truncate(3);

            assert_eq!(rows.len(), expected.len());
            for (version, description, checksum) in expected {
                assert!(rows.iter().any(|row| {
                    row.get::<i64, _>("version") == version
                        && row.get::<String, _>("description") == description
                        && row.get::<Vec<u8>, _>("checksum") == checksum
                }));
            }

            run_current_migrations(&pool).await.unwrap();
            assert!(has_web_activity_schema(&pool).await.unwrap());
        });
    }

    #[test]
    fn current_schema_history_does_not_mark_missing_web_favicon_cache_as_applied() {
        tauri::async_runtime::block_on(async {
            let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
            pool.execute(schema::CURRENT_BASELINE_SCHEMA_SQL)
                .await
                .unwrap();
            pool.execute(schema::TOOLS_TABLES_SCHEMA_SQL).await.unwrap();
            pool.execute(schema::SOFTWARE_REMINDER_RULES_SCHEMA_SQL)
                .await
                .unwrap();
            pool.execute(schema::WEB_ACTIVITY_SCHEMA_SQL).await.unwrap();
            create_sqlx_migrations_table(&pool).await;
            pool.execute(
                "INSERT INTO _sqlx_migrations (version, description, success, checksum, execution_time)
                 VALUES (1, 'old_v1', 1, x'01', 0),
                        (2, 'old_v2', 1, x'02', 0),
                        (3, 'old_v3', 1, x'03', 0),
                        (4, 'old_v4', 1, x'04', 0),
                        (5, 'old_v5_without_table', 1, x'05', 0)",
            )
            .await
            .unwrap();

            let normalized = normalize_current_baseline_migration_history_for_pool(&pool)
                .await
                .unwrap();

            assert!(normalized);
            assert!(!has_web_favicon_cache_schema(&pool).await.unwrap());

            let rows = sqlx::query("SELECT version, description, checksum FROM _sqlx_migrations")
                .fetch_all(&pool)
                .await
                .unwrap();
            let mut expected = expected_migration_metadata();
            expected.truncate(4);

            assert_eq!(rows.len(), expected.len());
            for (version, description, checksum) in expected {
                assert!(rows.iter().any(|row| {
                    row.get::<i64, _>("version") == version
                        && row.get::<String, _>("description") == description
                        && row.get::<Vec<u8>, _>("checksum") == checksum
                }));
            }

            run_current_migrations(&pool).await.unwrap();
            assert!(has_web_favicon_cache_schema(&pool).await.unwrap());
        });
    }

    async fn create_legacy_schema_without_continuity_column(pool: &SqlitePool) {
        pool.execute(
            "CREATE TABLE sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                app_name TEXT NOT NULL,
                exe_name TEXT NOT NULL,
                window_title TEXT,
                start_time INTEGER NOT NULL,
                end_time INTEGER,
                duration INTEGER
            );
            CREATE INDEX idx_sessions_date ON sessions(start_time);
            CREATE UNIQUE INDEX idx_sessions_single_active ON sessions((1)) WHERE end_time IS NULL;
            CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
            CREATE TABLE icon_cache (
                exe_name TEXT PRIMARY KEY,
                icon_base64 TEXT NOT NULL,
                last_updated INTEGER
            );",
        )
        .await
        .unwrap();
    }

    #[test]
    fn legacy_schema_without_continuity_column_is_repaired() {
        tauri::async_runtime::block_on(async {
            let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
            create_legacy_schema_without_continuity_column(&pool).await;

            let repaired = repair_legacy_schema_before_baseline_normalization(&pool)
                .await
                .unwrap();

            assert!(repaired);
            assert!(sessions_has_column(&pool, "continuity_group_start_time")
                .await
                .unwrap());
            assert!(has_current_baseline_schema(&pool).await.unwrap());
        });
    }

    #[test]
    fn legacy_schema_repair_preserves_existing_sessions() {
        tauri::async_runtime::block_on(async {
            let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
            create_legacy_schema_without_continuity_column(&pool).await;
            pool.execute(
                "INSERT INTO sessions (app_name, exe_name, window_title, start_time, end_time, duration)
                 VALUES ('Editor', 'editor.exe', 'Doc', 100, 150, 50),
                        ('Browser', 'browser.exe', 'Page', 200, NULL, NULL)",
            )
            .await
            .unwrap();

            repair_legacy_schema_before_baseline_normalization(&pool)
                .await
                .unwrap();

            let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM sessions")
                .fetch_one(&pool)
                .await
                .unwrap();
            assert_eq!(count, 2);
        });
    }

    #[test]
    fn legacy_schema_repair_backfills_continuity_group_start_time() {
        tauri::async_runtime::block_on(async {
            let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
            create_legacy_schema_without_continuity_column(&pool).await;
            pool.execute(
                "INSERT INTO sessions (app_name, exe_name, window_title, start_time, end_time, duration)
                 VALUES ('Editor', 'editor.exe', 'Doc', 321, 654, 333)",
            )
            .await
            .unwrap();

            repair_legacy_schema_before_baseline_normalization(&pool)
                .await
                .unwrap();

            let continuity_group_start_time: i64 =
                sqlx::query_scalar("SELECT continuity_group_start_time FROM sessions")
                    .fetch_one(&pool)
                    .await
                    .unwrap();
            assert_eq!(continuity_group_start_time, 321);
        });
    }

    #[test]
    fn legacy_schema_repair_then_normalizes_migration_history() {
        tauri::async_runtime::block_on(async {
            let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
            create_legacy_schema_without_continuity_column(&pool).await;
            create_sqlx_migrations_table(&pool).await;
            pool.execute(
                "INSERT INTO _sqlx_migrations (version, description, success, checksum, execution_time)
                 VALUES (1, 'old_v1', 1, x'01', 0)",
            )
                .await
                .unwrap();

            repair_legacy_schema_before_baseline_normalization(&pool)
                .await
                .unwrap();
            let normalized = normalize_current_baseline_migration_history_for_pool(&pool)
                .await
                .unwrap();

            assert!(normalized);
            let description: String =
                sqlx::query_scalar("SELECT description FROM _sqlx_migrations WHERE version = 1")
                    .fetch_one(&pool)
                    .await
                    .unwrap();
            assert_eq!(description, schema::CURRENT_BASELINE_MIGRATION_DESCRIPTION);
        });
    }

    #[test]
    fn legacy_schema_repair_dedupes_active_sessions() {
        tauri::async_runtime::block_on(async {
            let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
            pool.execute(
                "CREATE TABLE sessions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    app_name TEXT NOT NULL,
                    exe_name TEXT NOT NULL,
                    window_title TEXT,
                    start_time INTEGER NOT NULL,
                    end_time INTEGER,
                    duration INTEGER
                );
                CREATE INDEX idx_sessions_date ON sessions(start_time);
                CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
                CREATE TABLE icon_cache (
                    exe_name TEXT PRIMARY KEY,
                    icon_base64 TEXT NOT NULL,
                    last_updated INTEGER
                );
                INSERT INTO sessions (app_name, exe_name, window_title, start_time, end_time, duration)
                VALUES ('A', 'a.exe', 'A', 100, NULL, NULL),
                       ('B', 'b.exe', 'B', 200, NULL, NULL);",
            )
            .await
            .unwrap();

            repair_legacy_schema_before_baseline_normalization(&pool)
                .await
                .unwrap();

            let active_count: i64 =
                sqlx::query_scalar("SELECT COUNT(*) FROM sessions WHERE end_time IS NULL")
                    .fetch_one(&pool)
                    .await
                    .unwrap();
            let sealed_count: i64 =
                sqlx::query_scalar("SELECT COUNT(*) FROM sessions WHERE duration = 0")
                    .fetch_one(&pool)
                    .await
                    .unwrap();
            assert_eq!(active_count, 1);
            assert_eq!(sealed_count, 1);
            assert!(sessions_has_index(&pool, "idx_sessions_single_active")
                .await
                .unwrap());
        });
    }

    #[test]
    fn current_baseline_includes_title_samples_table_and_indexes() {
        tauri::async_runtime::block_on(async {
            let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
            pool.execute(schema::CURRENT_BASELINE_SCHEMA_SQL)
                .await
                .unwrap();

            assert!(table_exists(&pool, "session_title_samples").await.unwrap());
            assert!(table_has_index(
                &pool,
                "session_title_samples",
                "idx_session_title_samples_session_time",
            )
            .await
            .unwrap());
            assert!(table_has_index(
                &pool,
                "session_title_samples",
                "idx_session_title_samples_time",
            )
            .await
            .unwrap());
            assert!(has_current_baseline_schema(&pool).await.unwrap());
        });
    }

    #[test]
    fn legacy_schema_repair_creates_title_samples_and_backfills_once() {
        tauri::async_runtime::block_on(async {
            let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
            create_legacy_schema_without_continuity_column(&pool).await;
            pool.execute(
                "INSERT INTO sessions (id, app_name, exe_name, window_title, start_time, end_time, duration)
                 VALUES (1, 'Editor', 'editor.exe', 'Doc', 100, 150, 50),
                        (2, 'Browser', 'browser.exe', '', 200, 250, 50)",
            )
            .await
            .unwrap();

            assert!(repair_legacy_schema_before_baseline_normalization(&pool)
                .await
                .unwrap());
            assert!(!repair_legacy_schema_before_baseline_normalization(&pool)
                .await
                .unwrap());

            let samples: Vec<(i64, String, i64, Option<i64>)> = sqlx::query_as(
                "SELECT session_id, title, start_time, end_time
                 FROM session_title_samples
                 ORDER BY id ASC",
            )
            .fetch_all(&pool)
            .await
            .unwrap();

            assert_eq!(samples, vec![(1, "Doc".to_string(), 100, Some(150))]);
            assert!(has_current_baseline_schema(&pool).await.unwrap());
        });
    }

    #[test]
    fn current_schema_repair_is_idempotent() {
        tauri::async_runtime::block_on(async {
            let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
            pool.execute(schema::CURRENT_BASELINE_SCHEMA_SQL)
                .await
                .unwrap();

            assert!(!repair_legacy_schema_before_baseline_normalization(&pool)
                .await
                .unwrap());
            assert!(has_current_baseline_schema(&pool).await.unwrap());
        });
    }

    #[test]
    fn incomplete_schema_is_not_marked_as_current_baseline() {
        tauri::async_runtime::block_on(async {
            let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
            pool.execute(
                "CREATE TABLE sessions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    app_name TEXT NOT NULL,
                    exe_name TEXT NOT NULL,
                    window_title TEXT,
                    start_time INTEGER NOT NULL,
                    end_time INTEGER,
                    duration INTEGER
                );",
            )
            .await
            .unwrap();
            create_sqlx_migrations_table(&pool).await;
            pool.execute(
                "INSERT INTO _sqlx_migrations (version, description, success, checksum, execution_time)
                 VALUES (1, 'old_v1', 1, x'01', 0)",
            )
            .await
            .unwrap();

            repair_legacy_schema_before_baseline_normalization(&pool)
                .await
                .unwrap();
            let normalized = normalize_current_baseline_migration_history_for_pool(&pool)
                .await
                .unwrap();

            assert!(!normalized);
            let description: String =
                sqlx::query_scalar("SELECT description FROM _sqlx_migrations WHERE version = 1")
                    .fetch_one(&pool)
                    .await
                    .unwrap();
            assert_eq!(description, "old_v1");
        });
    }
}
