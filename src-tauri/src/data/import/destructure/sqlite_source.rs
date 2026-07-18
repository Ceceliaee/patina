use super::{ExternalConversion, ExternalWarning};
use crate::data::import::model::{CanonicalImportRecord, ImportRecordType, MAX_IMPORT_RECORDS};
use chrono::{DateTime, Local, NaiveDateTime, TimeZone};
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::{Pool, Row, Sqlite};
use std::collections::HashMap;
use std::path::Path;

const APP_TABLES: &[&str] = &["AppModels", "App", "Apps", "Process", "Processes"];
const SESSION_TABLES: &[&str] = &["AppSessions", "Sessions", "SessionModels"];
const HOUR_TABLES: &[&str] = &[
    "HoursLog",
    "HoursLogModels",
    "Hours",
    "AppHours",
    "HourModels",
];

pub async fn convert_sqlite_source(path: &Path) -> Result<ExternalConversion, String> {
    let options = SqliteConnectOptions::new()
        .filename(path)
        .read_only(true)
        .pragma("query_only", "ON")
        .pragma("trusted_schema", "OFF");
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(options)
        .await
        .map_err(|error| format!("failed to open external SQLite database: {error}"))?;
    let result = convert_pool(&pool).await;
    pool.close().await;
    result
}

async fn convert_pool(pool: &Pool<Sqlite>) -> Result<ExternalConversion, String> {
    let tables = table_names(pool).await?;
    let app_table = find_table(&tables, APP_TABLES)
        .ok_or_else(|| "unrecognized Tai/Taix database: application table not found".to_string())?;
    let session_table = find_table(&tables, SESSION_TABLES);
    let hour_table = find_table(&tables, HOUR_TABLES);
    if session_table.is_none() && hour_table.is_none() {
        return Err(
            "unrecognized Tai/Taix database: no supported session or hour table".to_string(),
        );
    }

    let app_columns = table_columns(pool, app_table).await?;
    let app_id = find_column(&app_columns, &["ID", "Id", "AppID", "AppId"])
        .ok_or_else(|| "application table is missing its id column".to_string())?;
    let app_file = find_column(&app_columns, &["File", "Path", "ProcessPath"]);
    let app_name = find_column(&app_columns, &["Name", "ProcessName"]);
    let app_alias = find_column(&app_columns, &["Alias"]);
    let app_description = find_column(&app_columns, &["Description", "Desc"]);

    let mut records = Vec::new();
    let mut warnings = Vec::new();
    if let Some(table) = session_table {
        decode_exact_sessions(
            pool,
            table,
            app_table,
            app_id,
            app_file,
            app_name,
            app_alias,
            app_description,
            &mut records,
            &mut warnings,
        )
        .await?;
    }
    let exact_start_boundaries = records
        .iter()
        .filter(|record| record.record_type == ImportRecordType::ExactSession)
        .fold(HashMap::<String, i64>::new(), |mut boundaries, record| {
            boundaries
                .entry(record.exe_name.clone())
                .and_modify(|boundary| *boundary = (*boundary).min(record.start_time_ms))
                .or_insert(record.start_time_ms);
            boundaries
        });
    if let Some(table) = hour_table {
        decode_hour_buckets(
            pool,
            table,
            app_table,
            app_id,
            app_file,
            app_name,
            app_alias,
            app_description,
            &exact_start_boundaries,
            &mut records,
            &mut warnings,
        )
        .await?;
    }
    if records.len() > MAX_IMPORT_RECORDS {
        return Err(format!(
            "external database exceeds the {MAX_IMPORT_RECORDS} record safety limit"
        ));
    }

    Ok(ExternalConversion {
        source_kind: if session_table.is_some() {
            "taix-db".to_string()
        } else {
            "tai-db".to_string()
        },
        records,
        warnings,
    })
}

