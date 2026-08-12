use tauri_plugin_sql::{Migration, MigrationKind};

pub const CURRENT_BASELINE_MIGRATION_VERSION: i64 = 1;
pub const CURRENT_BASELINE_MIGRATION_DESCRIPTION: &str = "create_current_baseline_schema";
pub const TOOLS_TABLES_MIGRATION_VERSION: i64 = 2;
pub const TOOLS_TABLES_MIGRATION_DESCRIPTION: &str = "create_tools_tables";
pub const SOFTWARE_REMINDER_RULES_MIGRATION_VERSION: i64 = 3;
pub const SOFTWARE_REMINDER_RULES_MIGRATION_DESCRIPTION: &str = "create_software_reminder_rules";
pub const WEB_ACTIVITY_MIGRATION_VERSION: i64 = 4;
pub const WEB_ACTIVITY_MIGRATION_DESCRIPTION: &str = "create_web_activity_segments";
pub const WEB_FAVICON_CACHE_MIGRATION_VERSION: i64 = 5;
pub const WEB_FAVICON_CACHE_MIGRATION_DESCRIPTION: &str = "create_web_favicon_cache";
pub const IMPORT_DATA_MIGRATION_VERSION: i64 = 6;
pub const IMPORT_DATA_MIGRATION_DESCRIPTION: &str = "create_import_data_tables";
pub const IMPORT_DATA_ISOLATION_MIGRATION_VERSION: i64 = 7;
pub const IMPORT_DATA_ISOLATION_MIGRATION_DESCRIPTION: &str = "isolate_imported_exact_sessions";
pub const ACTIVITY_READ_MODELS_MIGRATION_VERSION: i64 = 8;
pub const ACTIVITY_READ_MODELS_MIGRATION_DESCRIPTION: &str = "create_activity_read_models";
pub const WEB_ACTIVITY_REVISION_MIGRATION_VERSION: i64 = 9;
pub const WEB_ACTIVITY_REVISION_MIGRATION_DESCRIPTION: &str = "create_web_activity_revision";
pub const SCHEDULED_BACKUP_MIGRATION_VERSION: i64 = 10;
pub const SCHEDULED_BACKUP_MIGRATION_DESCRIPTION: &str = "create_scheduled_backup_tables";
pub const SCHEDULED_BACKUP_TARGETS_MIGRATION_VERSION: i64 = 11;
pub const SCHEDULED_BACKUP_TARGETS_MIGRATION_DESCRIPTION: &str = "extend_scheduled_backup_targets";
pub const SCHEDULED_EXPORT_MIGRATION_VERSION: i64 = 12;
pub const SCHEDULED_EXPORT_MIGRATION_DESCRIPTION: &str = "create_scheduled_export_tables";
pub const ACTIVITY_REMINDER_RULES_MIGRATION_VERSION: i64 = 13;
pub const ACTIVITY_REMINDER_RULES_MIGRATION_DESCRIPTION: &str =
    "generalize_activity_reminder_rules";

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

pub const ACTIVITY_REMINDER_RULES_SCHEMA_SQL: &str = "
    CREATE TABLE IF NOT EXISTS tool_software_reminder_rules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        app_name TEXT NOT NULL,
        exe_name TEXT,
        limit_ms INTEGER NOT NULL CHECK(limit_ms BETWEEN 60000 AND 86400000),
        message TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        disabled_at INTEGER,
        last_fired_date_key TEXT
    );

    CREATE TABLE IF NOT EXISTS tool_activity_reminder_rules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        target_kind TEXT NOT NULL CHECK(target_kind IN ('app', 'category', 'web')),
        app_name TEXT,
        exe_name TEXT,
        category_id TEXT,
        normalized_domain TEXT,
        label_snapshot TEXT NOT NULL,
        limit_ms INTEGER NOT NULL CHECK(limit_ms BETWEEN 60000 AND 86400000),
        message TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        disabled_at INTEGER,
        last_fired_date_key TEXT,
        CHECK(
            (target_kind = 'app'
                AND app_name IS NOT NULL AND TRIM(app_name) <> ''
                AND category_id IS NULL AND normalized_domain IS NULL)
            OR
            (target_kind = 'category'
                AND app_name IS NULL AND exe_name IS NULL
                AND category_id IS NOT NULL AND TRIM(category_id) <> ''
                AND normalized_domain IS NULL)
            OR
            (target_kind = 'web'
                AND app_name IS NULL AND exe_name IS NULL AND category_id IS NULL
                AND normalized_domain IS NOT NULL AND TRIM(normalized_domain) <> '')
        )
    );

    INSERT OR IGNORE INTO tool_activity_reminder_rules (
        id, target_kind, app_name, exe_name, category_id, normalized_domain,
        label_snapshot, limit_ms, message, created_at, updated_at, disabled_at,
        last_fired_date_key
    )
    SELECT id, 'app', app_name, NULLIF(TRIM(exe_name), ''), NULL, NULL,
           app_name, limit_ms, message, created_at, updated_at, disabled_at,
           last_fired_date_key
    FROM tool_software_reminder_rules;

    DROP TABLE tool_software_reminder_rules;

    CREATE INDEX IF NOT EXISTS idx_tool_activity_reminder_rules_active
    ON tool_activity_reminder_rules(disabled_at, target_kind);

    CREATE INDEX IF NOT EXISTS idx_tool_activity_reminder_rules_app
    ON tool_activity_reminder_rules(target_kind, exe_name COLLATE NOCASE, app_name COLLATE NOCASE)
    WHERE disabled_at IS NULL AND target_kind = 'app';

    CREATE INDEX IF NOT EXISTS idx_tool_activity_reminder_rules_category
    ON tool_activity_reminder_rules(target_kind, category_id)
    WHERE disabled_at IS NULL AND target_kind = 'category';

    CREATE INDEX IF NOT EXISTS idx_tool_activity_reminder_rules_web
    ON tool_activity_reminder_rules(target_kind, normalized_domain)
    WHERE disabled_at IS NULL AND target_kind = 'web';
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

pub const WEB_ACTIVITY_REVISION_SCHEMA_SQL: &str = "
    CREATE TABLE IF NOT EXISTS web_activity_revision (
        id INTEGER PRIMARY KEY CHECK(id = 1),
        source_revision INTEGER NOT NULL DEFAULT 0 CHECK(source_revision >= 0),
        updated_at_ms INTEGER NOT NULL DEFAULT 0 CHECK(updated_at_ms >= 0)
    );

    INSERT OR IGNORE INTO web_activity_revision(id, source_revision, updated_at_ms)
    VALUES (1, 0, 0);

    DROP TRIGGER IF EXISTS trg_web_activity_revision_insert;
    CREATE TRIGGER trg_web_activity_revision_insert
    AFTER INSERT ON web_activity_segments
    BEGIN
        UPDATE web_activity_revision
        SET source_revision = source_revision + 1,
            updated_at_ms = MAX(0, NEW.updated_at)
        WHERE id = 1;
    END;

    DROP TRIGGER IF EXISTS trg_web_activity_revision_update;
    CREATE TRIGGER trg_web_activity_revision_update
    AFTER UPDATE OF normalized_domain, start_time, end_time, duration, updated_at
    ON web_activity_segments
    WHEN OLD.normalized_domain IS NOT NEW.normalized_domain
      OR OLD.start_time IS NOT NEW.start_time
      OR OLD.end_time IS NOT NEW.end_time
      OR OLD.duration IS NOT NEW.duration
      OR OLD.updated_at IS NOT NEW.updated_at
    BEGIN
        UPDATE web_activity_revision
        SET source_revision = source_revision + 1,
            updated_at_ms = MAX(0, NEW.updated_at)
        WHERE id = 1;
    END;

    DROP TRIGGER IF EXISTS trg_web_activity_revision_delete;
    CREATE TRIGGER trg_web_activity_revision_delete
    AFTER DELETE ON web_activity_segments
    BEGIN
        UPDATE web_activity_revision
        SET source_revision = source_revision + 1,
            updated_at_ms = MAX(
                updated_at_ms,
                MAX(0, CAST(strftime('%s', 'now') AS INTEGER) * 1000)
            )
        WHERE id = 1;
    END;
";

