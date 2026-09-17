use crate::data::{schema, tracking_runtime::TrackingRuntimeDataStore};
use crate::engine::tracking::metadata::{
    ensure_icon_cache, ensure_icon_cache_with, IconMetadataSource, ICON_REFRESH_INTERVAL_MS,
};
use crate::engine::tracking::ports::{TrackingDataError, TrackingDataStore};
use sqlx::{Executor, SqlitePool};
use std::sync::atomic::{AtomicUsize, Ordering};
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

#[test]
fn refresh_pipeline_preserves_fresh_icons_and_refreshes_only_when_due() {
    tauri::async_runtime::block_on(async {
        let exe = "refresh-pipeline.exe";
        let (pool, store) = fixture(exe, Some(100)).await;
        let calls = AtomicUsize::new(0);
        refresh(
            &store,
            source(exe),
            || 101,
            || async {
                calls.fetch_add(1, Ordering::SeqCst);
                Some("unexpected".into())
            },
        )
        .await
        .unwrap();
        assert_eq!(calls.load(Ordering::SeqCst), 0);
        let now = 100 + ICON_REFRESH_INTERVAL_MS;
        refresh(
            &store,
            source(exe),
            || now,
            || async {
                calls.fetch_add(1, Ordering::SeqCst);
                Some("new".into())
            },
        )
        .await
        .unwrap();
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        let row: (String, i64) = sqlx::query_as("SELECT icon_base64, last_updated FROM icon_cache")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(row, ("new".into(), now));
        refresh(
            &store,
            source(exe),
            || now + 1,
            || async { panic!("already confirmed") },
        )
        .await
        .unwrap();
        pool.close().await;
    });
}

#[test]
fn failed_refresh_retains_old_icon_and_backs_off_even_for_packaged_apps() {
    tauri::async_runtime::block_on(async {
        let exe = "refresh-failure.exe";
        let (pool, store) = fixture(exe, None).await;
        let mut identity = source(exe);
        identity.app_user_model_id = "package!App";
        refresh(&store, identity, || 10_000, || async { None })
            .await
            .unwrap();
        refresh(
            &store,
            identity,
            || 50_000,
            || async { panic!("refresh must use long backoff") },
        )
        .await
        .unwrap();
        let row: (String, Option<i64>) =
            sqlx::query_as("SELECT icon_base64, last_updated FROM icon_cache")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(row, ("old".into(), None));
        refresh(
            &store,
            identity,
            || 10_000 + (60 * 60 * 1000),
            || async { Some("old".into()) },
        )
        .await
        .unwrap();
        assert_eq!(
            store.read_icon_cache(exe).await.unwrap().last_updated,
            Some(Some(10_000 + (60 * 60 * 1000)))
        );
        pool.close().await;
    });
}

#[test]
fn in_flight_refresh_is_deduplicated_and_cancellation_releases_guard() {
    tauri::async_runtime::block_on(async {
        let exe = "refresh-in-flight.exe";
        let (pool, store) = fixture(exe, None).await;
        let (started, ready) = tokio::sync::oneshot::channel();
        let task_store = store.clone();
        let task = tauri::async_runtime::spawn(async move {
            refresh(
                &task_store,
                source(exe),
                || 10,
                || async {
                    started.send(()).unwrap();
                    std::future::pending::<Option<String>>().await
                },
            )
            .await
        });
        ready.await.unwrap();
        refresh(
            &store,
            source(exe),
            || 10,
            || async { panic!("duplicate extraction") },
        )
        .await
        .unwrap();
        task.abort();
        let _ = task.await;
        refresh(&store, source(exe), || 11, || async { Some("new".into()) })
            .await
            .unwrap();
        assert_eq!(
            store.read_icon_cache(exe).await.unwrap().last_updated,
            Some(Some(11))
        );
        pool.close().await;
    });
}

async fn refresh<F, Fut>(
    data: &dyn TrackingDataStore,
    source: IconMetadataSource<'_>,
    clock: impl Fn() -> i64,
    extract: F,
) -> Result<(), TrackingDataError>
where
    F: FnOnce() -> Fut,
    Fut: std::future::Future<Output = Option<String>>,
{
    ensure_icon_cache_with(data, source, clock, &Arc::new(Semaphore::new(2)), extract).await
}

#[test]
fn exhausted_capacity_does_not_mark_confirmation_and_can_retry() {
    tauri::async_runtime::block_on(async {
        let exe = "refresh-capacity.exe";
        let (pool, store) = fixture(exe, None).await;
        let semaphore = Arc::new(Semaphore::new(1));
        let permit = semaphore.clone().acquire_owned().await.unwrap();
        ensure_icon_cache_with(
            &store,
            source(exe),
            || 100,
            &semaphore,
            || async { panic!("capacity exhausted") },
        )
        .await
        .unwrap();
        assert_eq!(
            store.read_icon_cache(exe).await.unwrap().last_updated,
            Some(None)
        );
        drop(permit);
        ensure_icon_cache_with(
            &store,
            source(exe),
            || 100,
            &semaphore,
            || async { Some("old".into()) },
        )
        .await
        .unwrap();
        assert_eq!(
            store.read_icon_cache(exe).await.unwrap().last_updated,
            Some(Some(100))
        );
        pool.close().await;
    });
}

