use super::*;
use crate::data::sqlite_pool::prepare_pool_schema;
use std::path::Path;

async fn pool() -> Pool<Sqlite> {
    let pool = sqlx::SqlitePool::connect("sqlite::memory:").await.unwrap();
    prepare_pool_schema(&pool, Path::new(":memory:"))
        .await
        .unwrap();
    pool
}

#[tokio::test]
async fn late_name_does_not_resurrect_deleted_sessions_or_replace_existing_metadata() {
    let pool = pool().await;
    let store = TrackingRuntimeDataStore::new(pool.clone());
    let deleted = store
        .start_session("a.exe", "private title", 100, 100)
        .await
        .unwrap()
        .unwrap();
    sqlx::query("DELETE FROM sessions")
        .execute(&pool)
        .await
        .unwrap();
    let replacement = store
        .start_session("a.exe", "", 200, 200)
        .await
        .unwrap()
        .unwrap();
    assert!(!deleted("Deleted name".into()).await.unwrap());
    assert!(!store.take_session_name_changed());
    assert_eq!(
        store.load_active_session().await.unwrap().unwrap().app_name,
        ""
    );
    sqlx::query("UPDATE sessions SET app_name = 'Already resolved'")
        .execute(&pool)
        .await
        .unwrap();
    assert!(!replacement("Stale name".into()).await.unwrap());
    let row: (String, String, i64, Option<i64>) =
        sqlx::query_as("SELECT app_name, window_title, start_time, end_time FROM sessions")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(row, ("Already resolved".into(), "".into(), 200, None));
    pool.close().await;
}

#[tokio::test]
async fn pending_name_cannot_cross_restore_even_with_identical_row_identity() {
    let old_pool = pool().await;
    let current = Arc::new(std::sync::Mutex::new(old_pool.clone()));
    let source = current.clone();
    let store = shared_from_pool_source(Arc::new(move || {
        let pool = source.lock().unwrap().clone();
        Box::pin(async move { Ok(pool) })
    }))
    .await
    .unwrap();
    let old_name = store
        .start_session("a.exe", "", 100, 100)
        .await
        .unwrap()
        .unwrap();
    let new_pool = pool().await;
    *current.lock().unwrap() = new_pool.clone();
    old_pool.close().await;
    let new_name = store
        .start_session("a.exe", "", 100, 100)
        .await
        .unwrap()
        .unwrap();
    assert!(!old_name("Old database".into()).await.unwrap());
    assert!(!store.take_session_name_changed());
    assert_eq!(
        store.load_active_session().await.unwrap().unwrap().app_name,
        ""
    );
    assert!(new_name("New database".into()).await.unwrap());
    assert!(store.take_session_name_changed());
    assert_eq!(
        store.load_active_session().await.unwrap().unwrap().app_name,
        "New database"
    );
    new_pool.close().await;
}
