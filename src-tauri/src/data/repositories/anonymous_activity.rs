use sqlx::{Pool, Row, Sqlite};

/// Anonymous facts intentionally have no foreign key to a named activity.
pub const SCHEMA_SQL: &str = "
CREATE TABLE IF NOT EXISTS anonymous_activity (
    id TEXT PRIMARY KEY NOT NULL,
    start_time INTEGER NOT NULL,
    end_time INTEGER,
    observed_until INTEGER NOT NULL,
    is_web INTEGER NOT NULL CHECK (is_web IN (0, 1)),
    CHECK (observed_until >= start_time),
    CHECK (end_time IS NULL OR end_time >= start_time)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_anonymous_activity_active
    ON anonymous_activity((1)) WHERE end_time IS NULL;
CREATE INDEX IF NOT EXISTS idx_anonymous_activity_range
    ON anonymous_activity(COALESCE(end_time, observed_until), start_time);
CREATE TABLE IF NOT EXISTS anonymous_activity_revision (
    id INTEGER PRIMARY KEY CHECK(id = 1), source_revision INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO anonymous_activity_revision(id, source_revision) VALUES(1, 0);
CREATE TRIGGER IF NOT EXISTS trg_anonymous_read_model_insert
AFTER INSERT ON anonymous_activity
BEGIN
    UPDATE anonymous_activity_revision SET source_revision = source_revision + 1 WHERE id = 1;
    UPDATE read_model_revision SET source_revision = source_revision + 1 WHERE id = 1;
    INSERT INTO activity_summary_dirty_ranges(start_ms, end_ms, generation, reason)
    VALUES (
        NEW.start_time - (((NEW.start_time % 3600000) + 3600000) % 3600000),
        MAX(NEW.start_time + 1, COALESCE(NEW.end_time, NEW.observed_until)) + ((3600000 - (((MAX(NEW.start_time + 1, COALESCE(NEW.end_time, NEW.observed_until)) % 3600000) + 3600000) % 3600000)) % 3600000),
        (SELECT source_revision FROM read_model_revision WHERE id = 1), 'native_insert'
    );
END;

CREATE TRIGGER IF NOT EXISTS trg_anonymous_read_model_update
AFTER UPDATE ON anonymous_activity
BEGIN
    UPDATE anonymous_activity_revision SET source_revision = source_revision + 1 WHERE id = 1;
    UPDATE read_model_revision SET source_revision = source_revision + 1 WHERE id = 1;
    INSERT INTO activity_summary_dirty_ranges(start_ms, end_ms, generation, reason)
    SELECT
        MIN(OLD.start_time, NEW.start_time) - (((MIN(OLD.start_time, NEW.start_time) % 3600000) + 3600000) % 3600000),
        MAX(MIN(OLD.start_time, NEW.start_time) + 1, MAX(COALESCE(OLD.end_time, OLD.observed_until), COALESCE(NEW.end_time, NEW.observed_until))) + ((3600000 - (((MAX(MIN(OLD.start_time, NEW.start_time) + 1, MAX(COALESCE(OLD.end_time, OLD.observed_until), COALESCE(NEW.end_time, NEW.observed_until))) % 3600000) + 3600000) % 3600000)) % 3600000),
        (SELECT source_revision FROM read_model_revision WHERE id = 1), 'native_update'
    WHERE OLD.end_time IS NOT NULL OR NEW.end_time IS NOT NULL OR OLD.start_time != NEW.start_time;
END;

CREATE TRIGGER IF NOT EXISTS trg_anonymous_read_model_delete
AFTER DELETE ON anonymous_activity
BEGIN
    UPDATE anonymous_activity_revision SET source_revision = source_revision + 1 WHERE id = 1;
    UPDATE read_model_revision SET source_revision = source_revision + 1 WHERE id = 1;
    INSERT INTO activity_summary_dirty_ranges(start_ms, end_ms, generation, reason)
    VALUES (
        OLD.start_time - (((OLD.start_time % 3600000) + 3600000) % 3600000),
        MAX(OLD.start_time + 1, COALESCE(OLD.end_time, OLD.observed_until)) + ((3600000 - (((MAX(OLD.start_time + 1, COALESCE(OLD.end_time, OLD.observed_until)) % 3600000) + 3600000) % 3600000)) % 3600000),
        (SELECT source_revision FROM read_model_revision WHERE id = 1), 'native_delete'
    );
END;
";

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnonymousActivityRecord {
    pub id: String,
    pub start_time: i64,
    pub end_time: Option<i64>,
    pub observed_until: i64,
    pub is_web: bool,
}

pub async fn observe(pool: &Pool<Sqlite>, now_ms: i64, is_web: bool) -> Result<bool, sqlx::Error> {
    let mut tx = pool.begin().await?;
    super::sessions::end_active_sessions_tx(&mut tx, now_ms).await?;
    let active: Option<(String, i64, bool)> = sqlx::query_as(
        "SELECT id, observed_until, is_web FROM anonymous_activity WHERE end_time IS NULL",
    )
    .fetch_optional(&mut *tx)
    .await?;
    if let Some((id, observed_until, previous_web)) = active {
        if now_ms < observed_until {
            return Ok(false);
        }
        if previous_web == is_web {
            sqlx::query("UPDATE anonymous_activity SET observed_until = ? WHERE id = ?")
                .bind(now_ms)
                .bind(id)
                .execute(&mut *tx)
                .await?;
            tx.commit().await?;
            return Ok(false);
        }
        sqlx::query("UPDATE anonymous_activity SET end_time = ?, observed_until = ? WHERE id = ?")
            .bind(now_ms)
            .bind(now_ms)
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }
    sqlx::query("INSERT INTO anonymous_activity (id, start_time, observed_until, is_web) VALUES (?, ?, ?, ?)")
        .bind(uuid::Uuid::new_v4().to_string()).bind(now_ms).bind(now_ms).bind(is_web)
        .execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(true)
}

pub async fn seal(pool: &Pool<Sqlite>, cutoff_ms: i64) -> Result<bool, sqlx::Error> {
    let mut tx = pool.begin().await?;
    let changed = seal_tx(&mut tx, cutoff_ms).await?;
    tx.commit().await?;
    Ok(changed)
}

pub async fn seal_tx(
    tx: &mut sqlx::Transaction<'_, Sqlite>,
    cutoff_ms: i64,
) -> Result<bool, sqlx::Error> {
    let result = sqlx::query(
        "UPDATE anonymous_activity SET end_time = MAX(start_time, ?),
         observed_until = MAX(start_time, ?) WHERE end_time IS NULL",
    )
    .bind(cutoff_ms)
    .bind(cutoff_ms)
    .execute(&mut **tx)
    .await?;
    Ok(result.rows_affected() != 0)
}

pub async fn seal_web_tx(
    tx: &mut sqlx::Transaction<'_, Sqlite>,
    cutoff_ms: i64,
) -> Result<bool, sqlx::Error> {
    let result = sqlx::query(
        "UPDATE anonymous_activity SET end_time = MAX(start_time, ?),
         observed_until = MAX(start_time, ?) WHERE end_time IS NULL AND is_web = 1",
    )
    .bind(cutoff_ms)
    .bind(cutoff_ms)
    .execute(&mut **tx)
    .await?;
    Ok(result.rows_affected() != 0)
}

pub async fn seal_interrupted(pool: &Pool<Sqlite>, cutoff_ms: i64) -> Result<bool, sqlx::Error> {
    let result = sqlx::query(
        "UPDATE anonymous_activity SET end_time = CASE WHEN observed_until BETWEEN start_time AND ? THEN observed_until ELSE start_time END WHERE end_time IS NULL",
    )
    .bind(cutoff_ms)
    .execute(pool)
    .await?;
    Ok(result.rows_affected() != 0)
}

pub async fn is_available(pool: &Pool<Sqlite>) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'anonymous_activity')")
        .fetch_one(pool).await
}

