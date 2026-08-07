use sqlx::{Pool, Row, Sqlite};

pub async fn has_web_activity_revision_schema(pool: &Pool<Sqlite>) -> Result<bool, String> {
    let rows = sqlx::query("PRAGMA table_info(web_activity_revision)")
        .fetch_all(pool)
        .await
        .map_err(|error| {
            format!("failed to inspect web_activity_revision schema columns: {error}")
        })?;
    let columns = rows
        .iter()
        .map(|row| row.get::<String, _>("name"))
        .collect::<Vec<_>>();

    Ok(["id", "source_revision", "updated_at_ms"]
        .iter()
        .all(|required| columns.iter().any(|column| column == required)))
}

const BASE_SCREENSHOT_COLUMNS: &[&str] = &[
    "id",
    "file_path",
    "captured_at",
    "width",
    "height",
    "thumbnail_base64",
    "session_id",
];

const REVISED_SCREENSHOT_COLUMNS: &[&str] = &["active_url", "active_normalized_domain"];

async fn screenshot_columns(pool: &Pool<Sqlite>) -> Result<Vec<String>, String> {
    let rows = sqlx::query("PRAGMA table_info(screenshots)")
        .fetch_all(pool)
        .await
        .map_err(|error| format!("failed to inspect screenshots schema columns: {error}"))?;
    Ok(rows
        .iter()
        .map(|row| row.get::<String, _>("name"))
        .collect::<Vec<_>>())
}

async fn screenshot_index_exists(pool: &Pool<Sqlite>, index_name: &str) -> bool {
    sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND tbl_name = 'screenshots' AND name = ?",
    )
    .bind(index_name)
    .fetch_one(pool)
    .await
    .map(|count| count > 0)
    .unwrap_or(false)
}

fn columns_contain(columns: &[String], required: &[&str]) -> bool {
    required
        .iter()
        .all(|column| columns.iter().any(|existing| existing == column))
}

pub async fn has_base_screenshots_schema(pool: &Pool<Sqlite>) -> Result<bool, String> {
    let columns = screenshot_columns(pool).await?;
    Ok(columns_contain(&columns, BASE_SCREENSHOT_COLUMNS)
        && screenshot_index_exists(pool, "idx_screenshots_captured_at").await
        && screenshot_index_exists(pool, "idx_screenshots_session_id").await)
}

pub async fn has_screenshots_schema(pool: &Pool<Sqlite>) -> Result<bool, String> {
    let columns = screenshot_columns(pool).await?;
    Ok(columns_contain(&columns, BASE_SCREENSHOT_COLUMNS)
        && columns_contain(&columns, REVISED_SCREENSHOT_COLUMNS)
        && screenshot_index_exists(pool, "idx_screenshots_captured_at").await
        && screenshot_index_exists(pool, "idx_screenshots_session_id").await
        && screenshot_index_exists(pool, "idx_screenshots_active_domain").await)
}
