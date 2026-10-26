use super::*;
use crate::data::backup::RestoreStrategy;
use futures_util::FutureExt;
use sqlx::Executor;
use std::panic::AssertUnwindSafe;

#[tokio::test]
async fn widget_retirement_snapshot_replace_merge_and_reexport_preserve_data() {
    let dir = tests::SnapshotTestDirectory::new("snapshot-widget-retirement");
    let mut pools = Vec::new();
    let mut candidates = Vec::new();
    let outcome = AssertUnwindSafe(async {
        let source_path = dir.0.join("source.db");
        let source = crate::data::sqlite_pool::open_single_connection_sqlite_pool(&source_path,true).await.unwrap();
        pools.push(source.clone());
        crate::data::sqlite_pool::prepare_pool_schema(&source,&source_path).await.unwrap();
        source.execute("DELETE FROM _sqlx_migrations WHERE version=17;
            INSERT INTO settings(key,value) VALUES ('minimize_behavior','widget'),('widget_placement','broken'),('widget_expansion_preference','pinned'),('widget_side','right'),('widget_anchor_y','0.7'),('mini_window_preferences','{\"held\":true}'),('language','es');
            INSERT INTO sessions(id,app_name,exe_name,start_time,end_time,duration) VALUES(1,'Editor','editor.exe',1000,2000,1000);
            INSERT INTO session_title_samples(session_id,title,start_time,end_time) VALUES(1,'Document',1000,2000);
            INSERT INTO icon_cache(exe_name,icon_base64,last_updated) VALUES('editor.exe','icon',1);").await.unwrap();
        let archive = dir.0.join("old.zip");
        write_snapshot_archive(&source,&archive,"old").await.unwrap();
        let original_hash = sha256_file(&archive).unwrap();
        for strategy in [RestoreStrategy::Replace, RestoreStrategy::Merge] {
            candidates.push(prepare_snapshot_backup(&archive,strategy).await.unwrap());
            let candidate = open_snapshot_pool(&candidates.last().unwrap().db_path,false).await.unwrap();
            pools.push(candidate.clone());
            let source_mini: String = sqlx::query_scalar("SELECT value FROM settings WHERE key='mini_window_preferences'").fetch_one(&candidate).await.unwrap();
            assert_eq!(source_mini,"{\"held\":true}");
            assert!(crate::data::schema_contracts::has_retired_widget_preferences(&candidate).await.unwrap());
            let result = if strategy == RestoreStrategy::Merge {
                let target_path = dir.0.join("target.db");
                let target = crate::data::sqlite_pool::open_single_connection_sqlite_pool(&target_path,true).await.unwrap();
                pools.push(target.clone());
                crate::data::sqlite_pool::prepare_pool_schema(&target,&target_path).await.unwrap();
                target.execute("INSERT INTO settings(key,value) VALUES('mini_window_preferences','{\"held\":false}'),('language','zh-CN')").await.unwrap();
                restore::merge_snapshot_backup(candidate,&target).await.unwrap();
                assert_eq!(sqlx::query_scalar::<_,String>("SELECT value FROM settings WHERE key='mini_window_preferences'").fetch_one(&target).await.unwrap(),"{\"held\":false}");
                target
            } else { candidate };
            assert_eq!(count_table(&result,"sessions").await.unwrap(),1);
            assert_eq!(count_table(&result,"session_title_samples").await.unwrap(),1);
            assert_eq!(count_table(&result,"icon_cache").await.unwrap(),1);
            let data: (String,i64,i64,i64) = sqlx::query_as("SELECT exe_name,start_time,end_time,duration FROM sessions").fetch_one(&result).await.unwrap();
            assert_eq!(data,("editor.exe".into(),1000,2000,1000));
            let reexport = dir.0.join("reexport.zip");
            write_snapshot_archive(&result,&reexport,"new").await.unwrap();
            candidates.push(prepare_snapshot_backup(&reexport,RestoreStrategy::Replace).await.unwrap());
            let exported = open_snapshot_pool(&candidates.last().unwrap().db_path,false).await.unwrap();
            pools.push(exported.clone());
            let keys: Vec<String> = sqlx::query_scalar("SELECT key FROM settings WHERE key IN ('language','mini_window_preferences') ORDER BY key").fetch_all(&exported).await.unwrap();
            assert_eq!(keys,vec!["language","mini_window_preferences"]);
            assert!(crate::data::schema_contracts::has_retired_widget_preferences(&exported).await.unwrap());
            assert_eq!(sha256_file(&archive).unwrap(),original_hash,"preparation must not rewrite the original backup");
        }
        // A failed cleanup acts only on the extracted candidate.
        source.execute("CREATE TRIGGER reject_retirement BEFORE DELETE ON settings WHEN OLD.key='widget_side' BEGIN SELECT RAISE(ABORT,'retirement failure'); END").await.unwrap();
        let failing_archive = dir.0.join("failure.zip");
        write_snapshot_archive(&source,&failing_archive,"old").await.unwrap();
        let failing_hash = sha256_file(&failing_archive).unwrap();
        for strategy in [RestoreStrategy::Replace,RestoreStrategy::Merge] {
            let error = prepare_snapshot_backup(&failing_archive,strategy).await.err().expect("cleanup must fail");
            assert!(error.contains("retirement failure"),"{error}");
            assert_eq!(sha256_file(&failing_archive).unwrap(),failing_hash);
            assert_eq!(count_table(&source,"settings").await.unwrap(),7);
        }
    }).catch_unwind().await;
    for pool in pools {
        pool.close().await;
    }
    drop(candidates);
    if let Err(panic) = outcome {
        std::panic::resume_unwind(panic);
    }
}