#[allow(clippy::too_many_arguments)]
async fn decode_exact_sessions(
    pool: &Pool<Sqlite>,
    session_table: &'static str,
    app_table: &'static str,
    app_id: &'static str,
    app_file: Option<&'static str>,
    app_name: Option<&'static str>,
    app_alias: Option<&'static str>,
    app_description: Option<&'static str>,
    records: &mut Vec<CanonicalImportRecord>,
    warnings: &mut Vec<ExternalWarning>,
) -> Result<(), String> {
    let columns = table_columns(pool, session_table).await?;
    let app_fk = find_column(&columns, &["AppModelID", "AppModelId", "AppID", "AppId"])
        .ok_or_else(|| "session table is missing its application id column".to_string())?;
    let start = find_column(&columns, &["StartTime", "StartedAt", "Start"])
        .ok_or_else(|| "session table is missing StartTime".to_string())?;
    let end = find_column(&columns, &["EndTime", "EndedAt", "End"])
        .ok_or_else(|| "session table is missing EndTime".to_string())?;
    let title = find_column(&columns, &["Title", "WindowTitle"]);
    let sql = format!(
        "SELECT CAST(s.{} AS TEXT) AS start_value,
                CAST(s.{} AS TEXT) AS end_value,
                {} AS title_value,
                {} AS file_value,
                {} AS name_value,
                {} AS alias_value,
                {} AS description_value
         FROM {} AS s
         JOIN {} AS a ON a.{} = s.{}
         ORDER BY s.{} ASC
         LIMIT {}",
        q(start),
        q(end),
        text_expr("s", title),
        text_expr("a", app_file),
        text_expr("a", app_name),
        text_expr("a", app_alias),
        text_expr("a", app_description),
        q(session_table),
        q(app_table),
        q(app_id),
        q(app_fk),
        q(start),
        MAX_IMPORT_RECORDS + 1,
    );
    let rows = sqlx::query(&sql)
        .fetch_all(pool)
        .await
        .map_err(|error| format!("failed to read Taix sessions: {error}"))?;
    if rows.len() > MAX_IMPORT_RECORDS {
        return Err(format!(
            "external database exceeds the {MAX_IMPORT_RECORDS} record safety limit"
        ));
    }
    for (index, row) in rows.into_iter().enumerate() {
        let line = index + 1;
        let start_value = row
            .try_get::<Option<String>, _>("start_value")
            .ok()
            .flatten();
        let end_value = row.try_get::<Option<String>, _>("end_value").ok().flatten();
        let Some(start_time_ms) = start_value.as_deref().and_then(parse_external_timestamp) else {
            warnings.push(warning(line, "invalid exact session start time"));
            continue;
        };
        let Some(end_time_ms) = end_value.as_deref().and_then(parse_external_timestamp) else {
            warnings.push(warning(line, "invalid exact session end time"));
            continue;
        };
        if end_time_ms <= start_time_ms {
            warnings.push(warning(line, "exact session end is not after start"));
            continue;
        }
        let file = row_text(&row, "file_value");
        let name = row_text(&row, "name_value");
        let Some(exe_name) = resolve_exe_name(file.as_deref(), name.as_deref()) else {
            warnings.push(warning(line, "application has no reliable executable file"));
            continue;
        };
        records.push(CanonicalImportRecord {
            source_line: line,
            record_type: ImportRecordType::ExactSession,
            start_time_ms,
            end_time_ms: Some(end_time_ms),
            duration_ms: end_time_ms - start_time_ms,
            exe_name,
            app_name: first_text(&[
                row_text(&row, "alias_value"),
                row_text(&row, "description_value"),
                name,
            ]),
            title: row_text(&row, "title_value"),
            category: None,
        });
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
async fn decode_hour_buckets(
    pool: &Pool<Sqlite>,
    hour_table: &'static str,
    app_table: &'static str,
    app_id: &'static str,
    app_file: Option<&'static str>,
    app_name: Option<&'static str>,
    app_alias: Option<&'static str>,
    app_description: Option<&'static str>,
    exact_start_boundaries: &HashMap<String, i64>,
    records: &mut Vec<CanonicalImportRecord>,
    warnings: &mut Vec<ExternalWarning>,
) -> Result<(), String> {
    let columns = table_columns(pool, hour_table).await?;
    let app_fk = find_column(
        &columns,
        &[
            "AppModelID",
            "AppModelId",
            "AppID",
            "AppId",
            "ProcessID",
            "ProcessId",
        ],
    )
    .ok_or_else(|| "hour table is missing its application id column".to_string())?;
    let start = find_column(
        &columns,
        &["DataTime", "StartTime", "HourStart", "DateTime"],
    )
    .ok_or_else(|| "hour table is missing its time column".to_string())?;
    let duration = find_column(&columns, &["Time", "Duration", "TotalTime"])
        .ok_or_else(|| "hour table is missing its duration column".to_string())?;
    let duration_is_seconds =
        matches!(duration.to_ascii_lowercase().as_str(), "time" | "totaltime");
    let sql = format!(
        "SELECT CAST(h.{} AS TEXT) AS start_value,
                CAST(h.{} AS TEXT) AS duration_value,
                {} AS file_value,
                {} AS name_value,
                {} AS alias_value,
                {} AS description_value
         FROM {} AS h
         JOIN {} AS a ON a.{} = h.{}
         ORDER BY h.{} ASC
         LIMIT {}",
        q(start),
        q(duration),
        text_expr("a", app_file),
        text_expr("a", app_name),
        text_expr("a", app_alias),
        text_expr("a", app_description),
        q(hour_table),
        q(app_table),
        q(app_id),
        q(app_fk),
        q(start),
        MAX_IMPORT_RECORDS.saturating_sub(records.len()) + 1,
    );
    let rows = sqlx::query(&sql)
        .fetch_all(pool)
        .await
        .map_err(|error| format!("failed to read Tai/Taix hour records: {error}"))?;
    if rows.len() > MAX_IMPORT_RECORDS.saturating_sub(records.len()) {
        return Err(format!(
            "external database exceeds the {MAX_IMPORT_RECORDS} record safety limit"
        ));
    }
    for (index, row) in rows.into_iter().enumerate() {
        let line = index + 1;
        let start_value = row
            .try_get::<Option<String>, _>("start_value")
            .ok()
            .flatten();
        let Some(start_time_ms) = start_value.as_deref().and_then(parse_external_timestamp) else {
            warnings.push(warning(line, "invalid hour bucket start time"));
            continue;
        };
        let duration_value = row_text(&row, "duration_value");
        let Some(raw_duration) = duration_value.and_then(|value| value.parse::<i64>().ok()) else {
            warnings.push(warning(line, "invalid hour bucket duration"));
            continue;
        };
        let duration_ms = if duration_is_seconds {
            raw_duration.checked_mul(1_000)
        } else {
            Some(raw_duration)
        };
        let Some(duration_ms) = duration_ms.filter(|value| *value > 0 && *value <= 3_600_000)
        else {
            warnings.push(warning(
                line,
                "hour bucket duration must be positive and no longer than one hour",
            ));
            continue;
        };
        let file = row_text(&row, "file_value");
        let name = row_text(&row, "name_value");
        let Some(exe_name) = resolve_exe_name(file.as_deref(), name.as_deref()) else {
            warnings.push(warning(line, "application has no reliable executable file"));
            continue;
        };
        if exact_start_boundaries
            .get(&exe_name)
            .is_some_and(|boundary| start_time_ms.saturating_add(3_600_000) > *boundary)
        {
            continue;
        }
        records.push(CanonicalImportRecord {
            source_line: line,
            record_type: ImportRecordType::HourBucket,
            start_time_ms,
            end_time_ms: None,
            duration_ms,
            exe_name,
            app_name: first_text(&[
                row_text(&row, "alias_value"),
                row_text(&row, "description_value"),
                name,
            ]),
            title: None,
            category: None,
        });
    }
    Ok(())
}

async fn table_names(pool: &Pool<Sqlite>) -> Result<Vec<String>, String> {
    sqlx::query("SELECT name FROM sqlite_master WHERE type = 'table'")
        .fetch_all(pool)
        .await
        .map_err(|error| format!("failed to inspect external database tables: {error}"))
        .map(|rows| rows.into_iter().map(|row| row.get("name")).collect())
}

async fn table_columns(pool: &Pool<Sqlite>, table: &str) -> Result<Vec<String>, String> {
    sqlx::query("SELECT name FROM pragma_table_info(?)")
        .bind(table)
        .fetch_all(pool)
        .await
        .map_err(|error| format!("failed to inspect external table {table}: {error}"))
        .map(|rows| rows.into_iter().map(|row| row.get("name")).collect())
}

fn find_table(tables: &[String], candidates: &'static [&'static str]) -> Option<&'static str> {
    candidates.iter().copied().find(|candidate| {
        tables
            .iter()
            .any(|table| table.eq_ignore_ascii_case(candidate))
    })
}

