use super::common::{
    build_overlap_where_clause, current_time_ms, load_export_classification, ms_to_datetime_str,
    ms_to_local_date, ms_to_local_hour, ms_to_local_month, ms_to_local_week, ms_to_local_weekday,
    replace_output_file, resolve_export_fields, unique_temp_path, ExportClassification,
    ExportTimeFilter,
};
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions, SqliteRow};
use sqlx::{Pool, Row, Sqlite};
use std::path::Path;

const SESSION_SOURCE_COLUMNS: &[&str] = &[
    "id",
    "app_name",
    "exe_name",
    "window_title",
    "start_time",
    "end_time",
    "duration",
    "COALESCE(continuity_group_start_time, start_time) AS continuity_group_start_time",
];

const WEB_SOURCE_COLUMNS: &[&str] = &[
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
];

#[derive(Clone, Copy)]
enum ColumnKind {
    Text,
    TimeText,
    Integer,
    RecordType,
    CategoryLabel,
    CategoryId,
    CategoryColor,
    LocalDate,
    LocalWeek,
    LocalMonth,
    Weekday,
    StartHour,
    DurationMinutes,
    SourceKey,
    SourceName,
}

#[derive(Clone, Copy)]
struct ExportColumn {
    output_name: &'static str,
    nullable: bool,
    kind: ColumnKind,
}

struct ResolvedFields {
    session_cols: Vec<ExportColumn>,
    web_cols: Vec<ExportColumn>,
}

pub async fn export_to_sqlite(
    pool: &Pool<Sqlite>,
    output_path: &str,
    start_time: Option<i64>,
    end_time: Option<i64>,
    selected_fields: Option<&[String]>,
) -> Result<u64, String> {
    let resolved = resolve_sqlite_fields(selected_fields)?;
    let classification = load_export_classification(pool).await?;
    let temp_path = unique_temp_path(output_path, "sqlite")?;
    let _ = std::fs::remove_file(&temp_path);

    let dst = open_output_db(&temp_path).await?;
    let filter = ExportTimeFilter {
        start_time,
        end_time,
        effective_now_ms: current_time_ms(),
    };

    let copy_result = async {
        let session_count = copy_sessions(pool, &dst, filter, &resolved, &classification).await?;
        let web_count = copy_web(pool, &dst, filter, &resolved, &classification).await?;
        Ok::<u64, String>((session_count + web_count) as u64)
    }
    .await;
    dst.close().await;

    let row_count = match copy_result {
        Ok(row_count) => row_count,
        Err(error) => {
            let _ = std::fs::remove_file(&temp_path);
            return Err(error);
        }
    };

    replace_output_file(&temp_path, output_path)?;
    Ok(row_count)
}

fn resolve_sqlite_fields(selected_fields: Option<&[String]>) -> Result<ResolvedFields, String> {
    let fields = resolve_export_fields(selected_fields)?;
    let mut session_cols = Vec::new();
    let mut web_cols = Vec::new();

    for field in fields {
        match field {
            "record_type" => push_shared(&mut session_cols, &mut web_cols, record_type_col()),
            "category" => push_shared(
                &mut session_cols,
                &mut web_cols,
                computed_col("category", false, ColumnKind::CategoryLabel),
            ),
            "category_id" => push_shared(
                &mut session_cols,
                &mut web_cols,
                computed_col("category_id", false, ColumnKind::CategoryId),
            ),
            "category_color" => push_shared(
                &mut session_cols,
                &mut web_cols,
                computed_col("category_color", false, ColumnKind::CategoryColor),
            ),
            "start_time" => push_shared(
                &mut session_cols,
                &mut web_cols,
                time_col("start_time", false),
            ),
            "end_time" => push_shared(&mut session_cols, &mut web_cols, time_col("end_time", true)),
            "duration_ms" => push_shared(
                &mut session_cols,
                &mut web_cols,
                integer_col("duration_ms", true),
            ),
            "local_date" => push_shared(
                &mut session_cols,
                &mut web_cols,
                computed_col("local_date", false, ColumnKind::LocalDate),
            ),
            "local_week" => push_shared(
                &mut session_cols,
                &mut web_cols,
                computed_col("local_week", false, ColumnKind::LocalWeek),
            ),
            "local_month" => push_shared(
                &mut session_cols,
                &mut web_cols,
                computed_col("local_month", false, ColumnKind::LocalMonth),
            ),
            "weekday" => push_shared(
                &mut session_cols,
                &mut web_cols,
                computed_col("weekday", false, ColumnKind::Weekday),
            ),
            "start_hour" => push_shared(
                &mut session_cols,
                &mut web_cols,
                computed_col("start_hour", false, ColumnKind::StartHour),
            ),
            "duration_minutes" => push_shared(
                &mut session_cols,
                &mut web_cols,
                computed_col("duration_minutes", true, ColumnKind::DurationMinutes),
            ),
            "source_key" => push_shared(
                &mut session_cols,
                &mut web_cols,
                computed_col("source_key", false, ColumnKind::SourceKey),
            ),
            "source_name" => push_shared(
                &mut session_cols,
                &mut web_cols,
                computed_col("source_name", false, ColumnKind::SourceName),
            ),
            "app_name" => session_cols.push(text_col("app_name", false)),
            "exe_name" => session_cols.push(text_col("exe_name", false)),
            "window_title" => session_cols.push(text_col("window_title", true)),
            "session_id" => session_cols.push(integer_col("session_id", false)),
            "continuity_group_start_time" => {
                session_cols.push(time_col("continuity_group_start_time", false));
            }
            "domain" => web_cols.push(text_col("domain", false)),
            "normalized_domain" => web_cols.push(text_col("normalized_domain", false)),
            "url" => web_cols.push(text_col("url", true)),
            "page_title" => web_cols.push(text_col("page_title", true)),
            "web_segment_id" => web_cols.push(integer_col("web_segment_id", false)),
            "browser_client_id" => web_cols.push(text_col("browser_client_id", false)),
            "browser_kind" => web_cols.push(text_col("browser_kind", false)),
            "browser_exe_name" => web_cols.push(text_col("browser_exe_name", false)),
            "favicon_url" => web_cols.push(text_col("favicon_url", true)),
            "web_source" => web_cols.push(text_col("web_source", false)),
            "created_at" => web_cols.push(time_col("created_at", false)),
            "updated_at" => web_cols.push(time_col("updated_at", false)),
            _ => unreachable!("export fields are validated before mapping"),
        }
    }

    Ok(ResolvedFields {
        session_cols,
        web_cols,
    })
}

