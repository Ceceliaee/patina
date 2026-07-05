use crate::data::sqlite_pool::wait_for_sqlite_pool;
use sqlx::sqlite::SqlitePoolOptions;
use sqlx::{Pool, Row, Sqlite};
use tauri::AppHandle;
use std::collections::HashSet;

const ALL_EXPORT_FIELDS: &[&str] = &[
    "record_type",
    "exe_name",
    "app_name",
    "window_title",
    "domain",
    "normalized_domain",
    "url",
    "page_title",
    "start_time",
    "end_time",
    "duration_ms",
];

const SESSION_FIELDS: &[(&str, bool, bool)] = &[
    ("exe_name", false, false),
    ("app_name", false, false),
    ("window_title", true, false),
    ("start_time", false, true),
    ("end_time", true, true),
    ("duration_ms", true, true),
];

const WEB_FIELDS: &[(&str, bool, bool)] = &[
    ("domain", false, false),
    ("normalized_domain", false, false),
    ("url", true, false),
    ("page_title", true, false),
    ("start_time", false, true),
    ("end_time", true, true),
    ("duration_ms", true, true),
];

struct ResolvedFields {
    session_cols: Vec<(String, bool, bool)>,
    web_cols: Vec<(String, bool, bool)>,
}

fn resolve_fields(selected: &[String]) -> Result<ResolvedFields, String> {
    let all: HashSet<&str> = ALL_EXPORT_FIELDS.iter().copied().collect();
    let mut seen = HashSet::new();
    let mut ordered = Vec::new();
    for s in selected {
        if !all.contains(s.as_str()) {
            return Err(format!("unknown field: {s}"));
        }
        if !seen.contains(s.as_str()) {
            ordered.push(s.clone());
            seen.insert(s.clone());
        }
    }
    if ordered.is_empty() {
        ordered = ALL_EXPORT_FIELDS.iter().map(|s| s.to_string()).collect();
    }
    let mut session_cols = Vec::new();
    let mut web_cols = Vec::new();
    for name in &ordered {
        if name == "record_type" {
            continue;
        }
        for &(sname, nullable, is_int) in SESSION_FIELDS {
            if sname == name {
                let col_name = if sname == "duration_ms" { "duration" } else { sname };
                session_cols.push((col_name.to_string(), nullable, is_int));
                break;
            }
        }
        for &(wname, nullable, is_int) in WEB_FIELDS {
            if wname == name {
                let col_name = match wname {
                    "page_title" => "title",
                    "duration_ms" => "duration",
                    _ => wname,
                };
                web_cols.push((col_name.to_string(), nullable, is_int));
                break;
            }
        }
    }
    Ok(ResolvedFields { session_cols, web_cols })
}

pub async fn export_to_sqlite(
    app: &AppHandle,
    output_path: &str,
    start_time: Option<i64>,
    end_time: Option<i64>,
    selected_fields: &[String],
) -> Result<u64, String> {
    let resolved = resolve_fields(selected_fields)?;
    let src = wait_for_sqlite_pool(app).await?;
    let dst = open_output_db(output_path).await?;

    let session_count = copy_sessions(&src, &dst, start_time, end_time, &resolved).await?;
    let web_count = copy_web(&src, &dst, start_time, end_time, &resolved).await?;

    dst.close().await;
    Ok((session_count + web_count) as u64)
}

async fn open_output_db(path: &str) -> Result<Pool<Sqlite>, String> {
    SqlitePoolOptions::new()
        .max_connections(1)
        .connect(&format!("sqlite://{path}?mode=rwc"))
        .await
        .map_err(|e| format!("failed to create output database: {e}"))
}

fn fmt_col(name: &str, nullable: bool, is_int: bool) -> String {
    if is_int {
        format!("{name} INTEGER")
    } else if nullable {
        format!("{name} TEXT")
    } else {
        format!("{name} TEXT NOT NULL")
    }
}