pub async fn read_range(
    pool: &Pool<Sqlite>,
    start_ms: i64,
    end_ms: i64,
) -> Result<Vec<AnonymousActivityRecord>, sqlx::Error> {
    let mut tx = pool.begin().await?;
    let rows = read_range_tx(&mut tx, start_ms, end_ms).await?;
    tx.commit().await?;
    Ok(rows)
}

const RANGE_SQL: &str =
    "SELECT id, start_time, end_time, observed_until, is_web FROM anonymous_activity
         WHERE start_time < ? AND COALESCE(end_time, observed_until) > ?
           AND COALESCE(end_time, observed_until) > start_time
         ORDER BY start_time, id";

pub async fn read_range_tx(
    tx: &mut sqlx::Transaction<'_, Sqlite>,
    start_ms: i64,
    end_ms: i64,
) -> Result<Vec<AnonymousActivityRecord>, sqlx::Error> {
    let rows = sqlx::query(RANGE_SQL)
        .bind(end_ms)
        .bind(start_ms)
        .fetch_all(&mut **tx)
        .await?;
    Ok(rows
        .into_iter()
        .map(|row| AnonymousActivityRecord {
            id: row.get("id"),
            start_time: row.get("start_time"),
            end_time: row.get("end_time"),
            observed_until: row.get("observed_until"),
            is_web: row.get("is_web"),
        })
        .collect())
}

