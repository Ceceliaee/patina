use super::common::{
    build_overlap_where_clause, current_time_ms, load_export_classification, ms_to_datetime_str,
    ms_to_local_date, ms_to_local_hour, ms_to_local_month, ms_to_local_week, ms_to_local_weekday,
    replace_output_file, resolve_export_fields, sanitize_csv_text_for_excel, unique_temp_path,
    ExportClassification, ExportTimeFilter,
};
use sqlx::{Pool, Row, Sqlite};
use std::io::Write;

pub async fn export_to_csv(
    pool: &Pool<Sqlite>,
    output_path: &str,
    start_time: Option<i64>,
    end_time: Option<i64>,
    selected_fields: Option<&[String]>,
) -> Result<u64, String> {
    let fields = resolve_export_fields(selected_fields)?;
    let classification = load_export_classification(pool).await?;
    let filter = ExportTimeFilter {
        start_time,
        end_time,
        effective_now_ms: current_time_ms(),
    };

    let sessions = load_sessions(pool, filter).await?;
    let web = load_web_activity(pool, filter).await?;
    let total_rows = (sessions.len() + web.len()) as u64;

    let temp_path = unique_temp_path(output_path, "csv")?;
    let write_result = (|| -> Result<(), String> {
        let mut file = std::fs::File::create(&temp_path)
            .map_err(|e| format!("failed to create output file: {e}"))?;
        file.write_all(&[0xEF, 0xBB, 0xBF])
            .map_err(|e| format!("failed to write BOM: {e}"))?;

        let mut writer = csv::Writer::from_writer(file);
        writer
            .write_record(&fields)
            .map_err(|e| format!("failed to write csv header: {e}"))?;

        let total = sessions.len() + web.len();
        for index in 0..total {
            let record: Vec<String> = fields
                .iter()
                .map(|field| get_csv_value(field, &sessions, &web, index, &classification))
                .collect();
            writer
                .write_record(&record)
                .map_err(|e| format!("failed to write csv row: {e}"))?;
        }

        writer
            .flush()
            .map_err(|e| format!("failed to flush csv writer: {e}"))?;
        Ok(())
    })();

    if let Err(error) = write_result {
        let _ = std::fs::remove_file(&temp_path);
        return Err(error);
    }

    replace_output_file(&temp_path, output_path)?;
    Ok(total_rows)
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

fn csv_text(value: &str) -> String {
    sanitize_csv_text_for_excel(value)
}

fn duration_minutes_text(duration: Option<i64>) -> String {
    duration
        .map(|duration| format!("{:.3}", duration as f64 / 60_000.0))
        .unwrap_or_default()
}

fn get_csv_value(
    name: &str,
    sessions: &[SessionRow],
    web: &[WebRow],
    index: usize,
    classification: &ExportClassification,
) -> String {
    if index < sessions.len() {
        let row = &sessions[index];
        let category = classification.resolve_session_category(&row.exe_name);
        match name {
            "record_type" => "session".to_string(),
            "category" => csv_text(&category.label),
            "category_id" => csv_text(&category.id),
            "category_color" => csv_text(&category.color),
            "session_id" => row.id.to_string(),
            "web_segment_id" => String::new(),
            "app_name" => csv_text(&row.app_name),
            "exe_name" => csv_text(&row.exe_name),
            "window_title" => csv_text(row.window_title.as_deref().unwrap_or_default()),
            "domain" | "normalized_domain" | "url" | "page_title" | "browser_client_id"
            | "browser_kind" | "browser_exe_name" | "favicon_url" | "web_source" => String::new(),
            "start_time" => ms_to_datetime_str(row.start_time),
            "end_time" => row.end_time.map(ms_to_datetime_str).unwrap_or_default(),
            "continuity_group_start_time" => ms_to_datetime_str(row.continuity_group_start_time),
            "created_at" | "updated_at" => String::new(),
            "duration_ms" => row
                .duration
                .map(|duration| duration.to_string())
                .unwrap_or_default(),
            "duration_minutes" => duration_minutes_text(row.duration),
            "local_date" => ms_to_local_date(row.start_time),
            "local_week" => ms_to_local_week(row.start_time),
            "local_month" => ms_to_local_month(row.start_time),
            "weekday" => ms_to_local_weekday(row.start_time).to_string(),
            "start_hour" => ms_to_local_hour(row.start_time).to_string(),
            "source_key" => csv_text(&row.exe_name.to_ascii_lowercase()),
            "source_name" => csv_text(&row.app_name),
            _ => String::new(),
        }
    } else {
        let row = &web[index - sessions.len()];
        let category = classification.resolve_web_category(&row.normalized_domain);
        match name {
            "record_type" => "web".to_string(),
            "category" => csv_text(&category.label),
            "category_id" => csv_text(&category.id),
            "category_color" => csv_text(&category.color),
            "session_id" => String::new(),
            "web_segment_id" => row.id.to_string(),
            "app_name" | "exe_name" | "window_title" | "continuity_group_start_time" => {
                String::new()
            }
            "domain" => csv_text(&row.domain),
            "normalized_domain" => csv_text(&row.normalized_domain),
            "url" => csv_text(row.url.as_deref().unwrap_or_default()),
            "page_title" => csv_text(row.title.as_deref().unwrap_or_default()),
            "browser_client_id" => csv_text(&row.browser_client_id),
            "browser_kind" => csv_text(&row.browser_kind),
            "browser_exe_name" => csv_text(&row.browser_exe_name),
            "favicon_url" => csv_text(row.favicon_url.as_deref().unwrap_or_default()),
            "web_source" => csv_text(&row.source),
            "start_time" => ms_to_datetime_str(row.start_time),
            "end_time" => row.end_time.map(ms_to_datetime_str).unwrap_or_default(),
            "created_at" => ms_to_datetime_str(row.created_at),
            "updated_at" => ms_to_datetime_str(row.updated_at),
            "duration_ms" => row
                .duration
                .map(|duration| duration.to_string())
                .unwrap_or_default(),
            "duration_minutes" => duration_minutes_text(row.duration),
            "local_date" => ms_to_local_date(row.start_time),
            "local_week" => ms_to_local_week(row.start_time),
            "local_month" => ms_to_local_month(row.start_time),
            "weekday" => ms_to_local_weekday(row.start_time).to_string(),
            "start_hour" => ms_to_local_hour(row.start_time).to_string(),
            "source_key" => csv_text(&row.normalized_domain.to_ascii_lowercase()),
            "source_name" => csv_text(&row.domain),
            _ => String::new(),
        }
    }
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
