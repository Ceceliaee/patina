use crate::data::migrations;
use sqlx::migrate::{Migration as SqlxMigration, MigrationType};
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::{Pool, Row, Sqlite};
use std::env;
use std::path::PathBuf;
use tauri::{AppHandle, Manager, Runtime};
use tauri_plugin_sql::{DbInstances, DbPool};
use tokio::time::{sleep, Duration};

pub const SQLITE_DB_NAME: &str = "sqlite:timetracker.db";

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
    migrations::tracker_migrations()
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

pub async fn repair_legacy_migration_history(app_identifier: &str) -> Result<(), String> {
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

    let migrations_table_exists = sqlx::query(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '_sqlx_migrations' LIMIT 1",
    )
    .fetch_optional(&pool)
    .await
    .map_err(|error| format!("failed to inspect sqlite migrations table: {error}"))?
    .is_some();

    if !migrations_table_exists {
        pool.close().await;
        return Ok(());
    }

    let applied_rows = sqlx::query("SELECT version, description, checksum FROM _sqlx_migrations")
        .fetch_all(&pool)
        .await
        .map_err(|error| format!("failed to load applied sqlite migrations: {error}"))?;

    let mut repaired_versions: Vec<i64> = Vec::new();
    for (version, description, checksum) in expected_migration_metadata() {
        let Some(applied_row) = applied_rows
            .iter()
            .find(|row| row.get::<i64, _>("version") == version)
        else {
            continue;
        };

        let applied_description = applied_row.get::<String, _>("description");
        let applied_checksum = applied_row.get::<Vec<u8>, _>("checksum");

        if applied_description == description && applied_checksum == checksum {
            continue;
        }

        sqlx::query("UPDATE _sqlx_migrations SET description = ?, checksum = ? WHERE version = ?")
            .bind(description)
            .bind(checksum)
            .bind(version)
            .execute(&pool)
            .await
            .map_err(|error| {
                format!("failed to repair sqlite migration metadata for v{version}: {error}")
            })?;
        repaired_versions.push(version);
    }

    if !repaired_versions.is_empty() {
        eprintln!(
            "[sql] repaired legacy migration metadata for versions: {}",
            repaired_versions
                .into_iter()
                .map(|version| version.to_string())
                .collect::<Vec<_>>()
                .join(", ")
        );
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