fn find_column(columns: &[String], candidates: &'static [&'static str]) -> Option<&'static str> {
    candidates.iter().copied().find(|candidate| {
        columns
            .iter()
            .any(|column| column.eq_ignore_ascii_case(candidate))
    })
}

fn q(identifier: &str) -> String {
    debug_assert!(identifier
        .chars()
        .all(|value| value.is_ascii_alphanumeric() || value == '_'));
    format!("\"{identifier}\"")
}

fn text_expr(alias: &str, column: Option<&str>) -> String {
    column
        .map(|column| format!("CAST({alias}.{} AS TEXT)", q(column)))
        .unwrap_or_else(|| "NULL".to_string())
}

fn row_text(row: &sqlx::sqlite::SqliteRow, column: &str) -> Option<String> {
    row.try_get::<Option<String>, _>(column)
        .ok()
        .flatten()
        .and_then(|value| {
            let trimmed = value.trim();
            (!trimmed.is_empty()).then(|| trimmed.to_string())
        })
}

fn first_text(values: &[Option<String>]) -> Option<String> {
    values
        .iter()
        .flatten()
        .find(|value| !value.trim().is_empty())
        .cloned()
}

fn resolve_exe_name(file: Option<&str>, name: Option<&str>) -> Option<String> {
    let from_file = file.and_then(|value| {
        Path::new(value)
            .file_name()
            .and_then(|name| name.to_str())
            .map(str::to_string)
    });
    let candidate = from_file.or_else(|| {
        name.filter(|value| value.to_ascii_lowercase().ends_with(".exe"))
            .map(|value| value.to_string())
    })?;
    let normalized = candidate.trim().trim_matches('"').to_ascii_lowercase();
    normalized.ends_with(".exe").then_some(normalized)
}