fn push_shared(
    session_cols: &mut Vec<ExportColumn>,
    web_cols: &mut Vec<ExportColumn>,
    column: ExportColumn,
) {
    session_cols.push(column);
    web_cols.push(column);
}

fn text_col(output_name: &'static str, nullable: bool) -> ExportColumn {
    ExportColumn {
        output_name,
        nullable,
        kind: ColumnKind::Text,
    }
}

fn time_col(output_name: &'static str, nullable: bool) -> ExportColumn {
    ExportColumn {
        output_name,
        nullable,
        kind: ColumnKind::TimeText,
    }
}

fn integer_col(output_name: &'static str, nullable: bool) -> ExportColumn {
    ExportColumn {
        output_name,
        nullable,
        kind: ColumnKind::Integer,
    }
}

fn computed_col(output_name: &'static str, nullable: bool, kind: ColumnKind) -> ExportColumn {
    ExportColumn {
        output_name,
        nullable,
        kind,
    }
}

fn record_type_col() -> ExportColumn {
    ExportColumn {
        output_name: "record_type",
        nullable: false,
        kind: ColumnKind::RecordType,
    }
}

async fn open_output_db(path: &Path) -> Result<Pool<Sqlite>, String> {
    let options = SqliteConnectOptions::new()
        .filename(path)
        .create_if_missing(true);

    SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(options)
        .await
        .map_err(|e| format!("failed to create output database: {e}"))
}

fn fmt_col(column: &ExportColumn) -> String {
    match column.kind {
        ColumnKind::Integer | ColumnKind::Weekday | ColumnKind::StartHour => {
            format!("{} INTEGER{}", column.output_name, not_null(column))
        }
        ColumnKind::DurationMinutes => {
            format!("{} REAL{}", column.output_name, not_null(column))
        }
        ColumnKind::Text
        | ColumnKind::TimeText
        | ColumnKind::RecordType
        | ColumnKind::CategoryLabel
        | ColumnKind::CategoryId
        | ColumnKind::CategoryColor
        | ColumnKind::LocalDate
        | ColumnKind::LocalWeek
        | ColumnKind::LocalMonth
        | ColumnKind::SourceKey
        | ColumnKind::SourceName => {
            format!("{} TEXT{}", column.output_name, not_null(column))
        }
    }
}

fn not_null(column: &ExportColumn) -> &'static str {
    if column.nullable {
        ""
    } else {
        " NOT NULL"
    }
}

