use crate::data::schema;
use futures_util::future::BoxFuture;
use sqlx::error::BoxDynError;
use sqlx::migrate::{Migration as SqlxMigration, MigrationSource, MigrationType, Migrator};
use sqlx::{
    sqlite::{SqliteConnectOptions, SqlitePoolOptions},
    Pool, Sqlite,
};
use std::path::Path;

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

#[derive(Debug)]
struct InlineMigrationList(Vec<schema::Migration>);

impl MigrationSource<'static> for InlineMigrationList {
    fn resolve(self) -> BoxFuture<'static, Result<Vec<SqlxMigration>, BoxDynError>> {
        Box::pin(async move {
            let mut migrations = Vec::new();
            for migration in self.0 {
                migrations.push(SqlxMigration::new(
                    migration.version,
                    migration.description.into(),
                    MigrationType::ReversibleUp,
                    sqlx::SqlStr::from_static(migration.sql),
                    false,
                ));
            }
            Ok(migrations)
        })
    }
}

pub(crate) fn expected_migration_metadata() -> Vec<(i64, &'static str, Vec<u8>)> {
    schema::tracker_migrations()
        .into_iter()
        .map(|migration| {
            let sqlx_migration = SqlxMigration::new(
                migration.version,
                migration.description.into(),
                MigrationType::ReversibleUp,
                sqlx::SqlStr::from_static(migration.sql),
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

pub(crate) async fn run_current_migrations(pool: &Pool<Sqlite>) -> Result<(), String> {
    let migrator = Migrator::new(InlineMigrationList(schema::tracker_migrations()))
        .await
        .map_err(|error| format!("failed to prepare sqlite migrations: {error}"))?;
    migrator
        .run(pool)
        .await
        .map_err(|error| format!("failed to run sqlite migrations: {error}"))
}
