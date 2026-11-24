use crate::schema;
use futures_util::future::BoxFuture;
use sqlx::error::BoxDynError;
use sqlx::migrate::{Migration as SqlxMigration, MigrationSource, MigrationType, Migrator};
use sqlx::{
    sqlite::{SqliteConnectOptions, SqlitePoolOptions},
    Pool, Sqlite,
};
use std::path::Path;

pub async fn open_single_connection_sqlite_pool(
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

pub fn expected_migration_metadata() -> Vec<(i64, &'static str, Vec<u8>)> {
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

pub fn is_known_migration_prefix(rows: &[(i64, String, Vec<u8>, bool)]) -> bool {
    // Windows checkouts of v1.10.0 could embed focus_history.sql with CRLF.
    const FOCUS_HISTORY_CRLF: [u8; 48] = [
        0x20, 0xc7, 0x2c, 0xb9, 0xaa, 0xbd, 0x8d, 0xe9, 0x22, 0x93, 0x13, 0xfa, 0xe9, 0xdb, 0x60,
        0x18, 0xaf, 0x2b, 0x19, 0x93, 0x46, 0xa3, 0xd9, 0x7b, 0x15, 0xc6, 0xe8, 0x92, 0xa8, 0x1b,
        0x4a, 0x7c, 0xc7, 0xf7, 0x82, 0xed, 0x92, 0xd7, 0xe6, 0x2c, 0xe3, 0xd1, 0xcc, 0x4a, 0x03,
        0x6e, 0x31, 0x10,
    ];
    let expected = expected_migration_metadata();
    !rows.is_empty()
        && rows.len() <= expected.len()
        && rows.iter().zip(expected).all(
            |((version, description, checksum, success), (v, d, canonical))| {
                *success
                    && *version == v
                    && description == d
                    && (*checksum == canonical
                        || (v == schema::FOCUS_HISTORY_VERSION
                            && checksum.as_slice() == FOCUS_HISTORY_CRLF))
            },
        )
}

pub async fn run_current_migrations(pool: &Pool<Sqlite>) -> Result<(), String> {
    let migrator = Migrator::new(InlineMigrationList(schema::tracker_migrations()))
        .await
        .map_err(|error| format!("failed to prepare sqlite migrations: {error}"))?;
    migrator
        .run(pool)
        .await
        .map_err(|error| format!("failed to run sqlite migrations: {error}"))
}