async fn copy_sessions(
    src: &Pool<Sqlite>,
    dst: &Pool<Sqlite>,
    filter: ExportTimeFilter,
    resolved: &ResolvedFields,
    classification: &ExportClassification,
) -> Result<usize, String> {
    let mut tx = dst
        .begin()
        .await
        .map_err(|e| format!("begin sqlite export transaction: {e}"))?;

    create_table(&mut tx, "sessions", &resolved.session_cols).await?;
    if resolved.session_cols.is_empty() {
        tx.commit()
            .await
            .map_err(|e| format!("commit sessions export: {e}"))?;
        return Ok(0);
    }

    let (query, params) = build_select_query("sessions", SESSION_SOURCE_COLUMNS, filter);
    let rows = fetch_rows(src, &query, params).await?;
    let insert_sql = build_insert_query("sessions", &resolved.session_cols);

    for row in &rows {
        let mut query = sqlx::query(&insert_sql);
        for column in &resolved.session_cols {
            query = match column.output_name {
                "record_type" => query.bind("session"),
                "category" => {
                    let exe_name: String = row.get("exe_name");
                    query.bind(classification.resolve_session_category(&exe_name).label)
                }
                "category_id" => {
                    let exe_name: String = row.get("exe_name");
                    query.bind(classification.resolve_session_category(&exe_name).id)
                }
                "category_color" => {
                    let exe_name: String = row.get("exe_name");
                    query.bind(classification.resolve_session_category(&exe_name).color)
                }
                "app_name" | "exe_name" => {
                    let value: String = row.get(column.output_name);
                    query.bind(value)
                }
                "window_title" => {
                    let value: Option<String> = row.get("window_title");
                    query.bind(value)
                }
                "session_id" => {
                    let value: i64 = row.get("id");
                    query.bind(value)
                }
                "start_time" => {
                    let value: i64 = row.get("start_time");
                    query.bind(ms_to_datetime_str(value))
                }
                "end_time" => {
                    let value: Option<i64> = row.get("end_time");
                    query.bind(value.map(ms_to_datetime_str))
                }
                "continuity_group_start_time" => {
                    let value: i64 = row.get("continuity_group_start_time");
                    query.bind(ms_to_datetime_str(value))
                }
                "duration_ms" => {
                    let value: Option<i64> = row.get("duration");
                    query.bind(value)
                }
                "duration_minutes" => {
                    let value: Option<i64> = row.get("duration");
                    query.bind(value.map(|duration| duration as f64 / 60_000.0))
                }
                "local_date" => {
                    let value: i64 = row.get("start_time");
                    query.bind(ms_to_local_date(value))
                }
                "local_week" => {
                    let value: i64 = row.get("start_time");
                    query.bind(ms_to_local_week(value))
                }
                "local_month" => {
                    let value: i64 = row.get("start_time");
                    query.bind(ms_to_local_month(value))
                }
                "weekday" => {
                    let value: i64 = row.get("start_time");
                    query.bind(ms_to_local_weekday(value))
                }
                "start_hour" => {
                    let value: i64 = row.get("start_time");
                    query.bind(ms_to_local_hour(value))
                }
                "source_key" => {
                    let value: String = row.get("exe_name");
                    query.bind(value.to_ascii_lowercase())
                }
                "source_name" => {
                    let value: String = row.get("app_name");
                    query.bind(value)
                }
                _ => unreachable!("session export column should be known"),
            };
        }
        query
            .execute(&mut *tx)
            .await
            .map_err(|e| format!("insert session: {e}"))?;
    }

    tx.commit()
        .await
        .map_err(|e| format!("commit sessions export: {e}"))?;
    Ok(rows.len())
}

