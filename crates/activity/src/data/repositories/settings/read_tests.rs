use super::*;
use crate::data::repositories::icon_cache::load_executable_icons;
use sqlx::{sqlite::SqlitePoolOptions, Executor};

#[tokio::test]
async fn typed_reads_treat_keys_prefixes_and_icon_names_as_data() {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .unwrap();
    pool.execute(
        "CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
        CREATE TABLE icon_cache(exe_name TEXT PRIMARY KEY,icon_base64 TEXT NOT NULL);
        INSERT INTO settings VALUES('a_1','one'),('ab1','two'),('a%2','three');
        INSERT INTO icon_cache VALUES('Editor.EXE','icon');",
    )
    .await
    .unwrap();
    assert_eq!(load_rows(&pool, None, None).await.unwrap().len(), 3);
    assert_eq!(
        load_rows(&pool, Some("a_1"), None).await.unwrap()[0].value,
        "one"
    );
    assert_eq!(load_rows(&pool, None, Some("a_")).await.unwrap().len(), 1);
    assert_eq!(load_rows(&pool, None, Some("a%")).await.unwrap().len(), 1);
    assert!(load_rows(&pool, Some("a_1' OR 1=1 --"), None)
        .await
        .unwrap()
        .is_empty());
    assert!(load_rows(&pool, Some("a_1"), Some("a")).await.is_err());
    assert_eq!(
        load_executable_icons(&pool, &["EDITOR.exe".into()])
            .await
            .unwrap()[0]
            .icon_base64,
        "icon"
    );
    assert!(
        load_executable_icons(&pool, &["'); DROP TABLE settings; --".into()])
            .await
            .unwrap()
            .is_empty()
    );
    assert!(load_executable_icons(&pool, &vec!["x".into(); 901])
        .await
        .is_err());
    assert_eq!(load_rows(&pool, None, None).await.unwrap().len(), 3);
    pool.close().await;
}
