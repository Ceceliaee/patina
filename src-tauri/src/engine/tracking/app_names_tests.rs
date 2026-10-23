#[cfg(test)]
mod cases {
    use super::super::*;
    use crate::data::{schema, tracking_runtime::TrackingRuntimeDataStore};
    use crate::engine::tracking::{active_session, ports::TrackingDataStore};
    use crate::platform::windows::foreground::WindowInfo;
    use sqlx::{Executor, SqlitePool};
    use std::sync::{
        atomic::{AtomicUsize, Ordering},
        mpsc,
    };
    use std::time::Duration;
    use tokio::time::timeout;

    async fn fixture() -> (SqlitePool, TrackingRuntimeDataStore) {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        pool.execute(schema::CURRENT_BASELINE_SCHEMA_SQL)
            .await
            .unwrap();
        let store = TrackingRuntimeDataStore::new(pool.clone());
        (pool, store)
    }

    async fn start(
        store: &TrackingRuntimeDataStore,
        resolver: &NameResolver,
        exe: &str,
        time: i64,
        probe: impl FnOnce() -> Option<String> + Send + 'static,
    ) -> Option<tauri::async_runtime::JoinHandle<()>> {
        let window = WindowInfo {
            hwnd: "1".into(),
            root_owner_hwnd: "1".into(),
            process_id: 1,
            window_class: "fixture".into(),
            title: format!("title-{time}"),
            exe_name: exe.into(),
            process_path: String::new(),
            app_user_model_id: String::new(),
            is_afk: false,
            idle_time_ms: 0,
        };
        let mut job = None;
        // This is a latency contract: metadata is deliberately held until after
        // every transition is committed. The bound detects any wait in this path.
        assert!(timeout(
            Duration::from_secs(1),
            active_session::start_session_with_name_scheduler(
                store,
                &window,
                time,
                time,
                |confirm, _| job = resolver.schedule(confirm, probe)
            ),
        )
        .await
        .expect("recording waited for a display name")
        .unwrap());
        job
    }

    #[tokio::test]
    async fn blocked_name_keeps_a_b_a_samples_and_late_results_keep_session_identity() {
        let (pool, store) = fixture().await;
        let resolver = NameResolver::new(8, 1);
        let (release, held) = mpsc::channel();
        let (entered, ready) = tokio::sync::oneshot::channel();
        let first = start(&store, &resolver, "a.exe", 1_000, move || {
            let _ = entered.send(());
            // Always release the native fixture on a failed assertion as well.
            let _ = held.recv_timeout(Duration::from_secs(10));
            Some("A from first installation".into())
        })
        .await
        .unwrap();
        timeout(Duration::from_secs(2), ready)
            .await
            .unwrap()
            .unwrap();
        let second = start(&store, &resolver, "b.exe", 2_000, || Some("B".into()))
            .await
            .unwrap();
        let third = start(&store, &resolver, "a.exe", 3_000, || {
            Some("A from second installation".into())
        })
        .await
        .unwrap();
        let facts: Vec<(String, String, i64, Option<i64>, Option<i64>)> = sqlx::query_as(
            "SELECT app_name, exe_name, start_time, end_time, duration FROM sessions ORDER BY id",
        )
        .fetch_all(&pool)
        .await
        .unwrap();
        assert_eq!(
            facts,
            vec![
                ("".into(), "a.exe".into(), 1_000, Some(2_000), Some(1_000)),
                ("".into(), "b.exe".into(), 2_000, Some(3_000), Some(1_000)),
                ("".into(), "a.exe".into(), 3_000, None, None),
            ]
        );
        assert!(!store.take_session_name_changed());
        release.send(()).unwrap();
        for job in [first, second, third] {
            timeout(Duration::from_secs(3), job).await.unwrap().unwrap();
        }
        let names: Vec<String> = sqlx::query_scalar("SELECT app_name FROM sessions ORDER BY id")
            .fetch_all(&pool)
            .await
            .unwrap();
        assert_eq!(
            names,
            [
                "A from first installation",
                "B",
                "A from second installation"
            ]
        );
        let after: Vec<(String, i64, Option<i64>, Option<i64>)> = sqlx::query_as(
            "SELECT exe_name, start_time, end_time, duration FROM sessions ORDER BY id",
        )
        .fetch_all(&pool)
        .await
        .unwrap();
        assert_eq!(
            after,
            facts
                .into_iter()
                .map(|(_, e, s, end, d)| (e, s, end, d))
                .collect::<Vec<_>>()
        );
        assert!(store.take_session_name_changed());
        assert!(!store.take_session_name_changed());
        pool.close().await;
    }

