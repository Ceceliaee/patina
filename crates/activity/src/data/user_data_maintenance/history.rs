use crate::data::repositories::{icon_cache::acquire_icon_cache_maintenance, icon_retention};
use crate::data::sqlite_error::SqliteOperationError;
use sqlx::{Pool, Sqlite};
pub(super) fn cache_error(error: sqlx::Error) -> SqliteOperationError {
    SqliteOperationError::from_sqlx("clean unreferenced activity icons", error)
}

pub(crate) async fn delete_sessions_before_in_pool(
    pool: &Pool<Sqlite>,
    cutoff_time: i64,
) -> Result<(), SqliteOperationError> {
    let _guard = acquire_icon_cache_maintenance(pool).await;
    let mut tx = pool.begin().await.map_err(|error| {
        SqliteOperationError::from_sqlx("start historical activity cleanup", error)
    })?;

    let apps: Vec<String> = sqlx::query_scalar(
        "SELECT exe_name FROM sessions WHERE start_time < ?1
         UNION SELECT exe_name FROM import_exact_sessions WHERE start_time < ?1
         UNION SELECT exe_name FROM import_time_buckets WHERE bucket_start_time < ?1
         UNION SELECT browser_exe_name FROM web_activity_segments WHERE start_time < ?1",
    )
    .bind(cutoff_time)
    .fetch_all(&mut *tx)
    .await
    .map_err(cache_error)?;
    let domains: Vec<String> = sqlx::query_scalar(
        "SELECT DISTINCT normalized_domain FROM web_activity_segments WHERE start_time < ?",
    )
    .bind(cutoff_time)
    .fetch_all(&mut *tx)
    .await
    .map_err(cache_error)?;
    let named = icon_retention::named_reminder_apps(&mut tx)
        .await
        .map_err(cache_error)?;
    sqlx::query(
        "DELETE FROM session_title_samples WHERE session_id IN (SELECT id FROM sessions WHERE start_time < ?)",
    )
    .bind(cutoff_time)
    .execute(&mut *tx)
    .await
    .map_err(|error| SqliteOperationError::from_sqlx("delete historical title samples", error))?;
    sqlx::query("DELETE FROM sessions WHERE start_time < ?")
        .bind(cutoff_time)
        .execute(&mut *tx)
        .await
        .map_err(|error| SqliteOperationError::from_sqlx("delete historical sessions", error))?;
    sqlx::query("DELETE FROM anonymous_activity WHERE start_time < ?")
        .bind(cutoff_time)
        .execute(&mut *tx)
        .await
        .map_err(|error| {
            SqliteOperationError::from_sqlx("delete historical anonymous activity", error)
        })?;
    sqlx::query("DELETE FROM import_exact_sessions WHERE start_time < ?")
        .bind(cutoff_time)
        .execute(&mut *tx)
        .await
        .map_err(|error| {
            SqliteOperationError::from_sqlx("delete historical imported exact sessions", error)
        })?;
    sqlx::query("DELETE FROM import_time_buckets WHERE bucket_start_time < ?")
        .bind(cutoff_time)
        .execute(&mut *tx)
        .await
        .map_err(|error| {
            SqliteOperationError::from_sqlx("delete historical imported time buckets", error)
        })?;
    sqlx::query("DELETE FROM web_activity_segments WHERE start_time < ?")
        .bind(cutoff_time)
        .execute(&mut *tx)
        .await
        .map_err(|error| {
            SqliteOperationError::from_sqlx("delete historical web activity", error)
        })?;
    icon_retention::prune_apps(&mut tx, &apps, &named)
        .await
        .map_err(cache_error)?;
    icon_retention::prune_domains(&mut tx, &domains)
        .await
        .map_err(cache_error)?;
    refresh_import_batch_counts(&mut tx).await?;

    tx.commit().await.map_err(|error| {
        SqliteOperationError::from_sqlx("commit historical activity cleanup", error)
    })
}

