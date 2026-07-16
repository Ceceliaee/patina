use super::common::{
    build_overlap_where_clause, current_time_ms, load_export_classification, ms_to_datetime_str,
    ms_to_local_date, ms_to_local_hour, ms_to_local_month, ms_to_local_week, ms_to_local_weekday,
    replace_output_file, resolve_export_fields, unique_temp_path, ExportClassification,
    ExportTimeFilter,
};
use sqlx::{Pool, Row, Sqlite};
use std::fmt::Write as FmtWrite;

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

enum ActivityRow {
    Session(SessionRow),
    Web(WebRow),
}

impl ActivityRow {
    fn start_time(&self) -> i64 {
        match self {
            Self::Session(row) => row.start_time,
            Self::Web(row) => row.start_time,
        }
    }

    fn duration(&self) -> Option<i64> {
        match self {
            Self::Session(row) => row.duration,
            Self::Web(row) => row.duration,
        }
    }
}

pub async fn export_to_markdown(
    pool: &Pool<Sqlite>,
    output_path: &str,
    start_time: Option<i64>,
    end_time: Option<i64>,
    selected_fields: Option<&[String]>,
) -> Result<u64, String> {
    let fields = resolve_export_fields(selected_fields)?;
    let classification = load_export_classification(pool).await?;
    let effective_now_ms = current_time_ms();
    let filter = ExportTimeFilter {
        start_time,
        end_time,
        effective_now_ms,
    };
    let mut rows = load_sessions(pool, filter)
        .await?
        .into_iter()
        .map(ActivityRow::Session)
        .chain(
            load_web_activity(pool, filter)
                .await?
                .into_iter()
                .map(ActivityRow::Web),
        )
        .collect::<Vec<_>>();
    rows.sort_by_key(ActivityRow::start_time);

    let document = render_document(
        &rows,
        &fields,
        &classification,
        start_time,
        end_time,
        effective_now_ms,
    );
    let temp_path = unique_temp_path(output_path, "md")?;
    if let Err(error) = std::fs::write(&temp_path, document.as_bytes()) {
        let _ = std::fs::remove_file(&temp_path);
        return Err(format!("failed to write Markdown export: {error}"));
    }
    if let Err(error) = replace_output_file(&temp_path, output_path) {
        let _ = std::fs::remove_file(&temp_path);
        return Err(error);
    }
    Ok(rows.len() as u64)
}

fn render_document(
    rows: &[ActivityRow],
    fields: &[&str],
    classification: &ExportClassification,
    start_time: Option<i64>,
    end_time: Option<i64>,
    exported_at: i64,
) -> String {
    let chinese = classification.language() != "en-US";
    let total_duration: i64 = rows.iter().filter_map(ActivityRow::duration).sum();
    let range_start = start_time
        .map(ms_to_local_date)
        .unwrap_or_else(|| if chinese { "全部" } else { "All" }.to_string());
    let range_end = end_time
        .map(|value| ms_to_local_date(value.saturating_sub(1)))
        .unwrap_or_else(|| if chinese { "当前" } else { "Current" }.to_string());
    let mut output = String::new();
    let title = if chinese {
        "Patina 活动记录"
    } else {
        "Patina Activity Records"
    };
    let _ = writeln!(output, "# {title}\n");
    if chinese {
        let _ = writeln!(output, "- 导出范围：{range_start} 至 {range_end}");
        let _ = writeln!(output, "- 导出时间：{}", ms_to_datetime_str(exported_at));
        let _ = writeln!(output, "- 记录数量：{}", rows.len());
        let _ = writeln!(
            output,
            "- 总时长：{}\n",
            readable_duration(total_duration, true)
        );
    } else {
        let _ = writeln!(output, "- Range: {range_start} to {range_end}");
        let _ = writeln!(output, "- Exported at: {}", ms_to_datetime_str(exported_at));
        let _ = writeln!(output, "- Records: {}", rows.len());
        let _ = writeln!(
            output,
            "- Total duration: {}\n",
            readable_duration(total_duration, false)
        );
    }

    if rows.is_empty() {
        let message = if chinese {
            "所选范围内没有活动记录。"
        } else {
            "No activity records were found in the selected range."
        };
        let _ = writeln!(output, "{message}");
        return output;
    }

    let mut current_date = String::new();
    for row in rows {
        let date = ms_to_local_date(row.start_time());
        if date != current_date {
            current_date = date;
            let _ = writeln!(output, "## {current_date}\n");
            let labels = fields
                .iter()
                .map(|field| field_label(field, chinese))
                .collect::<Vec<_>>();
            let _ = writeln!(output, "| {} |", labels.join(" | "));
            let _ = writeln!(output, "| {} |", vec!["---"; fields.len()].join(" | "));
        }
        let values = fields
            .iter()
            .map(|field| escape_markdown_cell(&field_value(field, row, classification)))
            .collect::<Vec<_>>();
        let _ = writeln!(output, "| {} |", values.join(" | "));
    }
    output
}

