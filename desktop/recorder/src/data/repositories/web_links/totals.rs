use super::*;

// Both paths partition by domain and browser source before merging overlaps.
const TOTALS_SQL: &str = "WITH ordered AS (
    SELECT normalized_domain, start_time, COALESCE(end_time, updated_at) finish,
      MAX(COALESCE(end_time, updated_at)) OVER (
        PARTITION BY normalized_domain, browser_client_id, browser_kind, browser_exe_name
        ORDER BY start_time,id ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) previous_end
    FROM web_activity_segments {filter})
    SELECT normalized_domain,SUM(MAX(0,finish-MAX(start_time,COALESCE(previous_end,start_time))))
    FROM ordered GROUP BY normalized_domain";

pub(super) async fn read_uncached(
    tx: &mut Transaction<'_, Sqlite>,
) -> Result<BTreeMap<String, i64>, String> {
    let rows: Vec<(String, i64)> =
        sqlx::query_as(sqlx::AssertSqlSafe(TOTALS_SQL.replace("{filter}", "")))
            .fetch_all(&mut **tx)
            .await
            .map_err(|e| e.to_string())?;
    Ok(rows.into_iter().collect())
}

// TEMP tables follow this connection, its transactions and its database lifetime.
// Local writes dirty affected domains. A commit on another connection requires a full refresh.
const CACHE_SQL: &str = "
    CREATE TEMP TABLE web_lifetime_totals(domain TEXT PRIMARY KEY, total INTEGER);
    CREATE TEMP TRIGGER web_total_insert AFTER INSERT ON main.web_activity_segments BEGIN
        INSERT INTO web_lifetime_totals VALUES (NEW.normalized_domain,NULL) ON CONFLICT(domain) DO UPDATE SET total=NULL;
    END;
    CREATE TEMP TRIGGER web_total_update AFTER UPDATE OF normalized_domain,browser_client_id,browser_kind,browser_exe_name,start_time,end_time,updated_at,id ON main.web_activity_segments BEGIN
        INSERT INTO web_lifetime_totals VALUES (OLD.normalized_domain,NULL) ON CONFLICT(domain) DO UPDATE SET total=NULL;
        INSERT INTO web_lifetime_totals VALUES (NEW.normalized_domain,NULL) ON CONFLICT(domain) DO UPDATE SET total=NULL;
    END;
    CREATE TEMP TRIGGER web_total_delete AFTER DELETE ON main.web_activity_segments BEGIN
        INSERT INTO web_lifetime_totals VALUES (OLD.normalized_domain,NULL) ON CONFLICT(domain) DO UPDATE SET total=NULL;
    END;";

pub(super) async fn read_cached(
    tx: &mut Transaction<'_, Sqlite>,
) -> Result<BTreeMap<String, i64>, String> {
    read_cached_sql(tx)
        .await
        .map_err(|e| format!("failed to load website lifetime totals: {e}"))
}

async fn read_cached_sql(
    tx: &mut Transaction<'_, Sqlite>,
) -> Result<BTreeMap<String, i64>, sqlx::Error> {
    sqlx::query("CREATE TEMP TABLE IF NOT EXISTS web_totals_version(version INTEGER NOT NULL)")
        .execute(&mut **tx)
        .await?;
    let version: i64 = sqlx::query_scalar("PRAGMA main.data_version")
        .fetch_one(&mut **tx)
        .await?;
    let prior: Option<i64> = sqlx::query_scalar("SELECT version FROM temp.web_totals_version")
        .fetch_optional(&mut **tx)
        .await?;
    if prior.is_none() {
        sqlx::Executor::execute(&mut **tx, CACHE_SQL).await?;
    }
    let full = prior != Some(version);
    let dirty: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM temp.web_lifetime_totals WHERE total IS NULL)",
    )
    .fetch_one(&mut **tx)
    .await?;
    if full || dirty {
        let filter = if full {
            sqlx::query("DELETE FROM temp.web_lifetime_totals")
                .execute(&mut **tx)
                .await?;
            ""
        } else {
            "WHERE normalized_domain IN (SELECT domain FROM temp.web_lifetime_totals WHERE total IS NULL)"
        };
        let insert = format!(
            "INSERT OR REPLACE INTO temp.web_lifetime_totals(domain,total) {}",
            TOTALS_SQL.replace("{filter}", filter)
        );
        sqlx::query(sqlx::AssertSqlSafe(insert))
            .execute(&mut **tx)
            .await?;
        // A dirty domain without any remaining facts produces no aggregate row.
        sqlx::query("DELETE FROM temp.web_lifetime_totals WHERE total IS NULL")
            .execute(&mut **tx)
            .await?;
        if full {
            sqlx::query(
                "INSERT OR REPLACE INTO temp.web_totals_version(rowid,version) VALUES(1,?)",
            )
            .bind(version)
            .execute(&mut **tx)
            .await?;
        }
    }
    let rows: Vec<(String, i64)> =
        sqlx::query_as("SELECT domain,total FROM temp.web_lifetime_totals")
            .fetch_all(&mut **tx)
            .await?;
    Ok(rows.into_iter().collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::Executor;

    #[tokio::test]
    async fn lifetime_cache_handles_dirty_domains_rollback_and_external_commits() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("totals.db");
        let local = crate::data::sqlite_pool::open_single_connection_sqlite_pool(&path, true)
            .await
            .unwrap();
        let other = crate::data::sqlite_pool::open_single_connection_sqlite_pool(&path, false)
            .await
            .unwrap();
        local
            .execute(crate::data::schema::WEB_ACTIVITY_SCHEMA_SQL)
            .await
            .unwrap();
        local.execute("INSERT INTO web_activity_segments(browser_client_id,browser_kind,browser_exe_name,domain,normalized_domain,start_time,end_time,created_at,updated_at)
            VALUES('c','edge','edge.exe','a','a',1,101,1,101),('c','edge','edge.exe','a','a',20,40,1,40)").await.unwrap();
        async fn checked(pool: &sqlx::SqlitePool) -> BTreeMap<String, i64> {
            let mut tx = pool.begin().await.unwrap();
            let cached = read_cached(&mut tx).await.unwrap();
            assert_eq!(cached, read_uncached(&mut tx).await.unwrap());
            tx.commit().await.unwrap();
            cached
        }
        assert_eq!(checked(&local).await["a"], 100);
        assert_eq!(checked(&local).await["a"], 100);
        let mut tx = local.begin().await.unwrap();
        sqlx::query("DELETE FROM web_activity_segments")
            .execute(&mut *tx)
            .await
            .unwrap();
        assert!(read_cached(&mut tx).await.unwrap().is_empty());
        tx.rollback().await.unwrap();
        assert_eq!(checked(&local).await["a"], 100);
        local.execute("UPDATE web_activity_segments SET normalized_domain='b', browser_client_id='other' WHERE id=1").await.unwrap();
        assert_eq!(checked(&local).await["a"], 20);
        other
            .execute("DELETE FROM web_activity_segments WHERE normalized_domain='b'")
            .await
            .unwrap();
        assert!(!checked(&local).await.contains_key("b"));
        local
            .execute("DELETE FROM web_activity_segments")
            .await
            .unwrap();
        assert!(checked(&local).await.is_empty());
        local.close().await;
        other.close().await;
    }
}
