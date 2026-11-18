use super::*;
use crate::data::{
    repositories::sessions, sqlite_pool::prepare_pool_schema,
    tracking_runtime::TrackingRuntimeDataStore,
};
use crate::engine::tracking::ports::TrackingDataStore;
use std::path::Path;

async fn fixture() -> Pool<Sqlite> {
    let pool = sqlx::SqlitePool::connect("sqlite::memory:").await.unwrap();
    prepare_pool_schema(&pool, Path::new(":memory:"))
        .await
        .unwrap();
    pool
}

async fn drain(pool: &Pool<Sqlite>) {
    for _ in 0..100 {
        if !maintain_once(pool).await.unwrap() {
            return;
        }
    }
    panic!("name enrichment projections did not converge");
}

async fn visible_facts(pool: &Pool<Sqlite>) -> (serde_json::Value, serde_json::Value) {
    let catalog = catalog::load_page(pool, None, "".into(), 100)
        .await
        .unwrap();
    let hours = hourly::load_range(pool, 0, 3_600_000, &[0, 3_600_000])
        .await
        .unwrap();
    (
        serde_json::to_value(catalog.rows).unwrap(),
        serde_json::to_value(hours.records).unwrap(),
    )
}

#[tokio::test]
async fn app_name_enrichment_preserves_filters_and_invalidates_both_read_models() {
    let delayed = fixture().await;
    let resolved = fixture().await;
    let store = TrackingRuntimeDataStore::new(delayed.clone());
    let cases = [
        ("readerinstaller.exe", "Document reader", "Reader"),
        ("WeixinInstaller.exe", "", "WeChat Installer"),
        ("launcher.exe", "", "Wallpaper Engine Launcher"),
        ("product-0.0.750-win-x64.exe", "", "Setup Host"),
        ("other-0.0.750-win-x64.exe", "安装", "Other"),
        ("bcuninstaller.exe", "", "Bulk Crap Uninstaller"),
        ("setup.exe", "", "Setup"),
        ("editor.exe", "private title", "Editor"),
    ];
    let mut callbacks = Vec::new();
    for (index, (exe, title, name)) in cases.into_iter().enumerate() {
        let start = index as i64 * 10_000;
        callbacks.push((
            store
                .start_session(exe, title, start, start)
                .await
                .unwrap()
                .unwrap(),
            name,
        ));
        store.end_active_sessions(start + 1_000).await.unwrap();
        sessions::start_session(&resolved, name, exe, title, start, start)
            .await
            .unwrap();
        sessions::end_active_sessions(&resolved, start + 1_000)
            .await
            .unwrap();
    }
    drain(&delayed).await;
    let pending = catalog::load_page(&delayed, None, "readerinstaller".into(), 100)
        .await
        .unwrap();
    assert_eq!(
        pending.rows.len(),
        1,
        "a generated fallback must not falsely classify the reader as an installer"
    );
    assert_eq!(pending.rows[0].app_name, "");
    let before: i64 =
        sqlx::query_scalar("SELECT source_revision FROM read_model_revision WHERE id = 1")
            .fetch_one(&delayed)
            .await
            .unwrap();
    for (confirm, name) in callbacks {
        assert!(confirm(name.into()).await.unwrap());
    }
    let after: i64 =
        sqlx::query_scalar("SELECT source_revision FROM read_model_revision WHERE id = 1")
            .fetch_one(&delayed)
            .await
            .unwrap();
    assert_eq!(after - before, cases.len() as i64);
    // Dirty projections must already fall back to the updated facts before maintenance.
    assert_eq!(
        visible_facts(&delayed).await,
        visible_facts(&resolved).await
    );
    drain(&delayed).await;
    drain(&resolved).await;
    assert_eq!(
        visible_facts(&delayed).await,
        visible_facts(&resolved).await
    );
    let catalog = catalog::load_page(&delayed, None, "".into(), 100)
        .await
        .unwrap();
    let mut executables: Vec<_> = catalog
        .rows
        .into_iter()
        .map(|row| row.raw_exe_name)
        .collect();
    executables.sort();
    assert_eq!(
        executables,
        ["bcuninstaller.exe", "editor.exe", "readerinstaller.exe"]
    );
    let raw_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM sessions")
        .fetch_one(&delayed)
        .await
        .unwrap();
    assert_eq!(
        raw_count,
        cases.len() as i64,
        "filtering must not delete recorded time facts"
    );
    delayed.close().await;
    resolved.close().await;
}