fn parse_external_timestamp(value: &str) -> Option<i64> {
    let trimmed = value.trim();
    if let Ok(raw) = trimmed.parse::<i64>() {
        const DOTNET_UNIX_EPOCH_TICKS: i64 = 621_355_968_000_000_000;
        if raw >= DOTNET_UNIX_EPOCH_TICKS {
            return Some((raw - DOTNET_UNIX_EPOCH_TICKS) / 10_000);
        }
        if raw >= 1_000_000_000_000 {
            return Some(raw);
        }
        if raw >= 1_000_000_000 {
            return raw.checked_mul(1_000);
        }
    }
    if let Ok(value) = DateTime::parse_from_rfc3339(trimmed) {
        return Some(value.timestamp_millis());
    }
    for format in [
        "%Y-%m-%d %H:%M:%S%.f",
        "%Y-%m-%dT%H:%M:%S%.f",
        "%m/%d/%Y %H:%M:%S",
    ] {
        if let Ok(naive) = NaiveDateTime::parse_from_str(trimmed, format) {
            if let Some(local) = Local.from_local_datetime(&naive).single() {
                return Some(local.timestamp_millis());
            }
        }
    }
    None
}

fn warning(line: usize, message: &str) -> ExternalWarning {
    ExternalWarning {
        line,
        message: message.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::Executor;

    #[test]
    fn decodes_taix_exact_sessions_and_older_hour_buckets() {
        tauri::async_runtime::block_on(async {
            let pool = Pool::<Sqlite>::connect("sqlite::memory:").await.unwrap();
            pool.execute(
                "CREATE TABLE AppModels (
                    ID INTEGER PRIMARY KEY, Name TEXT, Alias TEXT,
                    Description TEXT, File TEXT
                 );
                 CREATE TABLE AppSessions (
                    ID INTEGER PRIMARY KEY, AppModelID INTEGER,
                    StartTime TEXT, EndTime TEXT, Duration INTEGER
                 );
                 CREATE TABLE Hours (
                    ID INTEGER PRIMARY KEY, AppModelID INTEGER,
                    DataTime TEXT, Duration INTEGER
                 );
                 INSERT INTO AppModels VALUES (
                    1, 'Code', 'VS Code', 'Editor', 'C:\\Tools\\Code.exe'
                 );
                 INSERT INTO AppModels VALUES (
                    2, 'Music', 'Music', 'Player', 'C:\\Tools\\Music.exe'
                 );
                 INSERT INTO AppSessions VALUES (
                    1, 1, '2026-01-02 10:00:00', '2026-01-02 10:05:00', 300000
                 );
                 INSERT INTO Hours VALUES (
                    1, 1, '2026-01-01 09:00:00', 120000
                 );
                 INSERT INTO Hours VALUES (
                    2, 1, '2026-01-02 10:00:00', 90000
                 );
                 INSERT INTO Hours VALUES (
                    3, 2, '2026-01-02 11:00:00', 60000
                 );",
            )
            .await
            .unwrap();

            let conversion = convert_pool(&pool).await.unwrap();
            assert_eq!(conversion.source_kind, "taix-db");
            assert_eq!(conversion.records.len(), 3);
            assert_eq!(
                conversion.records[0].record_type,
                ImportRecordType::ExactSession
            );
            assert_eq!(conversion.records[0].exe_name, "code.exe");
            assert_eq!(
                conversion.records[1].record_type,
                ImportRecordType::HourBucket
            );
            assert_eq!(conversion.records[2].exe_name, "music.exe");
        });
    }

    #[test]
    fn rejects_unknown_database_without_guessing_executable_names() {
        tauri::async_runtime::block_on(async {
            let pool = Pool::<Sqlite>::connect("sqlite::memory:").await.unwrap();
            pool.execute("CREATE TABLE RandomData (Name TEXT)")
                .await
                .unwrap();
            let error = convert_pool(&pool).await.unwrap_err();
            assert!(error.contains("application table not found"));
        });
    }
}
