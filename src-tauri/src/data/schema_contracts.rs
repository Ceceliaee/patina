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
