use arrow::array::{Int64Array, StringArray};
use arrow::datatypes::{DataType, Field, Schema};
use arrow::record_batch::RecordBatch;
use chrono::DateTime;
use parquet::arrow::ArrowWriter;
use parquet::file::properties::WriterProperties;
use sqlx::{Pool, Row, Sqlite};
use std::sync::Arc;

const ALL_FIELDS: &[&str] = &[
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

fn validate_fields(selected: &[String]) -> Result<Vec<&'static str>, String> {
    let all_set: std::collections::HashSet<&str> = ALL_FIELDS.iter().copied().collect();
    let mut seen = std::collections::HashSet::new();
    let mut ordered = Vec::new();
    for s in selected {
        if !all_set.contains(s.as_str()) {
            return Err(format!("unknown field: {s}"));
        }
        if !seen.contains(s.as_str()) {
            if let Some(field) = ALL_FIELDS.iter().find(|&&f| f == s) {
                ordered.push(*field);
                seen.insert(s.as_str());
            }
        }
    }
    if ordered.is_empty() {
        ordered = ALL_FIELDS.to_vec();
    }
    Ok(ordered)
}

fn field_data_type(name: &str) -> DataType {
    match name {
        "record_type" | "exe_name" | "app_name" | "window_title" | "domain"
        | "normalized_domain" | "url" | "page_title"
        | "start_time" | "end_time" => DataType::Utf8,
        "duration_ms" => DataType::Int64,
        _ => unreachable!(),
    }
}

fn field_is_always_not_null(name: &str) -> bool {
    matches!(name, "record_type")
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


async fn load_sessions_with_time(
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


async fn load_web_activity_with_time(
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

pub async fn export_to_parquet(
    pool: &Pool<Sqlite>,
    output_path: &str,
    selected_fields: &[String],
) -> Result<u64, String> {
    export_to_parquet_with_time(pool, output_path, selected_fields, None, None).await
}

pub async fn export_to_parquet_with_time(
    pool: &Pool<Sqlite>,
    output_path: &str,
    selected_fields: &[String],
    start_time: Option<i64>,
    end_time: Option<i64>,
) -> Result<u64, String> {
    let fields = validate_fields(selected_fields)?;
    let schema = Schema::new(
        fields
            .iter()
            .map(|name| {
                Field::new(*name, field_data_type(name), !field_is_always_not_null(name))
            })
            .collect::<Vec<_>>(),
    );

    let sessions = load_sessions_with_time(pool, start_time, end_time).await?;
    let web = load_web_activity_with_time(pool, start_time, end_time).await?;
    let total_rows = (sessions.len() + web.len()) as u64;

    let num_rows = sessions.len() + web.len();
    let mut columns: Vec<Arc<dyn arrow::array::Array>> = Vec::with_capacity(fields.len());
    let null_str: Vec<Option<&str>> = vec![None; num_rows];

    for &name in &fields {
        let arr: Arc<dyn arrow::array::Array> = match name {
            "record_type" => {
                let mut vals: Vec<&str> = Vec::with_capacity(num_rows);
                for _ in &sessions {
                    vals.push("session");
                }
                for _ in &web {
                    vals.push("web");
                }
                Arc::new(StringArray::from(vals))
            }
            "exe_name" => {
                let vals: Vec<Option<&str>> = sessions
                    .iter()
                    .map(|r| Some(r.exe_name.as_str()))
                    .chain(null_str.iter().copied().take(web.len()))
                    .collect();
                Arc::new(StringArray::from(vals))
            }
            "app_name" => {
                let vals: Vec<Option<&str>> = sessions
                    .iter()
                    .map(|r| {
                        let s = r.app_name.trim();
                        if s.is_empty() {
                            None
                        } else {
                            Some(s)
                        }
                    })
                    .chain(null_str.iter().copied().take(web.len()))
                    .collect();
                Arc::new(StringArray::from(vals))
            }
            "window_title" => {
                let vals: Vec<Option<&str>> = sessions
                    .iter()
                    .map(|r| r.window_title.as_deref())
                    .chain(null_str.iter().copied().take(web.len()))
                    .collect();
                Arc::new(StringArray::from(vals))
            }
            "domain" => {
                let vals: Vec<Option<&str>> = null_str
                    .iter()
                    .copied()
                    .take(sessions.len())
                    .chain(web.iter().map(|r| Some(r.domain.as_str())))
                    .collect();
                Arc::new(StringArray::from(vals))
            }
            "normalized_domain" => {
                let vals: Vec<Option<&str>> = null_str
                    .iter()
                    .copied()
                    .take(sessions.len())
                    .chain(web.iter().map(|r| Some(r.normalized_domain.as_str())))
                    .collect();
                Arc::new(StringArray::from(vals))
            }
            "url" => {
                let vals: Vec<Option<&str>> = null_str
                    .iter()
                    .copied()
                    .take(sessions.len())
                    .chain(web.iter().map(|r| r.url.as_deref()))
                    .collect();
                Arc::new(StringArray::from(vals))
            }
            "page_title" => {
                let vals: Vec<Option<&str>> = null_str
                    .iter()
                    .copied()
                    .take(sessions.len())
                    .chain(web.iter().map(|r| r.title.as_deref()))
                    .collect();
                Arc::new(StringArray::from(vals))
            }
            "start_time" => {
                let vals: Vec<Option<String>> = sessions
                    .iter()
                    .map(|r| Some(ms_to_datetime_str(r.start_time)))
                    .chain(web.iter().map(|r| Some(ms_to_datetime_str(r.start_time))))
                    .collect();
                Arc::new(StringArray::from(vals))
            }
            "end_time" => {
                let vals: Vec<Option<String>> = sessions
                    .iter()
                    .map(|r| r.end_time.map(ms_to_datetime_str))
                    .chain(web.iter().map(|r| r.end_time.map(ms_to_datetime_str)))
                    .collect();
                Arc::new(StringArray::from(vals))
            }
            "duration_ms" => {
                let vals: Vec<Option<i64>> = sessions
                    .iter()
                    .map(|r| r.duration)
                    .chain(web.iter().map(|r| r.duration))
                    .collect();
                Arc::new(Int64Array::from(vals))
            }
            _ => unreachable!(),
        };
        columns.push(arr);
    }

    let batch = RecordBatch::try_new(Arc::new(schema.clone()), columns)
        .map_err(|e| format!("failed to create record batch: {e}"))?;

    let file = std::fs::File::create(output_path)
        .map_err(|e| format!("failed to create output file: {e}"))?;
    let props = WriterProperties::builder().build();
    let mut writer = ArrowWriter::try_new(file, batch.schema(), Some(props))
        .map_err(|e| format!("failed to create parquet writer: {e}"))?;
    writer
        .write(&batch)
        .map_err(|e| format!("failed to write parquet: {e}"))?;
    writer
        .close()
        .map_err(|e| format!("failed to close parquet writer: {e}"))?;

    Ok(total_rows)
}