pub(crate) async fn refresh_import_batch_counts(
    tx: &mut sqlx::Transaction<'_, Sqlite>,
) -> Result<(), SqliteOperationError> {
    sqlx::query(
        "UPDATE import_batches
         SET exact_session_count = (
               SELECT COUNT(*) FROM import_exact_sessions
               WHERE import_exact_sessions.batch_id = import_batches.id
             ),
             hour_bucket_count = (
               SELECT COUNT(*) FROM import_time_buckets
               WHERE import_time_buckets.batch_id = import_batches.id
             )",
    )
    .execute(&mut **tx)
    .await
    .map_err(|error| SqliteOperationError::from_sqlx("refresh import batch counts", error))?;
    sqlx::query(
        "DELETE FROM import_batches
         WHERE exact_session_count = 0 AND hour_bucket_count = 0",
    )
    .execute(&mut **tx)
    .await
    .map(|_| ())
    .map_err(|error| SqliteOperationError::from_sqlx("delete empty import batches", error))
}

pub(super) fn in_clause_placeholders(value_count: usize) -> String {
    std::iter::repeat_n("?", value_count)
        .collect::<Vec<_>>()
        .join(", ")
}

pub(super) async fn apps_in_deletion(
    tx: &mut sqlx::Transaction<'_, Sqlite>,
    names: &[String],
    range: Option<(i64, i64)>,
) -> Result<Vec<String>, SqliteOperationError> {
    sqlx::query_scalar(
        "WITH target AS (SELECT value FROM json_each(?1))
         SELECT exe_name FROM sessions WHERE exe_name IN target AND (?2 IS NULL OR start_time >= ?2 AND start_time < ?3)
         UNION SELECT exe_name FROM import_exact_sessions WHERE exe_name IN target AND (?2 IS NULL OR start_time >= ?2 AND start_time < ?3)
         UNION SELECT exe_name FROM import_time_buckets WHERE exe_name IN target AND (?2 IS NULL OR bucket_start_time >= ?2 AND bucket_start_time < ?3)",
    ).bind(serde_json::json!(names).to_string()).bind(range.map(|r| r.0)).bind(range.map(|r| r.1))
     .fetch_all(&mut **tx).await.map_err(cache_error)
}

pub(crate) async fn delete_sessions_by_exe_names_in_pool(
    pool: &Pool<Sqlite>,
    exe_names: &[String],
) -> Result<(), SqliteOperationError> {
    let _icon_maintenance = acquire_icon_cache_maintenance(pool).await;
    let placeholders = in_clause_placeholders(exe_names.len());
    let mut tx = pool
        .begin()
        .await
        .map_err(|error| SqliteOperationError::from_sqlx("start app record deletion", error))?;

    let affected = apps_in_deletion(&mut tx, exe_names, None).await?;
    let named = icon_retention::named_reminder_apps(&mut tx)
        .await
        .map_err(cache_error)?;
    let title_query = format!(
        "DELETE FROM session_title_samples
         WHERE session_id IN (SELECT id FROM sessions WHERE exe_name IN ({placeholders}))"
    );
    let mut title_query = sqlx::query(sqlx::AssertSqlSafe(title_query));
    for exe_name in exe_names {
        title_query = title_query.bind(exe_name);
    }
    title_query.execute(&mut *tx).await.map_err(|error| {
        SqliteOperationError::from_sqlx("delete app title samples by executable", error)
    })?;

    for (table, operation) in [
        ("sessions", "delete native app records by executable"),
        (
            "import_exact_sessions",
            "delete imported exact app records by executable",
        ),
        (
            "import_time_buckets",
            "delete imported bucket app records by executable",
        ),
    ] {
        let query = format!("DELETE FROM {table} WHERE exe_name IN ({placeholders})");
        let mut query = sqlx::query(sqlx::AssertSqlSafe(query));
        for exe_name in exe_names {
            query = query.bind(exe_name);
        }
        query
            .execute(&mut *tx)
            .await
            .map_err(|error| SqliteOperationError::from_sqlx(operation, error))?;
    }

    icon_retention::prune_apps(&mut tx, &affected, &named)
        .await
        .map_err(cache_error)?;

    refresh_import_batch_counts(&mut tx).await?;
    tx.commit()
        .await
        .map_err(|error| SqliteOperationError::from_sqlx("commit app record deletion", error))
}
