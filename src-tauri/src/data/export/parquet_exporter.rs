use super::common::{
    build_overlap_where_clause, current_time_ms, load_export_classification, ms_to_datetime_str,
    ms_to_local_date, ms_to_local_hour, ms_to_local_month, ms_to_local_week, ms_to_local_weekday,
    replace_output_file, resolve_export_fields, unique_temp_path, ExportClassification,
    ExportTimeFilter,
};
use arrow::array::{Float64Array, Int64Array, StringArray};
use arrow::datatypes::{DataType, Field, Schema};
use arrow::record_batch::RecordBatch;
use parquet::arrow::ArrowWriter;
use parquet::file::properties::WriterProperties;
use sqlx::{Pool, Row, Sqlite};
use std::sync::Arc;

pub async fn export_to_parquet(
    pool: &Pool<Sqlite>,
    output_path: &str,
    selected_fields: Option<&[String]>,
    start_time: Option<i64>,
    end_time: Option<i64>,
) -> Result<u64, String> {
    let fields = resolve_export_fields(selected_fields)?;
    let classification = load_export_classification(pool).await?;
    let schema = Schema::new(
        fields
            .iter()
            .map(|name| {
                Field::new(
                    *name,
                    field_data_type(name),
                    !field_is_always_not_null(name),
                )
            })
            .collect::<Vec<_>>(),
    );
    let filter = ExportTimeFilter {
        start_time,
        end_time,
        effective_now_ms: current_time_ms(),
    };

    let sessions = load_sessions(pool, filter).await?;
    let web = load_web_activity(pool, filter).await?;
    let total_rows = (sessions.len() + web.len()) as u64;
    let batch = build_record_batch(&fields, schema, &sessions, &web, &classification)?;

    let temp_path = unique_temp_path(output_path, "parquet")?;
    let write_result = (|| -> Result<(), String> {
        let file = std::fs::File::create(&temp_path)
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
        Ok(())
    })();

    if let Err(error) = write_result {
        let _ = std::fs::remove_file(&temp_path);
        return Err(error);
    }

    replace_output_file(&temp_path, output_path)?;
    Ok(total_rows)
}

fn field_data_type(name: &str) -> DataType {
    match name {
        "duration_ms" | "weekday" | "start_hour" | "session_id" | "web_segment_id" => {
            DataType::Int64
        }
        "duration_minutes" => DataType::Float64,
        "record_type"
        | "category"
        | "start_time"
        | "end_time"
        | "app_name"
        | "exe_name"
        | "window_title"
        | "domain"
        | "normalized_domain"
        | "url"
        | "page_title"
        | "category_id"
        | "local_date"
        | "local_week"
        | "local_month"
        | "source_key"
        | "source_name"
        | "continuity_group_start_time"
        | "browser_client_id"
        | "browser_kind"
        | "browser_exe_name"
        | "favicon_url"
        | "web_source"
        | "created_at"
        | "updated_at"
        | "category_color" => DataType::Utf8,
        _ => unreachable!("export fields are validated before schema creation"),
    }
}

fn field_is_always_not_null(name: &str) -> bool {
    matches!(
        name,
        "record_type"
            | "category"
            | "category_id"
            | "category_color"
            | "start_time"
            | "local_date"
            | "local_week"
            | "local_month"
            | "weekday"
            | "start_hour"
            | "source_key"
            | "source_name"
    )
}

#[derive(Clone, Debug)]
struct SessionRow {
    id: i64,
    app_name: String,
    exe_name: String,
    window_title: Option<String>,
    start_time: i64,
    end_time: Option<i64>,
    duration: Option<i64>,
    continuity_group_start_time: i64,
}

#[derive(Clone, Debug)]
struct WebRow {
    id: i64,
    browser_client_id: String,
    browser_kind: String,
    browser_exe_name: String,
    domain: String,
    normalized_domain: String,
    url: Option<String>,
    title: Option<String>,
    favicon_url: Option<String>,
    start_time: i64,
    end_time: Option<i64>,
    duration: Option<i64>,
    source: String,
    created_at: i64,
    updated_at: i64,
}

