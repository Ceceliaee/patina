use super::{common, csv_exporter, markdown_exporter, parquet_exporter, sqlite_exporter};
pub use patina_activity_model::views::storage::ExportDataRequest;

pub async fn write_export(
    pool: &sqlx::SqlitePool,
    database_path: &std::path::Path,
    request: ExportDataRequest,
) -> Result<u64, String> {
    common::validate_time_range(request.start_time, request.end_time)?;
    if common::paths_refer_to_same_file(std::path::Path::new(&request.output_path), database_path) {
        return Err("export path cannot overwrite the Patina database".into());
    }
    let selected_fields = request.selected_fields.as_deref();

    match request.format.as_str() {
        "csv" => {
            csv_exporter::export_to_csv(
                pool,
                &request.output_path,
                request.start_time,
                request.end_time,
                selected_fields,
            )
            .await
        }
        "sqlite" => {
            sqlite_exporter::export_to_sqlite(
                pool,
                &request.output_path,
                request.start_time,
                request.end_time,
                selected_fields,
            )
            .await
        }
        "parquet" => {
            parquet_exporter::export_to_parquet(
                pool,
                &request.output_path,
                selected_fields,
                request.start_time,
                request.end_time,
            )
            .await
        }
        "markdown" => {
            markdown_exporter::export_to_markdown(
                pool,
                &request.output_path,
                request.start_time,
                request.end_time,
                selected_fields,
            )
            .await
        }
        _ => Err(format!("unsupported export format: {}", request.format)),
    }
}
