use super::*;
use crate::data::sqlite_pool::prepare_pool_schema;
use sqlx::{sqlite::SqlitePoolOptions, Executor};
use std::path::Path;

#[tokio::test]
async fn history_reads_keep_half_open_ranges_open_facts_and_private_anonymous_rows() {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .unwrap();
    prepare_pool_schema(&pool, Path::new(":memory:"))
        .await
        .unwrap();
    pool.execute("INSERT INTO sessions(id,app_name,exe_name,window_title,start_time,end_time,duration,continuity_group_start_time) VALUES
        (1,'Editor','editor.exe','before',-1000,0,1000,-1000),
        (2,'Editor','editor.exe','closed',0,1000,1000,0),
        (3,'Editor','editor.exe','at end',3000,4000,1000,3000),
        (4,'Editor','editor.exe','open',8000,NULL,NULL,8000);
        INSERT INTO session_title_samples(session_id,title,start_time,end_time) VALUES(2,'closed title',0,1000);
        INSERT INTO import_batches(id,imported_at,source_name,source_kind,source_fingerprint) VALUES('test',0,'test','test','test');
        INSERT INTO import_exact_sessions(batch_id,fingerprint,app_name,exe_name,window_title,start_time,end_time,duration)
            VALUES('test','one','Imported','imported.exe','imported',500,3500,3000);
        INSERT INTO anonymous_activity(id,start_time,end_time,observed_until,is_web) VALUES('closed',1000,2000,2000,1),('open',6000,NULL,7000,0);")
        .await.unwrap();
    for titles in [false, true] {
        let range = load_history_range(&pool, 0, 3000, 10000, titles)
            .await
            .unwrap();
        assert_eq!(range.sessions.len(), 3);
        assert_eq!(range.sessions[0].id, 2);
        assert_eq!(range.sessions[1].origin, "import_exact");
        let anonymous = &range.sessions[2];
        assert_eq!(anonymous.exe_name, "activity:anonymous");
        assert_eq!(
            (anonymous.app_name.as_str(), anonymous.window_title.as_str()),
            ("", "")
        );
        assert!(anonymous.id < 0);
        assert_eq!(range.title_samples.len(), usize::from(titles));
        if titles {
            assert_eq!(range.title_samples[0].title, "closed title");
        }
        let open = load_history_range(&pool, 8000, 9000, 10000, titles)
            .await
            .unwrap();
        assert_eq!(open.sessions.len(), 1);
        assert_eq!(
            (open.sessions[0].end_time, open.sessions[0].duration),
            (None, Some(2000))
        );
        assert!(load_history_range(&pool, 10000, 11000, 10000, titles)
            .await
            .unwrap()
            .sessions
            .is_empty());
        assert_eq!(
            load_history_range(&pool, -1000, 0, 10000, titles)
                .await
                .unwrap()
                .sessions[0]
                .id,
            1
        );
        let anonymous = load_history_range(&pool, 6000, 7000, 10000, titles)
            .await
            .unwrap();
        assert_eq!(anonymous.sessions[0].end_time, Some(7000));
        assert!(load_history_range(&pool, 7000, 8000, 10000, titles)
            .await
            .unwrap()
            .sessions
            .is_empty());
        assert!(load_history_range(&pool, 1, 1, 10000, titles)
            .await
            .unwrap()
            .sessions
            .is_empty());
    }
    assert_eq!(earliest_activity_start(&pool).await.unwrap(), Some(-1000));
    assert_eq!(
        recorded_executable_names(&pool).await.unwrap(),
        ["editor.exe", "imported.exe"]
    );
    pool.close().await;
}