fn field_value(field: &str, row: &ActivityRow, classification: &ExportClassification) -> String {
    match row {
        ActivityRow::Session(row) => {
            let category = classification.resolve_session_category(&row.exe_name);
            match field {
                "record_type" => "session".into(),
                "category" => category.label,
                "category_id" => category.id,
                "category_color" => category.color,
                "session_id" => row.id.to_string(),
                "web_segment_id" => empty_value(),
                "app_name" => present(&row.app_name),
                "exe_name" => present(&row.exe_name),
                "window_title" => optional(row.window_title.as_deref()),
                "domain" | "normalized_domain" | "url" | "page_title" | "browser_client_id"
                | "browser_kind" | "browser_exe_name" | "favicon_url" | "web_source"
                | "created_at" | "updated_at" => empty_value(),
                "start_time" => ms_to_datetime_str(row.start_time),
                "end_time" => row
                    .end_time
                    .map(ms_to_datetime_str)
                    .unwrap_or_else(empty_value),
                "continuity_group_start_time" => {
                    ms_to_datetime_str(row.continuity_group_start_time)
                }
                "duration_ms" => row
                    .duration
                    .map(|v| v.to_string())
                    .unwrap_or_else(empty_value),
                "duration_minutes" => duration_minutes(row.duration),
                "local_date" => ms_to_local_date(row.start_time),
                "local_week" => ms_to_local_week(row.start_time),
                "local_month" => ms_to_local_month(row.start_time),
                "weekday" => ms_to_local_weekday(row.start_time).to_string(),
                "start_hour" => ms_to_local_hour(row.start_time).to_string(),
                "source_key" => present(&row.exe_name.to_ascii_lowercase()),
                "source_name" => present(&row.app_name),
                _ => empty_value(),
            }
        }
        ActivityRow::Web(row) => {
            let category = classification.resolve_web_category(&row.normalized_domain);
            match field {
                "record_type" => "web".into(),
                "category" => category.label,
                "category_id" => category.id,
                "category_color" => category.color,
                "session_id" => empty_value(),
                "web_segment_id" => row.id.to_string(),
                "app_name" | "exe_name" | "window_title" | "continuity_group_start_time" => {
                    empty_value()
                }
                "domain" => present(&row.domain),
                "normalized_domain" => present(&row.normalized_domain),
                "url" => optional(row.url.as_deref()),
                "page_title" => optional(row.title.as_deref()),
                "browser_client_id" => present(&row.browser_client_id),
                "browser_kind" => present(&row.browser_kind),
                "browser_exe_name" => present(&row.browser_exe_name),
                "favicon_url" => optional(row.favicon_url.as_deref()),
                "web_source" => present(&row.source),
                "start_time" => ms_to_datetime_str(row.start_time),
                "end_time" => row
                    .end_time
                    .map(ms_to_datetime_str)
                    .unwrap_or_else(empty_value),
                "created_at" => ms_to_datetime_str(row.created_at),
                "updated_at" => ms_to_datetime_str(row.updated_at),
                "duration_ms" => row
                    .duration
                    .map(|v| v.to_string())
                    .unwrap_or_else(empty_value),
                "duration_minutes" => duration_minutes(row.duration),
                "local_date" => ms_to_local_date(row.start_time),
                "local_week" => ms_to_local_week(row.start_time),
                "local_month" => ms_to_local_month(row.start_time),
                "weekday" => ms_to_local_weekday(row.start_time).to_string(),
                "start_hour" => ms_to_local_hour(row.start_time).to_string(),
                "source_key" => present(&row.normalized_domain.to_ascii_lowercase()),
                "source_name" => present(&row.domain),
                _ => empty_value(),
            }
        }
    }
}

fn empty_value() -> String {
    "—".into()
}
fn present(value: &str) -> String {
    if value.trim().is_empty() {
        empty_value()
    } else {
        value.to_string()
    }
}
fn optional(value: Option<&str>) -> String {
    value.map(present).unwrap_or_else(empty_value)
}
fn duration_minutes(value: Option<i64>) -> String {
    value
        .map(|v| format!("{:.3}", v as f64 / 60_000.0))
        .unwrap_or_else(empty_value)
}

fn escape_markdown_cell(value: &str) -> String {
    let mut escaped = String::with_capacity(value.len());
    for character in value.chars() {
        match character {
            '\r' | '\n' => escaped.push(' '),
            '\\' | '|' | '`' | '*' | '_' | '~' | '[' | ']' | '(' | ')' | '<' | '>' | '#' | '!' => {
                escaped.push('\\');
                escaped.push(character);
            }
            _ => escaped.push(character),
        }
    }
    escaped
}

