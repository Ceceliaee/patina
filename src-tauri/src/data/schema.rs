use tauri_plugin_sql::{Migration, MigrationKind};

pub const CURRENT_BASELINE_MIGRATION_VERSION: i64 = 1;
pub const CURRENT_BASELINE_MIGRATION_DESCRIPTION: &str = "create_current_baseline_schema";
pub const TOOLS_TABLES_MIGRATION_VERSION: i64 = 2;
pub const TOOLS_TABLES_MIGRATION_DESCRIPTION: &str = "create_tools_tables";
pub const SOFTWARE_REMINDER_RULES_MIGRATION_VERSION: i64 = 3;
pub const SOFTWARE_REMINDER_RULES_MIGRATION_DESCRIPTION: &str = "create_software_reminder_rules";
pub const WEB_ACTIVITY_MIGRATION_VERSION: i64 = 4;
pub const WEB_ACTIVITY_MIGRATION_DESCRIPTION: &str = "create_web_activity_segments";

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

pub const TOOLS_TABLES_SCHEMA_SQL: &str = "
    CREATE TABLE IF NOT EXISTS tool_reminders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        label TEXT NOT NULL,
        scheduled_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        status TEXT NOT NULL,
        fired_at INTEGER,
        cancelled_at INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_tool_reminders_schedule_status
    ON tool_reminders(status, scheduled_at);

    CREATE TABLE IF NOT EXISTS tool_timers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        mode TEXT NOT NULL,
        label TEXT,
        duration_ms INTEGER,
        accumulated_ms INTEGER NOT NULL DEFAULT 0,
        started_at INTEGER,
        paused_at INTEGER,
        completed_at INTEGER,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_tool_timers_status_updated
    ON tool_timers(status, updated_at);

    CREATE TABLE IF NOT EXISTS tool_timer_laps (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timer_id INTEGER NOT NULL,
        lap_index INTEGER NOT NULL,
        started_at INTEGER NOT NULL,
        ended_at INTEGER NOT NULL,
        duration_ms INTEGER NOT NULL,
        FOREIGN KEY(timer_id) REFERENCES tool_timers(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_tool_timer_laps_timer_id
    ON tool_timer_laps(timer_id, lap_index);

    CREATE TABLE IF NOT EXISTS tool_pomodoro_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        phase TEXT NOT NULL,
        status TEXT NOT NULL,
        cycle_index INTEGER NOT NULL,
        focus_ms INTEGER NOT NULL,
        short_break_ms INTEGER NOT NULL,
        long_break_ms INTEGER NOT NULL,
        long_break_every INTEGER NOT NULL,
        phase_started_at INTEGER,
        phase_paused_at INTEGER,
        phase_remaining_ms INTEGER,
        completed_focus_count INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_tool_pomodoro_runs_status_updated
    ON tool_pomodoro_runs(status, updated_at);

    CREATE TABLE IF NOT EXISTS tool_daily_stats (
        date_key TEXT PRIMARY KEY,
        completed_pomodoros INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_tool_daily_stats_updated
    ON tool_daily_stats(updated_at);
";

pub const SOFTWARE_REMINDER_RULES_SCHEMA_SQL: &str = "
    CREATE INDEX IF NOT EXISTS idx_sessions_app_usage_time
    ON sessions(app_name COLLATE NOCASE, start_time, end_time);

    CREATE INDEX IF NOT EXISTS idx_sessions_exe_usage_time
    ON sessions(exe_name COLLATE NOCASE, start_time, end_time);

    CREATE TABLE IF NOT EXISTS tool_software_reminder_rules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        app_name TEXT NOT NULL,
        exe_name TEXT,
        limit_ms INTEGER NOT NULL,
        message TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        disabled_at INTEGER,
        last_fired_date_key TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_tool_software_reminder_rules_active
    ON tool_software_reminder_rules(disabled_at, app_name, exe_name);
";

pub const WEB_ACTIVITY_SCHEMA_SQL: &str = "
    CREATE TABLE IF NOT EXISTS web_activity_segments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        browser_client_id TEXT NOT NULL,
        browser_kind TEXT NOT NULL,
        browser_exe_name TEXT NOT NULL,
        domain TEXT NOT NULL,
        normalized_domain TEXT NOT NULL,
        url TEXT,
        title TEXT,
        favicon_url TEXT,
        start_time INTEGER NOT NULL,
        end_time INTEGER,
        duration INTEGER,
        source TEXT NOT NULL DEFAULT 'browser-extension',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_web_activity_segments_time
    ON web_activity_segments(start_time, end_time);

    CREATE INDEX IF NOT EXISTS idx_web_activity_segments_domain_time
    ON web_activity_segments(normalized_domain, start_time, end_time);

    CREATE UNIQUE INDEX IF NOT EXISTS idx_web_activity_segments_single_active
    ON web_activity_segments((1))
    WHERE end_time IS NULL;
";

pub fn tracker_migrations() -> Vec<Migration> {
    vec![
        Migration {
            version: CURRENT_BASELINE_MIGRATION_VERSION,
            description: CURRENT_BASELINE_MIGRATION_DESCRIPTION,
            sql: CURRENT_BASELINE_SCHEMA_SQL,
            kind: MigrationKind::Up,
        },
        Migration {
            version: TOOLS_TABLES_MIGRATION_VERSION,
            description: TOOLS_TABLES_MIGRATION_DESCRIPTION,
            sql: TOOLS_TABLES_SCHEMA_SQL,
            kind: MigrationKind::Up,
        },
        Migration {
            version: SOFTWARE_REMINDER_RULES_MIGRATION_VERSION,
            description: SOFTWARE_REMINDER_RULES_MIGRATION_DESCRIPTION,
            sql: SOFTWARE_REMINDER_RULES_SCHEMA_SQL,
            kind: MigrationKind::Up,
        },
        Migration {
            version: WEB_ACTIVITY_MIGRATION_VERSION,
            description: WEB_ACTIVITY_MIGRATION_DESCRIPTION,
            sql: WEB_ACTIVITY_SCHEMA_SQL,
            kind: MigrationKind::Up,
        },
    ]
}
