use crate::data::sqlite_pool::wait_for_sqlite_pool;
use chrono::DateTime;
use sqlx::{Pool, Row, Sqlite};
use std::io::Write;
use tauri::AppHandle;

const ALL_CSV_FIELDS: &[&str] = &[
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

fn ms_to_datetime_str(ms: i64) -> String {
    let secs = ms / 1000;
    let nanos = ((ms % 1000) * 1_000_000) as u32;
    let odt = DateTime::from_timestamp(secs, nanos).unwrap_or_default();
    odt.format("%Y-%m-%d %H:%M:%S").to_string()
}

fn validate_field_names(selected: &[String]) -> Result<Vec<&'static str>, String> {
    if selected.is_empty() {
        return Ok(ALL_CSV_FIELDS.to_vec());
    }
    let all_set: std::collections::HashSet<&str> = ALL_CSV_FIELDS.iter().copied().collect();
    let mut ordered = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for s in selected {
        if seen.contains(s.as_str()) {
            continue;
        }
        if !all_set.contains(s.as_str()) {
            return Err(format!("unknown csv field: {s}"));
        }
        let field = ALL_CSV_FIELDS.iter().find(|&&f| f == s).unwrap();
        ordered.push(*field);
        seen.insert(s.as_str());
    }
    Ok(ordered)
}

fn get_csv_value(name: &str, sessions: &[SessionRow], web: &[WebRow], idx: usize) -> String {
    if idx < sessions.len() {
        let s = &sessions[idx];
        match name {
            "record_type" => "session".to_string(),
            "exe_name" => s.exe_name.clone(),
            "app_name" => s.app_name.clone(),
            "window_title" => s.window_title.clone().unwrap_or_default(),
            "domain" | "normalized_domain" | "url" | "page_title" => String::new(),
            "start_time" => ms_to_datetime_str(s.start_time),
            "end_time" => s.end_time.map(ms_to_datetime_str).unwrap_or_default(),
            "duration_ms" => s.duration.map(|d| d.to_string()).unwrap_or_default(),
            _ => String::new(),
        }
    } else {
        let w = &web[idx - sessions.len()];
        match name {
            "record_type" => "web".to_string(),
            "exe_name" | "app_name" | "window_title" => String::new(),
            "domain" => w.domain.clone(),
            "normalized_domain" => w.normalized_domain.clone(),
            "url" => w.url.clone().unwrap_or_default(),
            "page_title" => w.title.clone().unwrap_or_default(),
            "start_time" => ms_to_datetime_str(w.start_time),
            "end_time" => w.end_time.map(ms_to_datetime_str).unwrap_or_default(),
            "duration_ms" => w.duration.map(|d| d.to_string()).unwrap_or_default(),
            _ => String::new(),
        }
    }
}

pub async fn export_to_csv(
    app: &AppHandle,
    output_path: &str,
    start_time: Option<i64>,
    end_time: Option<i64>,
    selected_fields: &[String],
) -> Result<u64, String> {
    let fields = validate_field_names(selected_fields)?;

    let pool = wait_for_sqlite_pool(app).await?;
    let sessions = load_sessions(&pool, start_time, end_time).await?;
    let web = load_web_activity(&pool, start_time, end_time).await?;
    let total_rows = (sessions.len() + web.len()) as u64;

    let mut file = std::fs::File::create(output_path)
        .map_err(|e| format!("failed to create output file: {e}"))?;
    file.write_all(&[0xEF, 0xBB, 0xBF])
        .map_err(|e| format!("failed to write BOM: {e}"))?;

    let mut writer = csv::Writer::from_writer(file);
    writer
        .write_record(&fields)
        .map_err(|e| format!("failed to write csv header: {e}"))?;

    let total = sessions.len() + web.len();
    for i in 0..total {
        let record: Vec<String> = fields
            .iter()
            .map(|f| get_csv_value(f, &sessions, &web, i))
            .collect();
        writer
            .write_record(&record)
            .map_err(|e| format!("failed to write csv row: {e}"))?;
    }

    writer
        .flush()
        .map_err(|e| format!("failed to flush csv writer: {e}"))?;

    Ok(total_rows)
}

#[derive(Clone, Debug)]
struct SessionRow {
    app_name: String,
    exe_name: String,
    window_title: Option<String>,
    start_time: i64,
    end_time: Option<i64>,
    duration: Option<i64>,
}

#[derive(Clone, Debug)]
struct WebRow {
    domain: String,
    normalized_domain: String,
    url: Option<String>,
    title: Option<String>,
    start_time: i64,
    end_time: Option<i64>,
    duration: Option<i64>,
}

fn build_time_clause(start_time: Option<i64>, end_time: Option<i64>) -> (String, Vec<i64>) {
    let mut clauses = Vec::new();
    let mut params = Vec::new();
    if let Some(st) = start_time {
        clauses.push("start_time >= ?".to_string());
        params.push(st);
    }
    if let Some(et) = end_time {
        clauses.push("start_time <= ?".to_string());
        params.push(et);
    }
    if clauses.is_empty() {
        (String::new(), params)
    } else {
        (format!("WHERE {}", clauses.join(" AND ")), params)
    }
}

async fn load_sessions(
    pool: &Pool<Sqlite>,
    start_time: Option<i64>,
    end_time: Option<i64>,
) -> Result<Vec<SessionRow>, String> {
    let (clause, params) = build_time_clause(start_time, end_time);
    let sql = format!(
        "SELECT app_name, exe_name, window_title, start_time, end_time, duration
         FROM sessions {} ORDER BY id ASC",
        clause
    );
    let mut query = sqlx::query(&sql);
    for p in &params {
        query = query.bind(p);
    }
    let rows = query
        .fetch_all(pool)
        .await
        .map_err(|e| format!("failed to read sessions: {e}"))?;

    Ok(rows
        .into_iter()
        .map(|r| SessionRow {
            app_name: r.get("app_name"),
            exe_name: r.get("exe_name"),
            window_title: r.get("window_title"),
            start_time: r.get("start_time"),
            end_time: r.get("end_time"),
            duration: r.get("duration"),
        })
        .collect())
}

async fn load_web_activity(
    pool: &Pool<Sqlite>,
    start_time: Option<i64>,
    end_time: Option<i64>,
) -> Result<Vec<WebRow>, String> {
    let (clause, params) = build_time_clause(start_time, end_time);
    let sql = format!(
        "SELECT domain, normalized_domain, url, title, start_time, end_time, duration
         FROM web_activity_segments {} ORDER BY id ASC",
        clause
    );
    let mut query = sqlx::query(&sql);
    for p in &params {
        query = query.bind(p);
    }
    let rows = query
        .fetch_all(pool)
        .await
        .map_err(|e| format!("failed to read web activity: {e}"))?;

    Ok(rows
        .into_iter()
        .map(|r| WebRow {
            domain: r.get("domain"),
            normalized_domain: r.get("normalized_domain"),
            url: r.get("url"),
            title: r.get("title"),
            start_time: r.get("start_time"),
            end_time: r.get("end_time"),
            duration: r.get("duration"),
        })
        .collect())
}