fn readable_duration(milliseconds: i64, chinese: bool) -> String {
    let total_minutes = milliseconds.max(0) / 60_000;
    let hours = total_minutes / 60;
    let minutes = total_minutes % 60;
    if chinese {
        format!("{hours} 小时 {minutes} 分钟")
    } else {
        format!("{hours}h {minutes}m")
    }
}

fn field_label(field: &str, chinese: bool) -> &'static str {
    let labels = match field {
        "record_type" => ("记录类型", "Record Type"),
        "category" => ("分类", "Category"),
        "start_time" => ("开始时间", "Start Time"),
        "end_time" => ("结束时间", "End Time"),
        "duration_ms" => ("时长（毫秒）", "Duration (ms)"),
        "duration_minutes" => ("时长（分钟）", "Duration (minutes)"),
        "app_name" => ("应用名称", "App Name"),
        "exe_name" => ("可执行文件名", "Executable Name"),
        "window_title" => ("窗口标题", "Window Title"),
        "domain" => ("域名", "Domain"),
        "normalized_domain" => ("标准化域名", "Normalized Domain"),
        "url" => ("URL 地址", "URL"),
        "page_title" => ("页面标题", "Page Title"),
        "category_id" => ("分类 ID", "Category ID"),
        "local_date" => ("本地日期", "Local Date"),
        "local_week" => ("本地周", "Local Week"),
        "local_month" => ("本地月份", "Local Month"),
        "weekday" => ("星期", "Weekday"),
        "start_hour" => ("开始小时", "Start Hour"),
        "source_key" => ("来源键", "Source Key"),
        "source_name" => ("来源名称", "Source Name"),
        "session_id" => ("会话 ID", "Session ID"),
        "web_segment_id" => ("网页片段 ID", "Web Segment ID"),
        "continuity_group_start_time" => ("连续组开始时间", "Continuity Group Start"),
        "browser_client_id" => ("浏览器客户端 ID", "Browser Client ID"),
        "browser_kind" => ("浏览器类型", "Browser Kind"),
        "browser_exe_name" => ("浏览器可执行文件", "Browser Executable"),
        "favicon_url" => ("网站图标 URL", "Favicon URL"),
        "web_source" => ("网页来源", "Web Source"),
        "created_at" => ("创建时间", "Created At"),
        "updated_at" => ("更新时间", "Updated At"),
        "category_color" => ("分类颜色", "Category Color"),
        _ => ("未知字段", "Unknown Field"),
    };
    if chinese {
        labels.0
    } else {
        labels.1
    }
}

async fn load_sessions(
    pool: &Pool<Sqlite>,
    filter: ExportTimeFilter,
) -> Result<Vec<SessionRow>, String> {
    let (clause, params) = build_overlap_where_clause(filter);
    let sql = format!("SELECT id, app_name, exe_name, window_title, start_time, end_time, duration, COALESCE(continuity_group_start_time, start_time) AS continuity_group_start_time FROM sessions {clause} ORDER BY start_time ASC, id ASC");
    let mut query = sqlx::query(&sql);
    for param in params {
        query = query.bind(param);
    }
    query
        .fetch_all(pool)
        .await
        .map_err(|e| format!("failed to read sessions: {e}"))?
        .into_iter()
        .map(|row| {
            Ok(SessionRow {
                id: row.get("id"),
                app_name: row.get("app_name"),
                exe_name: row.get("exe_name"),
                window_title: row.get("window_title"),
                start_time: row.get("start_time"),
                end_time: row.get("end_time"),
                duration: row.get("duration"),
                continuity_group_start_time: row.get("continuity_group_start_time"),
            })
        })
        .collect()
}

async fn load_web_activity(
    pool: &Pool<Sqlite>,
    filter: ExportTimeFilter,
) -> Result<Vec<WebRow>, String> {
    let (clause, params) = build_overlap_where_clause(filter);
    let sql = format!("SELECT id, browser_client_id, browser_kind, browser_exe_name, domain, normalized_domain, url, title, favicon_url, start_time, end_time, duration, source, created_at, updated_at FROM web_activity_segments {clause} ORDER BY start_time ASC, id ASC");
    let mut query = sqlx::query(&sql);
    for param in params {
        query = query.bind(param);
    }
    query
        .fetch_all(pool)
        .await
        .map_err(|e| format!("failed to read web activity: {e}"))?
        .into_iter()
        .map(|row| {
            Ok(WebRow {
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
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn markdown_cells_escape_table_breakers_and_newlines() {
        assert_eq!(
            escape_markdown_cell("a|b\\c\n[next](url) #tag"),
            "a\\|b\\\\c \\[next\\]\\(url\\) \\#tag"
        );
    }

    #[test]
    fn every_export_field_has_a_localized_label() {
        for field in super::super::common::ALL_EXPORT_FIELDS {
            assert_ne!(field_label(field, true), "未知字段");
            assert_ne!(field_label(field, false), "Unknown Field");
        }
    }
}