pub const SCHEDULED_BACKUP_SCHEMA_SQL: &str = "
    CREATE TABLE IF NOT EXISTS scheduled_backup_config (
        id INTEGER PRIMARY KEY CHECK(id = 1),
        enabled INTEGER NOT NULL CHECK(enabled IN (0, 1)),
        cadence TEXT NOT NULL CHECK(cadence IN ('daily', 'weekly')),
        weekday INTEGER CHECK(weekday BETWEEN 1 AND 7),
        local_time_minutes INTEGER NOT NULL CHECK(local_time_minutes BETWEEN 0 AND 1439),
        target_dir TEXT NOT NULL CHECK(TRIM(target_dir) <> ''),
        retention_count INTEGER NOT NULL CHECK(retention_count IN (1, 3, 7)),
        target_generation TEXT NOT NULL CHECK(TRIM(target_generation) <> ''),
        schedule_anchor_at_ms INTEGER NOT NULL CHECK(schedule_anchor_at_ms >= 0),
        updated_at_ms INTEGER NOT NULL CHECK(updated_at_ms >= 0),
        CHECK(
            (cadence = 'daily' AND weekday IS NULL)
            OR (cadence = 'weekly' AND weekday IS NOT NULL)
        )
    );

    CREATE TABLE IF NOT EXISTS scheduled_backup_runs (
        run_key TEXT PRIMARY KEY CHECK(TRIM(run_key) <> ''),
        target_generation TEXT NOT NULL CHECK(TRIM(target_generation) <> ''),
        logical_date TEXT NOT NULL CHECK(length(logical_date) = 10),
        logical_time_minutes INTEGER NOT NULL CHECK(logical_time_minutes BETWEEN 0 AND 1439),
        target_path TEXT NOT NULL CHECK(TRIM(target_path) <> ''),
        status TEXT NOT NULL CHECK(status IN ('running', 'retry_wait', 'succeeded', 'failed')),
        file_state TEXT NOT NULL CHECK(file_state IN ('absent', 'present', 'pruned', 'missing', 'conflict')),
        attempt_count INTEGER NOT NULL CHECK(attempt_count BETWEEN 1 AND 3),
        retry_at_ms INTEGER CHECK(retry_at_ms IS NULL OR retry_at_ms >= 0),
        started_at_ms INTEGER NOT NULL CHECK(started_at_ms >= 0),
        completed_at_ms INTEGER CHECK(completed_at_ms IS NULL OR completed_at_ms >= 0),
        archive_sha256 TEXT,
        size_bytes INTEGER CHECK(size_bytes IS NULL OR size_bytes >= 0),
        error_code TEXT,
        error_message TEXT,
        cleanup_warning TEXT,
        updated_at_ms INTEGER NOT NULL CHECK(updated_at_ms >= 0),
        UNIQUE(target_generation, logical_date, logical_time_minutes)
    );

    CREATE INDEX IF NOT EXISTS idx_scheduled_backup_runs_retention
    ON scheduled_backup_runs(
        target_generation, status, file_state,
        logical_date DESC, logical_time_minutes DESC
    );

    CREATE INDEX IF NOT EXISTS idx_scheduled_backup_runs_status_retry
    ON scheduled_backup_runs(status, retry_at_ms, updated_at_ms);
";

pub const SCHEDULED_BACKUP_TARGETS_SCHEMA_SQL: &str = "
    ALTER TABLE scheduled_backup_config RENAME TO scheduled_backup_config_local_only;
    ALTER TABLE scheduled_backup_runs RENAME TO scheduled_backup_runs_local_only;

    CREATE TABLE scheduled_backup_config (
        id INTEGER PRIMARY KEY CHECK(id = 1),
        enabled INTEGER NOT NULL CHECK(enabled IN (0, 1)),
        cadence TEXT NOT NULL CHECK(cadence IN ('daily', 'weekly')),
        weekday INTEGER CHECK(weekday BETWEEN 1 AND 7),
        local_time_minutes INTEGER NOT NULL CHECK(local_time_minutes BETWEEN 0 AND 1439),
        target_kind TEXT NOT NULL CHECK(target_kind IN ('local', 'webdav')),
        target_dir TEXT,
        target_identity TEXT,
        retention_count INTEGER NOT NULL CHECK(retention_count = 1),
        target_generation TEXT NOT NULL CHECK(TRIM(target_generation) <> ''),
        schedule_anchor_at_ms INTEGER NOT NULL CHECK(schedule_anchor_at_ms >= 0),
        updated_at_ms INTEGER NOT NULL CHECK(updated_at_ms >= 0),
        CHECK(
            (cadence = 'daily' AND weekday IS NULL)
            OR (cadence = 'weekly' AND weekday IS NOT NULL)
        ),
        CHECK(
            (target_kind = 'local' AND target_dir IS NOT NULL AND TRIM(target_dir) <> '' AND target_identity IS NULL)
            OR (target_kind = 'webdav' AND target_dir IS NULL AND target_identity IS NOT NULL AND TRIM(target_identity) <> '')
        )
    );

    INSERT INTO scheduled_backup_config (
        id, enabled, cadence, weekday, local_time_minutes, target_kind, target_dir,
        target_identity, retention_count, target_generation, schedule_anchor_at_ms, updated_at_ms
    )
    SELECT id, enabled, cadence, weekday, local_time_minutes, 'local', target_dir,
           NULL, 1, target_generation, schedule_anchor_at_ms, updated_at_ms
    FROM scheduled_backup_config_local_only;

    CREATE TABLE scheduled_backup_runs (
        run_key TEXT PRIMARY KEY CHECK(TRIM(run_key) <> ''),
        target_generation TEXT NOT NULL CHECK(TRIM(target_generation) <> ''),
        target_kind TEXT NOT NULL CHECK(target_kind IN ('local', 'webdav')),
        logical_date TEXT NOT NULL CHECK(length(logical_date) = 10),
        logical_time_minutes INTEGER NOT NULL CHECK(logical_time_minutes BETWEEN 0 AND 1439),
        target_path TEXT NOT NULL CHECK(TRIM(target_path) <> ''),
        staging_path TEXT,
        phase TEXT NOT NULL CHECK(phase IN ('claimed', 'staged', 'uploaded', 'remote_verified', 'indexed', 'succeeded')),
        remote_etag TEXT,
        status TEXT NOT NULL CHECK(status IN ('running', 'retry_wait', 'succeeded', 'failed')),
        file_state TEXT NOT NULL CHECK(file_state IN ('absent', 'present', 'pruned', 'missing', 'conflict')),
        attempt_count INTEGER NOT NULL CHECK(attempt_count BETWEEN 1 AND 3),
        retry_at_ms INTEGER CHECK(retry_at_ms IS NULL OR retry_at_ms >= 0),
        started_at_ms INTEGER NOT NULL CHECK(started_at_ms >= 0),
        completed_at_ms INTEGER CHECK(completed_at_ms IS NULL OR completed_at_ms >= 0),
        archive_sha256 TEXT,
        size_bytes INTEGER CHECK(size_bytes IS NULL OR size_bytes >= 0),
        error_code TEXT,
        error_message TEXT,
        cleanup_warning TEXT,
        updated_at_ms INTEGER NOT NULL CHECK(updated_at_ms >= 0),
        UNIQUE(target_generation, logical_date, logical_time_minutes)
    );

    INSERT INTO scheduled_backup_runs (
        run_key, target_generation, target_kind, logical_date, logical_time_minutes,
        target_path, staging_path, phase, remote_etag, status, file_state, attempt_count,
        retry_at_ms, started_at_ms, completed_at_ms, archive_sha256, size_bytes,
        error_code, error_message, cleanup_warning, updated_at_ms
    )
    SELECT REPLACE(run_key, 'scheduled-local-backup:', 'scheduled-backup:'),
           target_generation, 'local', logical_date, logical_time_minutes,
           target_path, NULL,
           CASE WHEN status = 'succeeded' THEN 'succeeded' ELSE 'claimed' END,
           NULL, status, file_state, attempt_count, retry_at_ms, started_at_ms,
           completed_at_ms, archive_sha256, size_bytes, error_code, error_message,
           cleanup_warning, updated_at_ms
    FROM scheduled_backup_runs_local_only;

    DROP TABLE scheduled_backup_config_local_only;
    DROP TABLE scheduled_backup_runs_local_only;

    CREATE INDEX idx_scheduled_backup_runs_retention
    ON scheduled_backup_runs(
        target_generation, status, file_state,
        logical_date DESC, logical_time_minutes DESC
    );

    CREATE INDEX idx_scheduled_backup_runs_status_retry
    ON scheduled_backup_runs(status, retry_at_ms, updated_at_ms);
";