pub async fn merge_for_restore(
    tx: &mut sqlx::Transaction<'_, Sqlite>,
    rows: &[AnonymousActivityRecord],
) -> Result<(), sqlx::Error> {
    for row in rows {
        // UUID is independent of identity. Existing records win when the same snapshot is merged again.
        sqlx::query(
            "INSERT INTO anonymous_activity(id, start_time, end_time, observed_until, is_web)
            VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING",
        )
        .bind(&row.id)
        .bind(row.start_time)
        .bind(row.end_time.unwrap_or(row.observed_until))
        .bind(row.observed_until)
        .bind(row.is_web)
        .execute(&mut **tx)
        .await?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::Executor;

    async fn setup() -> Pool<Sqlite> {
        let pool = Pool::<Sqlite>::connect("sqlite::memory:").await.unwrap();
        pool.execute(crate::data::schema::CURRENT_BASELINE_SCHEMA_SQL)
            .await
            .unwrap();
        pool.execute(crate::data::schema::IMPORT_DATA_SCHEMA_SQL)
            .await
            .unwrap();
        pool.execute(crate::data::schema::IMPORT_DATA_ISOLATION_SCHEMA_SQL)
            .await
            .unwrap();
        pool.execute(crate::data::schema::ACTIVITY_READ_MODELS_SCHEMA_SQL)
            .await
            .unwrap();
        pool.execute(crate::data::schema::WEB_ACTIVITY_SCHEMA_SQL)
            .await
            .unwrap();
        pool.execute(crate::data::schema::WEB_ACTIVITY_SESSION_SCHEMA_SQL)
            .await
            .unwrap();
        pool.execute(SCHEMA_SQL).await.unwrap();
        pool
    }

    #[test]
    fn anonymous_heartbeats_do_not_accumulate_projection_dirty_ranges() {
        tauri::async_runtime::block_on(async {
            let pool = setup().await;
            observe(&pool, 0, false).await.unwrap();
            for now in 1..100 {
                observe(&pool, now * 1000, false).await.unwrap();
            }
            let count: i64 =
                sqlx::query_scalar("SELECT COUNT(*) FROM activity_summary_dirty_ranges")
                    .fetch_one(&pool)
                    .await
                    .unwrap();
            assert_eq!(count, 1);
            seal(&pool, 100_000).await.unwrap();
            let count: i64 =
                sqlx::query_scalar("SELECT COUNT(*) FROM activity_summary_dirty_ranges")
                    .fetch_one(&pool)
                    .await
                    .unwrap();
            assert_eq!(count, 2);
        });
    }

    #[test]
    fn settings_stop_anonymous_activity_without_erasing_or_disabling_other_app_time() {
        tauri::async_runtime::block_on(async {
            use super::super::app_settings::{commit_app_setting_mutations, AppSettingMutation};
            let pool = setup().await;
            observe(&pool, 1000, true).await.unwrap();
            commit_app_setting_mutations(
                &pool,
                &[AppSettingMutation {
                    key: "web_activity_enabled".into(),
                    value: "false".into(),
                }],
            )
            .await
            .unwrap();
            let active: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM anonymous_activity WHERE end_time IS NULL",
            )
            .fetch_one(&pool)
            .await
            .unwrap();
            assert_eq!(active, 0);
            observe(&pool, 2000, false).await.unwrap();
            commit_app_setting_mutations(
                &pool,
                &[AppSettingMutation {
                    key: "web_activity_enabled".into(),
                    value: "false".into(),
                }],
            )
            .await
            .unwrap();
            let active: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM anonymous_activity WHERE end_time IS NULL",
            )
            .fetch_one(&pool)
            .await
            .unwrap();
            assert_eq!(
                active, 1,
                "web settings do not stop native anonymous app activity"
            );
            commit_app_setting_mutations(
                &pool,
                &[AppSettingMutation {
                    key: "tracking_paused".into(),
                    value: "true".into(),
                }],
            )
            .await
            .unwrap();
            let counts: (i64, i64) =
                sqlx::query_as("SELECT COUNT(*), SUM(end_time IS NULL) FROM anonymous_activity")
                    .fetch_one(&pool)
                    .await
                    .unwrap();
            assert_eq!(counts, (2, 0));
        });
    }

    #[test]
    fn anonymous_backup_merge_is_idempotent_and_keeps_current_conflicts() {
        tauri::async_runtime::block_on(async {
            let pool = setup().await;
            observe(&pool, 1_000, true).await.unwrap();
            seal(&pool, 5_000).await.unwrap();
            let mut saved = read_range(&pool, 0, 10_000).await.unwrap();
            saved[0].end_time = Some(9_000);
            for _ in 0..2 {
                let mut tx = pool.begin().await.unwrap();
                merge_for_restore(&mut tx, &saved).await.unwrap();
                tx.commit().await.unwrap();
            }
            let rows = read_range(&pool, 0, 10_000).await.unwrap();
            assert_eq!(rows.len(), 1);
            assert_eq!(rows[0].end_time, Some(5_000));
            let mut second = saved[0].clone();
            second.id = uuid::Uuid::new_v4().to_string();
            let mut tx = pool.begin().await.unwrap();
            merge_for_restore(&mut tx, &[second]).await.unwrap();
            tx.rollback().await.unwrap();
            assert_eq!(read_range(&pool, 0, 10_000).await.unwrap().len(), 1);
        });
    }

    #[test]
    fn failed_anonymous_projection_signal_rolls_back_the_named_boundary() {
        tauri::async_runtime::block_on(async {
            let pool = setup().await;
            super::super::sessions::start_session(&pool, "Editor", "editor.exe", "Public", 0, 0)
                .await
                .unwrap();
            pool.execute("CREATE TRIGGER reject_anonymous_dirty BEFORE INSERT ON activity_summary_dirty_ranges
                WHEN NEW.reason='native_insert' BEGIN SELECT RAISE(ABORT, 'fixture'); END").await.unwrap();
            assert!(observe(&pool, 1_000, false).await.is_err());
            let end: Option<i64> = sqlx::query_scalar("SELECT end_time FROM sessions LIMIT 1")
                .fetch_one(&pool)
                .await
                .unwrap();
            assert_eq!(end, None);
            let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM anonymous_activity")
                .fetch_one(&pool)
                .await
                .unwrap();
            assert_eq!(count, 0);
        });
    }

    #[test]
    fn anonymous_sources_share_one_interval_without_retaining_identity() {
        tauri::async_runtime::block_on(async {
            let pool = setup().await;
            assert!(observe(&pool, 1_000, false).await.unwrap());
            assert!(!observe(&pool, 5_000, false).await.unwrap());
            assert!(!observe(&pool, 4_000, false).await.unwrap());
            seal(&pool, 10_000).await.unwrap();
            let records = read_range(&pool, 0, 20_000).await.unwrap();
            assert_eq!(records.len(), 1);
            assert_eq!(records[0].end_time, Some(10_000));
            assert_eq!(records[0].start_time, 1_000);
        });
    }

    #[test]
    fn web_subset_and_idle_boundaries_preserve_total_time() {
        tauri::async_runtime::block_on(async {
            let pool = setup().await;
            observe(&pool, 0, false).await.unwrap();
            observe(&pool, 5_000, true).await.unwrap();
            observe(&pool, 8_000, true).await.unwrap();
            seal(&pool, 10_000).await.unwrap();
            observe(&pool, 20_000, false).await.unwrap();
            observe(&pool, 25_000, false).await.unwrap();
            seal_interrupted(&pool, 30_000).await.unwrap();
            let rows = read_range(&pool, 0, 40_000).await.unwrap();
            assert_eq!(rows.len(), 3);
            assert_eq!(
                rows.iter()
                    .map(|row| row.end_time.unwrap() - row.start_time)
                    .sum::<i64>(),
                15_000
            );
            assert_eq!(
                rows.iter()
                    .filter(|row| row.is_web)
                    .map(|row| row.end_time.unwrap() - row.start_time)
                    .sum::<i64>(),
                5_000
            );
            assert_eq!(rows[2].end_time, Some(25_000));
        });
    }

    #[test]
    fn anonymous_range_uses_its_effective_end_index() {
        tauri::async_runtime::block_on(async {
            let pool = setup().await;
            let plan: Vec<(i64, i64, i64, String)> =
                sqlx::query_as(&format!("EXPLAIN QUERY PLAN {RANGE_SQL}"))
                    .bind(20_000)
                    .bind(10_000)
                    .fetch_all(&pool)
                    .await
                    .unwrap();
            assert!(
                plan.iter().any(|row| row.3.contains(
                    "SEARCH anonymous_activity USING INDEX idx_anonymous_activity_range"
                )),
                "{plan:?}"
            );
            assert!(
                !plan
                    .iter()
                    .any(|row| row.3.contains("SCAN anonymous_activity")),
                "{plan:?}"
            );
        });
    }

    #[test]
    fn retroactive_idle_cutoff_never_creates_a_negative_interval() {
        tauri::async_runtime::block_on(async {
            let pool = setup().await;
            observe(&pool, 1_000, false).await.unwrap();
            seal(&pool, 0).await.unwrap();
            assert!(read_range(&pool, 0, 10_000).await.unwrap().is_empty());
        });
    }
}
