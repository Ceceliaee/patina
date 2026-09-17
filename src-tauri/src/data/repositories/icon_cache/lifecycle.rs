use sqlx::{sqlite::SqliteConnectOptions, SqlitePool};
use std::sync::{Arc, Mutex, OnceLock, Weak};
use tokio::sync::{Mutex as AsyncMutex, OwnedMutexGuard};

type Registry = Vec<(Weak<SqliteConnectOptions>, Weak<AsyncMutex<u64>>)>;

pub(super) fn state(pool: &SqlitePool) -> Arc<AsyncMutex<u64>> {
    static REGISTRY: OnceLock<Mutex<Registry>> = OnceLock::new();
    let mut entries = REGISTRY
        .get_or_init(|| Mutex::new(Vec::new()))
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    entries.retain(|(options, state)| options.strong_count() > 0 && state.strong_count() > 0);
    let options = pool.connect_options();
    for (key, value) in entries.iter() {
        if key.ptr_eq(&Arc::downgrade(&options)) {
            if let Some(state) = value.upgrade() {
                return state;
            }
        }
    }
    let state = Arc::new(AsyncMutex::new(0));
    entries.push((Arc::downgrade(&options), Arc::downgrade(&state)));
    state
}

/// Serialize cache cleanup with short reads/writes, never with Windows extraction.
pub(crate) async fn acquire_icon_cache_maintenance(pool: &SqlitePool) -> OwnedMutexGuard<u64> {
    let mut guard = state(pool).lock_owned().await;
    *guard = guard.wrapping_add(1);
    guard
}