async fn copy_web(
    src: &Pool<Sqlite>,
    dst: &Pool<Sqlite>,
    filter: ExportTimeFilter,
    resolved: &ResolvedFields,
    classification: &ExportClassification,
) -> Result<usize, String> {
    let mut tx = dst
        .begin()
        .await
        .map_err(|e| format!("begin sqlite export transaction: {e}"))?;

    create_table(&mut tx, "web_activity_segments", &resolved.web_cols).await?;
    if resolved.web_cols.is_empty() {
        tx.commit()
            .await
            .map_err(|e| format!("commit web export: {e}"))?;
        return Ok(0);
    }

    let (query, params) = build_select_query("web_activity_segments", WEB_SOURCE_COLUMNS, filter);
    let rows = fetch_rows(src, &query, params).await?;
    let insert_sql = build_insert_query("web_activity_segments", &resolved.web_cols);

    for row in &rows {
        let mut query = sqlx::query(&insert_sql);
        for column in &resolved.web_cols {
            query = match column.output_name {
                "record_type" => query.bind("web"),
                "category" => {
                    let normalized_domain: String = row.get("normalized_domain");
                    query.bind(
                        classification
                            .resolve_web_category(&normalized_domain)
                            .label,
                    )
                }
                "category_id" => {
                    let normalized_domain: String = row.get("normalized_domain");
                    query.bind(classification.resolve_web_category(&normalized_domain).id)
                }
                "category_color" => {
                    let normalized_domain: String = row.get("normalized_domain");
                    query.bind(
                        classification
                            .resolve_web_category(&normalized_domain)
                            .color,
                    )
                }
                "domain" | "normalized_domain" | "browser_client_id" | "browser_kind"
                | "browser_exe_name" => {
                    let value: String = row.get(column.output_name);
                    query.bind(value)
                }
                "url" | "favicon_url" => {
                    let value: Option<String> = row.get(column.output_name);
                    query.bind(value)
                }
                "page_title" => {
                    let value: Option<String> = row.get("title");
                    query.bind(value)
                }
                "web_source" => {
                    let value: String = row.get("source");
                    query.bind(value)
                }
                "web_segment_id" => {
                    let value: i64 = row.get("id");
                    query.bind(value)
                }
                "start_time" => {
                    let value: i64 = row.get("start_time");
                    query.bind(ms_to_datetime_str(value))
                }
                "end_time" => {
                    let value: Option<i64> = row.get("end_time");
                    query.bind(value.map(ms_to_datetime_str))
                }
                "created_at" | "updated_at" => {
                    let value: i64 = row.get(column.output_name);
                    query.bind(ms_to_datetime_str(value))
                }
                "duration_ms" => {
                    let value: Option<i64> = row.get("duration");
                    query.bind(value)
                }
                "duration_minutes" => {
                    let value: Option<i64> = row.get("duration");
                    query.bind(value.map(|duration| duration as f64 / 60_000.0))
                }
                "local_date" => {
                    let value: i64 = row.get("start_time");
                    query.bind(ms_to_local_date(value))
                }
                "local_week" => {
                    let value: i64 = row.get("start_time");
                    query.bind(ms_to_local_week(value))
                }
                "local_month" => {
                    let value: i64 = row.get("start_time");
                    query.bind(ms_to_local_month(value))
                }
                "weekday" => {
                    let value: i64 = row.get("start_time");
                    query.bind(ms_to_local_weekday(value))
                }
                "start_hour" => {
                    let value: i64 = row.get("start_time");
                    query.bind(ms_to_local_hour(value))
                }
                "source_key" => {
                    let value: String = row.get("normalized_domain");
                    query.bind(value.to_ascii_lowercase())
                }
                "source_name" => {
                    let value: String = row.get("domain");
                    query.bind(value)
                }
                _ => unreachable!("web export column should be known"),
            };
        }
        query
            .execute(&mut *tx)
            .await
            .map_err(|e| format!("insert web activity: {e}"))?;
    }

    tx.commit()
        .await
        .map_err(|e| format!("commit web export: {e}"))?;
    Ok(rows.len())
}

async fn create_table(
    tx: &mut sqlx::Transaction<'_, Sqlite>,
    table: &str,
    columns: &[ExportColumn],
) -> Result<(), String> {
    let col_defs: Vec<String> = columns.iter().map(fmt_col).collect();
    let create_sql = if col_defs.is_empty() {
        format!("CREATE TABLE {table} (id INTEGER PRIMARY KEY AUTOINCREMENT)")
    } else {
        format!(
            "CREATE TABLE {table} (id INTEGER PRIMARY KEY AUTOINCREMENT, {})",
            col_defs.join(", ")
        )
    };

    sqlx::query(&create_sql)
        .execute(&mut **tx)
        .await
        .map_err(|e| format!("create {table}: {e}"))?;
    Ok(())
}

fn build_select_query(
    table: &str,
    source_cols: &[&str],
    filter: ExportTimeFilter,
) -> (String, Vec<i64>) {
    let (clause, params) = build_overlap_where_clause(filter);
    (
        format!(
            "SELECT {} FROM {table} {clause} ORDER BY id ASC",
            source_cols.join(", ")
        ),
        params,
    )
}

fn build_insert_query(table: &str, columns: &[ExportColumn]) -> String {
    let insert_cols: Vec<&str> = columns.iter().map(|column| column.output_name).collect();
    let placeholders: Vec<&str> = columns.iter().map(|_| "?").collect();
    format!(
        "INSERT INTO {table} ({}) VALUES ({})",
        insert_cols.join(", "),
        placeholders.join(", ")
    )
}

async fn fetch_rows(
    pool: &Pool<Sqlite>,
    query: &str,
    params: Vec<i64>,
) -> Result<Vec<SqliteRow>, String> {
    let mut query = sqlx::query(query);
    for param in params {
        query = query.bind(param);
    }
    query
        .fetch_all(pool)
        .await
        .map_err(|e| format!("query failed: {e}"))
}
