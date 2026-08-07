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

pub async fn has_screenshots_schema(pool: &Pool<Sqlite>) -> Result<bool, String> {
    let rows = sqlx::query("PRAGMA table_info(screenshots)")
        .fetch_all(pool)
        .await
        .map_err(|error| format!("failed to inspect screenshots schema columns: {error}"))?;
    let columns = rows
        .iter()
        .map(|row| row.get::<String, _>("name"))
        .collect::<Vec<_>>();

    let columns_ready = [
        "id",
        "file_path",
        "captured_at",
        "width",
        "height",
        "thumbnail_base64",
        "session_id",
        "active_url",
        "active_normalized_domain",
    ]
    .iter()
    .all(|column| columns.iter().any(|c| c == column));

    let captured_at_index_ready = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name = 'idx_screenshots_captured_at'",
    )
    .fetch_one(pool)
    .await
    .map(|count| count > 0)
    .unwrap_or(false);

    let session_index_ready = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name = 'idx_screenshots_session_id'",
    )
    .fetch_one(pool)
    .await
    .map(|count| count > 0)
    .unwrap_or(false);

    let domain_index_ready = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name = 'idx_screenshots_active_domain'",
    )
    .fetch_one(pool)
    .await
    .map(|count| count > 0)
    .unwrap_or(false);

    Ok(columns_ready && captured_at_index_ready && session_index_ready && domain_index_ready)
}
