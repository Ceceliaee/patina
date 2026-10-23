use crate::data::{schema, tracking_runtime::TrackingRuntimeDataStore};
use crate::engine::tracking::metadata::{ensure_icon_cache_with, IconMetadataSource};
use sqlx::{Executor, SqlitePool};
use std::sync::Arc;
use tokio::sync::Semaphore;

fn source(exe: &str) -> IconMetadataSource<'_> {
    IconMetadataSource {
        process_id: 0,
        exe_name: exe,
        process_path: "",
        app_user_model_id: "",
        window_class: "",
        root_owner_hwnd: "",
        hwnd: "",
    }
}

async fn fixture(exe: &str, time: Option<i64>) -> (SqlitePool, TrackingRuntimeDataStore) {
    let pool = sqlx::sqlite::SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .unwrap();
    pool.execute(schema::CURRENT_BASELINE_SCHEMA_SQL)
        .await
        .unwrap();
    sqlx::query("INSERT INTO icon_cache VALUES (?, 'old', ?)")
        .bind(exe)
        .bind(time)
        .execute(&pool)
        .await
        .unwrap();
    let store = TrackingRuntimeDataStore::new(pool.clone());
    (pool, store)
}

pub(crate) fn verify(executable: &std::path::Path) {
    tauri::async_runtime::block_on(async {
        let exe = "refresh-native-fixture.exe";
        let (pool, store) = fixture(exe, Some(1)).await;
        let package = std::env::var("PATINA_ICON_REFRESH_TEST_APP_ID").unwrap_or_default();
        let path = if package.is_empty() {
            format!("{}\\explorer.exe", std::env::var("WINDIR").unwrap())
        } else {
            String::new()
        };
        let mut identity = source(exe);
        identity.process_path = &path;
        identity.app_user_model_id = &package;
        let start = std::time::Instant::now();
        ensure_icon_cache_with(
            &store,
            identity,
            || 1_000_000_000_000,
            &Arc::new(Semaphore::new(1)),
            |permit| async {
                let _permit = permit;
                crate::platform::windows::native_probe::acceptance::extract_icon(
                    executable, &path, &package,
                )
            },
        )
        .await
        .unwrap();
        let (icon, time): (String, i64) =
            sqlx::query_as("SELECT icon_base64, last_updated FROM icon_cache")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_ne!(icon, "old");
        assert!(time > 1);
        use base64::Engine;
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(icon.strip_prefix("data:image/png;base64,").unwrap())
            .unwrap();
        let decoded = image::load_from_memory_with_format(&bytes, image::ImageFormat::Png).unwrap();
        assert!(decoded.width() > 0 && decoded.height() > 0);
        println!(
            "ICON_REFRESH_NATIVE source={} elapsed_us={} dimensions={}x{}",
            if package.is_empty() {
                "win32"
            } else {
                "packaged-shell"
            },
            start.elapsed().as_micros(),
            decoded.width(),
            decoded.height()
        );
        pool.close().await;
    });
}