async fn load_sessions(
    pool: &Pool<Sqlite>,
    filter: ExportTimeFilter,
) -> Result<Vec<SessionRow>, String> {
    let (clause, params) = build_overlap_where_clause(filter);
    let sql = format!(
        "SELECT id, app_name, exe_name, window_title, start_time, end_time, duration,
                COALESCE(continuity_group_start_time, start_time) AS continuity_group_start_time
         FROM sessions {} ORDER BY id ASC",
        clause
    );
    let mut query = sqlx::query(&sql);
    for param in params {
        query = query.bind(param);
    }
    let rows = query
        .fetch_all(pool)
        .await
        .map_err(|e| format!("failed to read sessions: {e}"))?;

    Ok(rows
        .into_iter()
        .map(|row| SessionRow {
            id: row.get("id"),
            app_name: row.get("app_name"),
            exe_name: row.get("exe_name"),
            window_title: row.get("window_title"),
            start_time: row.get("start_time"),
            end_time: row.get("end_time"),
            duration: row.get("duration"),
            continuity_group_start_time: row.get("continuity_group_start_time"),
        })
        .collect())
}

async fn load_web_activity(
    pool: &Pool<Sqlite>,
    filter: ExportTimeFilter,
) -> Result<Vec<WebRow>, String> {
    let (clause, params) = build_overlap_where_clause(filter);
    let sql = format!(
        "SELECT id, browser_client_id, browser_kind, browser_exe_name, domain,
                normalized_domain, url, title, favicon_url, start_time, end_time,
                duration, source, created_at, updated_at
         FROM web_activity_segments {} ORDER BY id ASC",
        clause
    );
    let mut query = sqlx::query(&sql);
    for param in params {
        query = query.bind(param);
    }
    let rows = query
        .fetch_all(pool)
        .await
        .map_err(|e| format!("failed to read web activity: {e}"))?;

    Ok(rows
        .into_iter()
        .map(|row| WebRow {
            id: row.get("id"),
            browser_client_id: row.get("browser_client_id"),
            browser_kind: row.get("browser_kind"),
            browser_exe_name: row.get("browser_exe_name"),
            domain: row.get("domain"),
            normalized_domain: row.get("normalized_domain"),
            url: row.get("url"),
            title: row.get("title"),
            favicon_url: row.get("favicon_url"),
            start_time: row.get("start_time"),
            end_time: row.get("end_time"),
            duration: row.get("duration"),
            source: row.get("source"),
            created_at: row.get("created_at"),
            updated_at: row.get("updated_at"),
        })
        .collect())
}

fn build_record_batch(
    fields: &[&str],
    schema: Schema,
    sessions: &[SessionRow],
    web: &[WebRow],
    classification: &ExportClassification,
) -> Result<RecordBatch, String> {
    let mut columns: Vec<Arc<dyn arrow::array::Array>> = Vec::with_capacity(fields.len());

    for &name in fields {
        let array: Arc<dyn arrow::array::Array> = match field_data_type(name) {
            DataType::Utf8 => {
                let values: Vec<Option<String>> = sessions
                    .iter()
                    .map(|row| session_string_value(name, row, classification))
                    .chain(
                        web.iter()
                            .map(|row| web_string_value(name, row, classification)),
                    )
                    .collect();
                Arc::new(StringArray::from(values))
            }
            DataType::Int64 => {
                let values: Vec<Option<i64>> = sessions
                    .iter()
                    .map(|row| session_i64_value(name, row))
                    .chain(web.iter().map(|row| web_i64_value(name, row)))
                    .collect();
                Arc::new(Int64Array::from(values))
            }
            DataType::Float64 => {
                let values: Vec<Option<f64>> = sessions
                    .iter()
                    .map(|row| duration_minutes(row.duration))
                    .chain(web.iter().map(|row| duration_minutes(row.duration)))
                    .collect();
                Arc::new(Float64Array::from(values))
            }
            _ => unreachable!("export field data type should be supported"),
        };
        columns.push(array);
    }

    RecordBatch::try_new(Arc::new(schema), columns)
        .map_err(|e| format!("failed to create record batch: {e}"))
}

