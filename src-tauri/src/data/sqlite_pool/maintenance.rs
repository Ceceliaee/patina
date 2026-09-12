use sqlx::{Pool, Row, Sqlite};
use tokio::sync::{Mutex, MutexGuard};

static SQLITE_MAINTENANCE: Mutex<()> = Mutex::const_new(());
pub(crate) const QUERY_STATISTICS_OPTIMIZE_MASK: u32 = 0x2;

pub(crate) async fn optimize_query_statistics(pool: &Pool<Sqlite>) -> Result<(), String> {
    // Check queried tables and indexes without statistics. Retain STAT4 by omitting
    // the analysis-limit flag, and avoid blind analysis of untouched singleton tables.
    sqlx::query(&format!(
        "PRAGMA optimize({QUERY_STATISTICS_OPTIMIZE_MASK})"
    ))
    .execute(pool)
    .await
    .map(|_| ())
    .map_err(|error| format!("failed to optimize sqlite query statistics: {error}"))
}

pub(crate) async fn acquire_sqlite_maintenance() -> MutexGuard<'static, ()> {
    SQLITE_MAINTENANCE.lock().await
}

pub(crate) async fn checkpoint_sqlite_pool(pool: &Pool<Sqlite>) -> Result<(), String> {
    let row = sqlx::query("PRAGMA wal_checkpoint(TRUNCATE)")
        .fetch_one(pool)
        .await
        .map_err(|error| format!("failed to checkpoint sqlite database: {error}"))?;
    let busy: i64 = row.try_get(0).unwrap_or(1);
    let log: i64 = row.try_get(1).unwrap_or(-1);
    let checkpointed: i64 = row.try_get(2).unwrap_or(-1);
    if busy != 0 || log != checkpointed {
        return Err(format!(
            "sqlite checkpoint did not complete (busy={busy}, log={log}, checkpointed={checkpointed})"
        ));
    }
    Ok(())
}
