pub mod common;
pub mod csv_exporter;
pub mod parquet_exporter;
pub mod sqlite_exporter;

use crate::data::sqlite_pool::wait_for_sqlite_pool;
use serde::Deserialize;
use tauri::AppHandle;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportDataRequest {
    pub format: String,
    pub output_path: String,
    pub start_time: Option<i64>,
    pub end_time: Option<i64>,
    pub selected_fields: Option<Vec<String>>,
}

pub async fn export_data(app: &AppHandle, request: ExportDataRequest) -> Result<u64, String> {
    common::validate_time_range(request.start_time, request.end_time)?;
    let pool = wait_for_sqlite_pool(app).await?;
    let selected_fields = request.selected_fields.as_deref();

    match request.format.as_str() {
        "csv" => {
            csv_exporter::export_to_csv(
                &pool,
                &request.output_path,
                request.start_time,
                request.end_time,
                selected_fields,
            )
            .await
        }
        "sqlite" => {
            sqlite_exporter::export_to_sqlite(
                &pool,
                &request.output_path,
                request.start_time,
                request.end_time,
                selected_fields,
            )
            .await
        }
        "parquet" => {
            parquet_exporter::export_to_parquet(
                &pool,
                &request.output_path,
                selected_fields,
                request.start_time,
                request.end_time,
            )
            .await
        }
        _ => Err(format!("unsupported export format: {}", request.format)),
    }
}

