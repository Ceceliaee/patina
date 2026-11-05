use super::load_web_activity_aggregate_range_from_pool;
use crate::data::schema;
use sqlx::Executor;
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Arc,
};
use std::time::Instant;

pub(crate) async fn measure() -> Vec<serde_json::Value> {
    let mut results = Vec::new();
    for count in [10_000, 100_000] {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        for sql in [
            schema::CURRENT_BASELINE_SCHEMA_SQL,
            schema::WEB_ACTIVITY_SCHEMA_SQL,
            schema::WEB_FAVICON_CACHE_SCHEMA_SQL,
            schema::WEB_ACTIVITY_REVISION_SCHEMA_SQL,
            schema::ACTIVITY_READ_MODELS_SCHEMA_SQL,
            crate::data::repositories::anonymous_activity::SCHEMA_SQL,
        ] {
            pool.execute(sql).await.unwrap();
        }
        sqlx::query("WITH RECURSIVE n(i) AS (VALUES(1) UNION ALL SELECT i+1 FROM n WHERE i<?)
            INSERT INTO web_activity_segments(browser_client_id,browser_kind,browser_exe_name,domain,normalized_domain,start_time,end_time,duration,created_at,updated_at)
            SELECT 'c','edge','edge.exe',printf('d%d.test',i%100),printf('d%d.test',i%100),i*100,i*100+50,50,0,i*100+50 FROM n")
            .bind(count).execute(&pool).await.unwrap();
        pool.execute("INSERT INTO web_activity_segments(browser_client_id,browser_kind,browser_exe_name,domain,normalized_domain,start_time,end_time,duration,created_at,updated_at)
            VALUES('c','edge','edge.exe','d0.test','d0.test',20000000,20000050,50,0,20000050); ANALYZE;").await.unwrap();
        let steps = Arc::new(AtomicU64::new(0));
        let counter = steps.clone();
        pool.acquire()
            .await
            .unwrap()
            .lock_handle()
            .await
            .unwrap()
            .set_progress_handler(100, move || {
                counter.fetch_add(100, Ordering::Relaxed);
                true
            });
        let mut timings = Vec::new();
        let mut cold = (0.0, 0);
        let mut warm_steps = 0;
        for sample in 0..21 {
            let start = Instant::now();
            steps.store(0, Ordering::Relaxed);
            let result = load_web_activity_aggregate_range_from_pool(
                &pool,
                20_000_000,
                20_001_000,
                &[20_000_000, 20_001_000],
                Some("d0.test"),
                None,
                20_001_000,
            )
            .await
            .unwrap();
            let ms = start.elapsed().as_secs_f64() * 1000.0;
            assert_eq!(result.records.len(), 1);
            assert_eq!(result.records[0].duration_ms, 50);
            let work = steps.load(Ordering::Relaxed);
            if sample == 0 {
                cold = (ms, work);
            } else {
                timings.push(ms);
                warm_steps = warm_steps.max(work);
            }
        }
        timings.sort_by(f64::total_cmp);
        assert!(
            warm_steps < cold.1 / 2,
            "warm range still incurred the cold aggregation cost"
        );
        results.push(serde_json::json!({"historyRows":count, "coldMs":cold.0,"coldVmSteps":cold.1,
            "warmP50Ms":timings[9],"warmP95Ms":timings[18],"warmMaxMs":timings[19],"warmMaxVmSteps":warm_steps}));
        pool.close().await;
    }
    results
}
