use crate::data::schema;
use sqlx::migrate::{Migration as SqlxMigration, MigrationType};
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::{Pool, Row, Sqlite};
use std::env;
use std::fs::create_dir_all;
use std::path::PathBuf;
use tauri::{AppHandle, Manager, Runtime};
use tauri_plugin_sql::{DbInstances, DbPool};
use tokio::time::{sleep, Duration};

pub const SQLITE_DB_NAME: &str = "sqlite:timetracker.db";
const SQLITE_DB_FILE_NAME: &str = "timetracker.db";

fn resolve_app_config_db_path(app_identifier: &str) -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        return env::var_os("APPDATA")
            .map(PathBuf::from)
            .map(|path| path.join(app_identifier).join("timetracker.db"));
    }

    #[cfg(target_os = "macos")]
    {
        return env::var_os("HOME").map(PathBuf::from).map(|path| {
            path.join("Library")
                .join("Application Support")
                .join(app_identifier)
                .join("timetracker.db")
        });
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let config_root = env::var_os("XDG_CONFIG_HOME")
            .map(PathBuf::from)
            .or_else(|| env::var_os("HOME").map(|home| PathBuf::from(home).join(".config")));
        return config_root.map(|path| path.join(app_identifier).join("timetracker.db"));
    }

    #[allow(unreachable_code)]
    None
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

fn resolve_tauri_app_config_db_path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let mut app_path = app
        .path()
        .app_config_dir()
        .map_err(|error| format!("failed to resolve app config dir: {error}"))?;
    create_dir_all(&app_path).map_err(|error| {
        format!(
            "failed to create app config dir `{}`: {error}",
            app_path.display()
        )
    })?;
    app_path.push(SQLITE_DB_FILE_NAME);
    Ok(app_path)
}

async fn open_single_connection_sqlite_pool(db_path: PathBuf) -> Result<Pool<Sqlite>, String> {
    let connect_options = SqliteConnectOptions::new()
        .filename(&db_path)
        .create_if_missing(true)
        .pragma("busy_timeout", "5000");

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
    let db_path = resolve_tauri_app_config_db_path(app)?;
    let next_pool = open_single_connection_sqlite_pool(db_path).await?;

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

    Ok(next_pool)
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

async fn normalize_current_baseline_migration_history_for_pool(
    pool: &Pool<Sqlite>,
) -> Result<bool, String> {
    if !table_exists(pool, "_sqlx_migrations").await? {
        return Ok(false);
    }

    if !has_current_baseline_schema(pool).await? {
        return Ok(false);
    }

    let Some((version, description, checksum)) = expected_migration_metadata().into_iter().next()
    else {
        return Ok(false);
    };

    let applied_rows = sqlx::query("SELECT version, description, checksum FROM _sqlx_migrations")
        .fetch_all(pool)
        .await
        .map_err(|error| format!("failed to load applied sqlite migrations: {error}"))?;

    let already_normalized = applied_rows.len() == 1
        && applied_rows[0].get::<i64, _>("version") == version
        && applied_rows[0].get::<String, _>("description") == description
        && applied_rows[0].get::<Vec<u8>, _>("checksum") == checksum;

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
    sqlx::query(
        "INSERT INTO _sqlx_migrations (version, description, success, checksum, execution_time)
         VALUES (?, ?, 1, ?, 0)",
    )
    .bind(version)
    .bind(description)
    .bind(checksum)
    .execute(&mut *tx)
    .await
    .map_err(|error| {
        format!("failed to write sqlite current baseline migration history: {error}")
    })?;
    tx.commit().await.map_err(|error| {
        format!("failed to commit sqlite migration history normalization: {error}")
    })?;

    Ok(true)
}

pub async fn normalize_current_baseline_migration_history(
    app_identifier: &str,
) -> Result<(), String> {
    let Some(db_path) = resolve_app_config_db_path(app_identifier) else {
        return Ok(());
    };

    if !db_path.exists() {
        return Ok(());
    }

    let connect_options = SqliteConnectOptions::new()
        .filename(&db_path)
        .create_if_missing(false);

    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(connect_options)
        .await
        .map_err(|error| format!("failed to open sqlite db `{}`: {error}", db_path.display()))?;

    if repair_legacy_schema_before_baseline_normalization(&pool).await? {
        eprintln!("[sql] repaired legacy sqlite schema before baseline normalization");
    }

    if normalize_current_baseline_migration_history_for_pool(&pool).await? {
        eprintln!("[sql] normalized sqlite migration history to the current baseline");
    }

    pool.close().await;
    Ok(())
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