#[cfg(test)]
mod tests {
    use super::{csv_exporter, parquet_exporter, sqlite_exporter};
    use parquet::arrow::arrow_reader::ParquetRecordBatchReaderBuilder;
    use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
    use sqlx::{Pool, Row, Sqlite};
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    async fn source_pool() -> Pool<Sqlite> {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("test source db should open");

        sqlx::query(
            "CREATE TABLE sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                app_name TEXT NOT NULL,
                exe_name TEXT NOT NULL,
                window_title TEXT,
                start_time INTEGER NOT NULL,
                end_time INTEGER,
                duration INTEGER,
                continuity_group_start_time INTEGER
            )",
        )
        .execute(&pool)
        .await
        .expect("sessions table should be created");
        sqlx::query(
            "CREATE TABLE web_activity_segments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                browser_client_id TEXT NOT NULL,
                browser_kind TEXT NOT NULL,
                browser_exe_name TEXT NOT NULL,
                domain TEXT NOT NULL,
                normalized_domain TEXT NOT NULL,
                url TEXT,
                title TEXT,
                favicon_url TEXT,
                start_time INTEGER NOT NULL,
                end_time INTEGER,
                duration INTEGER,
                source TEXT NOT NULL DEFAULT 'browser-extension',
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            )",
        )
        .execute(&pool)
        .await
        .expect("web table should be created");
        sqlx::query(
            "CREATE TABLE settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            )",
        )
        .execute(&pool)
        .await
        .expect("settings table should be created");

        pool
    }

    async fn insert_session(
        pool: &Pool<Sqlite>,
        app_name: &str,
        title: &str,
        start_time: i64,
        end_time: i64,
    ) {
        sqlx::query(
            "INSERT INTO sessions (
                app_name,
                exe_name,
                window_title,
                start_time,
                end_time,
                duration,
                continuity_group_start_time
             ) VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(app_name)
        .bind(format!("{}.exe", app_name.to_lowercase()))
        .bind(title)
        .bind(start_time)
        .bind(end_time)
        .bind(end_time - start_time)
        .bind(start_time)
        .execute(pool)
        .await
        .expect("session row should be inserted");
    }

    async fn insert_web(pool: &Pool<Sqlite>, title: &str, start_time: i64, end_time: i64) {
        sqlx::query(
            "INSERT INTO web_activity_segments
             (
                browser_client_id,
                browser_kind,
                browser_exe_name,
                domain,
                normalized_domain,
                url,
                title,
                favicon_url,
                start_time,
                end_time,
                duration,
                source,
                created_at,
                updated_at
             )
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind("client-1")
        .bind("chrome")
        .bind("chrome.exe")
        .bind("example.com")
        .bind("example.com")
        .bind("https://example.com/path?q=export-me#fragment")
        .bind(title)
        .bind(None::<String>)
        .bind(start_time)
        .bind(end_time)
        .bind(end_time - start_time)
        .bind("browser-extension")
        .bind(start_time)
        .bind(end_time)
        .execute(pool)
        .await
        .expect("web row should be inserted");
    }

    fn output_path(extension: &str) -> PathBuf {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be after epoch")
            .as_nanos();
        std::env::temp_dir().join(format!(
            "patina-export-test-{}-{suffix}.{extension}",
            std::process::id()
        ))
    }

    fn field_list(fields: &[&str]) -> Vec<String> {
        fields.iter().map(|field| field.to_string()).collect()
    }

    #[tokio::test]
    async fn csv_export_uses_overlap_range_and_sanitizes_text() {
        let pool = source_pool().await;
        insert_session(&pool, "Inside", "=cmd", 1_100, 1_200).await;
        insert_session(&pool, "BeforeOverlap", "+SUM(1,1)", 900, 1_050).await;
        insert_session(&pool, "AfterOverlap", "plain", 1_900, 2_300).await;
        insert_session(&pool, "Outside", "outside", 2_100, 2_200).await;
        insert_web(&pool, "  @HYPERLINK(\"x\")", 1_500, 1_600).await;

        let path = output_path("csv");
        let fields = field_list(&[
            "record_type",
            "app_name",
            "window_title",
            "url",
            "page_title",
        ]);
        let row_count = csv_exporter::export_to_csv(
            &pool,
            path.to_str().expect("temp path should be utf-8"),
            Some(1_000),
            Some(2_000),
            Some(&fields),
        )
        .await
        .expect("csv export should succeed");

        let csv = std::fs::read_to_string(&path).expect("csv output should be readable");
        let _ = std::fs::remove_file(&path);

        assert_eq!(row_count, 4);
        assert!(csv.contains("'=cmd"));
        assert!(csv.contains("'+SUM(1,1)"));
        assert!(csv.contains("'  @HYPERLINK"));
        assert!(csv.contains("https://example.com/path?q=export-me#fragment"));
        assert!(csv.contains("AfterOverlap"));
        assert!(!csv.contains("Outside"));
    }

    #[tokio::test]
    async fn sqlite_export_replaces_existing_file_without_appending() {
        let pool = source_pool().await;
        insert_session(&pool, "Inside", "plain", 1_100, 1_200).await;

        let path = output_path("sqlite");
        let path_str = path.to_str().expect("temp path should be utf-8");
        let fields = field_list(&["record_type", "app_name"]);

        sqlite_exporter::export_to_sqlite(&pool, path_str, Some(1_000), Some(2_000), Some(&fields))
            .await
            .expect("first sqlite export should succeed");
        sqlite_exporter::export_to_sqlite(&pool, path_str, Some(1_000), Some(2_000), Some(&fields))
            .await
            .expect("second sqlite export should replace prior output");

        let options = SqliteConnectOptions::new().filename(&path).read_only(true);
        let exported = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(options)
            .await
            .expect("exported sqlite db should open");
        let count: i64 = sqlx::query("SELECT COUNT(*) AS count FROM sessions")
            .fetch_one(&exported)
            .await
            .expect("sessions count should be readable")
            .get("count");
        exported.close().await;
        let _ = std::fs::remove_file(&path);

        assert_eq!(count, 1);
    }

    #[tokio::test]
    async fn csv_export_computes_current_categories_and_analysis_fields() {
        let pool = source_pool().await;
        insert_session(&pool, "Inside", "plain", 1_100, 61_100).await;
        insert_web(&pool, "Example", 1_500, 121_500).await;
        sqlx::query("INSERT INTO settings (key, value) VALUES (?, ?), (?, ?)")
            .bind("__app_override::inside.exe")
            .bind(r#"{"category":"development","enabled":true}"#)
            .bind("__web_domain_override::example.com")
            .bind(r#"{"category":"office","enabled":true}"#)
            .execute(&pool)
            .await
            .expect("classification settings should be inserted");

        let path = output_path("csv");
        let fields = field_list(&[
            "record_type",
            "category",
            "category_id",
            "duration_minutes",
            "source_key",
            "source_name",
        ]);
        let row_count = csv_exporter::export_to_csv(
            &pool,
            path.to_str().expect("temp path should be utf-8"),
            None,
            None,
            Some(&fields),
        )
        .await
        .expect("csv export should succeed");

        let csv = std::fs::read_to_string(&path).expect("csv output should be readable");
        let _ = std::fs::remove_file(&path);

        assert_eq!(row_count, 2);
        assert!(csv.contains("开发,development,1.000,inside.exe,Inside"));
        assert!(csv.contains("办公,office,2.000,example.com,example.com"));
    }

    #[tokio::test]
    async fn parquet_export_keeps_field_order_for_new_field_groups() {
        let pool = source_pool().await;
        insert_session(&pool, "Inside", "plain", 1_100, 61_100).await;
        insert_web(&pool, "Example", 1_500, 121_500).await;
        sqlx::query("INSERT INTO settings (key, value) VALUES (?, ?)")
            .bind("__app_override::inside.exe")
            .bind(r#"{"category":"development","enabled":true}"#)
            .execute(&pool)
            .await
            .expect("classification settings should be inserted");

        let path = output_path("parquet");
        let fields = field_list(&[
            "record_type",
            "category",
            "duration_minutes",
            "session_id",
            "web_segment_id",
            "browser_client_id",
        ]);
        let row_count = parquet_exporter::export_to_parquet(
            &pool,
            path.to_str().expect("temp path should be utf-8"),
            Some(&fields),
            None,
            None,
        )
        .await
        .expect("parquet export should succeed");

        let file = std::fs::File::open(&path).expect("parquet output should be readable");
        let builder = ParquetRecordBatchReaderBuilder::try_new(file)
            .expect("parquet reader should be created");
        let schema = builder.schema();
        let field_names: Vec<String> = schema
            .fields()
            .iter()
            .map(|field| field.name().to_string())
            .collect();
        let mut reader = builder.build().expect("parquet batch reader should build");
        let batch = reader
            .next()
            .expect("parquet should have a batch")
            .expect("parquet batch should be readable");
        let _ = std::fs::remove_file(&path);

        assert_eq!(row_count, 2);
        assert_eq!(
            field_names,
            fields.iter().map(ToString::to_string).collect::<Vec<_>>()
        );
        assert_eq!(batch.num_rows(), 2);
    }

    #[tokio::test]
    async fn explicit_empty_field_selection_is_rejected_by_exporters() {
        let pool = source_pool().await;
        let fields: Vec<String> = Vec::new();
        let path = output_path("csv");

        let error = csv_exporter::export_to_csv(
            &pool,
            path.to_str().expect("temp path should be utf-8"),
            None,
            None,
            Some(&fields),
        )
        .await
        .expect_err("empty fields should be rejected");

        assert!(error.contains("select at least one export field"));
        assert!(!path.exists());
    }
}