async fn copy_sessions(
    src: &Pool<Sqlite>,
    dst: &Pool<Sqlite>,
    start_time: Option<i64>,
    end_time: Option<i64>,
    resolved: &ResolvedFields,
) -> Result<usize, String> {
    let col_defs: Vec<String> = resolved
        .session_cols
        .iter()
        .map(|(name, nullable, is_int)| fmt_col(name, *nullable, *is_int))
        .collect();

    if col_defs.is_empty() {
        sqlx::query("CREATE TABLE IF NOT EXISTS sessions (id INTEGER PRIMARY KEY AUTOINCREMENT)")
            .execute(dst).await.map_err(|e| format!("create sessions: {e}"))?;
        return Ok(0);
    }

    let create_sql = format!(
        "CREATE TABLE IF NOT EXISTS sessions (id INTEGER PRIMARY KEY AUTOINCREMENT, {})",
        col_defs.join(", ")
    );
    sqlx::query(&create_sql).execute(dst).await.map_err(|e| format!("create sessions: {e}"))?;

    let ins_cols: Vec<&str> = resolved.session_cols.iter().map(|(name, _, _)| name.as_str()).collect();
    if ins_cols.is_empty() {
        return Ok(0);
    }
    let placeholders: Vec<String> = ins_cols.iter().map(|_| "?".to_string()).collect();
    let insert_sql = format!(
        "INSERT INTO sessions ({}) VALUES ({})",
        ins_cols.join(", "), placeholders.join(", ")
    );

    let sel_cols: Vec<&str> = ins_cols.clone();
    if sel_cols.is_empty() {
        return Ok(0);
    }

    let query = build_time_query("sessions", &sel_cols, start_time, end_time);
    let rows = fetch_rows(src, &query, start_time, end_time).await?;

    for row in &rows {
        let mut q = sqlx::query(&insert_sql);
        for &col in &ins_cols {
            match col {
                "app_name" | "exe_name" => { let v: String = row.get(col); q = q.bind(v); }
                "window_title" => { let v: Option<String> = row.get(col); q = q.bind(v); }
                "start_time" => { let v: i64 = row.get(col); q = q.bind(v); }
                "end_time" | "duration" => { let v: Option<i64> = row.get(col); q = q.bind(v); }
                _ => {}
            }
        }
        q.execute(dst).await.map_err(|e| format!("insert session: {e}"))?;
    }

    Ok(rows.len())
}

async fn copy_web(
    src: &Pool<Sqlite>,
    dst: &Pool<Sqlite>,
    start_time: Option<i64>,
    end_time: Option<i64>,
    resolved: &ResolvedFields,
) -> Result<usize, String> {
    let col_defs: Vec<String> = resolved
        .web_cols
        .iter()
        .map(|(name, nullable, is_int)| fmt_col(name, *nullable, *is_int))
        .collect();

    if col_defs.is_empty() {
        sqlx::query("CREATE TABLE IF NOT EXISTS web_activity_segments (id INTEGER PRIMARY KEY AUTOINCREMENT)")
            .execute(dst).await.map_err(|e| format!("create web: {e}"))?;
        return Ok(0);
    }

    let create_sql = format!(
        "CREATE TABLE IF NOT EXISTS web_activity_segments (id INTEGER PRIMARY KEY AUTOINCREMENT, {})",
        col_defs.join(", ")
    );
    sqlx::query(&create_sql).execute(dst).await.map_err(|e| format!("create web: {e}"))?;

    let ins_cols: Vec<&str> = resolved.web_cols.iter().map(|(name, _, _)| name.as_str()).collect();
    if ins_cols.is_empty() {
        return Ok(0);
    }
    let placeholders: Vec<String> = ins_cols.iter().map(|_| "?".to_string()).collect();
    let insert_sql = format!(
        "INSERT INTO web_activity_segments ({}) VALUES ({})",
        ins_cols.join(", "), placeholders.join(", ")
    );

    let sel_cols: Vec<&str> = ins_cols.clone();
    if sel_cols.is_empty() {
        return Ok(0);
    }

    let query = build_time_query("web_activity_segments", &sel_cols, start_time, end_time);
    let rows = fetch_rows(src, &query, start_time, end_time).await?;

    for row in &rows {
        let mut q = sqlx::query(&insert_sql);
        for &col in &ins_cols {
            match col {
                "domain" | "normalized_domain" => { let v: String = row.get(col); q = q.bind(v); }
                "url" | "title" => { let v: Option<String> = row.get(col); q = q.bind(v); }
                "start_time" => { let v: i64 = row.get(col); q = q.bind(v); }
                "end_time" | "duration" => { let v: Option<i64> = row.get(col); q = q.bind(v); }
                _ => {}
            }
        }
        q.execute(dst).await.map_err(|e| format!("insert web: {e}"))?;
    }

    Ok(rows.len())
}

fn build_time_query(
    table: &str,
    columns: &[&str],
    start_time: Option<i64>,
    end_time: Option<i64>,
) -> String {
    let mut query = format!("SELECT {} FROM {table}", columns.join(", "));
    let mut clauses: Vec<String> = Vec::new();
    if start_time.is_some() {
        clauses.push("start_time >= ?".to_string());
    }
    if end_time.is_some() {
        clauses.push("start_time <= ?".to_string());
    }
    if !clauses.is_empty() {
        query.push_str(&format!(" WHERE {}", clauses.join(" AND ")));
    }
    query.push_str(" ORDER BY id ASC");
    query
}

async fn fetch_rows(
    pool: &Pool<Sqlite>,
    query: &str,
    start_time: Option<i64>,
    end_time: Option<i64>,
) -> Result<Vec<sqlx::sqlite::SqliteRow>, String> {
    let mut q = sqlx::query(query);
    if let Some(st) = start_time {
        q = q.bind(st);
    }
    if let Some(et) = end_time {
        q = q.bind(et);
    }
    q.fetch_all(pool).await.map_err(|e| format!("query failed: {e}"))
}
