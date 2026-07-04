use crate::data::sqlite_pool::run_recoverable_sqlite_write;
use sqlx::{Pool, Sqlite};
use tauri::{AppHandle, Runtime};

pub async fn delete_sessions_before<R: Runtime>(
    app: &AppHandle<R>,
    cutoff_time: i64,
) -> Result<(), String> {
    run_recoverable_sqlite_write(
        app,
        "failed to delete historical activity",
        move |pool| async move { delete_sessions_before_in_pool(&pool, cutoff_time).await },
    )
    .await
}

pub async fn clear_all_session_window_titles<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    run_recoverable_sqlite_write(
        app,
        "failed to clear session window titles",
        |pool| async move { clear_all_session_window_titles_in_pool(&pool).await },
    )
    .await
}

pub async fn delete_sessions_by_exe_names<R: Runtime>(
    app: &AppHandle<R>,
    exe_names: Vec<String>,
) -> Result<(), String> {
    let exe_names = non_empty_values(exe_names);
    if exe_names.is_empty() {
        return Ok(());
    }

    run_recoverable_sqlite_write(
        app,
        "failed to delete sessions by executable",
        move |pool| {
            let exe_names = exe_names.clone();
            async move { delete_sessions_by_exe_names_in_pool(&pool, &exe_names).await }
        },
    )
    .await
}

pub async fn delete_sessions_by_exe_names_between<R: Runtime>(
    app: &AppHandle<R>,
    exe_names: Vec<String>,
    start_time: i64,
    end_time: i64,
) -> Result<(), String> {
    let exe_names = non_empty_values(exe_names);
    if exe_names.is_empty() {
        return Ok(());
    }

    run_recoverable_sqlite_write(
        app,
        "failed to delete sessions by executable range",
        move |pool| {
            let exe_names = exe_names.clone();
            async move {
                delete_sessions_by_exe_names_between_in_pool(
                    &pool, &exe_names, start_time, end_time,
                )
                .await
            }
        },
    )
    .await
}

pub async fn delete_web_activity_segments_before<R: Runtime>(
    app: &AppHandle<R>,
    cutoff_time: i64,
) -> Result<(), String> {
    run_recoverable_sqlite_write(app, "failed to delete web activity", move |pool| async move {
        delete_web_activity_segments_before_in_pool(&pool, cutoff_time).await
    })
    .await
}

pub async fn delete_web_activity_segments_by_domain<R: Runtime>(
    app: &AppHandle<R>,
    normalized_domain: String,
) -> Result<(), String> {
    let normalized_domain = normalized_domain.trim().to_ascii_lowercase();
    if normalized_domain.is_empty() {
        return Ok(());
    }

    run_recoverable_sqlite_write(
        app,
        "failed to delete web activity by domain",
        move |pool| {
            let normalized_domain = normalized_domain.clone();
            async move {
                sqlx::query("DELETE FROM web_activity_segments WHERE normalized_domain = ?")
                    .bind(normalized_domain)
                    .execute(&pool)
                    .await
                    .map(|_| ())
                    .map_err(|error| error.to_string())
            }
        },
    )
    .await
}

fn non_empty_values(values: Vec<String>) -> Vec<String> {
    values
        .into_iter()
        .filter(|value| !value.trim().is_empty())
        .collect()
}

fn in_clause_placeholders(value_count: usize) -> String {
    std::iter::repeat_n("?", value_count)
        .collect::<Vec<_>>()
        .join(", ")
}

async fn delete_sessions_before_in_pool(
    pool: &Pool<Sqlite>,
    cutoff_time: i64,
) -> Result<(), String> {
    let mut tx = pool
        .begin()
        .await
        .map_err(|error| format!("failed to start historical activity cleanup: {error}"))?;

    sqlx::query(
        "DELETE FROM session_title_samples WHERE session_id IN (SELECT id FROM sessions WHERE start_time < ?)",
    )
    .bind(cutoff_time)
    .execute(&mut *tx)
    .await
    .map_err(|error| format!("failed to delete title samples: {error}"))?;
    sqlx::query("DELETE FROM sessions WHERE start_time < ?")
        .bind(cutoff_time)
        .execute(&mut *tx)
        .await
        .map_err(|error| format!("failed to delete sessions: {error}"))?;
    sqlx::query("DELETE FROM web_activity_segments WHERE start_time < ?")
        .bind(cutoff_time)
        .execute(&mut *tx)
        .await
        .map_err(|error| format!("failed to delete web activity: {error}"))?;

    tx.commit()
        .await
        .map_err(|error| format!("failed to commit historical activity cleanup: {error}"))
}