pub const SCHEDULED_EXPORT_SCHEMA_SQL: &str = "
    CREATE TABLE IF NOT EXISTS scheduled_export_config (
        id INTEGER PRIMARY KEY CHECK(id = 1),
        enabled INTEGER NOT NULL CHECK(enabled IN (0, 1)),
        cadence TEXT NOT NULL CHECK(cadence IN ('daily', 'weekly')),
        weekday INTEGER CHECK(weekday BETWEEN 1 AND 7),
        local_time_minutes INTEGER NOT NULL CHECK(local_time_minutes BETWEEN 0 AND 1439),
        target_dir TEXT NOT NULL CHECK(TRIM(target_dir) <> ''),
        format TEXT NOT NULL CHECK(format IN ('csv', 'markdown', 'parquet', 'sqlite')),
        selected_fields_json TEXT NOT NULL CHECK(json_valid(selected_fields_json)),
        plan_generation TEXT NOT NULL CHECK(TRIM(plan_generation) <> ''),
        schedule_anchor_at_ms INTEGER NOT NULL CHECK(schedule_anchor_at_ms >= 0),
        updated_at_ms INTEGER NOT NULL CHECK(updated_at_ms >= 0),
        CHECK(
            (cadence = 'daily' AND weekday IS NULL)
            OR (cadence = 'weekly' AND weekday IS NOT NULL)
        )
    );

    CREATE TABLE IF NOT EXISTS scheduled_export_runs (
        run_key TEXT PRIMARY KEY CHECK(TRIM(run_key) <> ''),
        plan_generation TEXT NOT NULL CHECK(TRIM(plan_generation) <> ''),
        cadence TEXT NOT NULL CHECK(cadence IN ('daily', 'weekly')),
        logical_start_date TEXT NOT NULL CHECK(length(logical_start_date) = 10),
        logical_end_date TEXT NOT NULL CHECK(length(logical_end_date) = 10),
        period_start_ms INTEGER NOT NULL CHECK(period_start_ms >= 0),
        period_end_ms INTEGER NOT NULL CHECK(period_end_ms > period_start_ms),
        format TEXT NOT NULL CHECK(format IN ('csv', 'markdown', 'parquet', 'sqlite')),
        selected_fields_json TEXT NOT NULL CHECK(json_valid(selected_fields_json)),
        target_path TEXT NOT NULL CHECK(TRIM(target_path) <> ''),
        staging_path TEXT,
        phase TEXT NOT NULL CHECK(phase IN ('claimed', 'written', 'validated', 'published', 'succeeded')),
        status TEXT NOT NULL CHECK(status IN ('running', 'retry_wait', 'succeeded', 'failed', 'superseded')),
        file_state TEXT NOT NULL CHECK(file_state IN ('absent', 'present', 'missing', 'conflict')),
        attempt_count INTEGER NOT NULL CHECK(attempt_count BETWEEN 1 AND 3),
        retry_at_ms INTEGER,
        row_count INTEGER CHECK(row_count >= 0),
        size_bytes INTEGER CHECK(size_bytes >= 0),
        sha256 TEXT,
        error_code TEXT,
        error_message TEXT,
        started_at_ms INTEGER NOT NULL CHECK(started_at_ms >= 0),
        completed_at_ms INTEGER,
        updated_at_ms INTEGER NOT NULL CHECK(updated_at_ms >= 0),
        UNIQUE(plan_generation, period_start_ms, period_end_ms)
    );

    CREATE INDEX IF NOT EXISTS idx_scheduled_export_runs_status_retry
    ON scheduled_export_runs(status, retry_at_ms, updated_at_ms);

    CREATE INDEX IF NOT EXISTS idx_scheduled_export_runs_recent
    ON scheduled_export_runs(plan_generation, status, updated_at_ms DESC);
";

pub const WEB_FAVICON_CACHE_SCHEMA_SQL: &str = "
    CREATE TABLE IF NOT EXISTS web_favicon_cache (
        normalized_domain TEXT PRIMARY KEY,
        favicon_url TEXT NOT NULL,
        updated_at INTEGER NOT NULL
    );

    INSERT INTO web_favicon_cache (normalized_domain, favicon_url, updated_at)
    SELECT domain.normalized_domain,
           (
             SELECT icon.favicon_url
             FROM web_activity_segments AS icon
             WHERE icon.normalized_domain = domain.normalized_domain
               AND icon.favicon_url IS NOT NULL
               AND TRIM(icon.favicon_url) <> ''
             ORDER BY CASE WHEN icon.favicon_url LIKE 'data:%' THEN 0 ELSE 1 END,
                      icon.start_time DESC,
                      icon.id DESC
             LIMIT 1
           ) AS favicon_url,
           COALESCE((
             SELECT icon.updated_at
             FROM web_activity_segments AS icon
             WHERE icon.normalized_domain = domain.normalized_domain
               AND icon.favicon_url IS NOT NULL
               AND TRIM(icon.favicon_url) <> ''
             ORDER BY CASE WHEN icon.favicon_url LIKE 'data:%' THEN 0 ELSE 1 END,
                      icon.start_time DESC,
                      icon.id DESC
             LIMIT 1
           ), 0) AS updated_at
    FROM (
        SELECT DISTINCT normalized_domain
        FROM web_activity_segments
        WHERE normalized_domain IS NOT NULL
          AND TRIM(normalized_domain) <> ''
    ) AS domain
    WHERE EXISTS (
        SELECT 1
        FROM web_activity_segments AS icon
        WHERE icon.normalized_domain = domain.normalized_domain
          AND icon.favicon_url IS NOT NULL
          AND TRIM(icon.favicon_url) <> ''
    )
    ON CONFLICT(normalized_domain) DO UPDATE SET
        favicon_url = excluded.favicon_url,
        updated_at = excluded.updated_at
    WHERE web_favicon_cache.favicon_url <> excluded.favicon_url;
";

