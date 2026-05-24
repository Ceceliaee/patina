use tauri_plugin_sql::{Migration, MigrationKind};

pub const CURRENT_BASELINE_MIGRATION_VERSION: i64 = 1;
pub const CURRENT_BASELINE_MIGRATION_DESCRIPTION: &str = "create_current_baseline_schema";

pub const CURRENT_BASELINE_SCHEMA_SQL: &str = "
    CREATE TABLE IF NOT EXISTS sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        app_name TEXT NOT NULL,
        exe_name TEXT NOT NULL,
        window_title TEXT,
        start_time INTEGER NOT NULL,
        end_time INTEGER,
        duration INTEGER,
        continuity_group_start_time INTEGER
    );

    CREATE TABLE IF NOT EXISTS session_title_samples (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        start_time INTEGER NOT NULL,
        end_time INTEGER,
        FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );

    UPDATE sessions
    SET end_time = start_time,
        duration = 0
    WHERE end_time IS NULL
      AND id NOT IN (
        SELECT id
        FROM sessions
        WHERE end_time IS NULL
        ORDER BY start_time DESC, id DESC
        LIMIT 1
      );

    UPDATE sessions
    SET continuity_group_start_time = start_time
    WHERE continuity_group_start_time IS NULL;

    CREATE INDEX IF NOT EXISTS idx_sessions_date ON sessions(start_time);

    CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_single_active
    ON sessions((1))
    WHERE end_time IS NULL;

    CREATE INDEX IF NOT EXISTS idx_session_title_samples_session_time
    ON session_title_samples(session_id, start_time);

    CREATE INDEX IF NOT EXISTS idx_session_title_samples_time
    ON session_title_samples(start_time, end_time);

    CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS icon_cache (
        exe_name TEXT PRIMARY KEY,
        icon_base64 TEXT NOT NULL,
        last_updated INTEGER
    );
";

pub fn tracker_migrations() -> Vec<Migration> {
    vec![Migration {
        version: CURRENT_BASELINE_MIGRATION_VERSION,
        description: CURRENT_BASELINE_MIGRATION_DESCRIPTION,
        sql: CURRENT_BASELINE_SCHEMA_SQL,
        kind: MigrationKind::Up,
    }]
}