async fn clear_all_session_window_titles_in_pool(pool: &Pool<Sqlite>) -> Result<(), String> {
    let mut tx = pool
        .begin()
        .await
        .map_err(|error| format!("failed to start title cleanup: {error}"))?;

    sqlx::query("DELETE FROM session_title_samples")
        .execute(&mut *tx)
        .await
        .map_err(|error| format!("failed to delete title samples: {error}"))?;
    sqlx::query("UPDATE sessions SET window_title = '' WHERE COALESCE(window_title, '') <> ''")
        .execute(&mut *tx)
        .await
        .map_err(|error| format!("failed to clear session window titles: {error}"))?;

    tx.commit()
        .await
        .map_err(|error| format!("failed to commit title cleanup: {error}"))
}

async fn delete_sessions_by_exe_names_in_pool(
    pool: &Pool<Sqlite>,
    exe_names: &[String],
) -> Result<(), String> {
    let query = format!(
        "DELETE FROM sessions WHERE exe_name IN ({})",
        in_clause_placeholders(exe_names.len()),
    );
    let mut query = sqlx::query(&query);
    for exe_name in exe_names {
        query = query.bind(exe_name);
    }

    query
        .execute(pool)
        .await
        .map(|_| ())
        .map_err(|error| error.to_string())
}

async fn delete_sessions_by_exe_names_between_in_pool(
    pool: &Pool<Sqlite>,
    exe_names: &[String],
    start_time: i64,
    end_time: i64,
) -> Result<(), String> {
    let query = format!(
        "DELETE FROM sessions WHERE exe_name IN ({}) AND start_time >= ? AND start_time < ?",
        in_clause_placeholders(exe_names.len()),
    );
    let mut query = sqlx::query(&query);
    for exe_name in exe_names {
        query = query.bind(exe_name);
    }

    query
        .bind(start_time)
        .bind(end_time)
        .execute(pool)
        .await
        .map(|_| ())
        .map_err(|error| error.to_string())
}

async fn delete_web_activity_segments_before_in_pool(
    pool: &Pool<Sqlite>,
    cutoff_time: i64,
) -> Result<(), String> {
    sqlx::query("DELETE FROM web_activity_segments WHERE start_time < ?")
        .bind(cutoff_time)
        .execute(pool)
        .await
        .map(|_| ())
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::data::schema as db_schema;
    use sqlx::{Executor, Row, SqlitePool};

    async fn setup_test_db() -> SqlitePool {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        pool.execute(db_schema::CURRENT_BASELINE_SCHEMA_SQL)
            .await
            .unwrap();
        pool.execute(db_schema::WEB_ACTIVITY_SCHEMA_SQL)
            .await
            .unwrap();
        pool
    }

    #[test]
    fn delete_sessions_by_exe_names_uses_bound_values() {
        tauri::async_runtime::block_on(async {
            let pool = setup_test_db().await;
            sqlx::query(
                "INSERT INTO sessions (app_name, exe_name, window_title, start_time) VALUES (?, ?, ?, ?)",
            )
            .bind("Browser")
            .bind("browser.exe")
            .bind("Inbox")
            .bind(1000_i64)
            .execute(&pool)
            .await
            .unwrap();

            delete_sessions_by_exe_names_in_pool(&pool, &[String::from("browser.exe")])
                .await
                .unwrap();

            let count: i64 = sqlx::query("SELECT COUNT(*) AS count FROM sessions")
                .fetch_one(&pool)
                .await
                .unwrap()
                .get("count");
            assert_eq!(count, 0);
        });
    }

    #[test]
    fn clear_all_session_window_titles_removes_sample_rows() {
        tauri::async_runtime::block_on(async {
            let pool = setup_test_db().await;
            sqlx::query(
                "INSERT INTO sessions (id, app_name, exe_name, window_title, start_time) VALUES (?, ?, ?, ?, ?)",
            )
            .bind(1_i64)
            .bind("Editor")
            .bind("editor.exe")
            .bind("Project")
            .bind(1000_i64)
            .execute(&pool)
            .await
            .unwrap();
            sqlx::query(
                "INSERT INTO session_title_samples (session_id, title, start_time) VALUES (?, ?, ?)",
            )
            .bind(1_i64)
            .bind("Project")
            .bind(1000_i64)
            .execute(&pool)
            .await
            .unwrap();

            clear_all_session_window_titles_in_pool(&pool)
                .await
                .unwrap();

            let title: String = sqlx::query("SELECT window_title FROM sessions WHERE id = 1")
                .fetch_one(&pool)
                .await
                .unwrap()
                .get("window_title");
            let sample_count: i64 =
                sqlx::query("SELECT COUNT(*) AS count FROM session_title_samples")
                    .fetch_one(&pool)
                    .await
                    .unwrap()
                    .get("count");
            assert_eq!(title, "");
            assert_eq!(sample_count, 0);
        });
    }
}
