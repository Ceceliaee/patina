use super::*;
use crate::data::sqlite_pool::prepare_pool_schema;
use sqlx::{sqlite::SqlitePoolOptions, Executor};
use std::path::Path;

#[tokio::test]
async fn web_reads_bound_open_observations_and_bind_untrusted_domains() {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .unwrap();
    prepare_pool_schema(&pool, Path::new(":memory:"))
        .await
        .unwrap();
    pool.execute("INSERT INTO web_activity_segments(browser_client_id,browser_kind,browser_exe_name,domain,normalized_domain,start_time,end_time,duration,created_at,updated_at)
        VALUES('test','edge','msedge.exe','example.test','example.test',0,NULL,NULL,0,1000),
              ('test','edge','msedge.exe','closed.test','closed.test',50000,51000,1000,50000,51000);
        INSERT INTO web_favicon_cache(normalized_domain,favicon_url,updated_at) VALUES('example.test','data:image/test',0);")
        .await.unwrap();
    let open = segments_in_range(&pool, 0, 60000, 90000).await.unwrap();
    assert_eq!(open.len(), 2);
    assert_eq!(
        (open[0].end_time, open[0].duration),
        (Some(46000), Some(46000))
    );
    assert!(open[0].favicon_url.is_none());
    assert!(segments_in_range(&pool, 46000, 50000, 90000)
        .await
        .unwrap()
        .is_empty());
    assert!(segments_in_range(&pool, 51000, 60000, 90000)
        .await
        .unwrap()
        .is_empty());
    let domains = observed_domains(&pool, 0, 90000, 1).await.unwrap();
    assert_eq!(domains.len(), 1);
    assert_eq!(domains[0].normalized_domain, "closed.test");
    let icons = favicons(&pool, &["example.test".into()]).await.unwrap();
    assert_eq!(icons[0].favicon_url, "data:image/test");
    assert!(
        favicons(&pool, &["'); DELETE FROM web_favicon_cache; --".into()])
            .await
            .unwrap()
            .is_empty()
    );
    assert_eq!(
        favicons(&pool, &["example.test".into()])
            .await
            .unwrap()
            .len(),
        1
    );
    assert!(favicons(&pool, &vec!["example.test".into(); 901])
        .await
        .is_err());
    pool.close().await;
}