fn session_string_value(
    name: &str,
    row: &SessionRow,
    classification: &ExportClassification,
) -> Option<String> {
    let category = classification.resolve_session_category(&row.exe_name);
    match name {
        "record_type" => Some("session".to_string()),
        "category" => Some(category.label),
        "category_id" => Some(category.id),
        "category_color" => Some(category.color),
        "app_name" => Some(row.app_name.clone()),
        "exe_name" => Some(row.exe_name.clone()),
        "window_title" => row.window_title.clone(),
        "start_time" => Some(ms_to_datetime_str(row.start_time)),
        "end_time" => row.end_time.map(ms_to_datetime_str),
        "continuity_group_start_time" => Some(ms_to_datetime_str(row.continuity_group_start_time)),
        "local_date" => Some(ms_to_local_date(row.start_time)),
        "local_week" => Some(ms_to_local_week(row.start_time)),
        "local_month" => Some(ms_to_local_month(row.start_time)),
        "source_key" => Some(row.exe_name.to_ascii_lowercase()),
        "source_name" => Some(row.app_name.clone()),
        _ => None,
    }
}

fn web_string_value(
    name: &str,
    row: &WebRow,
    classification: &ExportClassification,
) -> Option<String> {
    let category = classification.resolve_web_category(&row.normalized_domain);
    match name {
        "record_type" => Some("web".to_string()),
        "category" => Some(category.label),
        "category_id" => Some(category.id),
        "category_color" => Some(category.color),
        "domain" => Some(row.domain.clone()),
        "normalized_domain" => Some(row.normalized_domain.clone()),
        "url" => row.url.clone(),
        "page_title" => row.title.clone(),
        "browser_client_id" => Some(row.browser_client_id.clone()),
        "browser_kind" => Some(row.browser_kind.clone()),
        "browser_exe_name" => Some(row.browser_exe_name.clone()),
        "favicon_url" => row.favicon_url.clone(),
        "web_source" => Some(row.source.clone()),
        "start_time" => Some(ms_to_datetime_str(row.start_time)),
        "end_time" => row.end_time.map(ms_to_datetime_str),
        "created_at" => Some(ms_to_datetime_str(row.created_at)),
        "updated_at" => Some(ms_to_datetime_str(row.updated_at)),
        "local_date" => Some(ms_to_local_date(row.start_time)),
        "local_week" => Some(ms_to_local_week(row.start_time)),
        "local_month" => Some(ms_to_local_month(row.start_time)),
        "source_key" => Some(row.normalized_domain.to_ascii_lowercase()),
        "source_name" => Some(row.domain.clone()),
        _ => None,
    }
}

fn session_i64_value(name: &str, row: &SessionRow) -> Option<i64> {
    match name {
        "session_id" => Some(row.id),
        "duration_ms" => row.duration,
        "weekday" => Some(ms_to_local_weekday(row.start_time)),
        "start_hour" => Some(ms_to_local_hour(row.start_time)),
        _ => None,
    }
}

fn web_i64_value(name: &str, row: &WebRow) -> Option<i64> {
    match name {
        "web_segment_id" => Some(row.id),
        "duration_ms" => row.duration,
        "weekday" => Some(ms_to_local_weekday(row.start_time)),
        "start_hour" => Some(ms_to_local_hour(row.start_time)),
        _ => None,
    }
}

fn duration_minutes(duration: Option<i64>) -> Option<f64> {
    duration.map(|duration| duration as f64 / 60_000.0)
}