#[test]
fn refresh_query_cost_and_observable_work_counts() {
    tauri::async_runtime::block_on(async {
        let exe = "refresh-measure.exe";
        let (pool, store) = fixture(exe, Some(100)).await;
        let mut tx = pool.begin().await.unwrap();
        for index in 0..256 {
            sqlx::query("INSERT INTO icon_cache VALUES (?, ?, 100)")
                .bind(format!("app-{index}.exe"))
                .bind("a".repeat(4096))
                .execute(&mut *tx)
                .await
                .unwrap();
        }
        tx.commit().await.unwrap();
        let mut baseline = Vec::new();
        let mut fresh = Vec::new();
        for _ in 0..200 {
            let start = std::time::Instant::now();
            sqlx::query(
                "SELECT exe_name FROM icon_cache WHERE exe_name = ? COLLATE NOCASE LIMIT 1",
            )
            .bind(exe)
            .fetch_optional(&pool)
            .await
            .unwrap();
            baseline.push(start.elapsed().as_micros());
            let start = std::time::Instant::now();
            refresh(
                &store,
                source(exe),
                || 101,
                || async { panic!("fresh cache must not extract") },
            )
            .await
            .unwrap();
            fresh.push(start.elapsed().as_micros());
        }
        for (name, mut samples) in [
            ("baseline-existence-query", baseline),
            ("fresh-refresh-pipeline", fresh),
        ] {
            samples.sort_unstable();
            println!("ICON_REFRESH_COST scenario={name} samples={} avg_us={} p50_us={} p95_us={} max_us={}",
            samples.len(), samples.iter().sum::<u128>() / samples.len() as u128,
            samples[100], samples[190], samples[199]);
        }
        let time: i64 = sqlx::query_scalar(
            "SELECT last_updated FROM icon_cache WHERE exe_name = 'refresh-measure.exe'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(time, 100);
        for (name, icon) in [("same", "old"), ("changed", "new")] {
            let start = std::time::Instant::now();
            let current = store.read_icon_cache(exe).await.unwrap();
            let changed = (current.confirm)(icon.into(), 200).await.unwrap();
            assert_eq!(changed, name == "changed");
            println!(
                "ICON_REFRESH_COST scenario={name} samples=1 elapsed_us={}",
                start.elapsed().as_micros()
            );
        }
        pool.close().await;
    });
}

#[test]
fn windows_extraction_refreshes_an_expired_icon_in_an_isolated_database() {
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
        ensure_icon_cache(&store, identity).await.unwrap();
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

#[test]
fn refresh_write_failure_enters_backoff_without_losing_cached_content() {
    tauri::async_runtime::block_on(async {
        let exe = "refresh-write-failure.exe";
        let (pool, store) = fixture(exe, None).await;
        pool.execute("CREATE TRIGGER fail_icon_update BEFORE UPDATE ON icon_cache BEGIN SELECT RAISE(ABORT, 'fixture write error'); END;").await.unwrap();
        assert!(
            refresh(&store, source(exe), || 10, || async { Some("new".into()) })
                .await
                .is_err()
        );
        refresh(
            &store,
            source(exe),
            || 11,
            || async { panic!("write failures must back off") },
        )
        .await
        .unwrap();
        assert_eq!(
            store.read_icon_cache(exe).await.unwrap().last_updated,
            Some(None)
        );
        assert_eq!(
            sqlx::query_scalar::<_, String>("SELECT icon_base64 FROM icon_cache")
                .fetch_one(&pool)
                .await
                .unwrap(),
            "old"
        );
        pool.close().await;
    });
}

#[test]
fn successful_confirmation_survives_database_reopen() {
    tauri::async_runtime::block_on(async {
        let path =
            std::env::temp_dir().join(format!("patina-icon-reopen-{}.sqlite", std::process::id()));
        let options = sqlx::sqlite::SqliteConnectOptions::new()
            .filename(&path)
            .create_if_missing(true);
        let pool = SqlitePool::connect_with(options.clone()).await.unwrap();
        pool.execute(schema::CURRENT_BASELINE_SCHEMA_SQL)
            .await
            .unwrap();
        let store = TrackingRuntimeDataStore::new(pool.clone());
        refresh(
            &store,
            source("reopened.exe"),
            || 100,
            || async { Some("icon".into()) },
        )
        .await
        .unwrap();
        pool.close().await;
        let reopened = SqlitePool::connect_with(options).await.unwrap();
        let store = TrackingRuntimeDataStore::new(reopened.clone());
        refresh(
            &store,
            source("reopened.exe"),
            || 101,
            || async { panic!("persisted confirmation must survive a process restart") },
        )
        .await
        .unwrap();
        assert_eq!(
            store
                .read_icon_cache("reopened.exe")
                .await
                .unwrap()
                .last_updated,
            Some(Some(100))
        );
        reopened.close().await;
        std::fs::remove_file(path).unwrap();
    });
}