pub const IMPORT_DATA_SCHEMA_SQL: &str = "
    CREATE TABLE IF NOT EXISTS import_batches (
        id TEXT PRIMARY KEY,
        imported_at INTEGER NOT NULL,
        source_name TEXT NOT NULL,
        source_kind TEXT NOT NULL,
        source_fingerprint TEXT NOT NULL,
        exact_session_count INTEGER NOT NULL DEFAULT 0 CHECK(exact_session_count >= 0),
        hour_bucket_count INTEGER NOT NULL DEFAULT 0 CHECK(hour_bucket_count >= 0)
    );

    CREATE INDEX IF NOT EXISTS idx_import_batches_imported_at
    ON import_batches(imported_at, id);

    CREATE TABLE IF NOT EXISTS import_exact_records (
        batch_id TEXT NOT NULL,
        session_id INTEGER NOT NULL UNIQUE,
        fingerprint TEXT NOT NULL UNIQUE,
        source_category TEXT,
        source_path TEXT,
        PRIMARY KEY(batch_id, session_id),
        FOREIGN KEY(batch_id) REFERENCES import_batches(id) ON DELETE CASCADE,
        FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_import_exact_records_batch
    ON import_exact_records(batch_id, session_id);

    CREATE TABLE IF NOT EXISTS import_time_buckets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        batch_id TEXT NOT NULL,
        fingerprint TEXT NOT NULL UNIQUE,
        app_name TEXT NOT NULL,
        exe_name TEXT NOT NULL,
        bucket_start_time INTEGER NOT NULL,
        duration INTEGER NOT NULL CHECK(duration > 0 AND duration <= 3600000),
        source_category TEXT,
        source_path TEXT,
        FOREIGN KEY(batch_id) REFERENCES import_batches(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_import_time_buckets_time
    ON import_time_buckets(bucket_start_time, duration);

    CREATE INDEX IF NOT EXISTS idx_import_time_buckets_exe_time
    ON import_time_buckets(exe_name COLLATE NOCASE, bucket_start_time);

    CREATE INDEX IF NOT EXISTS idx_import_time_buckets_batch
    ON import_time_buckets(batch_id, id);
";

pub const IMPORT_DATA_ISOLATION_SCHEMA_SQL: &str = "
    CREATE TABLE import_exact_migration_guard (
        valid INTEGER NOT NULL CHECK(valid = 1)
    );

    INSERT INTO import_exact_migration_guard(valid)
    SELECT CASE
        WHEN (
            SELECT COUNT(*) FROM import_exact_records
        ) = (
            SELECT COUNT(*)
            FROM import_exact_records AS records
            JOIN sessions ON sessions.id = records.session_id
        ) THEN 1
        ELSE 0
    END;

    CREATE TABLE IF NOT EXISTS import_exact_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        batch_id TEXT NOT NULL,
        fingerprint TEXT NOT NULL UNIQUE,
        app_name TEXT NOT NULL,
        exe_name TEXT NOT NULL,
        window_title TEXT NOT NULL DEFAULT '',
        start_time INTEGER NOT NULL,
        end_time INTEGER NOT NULL,
        duration INTEGER NOT NULL CHECK(
            duration > 0
            AND end_time > start_time
            AND ABS((end_time - start_time) - duration) <= 1000
        ),
        source_category TEXT,
        source_path TEXT,
        FOREIGN KEY(batch_id) REFERENCES import_batches(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_import_exact_sessions_time
    ON import_exact_sessions(start_time, end_time);

    CREATE INDEX IF NOT EXISTS idx_import_exact_sessions_exe_time
    ON import_exact_sessions(exe_name COLLATE NOCASE, start_time, end_time);

    CREATE INDEX IF NOT EXISTS idx_import_exact_sessions_batch
    ON import_exact_sessions(batch_id, id);

    INSERT INTO import_exact_sessions (
        batch_id, fingerprint, app_name, exe_name, window_title,
        start_time, end_time, duration, source_category, source_path
    )
    SELECT records.batch_id,
           records.fingerprint,
           sessions.app_name,
           sessions.exe_name,
           COALESCE(sessions.window_title, ''),
           sessions.start_time,
           sessions.end_time,
           sessions.duration,
           records.source_category,
           records.source_path
    FROM import_exact_records AS records
    JOIN sessions ON sessions.id = records.session_id;

    DELETE FROM sessions
    WHERE id IN (SELECT session_id FROM import_exact_records);

    DROP TABLE import_exact_records;
    DROP TABLE import_exact_migration_guard;
";

pub const ACTIVITY_READ_MODELS_SCHEMA_SQL: &str = "
    CREATE TABLE IF NOT EXISTS read_model_revision (
        id INTEGER PRIMARY KEY CHECK(id = 1),
        source_revision INTEGER NOT NULL DEFAULT 0 CHECK(source_revision >= 0),
        updated_at_ms INTEGER NOT NULL DEFAULT 0 CHECK(updated_at_ms >= 0)
    );

    INSERT OR IGNORE INTO read_model_revision(id, source_revision, updated_at_ms)
    VALUES (1, 0, 0);

    CREATE TABLE IF NOT EXISTS read_model_state (
        model_name TEXT PRIMARY KEY CHECK(model_name IN ('app_catalog', 'activity_hourly')),
        schema_version INTEGER NOT NULL CHECK(schema_version > 0),
        algorithm_version INTEGER NOT NULL CHECK(algorithm_version > 0),
        timezone_fingerprint TEXT NOT NULL,
        state TEXT NOT NULL CHECK(state IN ('invalid', 'building', 'ready', 'failed')),
        coverage_start_ms INTEGER,
        coverage_end_ms INTEGER,
        backfill_cursor_ms INTEGER,
        backfill_target_revision INTEGER NOT NULL DEFAULT 0 CHECK(backfill_target_revision >= 0),
        last_success_revision INTEGER NOT NULL DEFAULT 0 CHECK(last_success_revision >= 0),
        last_error_code TEXT,
        updated_at_ms INTEGER NOT NULL DEFAULT 0 CHECK(updated_at_ms >= 0),
        CHECK(coverage_start_ms IS NULL OR coverage_end_ms IS NULL OR coverage_end_ms >= coverage_start_ms)
    );

    INSERT OR IGNORE INTO read_model_state(
        model_name, schema_version, algorithm_version, timezone_fingerprint, state
    ) VALUES
        ('app_catalog', 1, 1, 'executable-v1', 'invalid'),
        ('activity_hourly', 1, 1, 'epoch-hour-v1', 'invalid');

    UPDATE read_model_state
    SET state = 'invalid', coverage_start_ms = NULL, coverage_end_ms = NULL,
        backfill_cursor_ms = NULL, last_error_code = 'schema_migration';

    CREATE TABLE IF NOT EXISTS activity_summary_dirty_ranges (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        start_ms INTEGER NOT NULL,
        end_ms INTEGER NOT NULL,
        generation INTEGER NOT NULL CHECK(generation >= 0),
        reason TEXT NOT NULL CHECK(reason IN (
            'native_insert', 'native_update', 'native_delete',
            'import_exact_insert', 'import_exact_update', 'import_exact_delete',
            'import_bucket_insert', 'import_bucket_update', 'import_bucket_delete',
            'restore', 'rebuild'
        )),
        created_at_ms INTEGER NOT NULL DEFAULT 0 CHECK(created_at_ms >= 0),
        CHECK(end_ms > start_ms)
    );

    CREATE INDEX IF NOT EXISTS idx_activity_dirty_ranges_window
    ON activity_summary_dirty_ranges(start_ms, end_ms, generation);

    CREATE TABLE IF NOT EXISTS app_catalog_dirty_keys (
        app_key TEXT PRIMARY KEY CHECK(TRIM(app_key) <> ''),
        generation INTEGER NOT NULL CHECK(generation >= 0),
        reason TEXT NOT NULL,
        created_at_ms INTEGER NOT NULL DEFAULT 0 CHECK(created_at_ms >= 0)
    );

    CREATE INDEX IF NOT EXISTS idx_app_catalog_dirty_generation
    ON app_catalog_dirty_keys(generation, app_key);

    CREATE TABLE IF NOT EXISTS recorded_app_catalog (
        app_key TEXT PRIMARY KEY CHECK(TRIM(app_key) <> ''),
        raw_exe_name TEXT NOT NULL CHECK(TRIM(raw_exe_name) <> ''),
        display_app_name TEXT NOT NULL DEFAULT '',
        last_seen_ms INTEGER NOT NULL,
        has_native_records INTEGER NOT NULL CHECK(has_native_records IN (0, 1)),
        has_import_exact_records INTEGER NOT NULL CHECK(has_import_exact_records IN (0, 1)),
        has_import_bucket_records INTEGER NOT NULL CHECK(has_import_bucket_records IN (0, 1)),
        computed_revision INTEGER NOT NULL CHECK(computed_revision >= 0),
        updated_at_ms INTEGER NOT NULL DEFAULT 0 CHECK(updated_at_ms >= 0)
    );

    CREATE INDEX IF NOT EXISTS idx_recorded_app_catalog_page
    ON recorded_app_catalog(last_seen_ms DESC, raw_exe_name ASC);

    CREATE INDEX IF NOT EXISTS idx_recorded_app_catalog_search
    ON recorded_app_catalog(raw_exe_name COLLATE NOCASE, display_app_name COLLATE NOCASE);

    CREATE TABLE IF NOT EXISTS activity_hourly_effective (
        bucket_start_ms INTEGER NOT NULL,
        bucket_end_ms INTEGER NOT NULL,
        app_key TEXT NOT NULL CHECK(TRIM(app_key) <> ''),
        raw_exe_name TEXT NOT NULL CHECK(TRIM(raw_exe_name) <> ''),
        display_app_name TEXT NOT NULL DEFAULT '',
        origin TEXT NOT NULL CHECK(origin IN ('native', 'import_exact', 'import_bucket')),
        source_id TEXT NOT NULL,
        effective_duration_ms INTEGER NOT NULL CHECK(effective_duration_ms > 0),
        computed_revision INTEGER NOT NULL CHECK(computed_revision >= 0),
        updated_at_ms INTEGER NOT NULL DEFAULT 0 CHECK(updated_at_ms >= 0),
        PRIMARY KEY(bucket_start_ms, app_key, origin, source_id),
        CHECK(bucket_end_ms > bucket_start_ms),
        CHECK(effective_duration_ms <= bucket_end_ms - bucket_start_ms)
    );

    CREATE INDEX IF NOT EXISTS idx_activity_hourly_range
    ON activity_hourly_effective(bucket_start_ms, bucket_end_ms);

    CREATE INDEX IF NOT EXISTS idx_activity_hourly_app_range
    ON activity_hourly_effective(app_key, bucket_start_ms, effective_duration_ms);

    DROP TRIGGER IF EXISTS trg_read_model_sessions_insert;
    CREATE TRIGGER trg_read_model_sessions_insert
    AFTER INSERT ON sessions
    WHEN TRIM(NEW.exe_name) <> ''
    BEGIN
        UPDATE read_model_revision
        SET source_revision = source_revision + 1,
            updated_at_ms = MAX(0, CAST(strftime('%s', 'now') AS INTEGER) * 1000)
        WHERE id = 1;
        INSERT INTO app_catalog_dirty_keys(app_key, generation, reason, created_at_ms)
        VALUES (
            CASE
                WHEN LOWER(TRIM(NEW.exe_name, ' \"')) LIKE '%.exe' THEN LOWER(TRIM(NEW.exe_name, ' \"'))
                ELSE LOWER(TRIM(NEW.exe_name, ' \"')) || '.exe'
            END,
            (SELECT source_revision FROM read_model_revision WHERE id = 1),
            'native_insert',
            MAX(0, CAST(strftime('%s', 'now') AS INTEGER) * 1000)
        )
        ON CONFLICT(app_key) DO UPDATE SET
            generation = excluded.generation,
            reason = excluded.reason,
            created_at_ms = excluded.created_at_ms;
        INSERT INTO activity_summary_dirty_ranges(start_ms, end_ms, generation, reason, created_at_ms)
        VALUES (
            NEW.start_time - (((NEW.start_time % 3600000) + 3600000) % 3600000),
            MAX(NEW.start_time + 1, COALESCE(NEW.end_time, NEW.start_time + 1))
              + ((3600000 - (((MAX(NEW.start_time + 1, COALESCE(NEW.end_time, NEW.start_time + 1)) % 3600000) + 3600000) % 3600000)) % 3600000),
            (SELECT source_revision FROM read_model_revision WHERE id = 1),
            'native_insert',
            MAX(0, CAST(strftime('%s', 'now') AS INTEGER) * 1000)
        );
    END;

    DROP TRIGGER IF EXISTS trg_read_model_sessions_update;
    CREATE TRIGGER trg_read_model_sessions_update
    AFTER UPDATE OF app_name, exe_name, window_title, start_time, end_time, duration ON sessions
    WHEN OLD.app_name IS NOT NEW.app_name
      OR OLD.exe_name IS NOT NEW.exe_name
      OR OLD.window_title IS NOT NEW.window_title
      OR OLD.start_time IS NOT NEW.start_time
      OR OLD.end_time IS NOT NEW.end_time
      OR OLD.duration IS NOT NEW.duration
    BEGIN
        UPDATE read_model_revision
        SET source_revision = source_revision + 1,
            updated_at_ms = MAX(0, CAST(strftime('%s', 'now') AS INTEGER) * 1000)
        WHERE id = 1;
        INSERT INTO app_catalog_dirty_keys(app_key, generation, reason, created_at_ms)
        SELECT app_key, (SELECT source_revision FROM read_model_revision WHERE id = 1),
               'native_update', MAX(0, CAST(strftime('%s', 'now') AS INTEGER) * 1000)
        FROM (
            SELECT CASE WHEN LOWER(TRIM(OLD.exe_name, ' \"')) LIKE '%.exe'
                        THEN LOWER(TRIM(OLD.exe_name, ' \"'))
                        ELSE LOWER(TRIM(OLD.exe_name, ' \"')) || '.exe' END AS app_key
            UNION
            SELECT CASE WHEN LOWER(TRIM(NEW.exe_name, ' \"')) LIKE '%.exe'
                        THEN LOWER(TRIM(NEW.exe_name, ' \"'))
                        ELSE LOWER(TRIM(NEW.exe_name, ' \"')) || '.exe' END
        ) WHERE TRIM(app_key) <> '' AND app_key <> '.exe'
        ON CONFLICT(app_key) DO UPDATE SET
            generation = excluded.generation,
            reason = excluded.reason,
            created_at_ms = excluded.created_at_ms;
        INSERT INTO activity_summary_dirty_ranges(start_ms, end_ms, generation, reason, created_at_ms)
        VALUES (
            MIN(OLD.start_time, NEW.start_time)
              - (((MIN(OLD.start_time, NEW.start_time) % 3600000) + 3600000) % 3600000),
            MAX(MAX(OLD.start_time + 1, COALESCE(OLD.end_time, OLD.start_time + 1)),
                MAX(NEW.start_time + 1, COALESCE(NEW.end_time, NEW.start_time + 1)))
              + ((3600000 - (((MAX(MAX(OLD.start_time + 1, COALESCE(OLD.end_time, OLD.start_time + 1)),
                                      MAX(NEW.start_time + 1, COALESCE(NEW.end_time, NEW.start_time + 1))) % 3600000)
                                     + 3600000) % 3600000)) % 3600000),
            (SELECT source_revision FROM read_model_revision WHERE id = 1),
            'native_update',
            MAX(0, CAST(strftime('%s', 'now') AS INTEGER) * 1000)
        );
    END;

    DROP TRIGGER IF EXISTS trg_read_model_sessions_delete;
    CREATE TRIGGER trg_read_model_sessions_delete
    AFTER DELETE ON sessions
    WHEN TRIM(OLD.exe_name) <> ''
    BEGIN
        UPDATE read_model_revision
        SET source_revision = source_revision + 1,
            updated_at_ms = MAX(0, CAST(strftime('%s', 'now') AS INTEGER) * 1000)
        WHERE id = 1;
        INSERT INTO app_catalog_dirty_keys(app_key, generation, reason, created_at_ms)
        VALUES (
            CASE WHEN LOWER(TRIM(OLD.exe_name, ' \"')) LIKE '%.exe'
                 THEN LOWER(TRIM(OLD.exe_name, ' \"'))
                 ELSE LOWER(TRIM(OLD.exe_name, ' \"')) || '.exe' END,
            (SELECT source_revision FROM read_model_revision WHERE id = 1),
            'native_delete',
            MAX(0, CAST(strftime('%s', 'now') AS INTEGER) * 1000)
        )
        ON CONFLICT(app_key) DO UPDATE SET
            generation = excluded.generation,
            reason = excluded.reason,
            created_at_ms = excluded.created_at_ms;
        INSERT INTO activity_summary_dirty_ranges(start_ms, end_ms, generation, reason, created_at_ms)
        VALUES (
            OLD.start_time - (((OLD.start_time % 3600000) + 3600000) % 3600000),
            MAX(OLD.start_time + 1, COALESCE(OLD.end_time, OLD.start_time + 1))
              + ((3600000 - (((MAX(OLD.start_time + 1, COALESCE(OLD.end_time, OLD.start_time + 1)) % 3600000) + 3600000) % 3600000)) % 3600000),
            (SELECT source_revision FROM read_model_revision WHERE id = 1),
            'native_delete',
            MAX(0, CAST(strftime('%s', 'now') AS INTEGER) * 1000)
        );
    END;

    DROP TRIGGER IF EXISTS trg_read_model_exact_insert;
    CREATE TRIGGER trg_read_model_exact_insert
    AFTER INSERT ON import_exact_sessions
    WHEN TRIM(NEW.exe_name) <> ''
    BEGIN
        UPDATE read_model_revision SET source_revision = source_revision + 1,
            updated_at_ms = MAX(0, CAST(strftime('%s', 'now') AS INTEGER) * 1000) WHERE id = 1;
        INSERT INTO app_catalog_dirty_keys(app_key, generation, reason, created_at_ms)
        VALUES (CASE WHEN LOWER(TRIM(NEW.exe_name, ' \"')) LIKE '%.exe'
                     THEN LOWER(TRIM(NEW.exe_name, ' \"'))
                     ELSE LOWER(TRIM(NEW.exe_name, ' \"')) || '.exe' END,
                (SELECT source_revision FROM read_model_revision WHERE id = 1),
                'import_exact_insert', MAX(0, CAST(strftime('%s', 'now') AS INTEGER) * 1000))
        ON CONFLICT(app_key) DO UPDATE SET generation = excluded.generation,
            reason = excluded.reason, created_at_ms = excluded.created_at_ms;
        INSERT INTO activity_summary_dirty_ranges(start_ms, end_ms, generation, reason, created_at_ms)
        VALUES (NEW.start_time - (((NEW.start_time % 3600000) + 3600000) % 3600000),
                NEW.end_time + ((3600000 - (((NEW.end_time % 3600000) + 3600000) % 3600000)) % 3600000),
                (SELECT source_revision FROM read_model_revision WHERE id = 1),
                'import_exact_insert', MAX(0, CAST(strftime('%s', 'now') AS INTEGER) * 1000));
    END;

    DROP TRIGGER IF EXISTS trg_read_model_exact_update;
    CREATE TRIGGER trg_read_model_exact_update
    AFTER UPDATE OF app_name, exe_name, window_title, start_time, end_time, duration, batch_id ON import_exact_sessions
    WHEN OLD.app_name IS NOT NEW.app_name OR OLD.exe_name IS NOT NEW.exe_name
      OR OLD.window_title IS NOT NEW.window_title
      OR OLD.start_time IS NOT NEW.start_time OR OLD.end_time IS NOT NEW.end_time
      OR OLD.duration IS NOT NEW.duration OR OLD.batch_id IS NOT NEW.batch_id
    BEGIN
        UPDATE read_model_revision SET source_revision = source_revision + 1,
            updated_at_ms = MAX(0, CAST(strftime('%s', 'now') AS INTEGER) * 1000) WHERE id = 1;
        INSERT INTO app_catalog_dirty_keys(app_key, generation, reason, created_at_ms)
        SELECT app_key, (SELECT source_revision FROM read_model_revision WHERE id = 1),
               'import_exact_update', MAX(0, CAST(strftime('%s', 'now') AS INTEGER) * 1000)
        FROM (
            SELECT CASE WHEN LOWER(TRIM(OLD.exe_name, ' \"')) LIKE '%.exe'
                        THEN LOWER(TRIM(OLD.exe_name, ' \"')) ELSE LOWER(TRIM(OLD.exe_name, ' \"')) || '.exe' END app_key
            UNION
            SELECT CASE WHEN LOWER(TRIM(NEW.exe_name, ' \"')) LIKE '%.exe'
                        THEN LOWER(TRIM(NEW.exe_name, ' \"')) ELSE LOWER(TRIM(NEW.exe_name, ' \"')) || '.exe' END
        ) WHERE TRIM(app_key) <> '' AND app_key <> '.exe'
        ON CONFLICT(app_key) DO UPDATE SET generation = excluded.generation,
            reason = excluded.reason, created_at_ms = excluded.created_at_ms;
        INSERT INTO activity_summary_dirty_ranges(start_ms, end_ms, generation, reason, created_at_ms)
        VALUES (MIN(OLD.start_time, NEW.start_time)
                  - (((MIN(OLD.start_time, NEW.start_time) % 3600000) + 3600000) % 3600000),
                MAX(OLD.end_time, NEW.end_time)
                  + ((3600000 - (((MAX(OLD.end_time, NEW.end_time) % 3600000) + 3600000) % 3600000)) % 3600000),
                (SELECT source_revision FROM read_model_revision WHERE id = 1),
                'import_exact_update', MAX(0, CAST(strftime('%s', 'now') AS INTEGER) * 1000));
    END;

    DROP TRIGGER IF EXISTS trg_read_model_exact_delete;
    CREATE TRIGGER trg_read_model_exact_delete
    AFTER DELETE ON import_exact_sessions
    WHEN TRIM(OLD.exe_name) <> ''
    BEGIN
        UPDATE read_model_revision SET source_revision = source_revision + 1,
            updated_at_ms = MAX(0, CAST(strftime('%s', 'now') AS INTEGER) * 1000) WHERE id = 1;
        INSERT INTO app_catalog_dirty_keys(app_key, generation, reason, created_at_ms)
        VALUES (CASE WHEN LOWER(TRIM(OLD.exe_name, ' \"')) LIKE '%.exe'
                     THEN LOWER(TRIM(OLD.exe_name, ' \"')) ELSE LOWER(TRIM(OLD.exe_name, ' \"')) || '.exe' END,
                (SELECT source_revision FROM read_model_revision WHERE id = 1),
                'import_exact_delete', MAX(0, CAST(strftime('%s', 'now') AS INTEGER) * 1000))
        ON CONFLICT(app_key) DO UPDATE SET generation = excluded.generation,
            reason = excluded.reason, created_at_ms = excluded.created_at_ms;
        INSERT INTO activity_summary_dirty_ranges(start_ms, end_ms, generation, reason, created_at_ms)
        VALUES (OLD.start_time - (((OLD.start_time % 3600000) + 3600000) % 3600000),
                OLD.end_time + ((3600000 - (((OLD.end_time % 3600000) + 3600000) % 3600000)) % 3600000),
                (SELECT source_revision FROM read_model_revision WHERE id = 1),
                'import_exact_delete', MAX(0, CAST(strftime('%s', 'now') AS INTEGER) * 1000));
    END;

    DROP TRIGGER IF EXISTS trg_read_model_bucket_insert;
    CREATE TRIGGER trg_read_model_bucket_insert
    AFTER INSERT ON import_time_buckets
    WHEN TRIM(NEW.exe_name) <> ''
    BEGIN
        UPDATE read_model_revision SET source_revision = source_revision + 1,
            updated_at_ms = MAX(0, CAST(strftime('%s', 'now') AS INTEGER) * 1000) WHERE id = 1;
        INSERT INTO app_catalog_dirty_keys(app_key, generation, reason, created_at_ms)
        VALUES (CASE WHEN LOWER(TRIM(NEW.exe_name, ' \"')) LIKE '%.exe'
                     THEN LOWER(TRIM(NEW.exe_name, ' \"')) ELSE LOWER(TRIM(NEW.exe_name, ' \"')) || '.exe' END,
                (SELECT source_revision FROM read_model_revision WHERE id = 1),
                'import_bucket_insert', MAX(0, CAST(strftime('%s', 'now') AS INTEGER) * 1000))
        ON CONFLICT(app_key) DO UPDATE SET generation = excluded.generation,
            reason = excluded.reason, created_at_ms = excluded.created_at_ms;
        INSERT INTO activity_summary_dirty_ranges(start_ms, end_ms, generation, reason, created_at_ms)
        VALUES (NEW.bucket_start_time - (((NEW.bucket_start_time % 3600000) + 3600000) % 3600000),
                NEW.bucket_start_time - (((NEW.bucket_start_time % 3600000) + 3600000) % 3600000) + 3600000,
                (SELECT source_revision FROM read_model_revision WHERE id = 1),
                'import_bucket_insert', MAX(0, CAST(strftime('%s', 'now') AS INTEGER) * 1000));
    END;

    DROP TRIGGER IF EXISTS trg_read_model_bucket_update;
    CREATE TRIGGER trg_read_model_bucket_update
    AFTER UPDATE OF app_name, exe_name, bucket_start_time, duration, batch_id ON import_time_buckets
    WHEN OLD.app_name IS NOT NEW.app_name OR OLD.exe_name IS NOT NEW.exe_name
      OR OLD.bucket_start_time IS NOT NEW.bucket_start_time OR OLD.duration IS NOT NEW.duration
      OR OLD.batch_id IS NOT NEW.batch_id
    BEGIN
        UPDATE read_model_revision SET source_revision = source_revision + 1,
            updated_at_ms = MAX(0, CAST(strftime('%s', 'now') AS INTEGER) * 1000) WHERE id = 1;
        INSERT INTO app_catalog_dirty_keys(app_key, generation, reason, created_at_ms)
        SELECT app_key, (SELECT source_revision FROM read_model_revision WHERE id = 1),
               'import_bucket_update', MAX(0, CAST(strftime('%s', 'now') AS INTEGER) * 1000)
        FROM (
            SELECT CASE WHEN LOWER(TRIM(OLD.exe_name, ' \"')) LIKE '%.exe'
                        THEN LOWER(TRIM(OLD.exe_name, ' \"')) ELSE LOWER(TRIM(OLD.exe_name, ' \"')) || '.exe' END app_key
            UNION
            SELECT CASE WHEN LOWER(TRIM(NEW.exe_name, ' \"')) LIKE '%.exe'
                        THEN LOWER(TRIM(NEW.exe_name, ' \"')) ELSE LOWER(TRIM(NEW.exe_name, ' \"')) || '.exe' END
        ) WHERE TRIM(app_key) <> '' AND app_key <> '.exe'
        ON CONFLICT(app_key) DO UPDATE SET generation = excluded.generation,
            reason = excluded.reason, created_at_ms = excluded.created_at_ms;
        INSERT INTO activity_summary_dirty_ranges(start_ms, end_ms, generation, reason, created_at_ms)
        VALUES (MIN(OLD.bucket_start_time, NEW.bucket_start_time)
                  - (((MIN(OLD.bucket_start_time, NEW.bucket_start_time) % 3600000) + 3600000) % 3600000),
                MAX(OLD.bucket_start_time, NEW.bucket_start_time)
                  - (((MAX(OLD.bucket_start_time, NEW.bucket_start_time) % 3600000) + 3600000) % 3600000) + 3600000,
                (SELECT source_revision FROM read_model_revision WHERE id = 1),
                'import_bucket_update', MAX(0, CAST(strftime('%s', 'now') AS INTEGER) * 1000));
    END;

    DROP TRIGGER IF EXISTS trg_read_model_bucket_delete;
    CREATE TRIGGER trg_read_model_bucket_delete
    AFTER DELETE ON import_time_buckets
    WHEN TRIM(OLD.exe_name) <> ''
    BEGIN
        UPDATE read_model_revision SET source_revision = source_revision + 1,
            updated_at_ms = MAX(0, CAST(strftime('%s', 'now') AS INTEGER) * 1000) WHERE id = 1;
        INSERT INTO app_catalog_dirty_keys(app_key, generation, reason, created_at_ms)
        VALUES (CASE WHEN LOWER(TRIM(OLD.exe_name, ' \"')) LIKE '%.exe'
                     THEN LOWER(TRIM(OLD.exe_name, ' \"')) ELSE LOWER(TRIM(OLD.exe_name, ' \"')) || '.exe' END,
                (SELECT source_revision FROM read_model_revision WHERE id = 1),
                'import_bucket_delete', MAX(0, CAST(strftime('%s', 'now') AS INTEGER) * 1000))
        ON CONFLICT(app_key) DO UPDATE SET generation = excluded.generation,
            reason = excluded.reason, created_at_ms = excluded.created_at_ms;
        INSERT INTO activity_summary_dirty_ranges(start_ms, end_ms, generation, reason, created_at_ms)
        VALUES (OLD.bucket_start_time - (((OLD.bucket_start_time % 3600000) + 3600000) % 3600000),
                OLD.bucket_start_time - (((OLD.bucket_start_time % 3600000) + 3600000) % 3600000) + 3600000,
                (SELECT source_revision FROM read_model_revision WHERE id = 1),
                'import_bucket_delete', MAX(0, CAST(strftime('%s', 'now') AS INTEGER) * 1000));
    END;
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
        Migration {
            version: WEB_FAVICON_CACHE_MIGRATION_VERSION,
            description: WEB_FAVICON_CACHE_MIGRATION_DESCRIPTION,
            sql: WEB_FAVICON_CACHE_SCHEMA_SQL,
            kind: MigrationKind::Up,
        },
        Migration {
            version: IMPORT_DATA_MIGRATION_VERSION,
            description: IMPORT_DATA_MIGRATION_DESCRIPTION,
            sql: IMPORT_DATA_SCHEMA_SQL,
            kind: MigrationKind::Up,
        },
        Migration {
            version: IMPORT_DATA_ISOLATION_MIGRATION_VERSION,
            description: IMPORT_DATA_ISOLATION_MIGRATION_DESCRIPTION,
            sql: IMPORT_DATA_ISOLATION_SCHEMA_SQL,
            kind: MigrationKind::Up,
        },
        Migration {
            version: ACTIVITY_READ_MODELS_MIGRATION_VERSION,
            description: ACTIVITY_READ_MODELS_MIGRATION_DESCRIPTION,
            sql: ACTIVITY_READ_MODELS_SCHEMA_SQL,
            kind: MigrationKind::Up,
        },
        Migration {
            version: WEB_ACTIVITY_REVISION_MIGRATION_VERSION,
            description: WEB_ACTIVITY_REVISION_MIGRATION_DESCRIPTION,
            sql: WEB_ACTIVITY_REVISION_SCHEMA_SQL,
            kind: MigrationKind::Up,
        },
        Migration {
            version: SCHEDULED_BACKUP_MIGRATION_VERSION,
            description: SCHEDULED_BACKUP_MIGRATION_DESCRIPTION,
            sql: SCHEDULED_BACKUP_SCHEMA_SQL,
            kind: MigrationKind::Up,
        },
        Migration {
            version: SCHEDULED_BACKUP_TARGETS_MIGRATION_VERSION,
            description: SCHEDULED_BACKUP_TARGETS_MIGRATION_DESCRIPTION,
            sql: SCHEDULED_BACKUP_TARGETS_SCHEMA_SQL,
            kind: MigrationKind::Up,
        },
        Migration {
            version: SCHEDULED_EXPORT_MIGRATION_VERSION,
            description: SCHEDULED_EXPORT_MIGRATION_DESCRIPTION,
            sql: SCHEDULED_EXPORT_SCHEMA_SQL,
            kind: MigrationKind::Up,
        },
        Migration {
            version: ACTIVITY_REMINDER_RULES_MIGRATION_VERSION,
            description: ACTIVITY_REMINDER_RULES_MIGRATION_DESCRIPTION,
            sql: ACTIVITY_REMINDER_RULES_SCHEMA_SQL,
            kind: MigrationKind::Up,
        },
    ]
}

#[cfg(test)]
mod query_plan_diagnostics {
    use super::{
        ACTIVITY_READ_MODELS_SCHEMA_SQL, CURRENT_BASELINE_SCHEMA_SQL,
        IMPORT_DATA_ISOLATION_SCHEMA_SQL, IMPORT_DATA_SCHEMA_SQL, WEB_ACTIVITY_SCHEMA_SQL,
    };
    use chrono::Utc;
    use serde::Serialize;
    use sqlx::{Executor, Row, SqlitePool};
    use std::time::Instant;

    const DAY_MS: i64 = 24 * 60 * 60 * 1000;
    const NOW_MS: i64 = 1_781_614_400_000;
    const RANGE_START_MS: i64 = NOW_MS - 365 * DAY_MS;
    const RANGE_END_MS: i64 = NOW_MS;
    const SESSION_COUNT: i64 = 48_000;
    const WEB_SEGMENT_COUNT: i64 = 12_000;

    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct QueryMeasurement {
        name: &'static str,
        row_count: usize,
        duration_ms: f64,
        plan: Vec<String>,
        uses_table_scan: bool,
        uses_temp_sort: bool,
        uses_index: bool,
    }

    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct QueryPlanReport {
        benchmark: &'static str,
        measured_at: String,
        measurements: Vec<QueryMeasurement>,
        metadata: QueryPlanMetadata,
    }

    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct QueryPlanMetadata {
        session_count: i64,
        web_segment_count: i64,
        range_start_ms: i64,
        range_end_ms: i64,
        notes: Vec<&'static str>,
    }

    async fn create_pool() -> SqlitePool {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        pool.execute(CURRENT_BASELINE_SCHEMA_SQL).await.unwrap();
        pool.execute(WEB_ACTIVITY_SCHEMA_SQL).await.unwrap();
        pool.execute(IMPORT_DATA_SCHEMA_SQL).await.unwrap();
        pool.execute(IMPORT_DATA_ISOLATION_SCHEMA_SQL)
            .await
            .unwrap();
        pool.execute(ACTIVITY_READ_MODELS_SCHEMA_SQL).await.unwrap();
        pool
    }

    async fn seed_sessions(pool: &SqlitePool) {
        let mut tx = pool.begin().await.unwrap();
        for index in 0..SESSION_COUNT {
            let start_time = RANGE_START_MS + (index * 11 * 60 * 1000);
            let duration = 2 * 60 * 1000 + (index % 17) * 45 * 1000;
            let end_time = if index == SESSION_COUNT - 1 {
                None
            } else {
                Some(start_time + duration)
            };
            let app_index = index % 12;
            sqlx::query(
                "INSERT INTO sessions (
                    app_name,
                    exe_name,
                    window_title,
                    start_time,
                    end_time,
                    duration,
                    continuity_group_start_time
                 ) VALUES (?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(format!("App {app_index}"))
            .bind(format!("app-{app_index}.exe"))
            .bind("Synthetic title")
            .bind(start_time)
            .bind(end_time)
            .bind(end_time.map(|value| value - start_time))
            .bind(start_time)
            .execute(&mut *tx)
            .await
            .unwrap();
        }

        for session_id in 1..=2_000_i64 {
            let start_time = RANGE_START_MS + (session_id * 13 * 60 * 1000);
            sqlx::query(
                "INSERT INTO session_title_samples (
                    session_id,
                    title,
                    start_time,
                    end_time
                 ) VALUES (?, ?, ?, ?)",
            )
            .bind(session_id)
            .bind("Synthetic title sample")
            .bind(start_time)
            .bind(start_time + 60 * 1000)
            .execute(&mut *tx)
            .await
            .unwrap();
        }

        tx.commit().await.unwrap();
    }

    async fn seed_web_segments(pool: &SqlitePool) {
        let mut tx = pool.begin().await.unwrap();
        for index in 0..WEB_SEGMENT_COUNT {
            let start_time = RANGE_START_MS + (index * 29 * 60 * 1000);
            let duration = 30 * 1000 + (index % 11) * 20 * 1000;
            let end_time = if index == WEB_SEGMENT_COUNT - 1 {
                None
            } else {
                Some(start_time + duration)
            };
            let domain_index = index % 30;
            sqlx::query(
                "INSERT INTO web_activity_segments (
                    browser_client_id,
                    browser_kind,
                    browser_exe_name,
                    domain,
                    normalized_domain,
                    url,
                    title,
                    favicon_url,
                    start_time,
                    end_time,
                    duration,
                    source,
                    created_at,
                    updated_at
                 ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .bind("synthetic-browser")
            .bind("chrome")
            .bind("chrome.exe")
            .bind(format!("example-{domain_index}.test"))
            .bind(format!("example-{domain_index}.test"))
            .bind(None::<String>)
            .bind(None::<String>)
            .bind(None::<String>)
            .bind(start_time)
            .bind(end_time)
            .bind(end_time.map(|value| value - start_time))
            .bind("query-plan-test")
            .bind(start_time)
            .bind(start_time)
            .execute(&mut *tx)
            .await
            .unwrap();
        }
        tx.commit().await.unwrap();
    }

    async fn explain_query(pool: &SqlitePool, sql: &str, binds: &[i64]) -> Vec<String> {
        let explain_sql = format!("EXPLAIN QUERY PLAN {sql}");
        let mut query = sqlx::query(&explain_sql);
        for bind in binds {
            query = query.bind(*bind);
        }

        query
            .fetch_all(pool)
            .await
            .unwrap()
            .into_iter()
            .map(|row| row.get::<String, _>("detail"))
            .collect()
    }

    fn summarize_plan(plan: &[String]) -> (bool, bool, bool) {
        let joined = plan.join("\n").to_ascii_uppercase();
        (
            joined.contains("SCAN SESSIONS") || joined.contains("SCAN WEB_ACTIVITY_SEGMENTS"),
            joined.contains("USE TEMP B-TREE"),
            joined.contains("USING INDEX") || joined.contains("USING COVERING INDEX"),
        )
    }

    async fn measure_session_summary_current(pool: &SqlitePool) -> QueryMeasurement {
        let sql = "SELECT app_name,
                          exe_name,
                          window_title,
                          start_time,
                          COALESCE(end_time, ?) AS effective_end_time
                   FROM sessions
                   WHERE start_time < ?
                     AND COALESCE(end_time, ?) > ?
                   ORDER BY start_time ASC";
        let plan = explain_query(pool, sql, &[NOW_MS, RANGE_END_MS, NOW_MS, RANGE_START_MS]).await;
        let started_at = Instant::now();
        let rows = sqlx::query(sql)
            .bind(NOW_MS)
            .bind(RANGE_END_MS)
            .bind(NOW_MS)
            .bind(RANGE_START_MS)
            .fetch_all(pool)
            .await
            .unwrap();
        build_measurement("sessions-current-coalesce", rows.len(), started_at, plan)
    }

    async fn measure_session_summary_split(
        pool: &SqlitePool,
        name: &'static str,
    ) -> QueryMeasurement {
        let closed_sql = "SELECT app_name,
                                 exe_name,
                                 window_title,
                                 start_time,
                                 end_time AS effective_end_time
                          FROM sessions
                          WHERE start_time < ?
                            AND end_time IS NOT NULL
                            AND end_time > ?
                          ORDER BY start_time ASC";
        let active_sql = "SELECT app_name,
                                 exe_name,
                                 window_title,
                                 start_time,
                                 ? AS effective_end_time
                          FROM sessions
                          WHERE start_time < ?
                            AND end_time IS NULL
                          ORDER BY start_time ASC";
        let mut plan = explain_query(pool, closed_sql, &[RANGE_END_MS, RANGE_START_MS]).await;
        plan.extend(
            explain_query(pool, active_sql, &[NOW_MS, RANGE_END_MS])
                .await
                .into_iter()
                .map(|detail| format!("active: {detail}")),
        );

        let started_at = Instant::now();
        let closed_rows = sqlx::query(closed_sql)
            .bind(RANGE_END_MS)
            .bind(RANGE_START_MS)
            .fetch_all(pool)
            .await
            .unwrap();
        let active_rows = sqlx::query(active_sql)
            .bind(NOW_MS)
            .bind(RANGE_END_MS)
            .fetch_all(pool)
            .await
            .unwrap();
        build_measurement(
            name,
            closed_rows.len() + active_rows.len(),
            started_at,
            plan,
        )
    }

    async fn measure_title_samples(pool: &SqlitePool) -> QueryMeasurement {
        let sample_ids = (1..=64).map(|_| "?").collect::<Vec<_>>().join(", ");
        let sql = format!(
            "SELECT session_id, title, start_time, end_time
             FROM session_title_samples
             WHERE session_id IN ({sample_ids})
               AND start_time < ?
               AND COALESCE(end_time, ?) > ?
             ORDER BY session_id ASC, start_time ASC, id ASC",
        );
        let mut binds = (1..=64).collect::<Vec<_>>();
        binds.extend([RANGE_END_MS, NOW_MS, RANGE_START_MS]);
        let plan = explain_query(pool, &sql, &binds).await;
        let mut query = sqlx::query(&sql);
        for bind in &binds {
            query = query.bind(*bind);
        }
        let started_at = Instant::now();
        let rows = query.fetch_all(pool).await.unwrap();
        build_measurement(
            "session-title-samples-current",
            rows.len(),
            started_at,
            plan,
        )
    }

    async fn measure_web_activity_current(pool: &SqlitePool) -> QueryMeasurement {
        let sql = "SELECT id,
                          browser_client_id,
                          browser_kind,
                          browser_exe_name,
                          domain,
                          normalized_domain,
                          start_time,
                          end_time,
                          COALESCE(duration, MAX(0, ? - start_time)) AS duration
                   FROM web_activity_segments
                   WHERE start_time < ?
                     AND COALESCE(end_time, ?) > ?
                   ORDER BY start_time ASC, id ASC";
        let plan = explain_query(pool, sql, &[NOW_MS, RANGE_END_MS, NOW_MS, RANGE_START_MS]).await;
        let started_at = Instant::now();
        let rows = sqlx::query(sql)
            .bind(NOW_MS)
            .bind(RANGE_END_MS)
            .bind(NOW_MS)
            .bind(RANGE_START_MS)
            .fetch_all(pool)
            .await
            .unwrap();
        build_measurement(
            "web-activity-current-coalesce",
            rows.len(),
            started_at,
            plan,
        )
    }

    async fn measure_web_activity_analysis_range(pool: &SqlitePool) -> QueryMeasurement {
        let sql = "SELECT normalized_domain, start_time, COALESCE(end_time, ?) effective_end_time
                   FROM web_activity_segments
                   WHERE start_time < ?
                     AND COALESCE(end_time, ?) > ?";
        let plan = explain_query(pool, sql, &[NOW_MS, RANGE_END_MS, NOW_MS, RANGE_START_MS]).await;
        let started_at = Instant::now();
        let rows = sqlx::query(sql)
            .bind(NOW_MS)
            .bind(RANGE_END_MS)
            .bind(NOW_MS)
            .bind(RANGE_START_MS)
            .fetch_all(pool)
            .await
            .unwrap();
        build_measurement(
            "web-activity-analysis-range-index",
            rows.len(),
            started_at,
            plan,
        )
    }

    async fn measure_web_activity_analysis_domain_range(pool: &SqlitePool) -> QueryMeasurement {
        let sql = "SELECT normalized_domain, start_time, COALESCE(end_time, ?) effective_end_time
                   FROM web_activity_segments
                   WHERE normalized_domain = ?
                     AND start_time < ?
                     AND COALESCE(end_time, ?) > ?";
        let explain_sql = format!("EXPLAIN QUERY PLAN {sql}");
        let plan = sqlx::query(&explain_sql)
            .bind(NOW_MS)
            .bind("example-1.test")
            .bind(RANGE_END_MS)
            .bind(NOW_MS)
            .bind(RANGE_START_MS)
            .fetch_all(pool)
            .await
            .unwrap()
            .into_iter()
            .map(|row| row.get::<String, _>("detail"))
            .collect();
        let started_at = Instant::now();
        let rows = sqlx::query(sql)
            .bind(NOW_MS)
            .bind("example-1.test")
            .bind(RANGE_END_MS)
            .bind(NOW_MS)
            .bind(RANGE_START_MS)
            .fetch_all(pool)
            .await
            .unwrap();
        build_measurement(
            "web-activity-analysis-domain-range-index",
            rows.len(),
            started_at,
            plan,
        )
    }

    async fn seed_activity_projections(pool: &SqlitePool) {
        let mut tx = pool.begin().await.unwrap();
        for day in 0..365_i64 {
            let bucket_start_ms = RANGE_START_MS + day * DAY_MS + 9 * 60 * 60 * 1000;
            for app_index in 0..12_i64 {
                sqlx::query(
                    "INSERT INTO activity_hourly_effective(
                       bucket_start_ms, bucket_end_ms, app_key, raw_exe_name,
                       display_app_name, origin, source_id, effective_duration_ms,
                       computed_revision, updated_at_ms
                     ) VALUES (?, ?, ?, ?, ?, 'native', ?, ?, 1, ?)",
                )
                .bind(bucket_start_ms)
                .bind(bucket_start_ms + 60 * 60 * 1000)
                .bind(format!("app-{app_index}.exe"))
                .bind(format!("app-{app_index}.exe"))
                .bind(format!("App {app_index}"))
                .bind(format!("native:{day}:{app_index}"))
                .bind(10 * 60 * 1000 + app_index * 1000)
                .bind(NOW_MS)
                .execute(&mut *tx)
                .await
                .unwrap();
            }
        }
        for app_index in 0..12_i64 {
            sqlx::query(
                "INSERT INTO recorded_app_catalog(
                   app_key, raw_exe_name, display_app_name, last_seen_ms,
                   has_native_records, has_import_exact_records, has_import_bucket_records,
                   computed_revision, updated_at_ms
                 ) VALUES (?, ?, ?, ?, 1, 0, 0, 1, ?)",
            )
            .bind(format!("app-{app_index}.exe"))
            .bind(format!("app-{app_index}.exe"))
            .bind(format!("App {app_index}"))
            .bind(NOW_MS - app_index * DAY_MS)
            .bind(NOW_MS)
            .execute(&mut *tx)
            .await
            .unwrap();
        }
        tx.commit().await.unwrap();
    }

    async fn measure_hourly_projection(pool: &SqlitePool) -> QueryMeasurement {
        let sql = "SELECT bucket_start_ms, bucket_end_ms, raw_exe_name,
                          display_app_name, effective_duration_ms
                   FROM activity_hourly_effective
                   WHERE bucket_start_ms < ? AND bucket_end_ms > ?
                   ORDER BY bucket_start_ms ASC, app_key ASC, origin ASC, source_id ASC";
        let plan = explain_query(pool, sql, &[RANGE_END_MS, RANGE_START_MS]).await;
        let started_at = Instant::now();
        let rows = sqlx::query(sql)
            .bind(RANGE_END_MS)
            .bind(RANGE_START_MS)
            .fetch_all(pool)
            .await
            .unwrap();
        build_measurement(
            "activity-hourly-projection-year",
            rows.len(),
            started_at,
            plan,
        )
    }

    async fn measure_catalog_projection(pool: &SqlitePool) -> QueryMeasurement {
        let sql = "SELECT raw_exe_name, display_app_name, last_seen_ms, has_native_records
                   FROM recorded_app_catalog
                   ORDER BY last_seen_ms DESC, raw_exe_name ASC LIMIT 60";
        let plan = explain_query(pool, sql, &[]).await;
        let started_at = Instant::now();
        let rows = sqlx::query(sql).fetch_all(pool).await.unwrap();
        build_measurement(
            "recorded-app-catalog-projection",
            rows.len(),
            started_at,
            plan,
        )
    }

    fn build_measurement(
        name: &'static str,
        row_count: usize,
        started_at: Instant,
        plan: Vec<String>,
    ) -> QueryMeasurement {
        let (uses_table_scan, uses_temp_sort, uses_index) = summarize_plan(&plan);
        QueryMeasurement {
            name,
            row_count,
            duration_ms: started_at.elapsed().as_secs_f64() * 1000.0,
            plan,
            uses_table_scan,
            uses_temp_sort,
            uses_index,
        }
    }

    #[tokio::test]
    #[ignore = "run with npm run perf:sqlite-query-plan"]
    async fn session_range_query_plan_report() {
        let pool = create_pool().await;
        seed_sessions(&pool).await;
        seed_web_segments(&pool).await;
        seed_activity_projections(&pool).await;

        let mut measurements = vec![
            measure_session_summary_current(&pool).await,
            measure_session_summary_split(&pool, "sessions-split-closed-active-baseline").await,
            measure_title_samples(&pool).await,
            measure_web_activity_current(&pool).await,
            measure_web_activity_analysis_range(&pool).await,
            measure_web_activity_analysis_domain_range(&pool).await,
            measure_hourly_projection(&pool).await,
            measure_catalog_projection(&pool).await,
        ];

        pool.execute(
            "CREATE INDEX IF NOT EXISTS idx_sessions_closed_end_start_candidate
             ON sessions(end_time, start_time)
             WHERE end_time IS NOT NULL",
        )
        .await
        .unwrap();
        pool.execute(
            "CREATE INDEX IF NOT EXISTS idx_sessions_active_start_candidate
             ON sessions(start_time)
             WHERE end_time IS NULL",
        )
        .await
        .unwrap();
        measurements.push(
            measure_session_summary_split(&pool, "sessions-split-closed-active-candidate-indexes")
                .await,
        );

        let report = QueryPlanReport {
            benchmark: "sqlite-session-query-plan",
            measured_at: Utc::now().to_rfc3339(),
            measurements,
            metadata: QueryPlanMetadata {
                session_count: SESSION_COUNT,
                web_segment_count: WEB_SEGMENT_COUNT,
                range_start_ms: RANGE_START_MS,
                range_end_ms: RANGE_END_MS,
                notes: vec![
                    "Synthetic in-memory SQLite data; no product migration or user database is modified.",
                    "Candidate indexes are created only after baseline measurements in the temporary database.",
                    "Use this report to decide whether a real migration deserves a separate execution plan.",
                ],
            },
        };
        println!(
            "PATINA_QUERY_PLAN_REPORT_JSON:{}",
            serde_json::to_string_pretty(&report).unwrap()
        );
    }
}