    #[tokio::test]
    async fn diagnostic_contention_rejects_enrichment_without_delaying_records() {
        let (pool, store) = fixture().await;
        let resolver = NameResolver::new(2, 1);
        let held = resolver.stats.pending_since.lock().unwrap();
        assert!(
            start(&store, &resolver, "still-recorded.exe", 1_000, || panic!(
                "rejected lookup ran"
            ))
            .await
            .is_none()
        );
        drop(held);
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT count(*) FROM sessions")
                .fetch_one(&pool)
                .await
                .unwrap(),
            1
        );
        assert_eq!(resolver.diagnostics().rejected, 1);
        assert_eq!(resolver.diagnostics().pending, 0);
        pool.close().await;
    }

    #[tokio::test]
    async fn full_name_queue_bounds_native_work_without_dropping_session_facts() {
        let (pool, store) = fixture().await;
        let resolver = NameResolver::new(2, 1);
        let (release, held) = mpsc::channel();
        let (entered, ready) = tokio::sync::oneshot::channel();
        let first = start(&store, &resolver, "first.exe", 1, move || {
            let _ = entered.send(());
            let _ = held.recv_timeout(Duration::from_secs(10));
            Some("First".into())
        })
        .await
        .unwrap();
        timeout(Duration::from_secs(2), ready)
            .await
            .unwrap()
            .unwrap();
        let calls = Arc::new(AtomicUsize::new(0));
        let queued_calls = calls.clone();
        let second = start(&store, &resolver, "queued.exe", 2, move || {
            queued_calls.fetch_add(1, Ordering::Relaxed);
            Some("Queued".into())
        })
        .await
        .unwrap();
        for time in 3..103 {
            let calls = calls.clone();
            assert!(start(
                &store,
                &resolver,
                &format!("app-{time}.exe"),
                time,
                move || {
                    calls.fetch_add(1, Ordering::Relaxed);
                    Some("Unexpected".into())
                }
            )
            .await
            .is_none());
        }
        assert_eq!(calls.load(Ordering::Relaxed), 0);
        assert_eq!(resolver.diagnostics().rejected, 100);
        assert_eq!(resolver.diagnostics().pending, 2);
        assert_eq!(resolver.diagnostics().running, 1);
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM sessions")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(count, 102);
        let duration: i64 = sqlx::query_scalar("SELECT SUM(duration) FROM sessions")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(duration, 101);
        release.send(()).unwrap();
        for job in [first, second] {
            timeout(Duration::from_secs(3), job).await.unwrap().unwrap();
        }
        assert_eq!(calls.load(Ordering::Relaxed), 1);
        assert_eq!(resolver.diagnostics().pending, 0);
        assert_eq!(resolver.diagnostics().running, 0);
        assert_eq!(resolver.diagnostics().finished, 2);
        let recovered = start(&store, &resolver, "recovered.exe", 103, || {
            Some("Recovered".into())
        })
        .await
        .unwrap();
        timeout(Duration::from_secs(3), recovered)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(
            store.load_active_session().await.unwrap().unwrap().app_name,
            "Recovered"
        );
        pool.close().await;
    }

    #[tokio::test]
    async fn missing_empty_or_panicking_name_never_fabricates_filter_metadata() {
        let (pool, store) = fixture().await;
        let resolver = NameResolver::new(2, 1);
        for (time, result) in [(1, None), (2, Some("  ".into())), (3, Some(".exe".into()))] {
            let job = start(&store, &resolver, "readerinstaller.exe", time, move || {
                result
            })
            .await
            .unwrap();
            timeout(Duration::from_secs(3), job).await.unwrap().unwrap();
        }
        let job = start(&store, &resolver, "readerinstaller.exe", 4, || {
            panic!("native fixture panic")
        })
        .await
        .unwrap();
        timeout(Duration::from_secs(3), job).await.unwrap().unwrap();
        let names: Vec<String> = sqlx::query_scalar("SELECT app_name FROM sessions")
            .fetch_all(&pool)
            .await
            .unwrap();
        assert!(names.iter().all(String::is_empty));
        assert!(!store.take_session_name_changed());
        pool.close().await;
    }
}
