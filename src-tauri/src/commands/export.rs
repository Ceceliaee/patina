use crate::data::sqlite_pool::wait_for_sqlite_pool;
use crate::engine::export::{csv_exporter, parquet_exporter, sqlite_exporter};
use rfd::FileDialog;
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportToParquetRequest {
    output_path: String,
    selected_fields: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportToParquetResult {
    row_count: u64,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParquetFieldInfo {
    name: String,
    label: String,
    group: String,
    selected_by_default: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportDataRequest {
    pub format: String,
    pub output_path: String,
    pub start_time: Option<i64>,
    pub end_time: Option<i64>,
    pub selected_fields: Option<Vec<String>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportDataResult {
    pub row_count: u64,
}

#[tauri::command]
pub fn cmd_pick_parquet_save_file(initial_path: Option<String>) -> Option<String> {
    let mut dialog = FileDialog::new()
        .add_filter("Parquet files", &["parquet"])
        .set_file_name("patina_export.parquet");
    if let Some(dir) = initial_path {
        if !dir.trim().is_empty() {
            dialog = dialog.set_directory(dir.trim());
        }
    }
    dialog.save_file().map(|p| p.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn cmd_export_data_to_parquet(
    request: ExportToParquetRequest,
    app: AppHandle,
) -> Result<ExportToParquetResult, String> {
    let pool = wait_for_sqlite_pool(&app).await?;
    let row_count =
        parquet_exporter::export_to_parquet(&pool, &request.output_path, &request.selected_fields)
            .await?;
    Ok(ExportToParquetResult { row_count })
}

#[tauri::command]
pub fn cmd_get_parquet_export_fields() -> Vec<ParquetFieldInfo> {
    vec![
        ParquetFieldInfo {
            name: "exe_name".into(),
            label: "exe_name".into(),
            group: "session".into(),
            selected_by_default: true,
        },
        ParquetFieldInfo {
            name: "app_name".into(),
            label: "app_name".into(),
            group: "session".into(),
            selected_by_default: true,
        },
        ParquetFieldInfo {
            name: "window_title".into(),
            label: "window_title".into(),
            group: "session".into(),
            selected_by_default: true,
        },
        ParquetFieldInfo {
            name: "start_time".into(),
            label: "start_time".into(),
            group: "session".into(),
            selected_by_default: true,
        },
        ParquetFieldInfo {
            name: "end_time".into(),
            label: "end_time".into(),
            group: "session".into(),
            selected_by_default: true,
        },
        ParquetFieldInfo {
            name: "duration_ms".into(),
            label: "duration_ms".into(),
            group: "session".into(),
            selected_by_default: true,
        },
        ParquetFieldInfo {
            name: "domain".into(),
            label: "domain".into(),
            group: "web".into(),
            selected_by_default: true,
        },
        ParquetFieldInfo {
            name: "normalized_domain".into(),
            label: "normalized_domain".into(),
            group: "web".into(),
            selected_by_default: true,
        },
        ParquetFieldInfo {
            name: "url".into(),
            label: "url".into(),
            group: "web".into(),
            selected_by_default: true,
        },
        ParquetFieldInfo {
            name: "page_title".into(),
            label: "page_title".into(),
            group: "web".into(),
            selected_by_default: true,
        },
        ParquetFieldInfo {
            name: "start_time".into(),
            label: "start_time".into(),
            group: "web".into(),
            selected_by_default: true,
        },
        ParquetFieldInfo {
            name: "end_time".into(),
            label: "end_time".into(),
            group: "web".into(),
            selected_by_default: true,
        },
        ParquetFieldInfo {
            name: "duration_ms".into(),
            label: "duration_ms".into(),
            group: "web".into(),
            selected_by_default: true,
        },
    ]
}

#[tauri::command]
pub fn cmd_pick_export_save_file(format: String, initial_path: Option<String>) -> Option<String> {
    let (filter_name, extensions, default_name) = match format.as_str() {
        "csv" => ("CSV files", vec!["csv"], "patina_export.csv"),
        "sqlite" => ("SQLite files", vec!["db", "sqlite"], "patina_export.db"),
        "parquet" => ("Parquet files", vec!["parquet"], "patina_export.parquet"),
        _ => return None,
    };
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

#[tauri::command]
pub async fn cmd_export_data(
    request: ExportDataRequest,
    app: AppHandle,
) -> Result<ExportDataResult, String> {
    match request.format.as_str() {
        "csv" => {
            let fields = request.selected_fields.as_deref().unwrap_or(&[]);
            let row_count =
                csv_exporter::export_to_csv(&app, &request.output_path, request.start_time, request.end_time, fields).await?;
            Ok(ExportDataResult { row_count })
        }
        "sqlite" => {
            let fields = request.selected_fields.as_deref().unwrap_or(&[]);
            let row_count =
                sqlite_exporter::export_to_sqlite(&app, &request.output_path, request.start_time, request.end_time, fields).await?;
            Ok(ExportDataResult { row_count })
        }
        "parquet" => {
            let pool = wait_for_sqlite_pool(&app).await?;
            let fields = request.selected_fields.as_deref().unwrap_or(&[]);
            let row_count =
                parquet_exporter::export_to_parquet_with_time(
                    &pool,
                    &request.output_path,
                    fields,
                    request.start_time,
                    request.end_time,
                )
                .await?;
            Ok(ExportDataResult { row_count })
        }
        _ => Err(format!("unsupported export format: {}", request.format)),
    }
}
