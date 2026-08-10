use crate::commands::window_guard::require_main_window_string;
use crate::data::export::{self, ExportDataRequest};
use crate::domain::export_schedule::{ScheduledExportConfigInput, ScheduledExportSnapshot};
use rfd::FileDialog;
use serde::Serialize;
use tauri::{AppHandle, WebviewWindow};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportDataResult {
    pub row_count: u64,
}

#[tauri::command]
pub fn cmd_pick_export_save_file(
    format: String,
    start_date: String,
    end_date: String,
    initial_path: Option<String>,
) -> Option<String> {
    let (filter_name, extensions) = match format.as_str() {
        "csv" => ("CSV files", vec!["csv"]),
        "sqlite" => ("SQLite files", vec!["sqlite", "db"]),
        "parquet" => ("Parquet files", vec!["parquet"]),
        "markdown" => ("Markdown files", vec!["md"]),
        _ => return None,
    };
    let default_name = export_file_name(&format, &start_date, &end_date)?;
    let mut dialog = FileDialog::new()
        .add_filter(filter_name, &extensions)
        .set_file_name(default_name);
    if let Some(dir) = initial_path {
        if !dir.trim().is_empty() {
            dialog = dialog.set_directory(dir.trim());
        }
    }
    dialog.save_file().map(|p| p.to_string_lossy().to_string())
}

fn export_file_name(format: &str, start_date: &str, end_date: &str) -> Option<String> {
    fn compact_date(value: &str) -> Option<String> {
        let bytes = value.as_bytes();
        if bytes.len() != 10 || bytes[4] != b'-' || bytes[7] != b'-' {
            return None;
        }
        if !bytes
            .iter()
            .enumerate()
            .all(|(index, byte)| index == 4 || index == 7 || byte.is_ascii_digit())
        {
            return None;
        }
        Some(value.replace('-', ""))
    }

    let extension = match format {
        "csv" => "csv",
        "sqlite" => "sqlite",
        "parquet" => "parquet",
        "markdown" => "md",
        _ => return None,
    };
    let start = compact_date(start_date)?;
    let end = compact_date(end_date)?;
    let date_range = if start == end {
        start
    } else {
        format!("{start}-{end}")
    };
    Some(format!("Patina-export-{date_range}.{extension}"))
}

#[tauri::command]
pub async fn cmd_export_data(
    request: ExportDataRequest,
    app: AppHandle,
) -> Result<ExportDataResult, String> {
    let row_count = export::export_data(&app, request).await?;
    Ok(ExportDataResult { row_count })
}

#[tauri::command]
pub async fn cmd_get_scheduled_export_snapshot(
    app: AppHandle,
) -> Result<ScheduledExportSnapshot, String> {
    crate::app::scheduled_export::get_snapshot(&app).await
}

#[tauri::command]
pub fn cmd_pick_scheduled_export_directory(initial_path: Option<String>) -> Option<String> {
    crate::app::scheduled_export::pick_directory(initial_path)
}

#[tauri::command]
pub async fn cmd_save_scheduled_export_config(
    input: ScheduledExportConfigInput,
    app: AppHandle,
    window: WebviewWindow,
) -> Result<ScheduledExportSnapshot, String> {
    require_main_window_string(&window)?;
    crate::app::scheduled_export::save_config(&app, input).await
}

#[cfg(test)]
mod tests {
    use super::export_file_name;

    #[test]
    fn export_file_names_use_range_and_format_extension() {
        for (format, extension) in [
            ("csv", "csv"),
            ("markdown", "md"),
            ("parquet", "parquet"),
            ("sqlite", "sqlite"),
        ] {
            assert_eq!(
                export_file_name(format, "2026-07-01", "2026-07-12"),
                Some(format!("Patina-export-20260701-20260712.{extension}")),
            );
        }
    }

    #[test]
    fn single_day_export_file_names_do_not_repeat_the_date() {
        assert_eq!(
            export_file_name("csv", "2026-07-12", "2026-07-12"),
            Some("Patina-export-20260712.csv".to_string()),
        );
    }

    #[test]
    fn export_file_names_reject_invalid_dates_and_formats() {
        assert_eq!(export_file_name("csv", "20260701", "2026-07-12"), None);
        assert_eq!(export_file_name("json", "2026-07-01", "2026-07-12"), None);
    }
}
