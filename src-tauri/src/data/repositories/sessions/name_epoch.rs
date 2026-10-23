use sqlx::{sqlite::SqliteConnectOptions, SqlitePool};
use std::sync::{Arc, Mutex, OnceLock, Weak};
use tokio::sync::{Mutex as AsyncMutex, OwnedMutexGuard};

type Registry = Vec<(Weak<SqliteConnectOptions>, Weak<AsyncMutex<u64>>)>;

pub(crate) fn state(pool: &SqlitePool) -> Arc<AsyncMutex<u64>> {
    static REGISTRY: OnceLock<Mutex<Registry>> = OnceLock::new();
    let mut entries = REGISTRY
        .get_or_init(|| Mutex::new(Vec::new()))
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    entries.retain(|(pool, state)| pool.strong_count() > 0 && state.strong_count() > 0);
    let key = Arc::downgrade(&pool.connect_options());
    for (pool, state) in entries.iter() {
        if pool.ptr_eq(&key) {
            if let Some(state) = state.upgrade() {
                return state;
            }
        }
    }
    let state = Arc::new(AsyncMutex::new(0));
    entries.push((key, Arc::downgrade(&state)));
    state
}

// Legacy restore can reuse row IDs without replacing the pool. Serialize its
// transaction with short session/name writes, never with the native lookup.
pub(crate) async fn invalidate(pool: &SqlitePool) -> OwnedMutexGuard<u64> {
    let mut epoch = state(pool).lock_owned().await;
    *epoch = epoch.wrapping_add(1);
    epoch
}
