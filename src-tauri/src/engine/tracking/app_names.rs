use super::ports::SessionNameWrite;
use crate::platform::windows::app_metadata;
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Arc, Mutex, OnceLock,
};
use std::{collections::BTreeMap, time::Instant};
use tokio::sync::Semaphore;

// A stalled native call retains its slot. Pending enrichment is expendable;
// session facts are already committed before admission to this queue.
const NATIVE_CONCURRENCY: usize = 2;
const PENDING_LIMIT: usize = 128;

#[cfg(test)]
#[path = "app_names_tests.rs"]
mod tests;

pub(super) struct NameResolver {
    pending: Arc<Semaphore>,
    native: Arc<Semaphore>,
    pending_limit: usize,
    native_limit: usize,
    stats: Arc<NameResolutionCounters>,
}

#[derive(Default)]
struct NameResolutionCounters {
    admitted: AtomicU64,
    rejected: AtomicU64,
    finished: AtomicU64,
    unavailable: AtomicU64,
    pending_since: Mutex<BTreeMap<u64, Instant>>,
}

struct PendingNameGuard {
    stats: Arc<NameResolutionCounters>,
    sequence: u64,
}
impl Drop for PendingNameGuard {
    fn drop(&mut self) {
        self.stats
            .pending_since
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .remove(&self.sequence);
        self.stats.finished.fetch_add(1, Ordering::Relaxed);
    }
}

#[derive(Clone, Debug, serde::Serialize)]
pub(crate) struct NameResolutionDiagnostics {
    pub pending: usize,
    pub running: usize,
    pub pending_limit: usize,
    pub running_limit: usize,
    pub oldest_age_ms: Option<u64>,
    pub admitted: u64,
    pub rejected: u64,
    pub finished: u64,
    pub unavailable: u64,
}

impl NameResolver {
    pub(super) fn new(pending: usize, native: usize) -> Self {
        Self {
            pending: Arc::new(Semaphore::new(pending)),
            native: Arc::new(Semaphore::new(native)),
            pending_limit: pending,
            native_limit: native,
            stats: Arc::default(),
        }
    }

    pub(super) fn schedule(
        &self,
        confirm: SessionNameWrite,
        probe: impl FnOnce() -> Option<String> + Send + 'static,
    ) -> Option<tauri::async_runtime::JoinHandle<()>> {
        let pending = match self.pending.clone().try_acquire_owned() {
            Ok(permit) => permit,
            Err(_) => {
                self.stats.rejected.fetch_add(1, Ordering::Relaxed);
                return None;
            }
        };
        let Ok(mut pending_since) = self.stats.pending_since.try_lock() else {
            self.stats.rejected.fetch_add(1, Ordering::Relaxed);
            return None;
        };
        let sequence = self.stats.admitted.fetch_add(1, Ordering::Relaxed);
        pending_since.insert(sequence, Instant::now());
        drop(pending_since);
        let pending_guard = PendingNameGuard {
            stats: self.stats.clone(),
            sequence,
        };
        let stats = self.stats.clone();
        let native = self.native.clone();
        Some(tauri::async_runtime::spawn(async move {
            let _pending = pending;
            let _pending_guard = pending_guard;
            let Ok(permit) = native.acquire_owned().await else {
                return;
            };
            let result = tauri::async_runtime::spawn_blocking(move || {
                let _permit = permit;
                probe()
            })
            .await;
            let Some(name) = result.ok().flatten() else {
                stats.unavailable.fetch_add(1, Ordering::Relaxed);
                return;
            };
            let name = name.trim().trim_end_matches(".exe").trim();
            if name.is_empty() {
                stats.unavailable.fetch_add(1, Ordering::Relaxed);
                return;
            }
            if let Err(error) = confirm(name.to_owned()).await {
                eprintln!("[tracker] failed to fill session name: {error}");
            }
        }))
    }

    fn diagnostics(&self) -> NameResolutionDiagnostics {
        NameResolutionDiagnostics {
            pending: self.pending_limit - self.pending.available_permits(),
            running: self.native_limit - self.native.available_permits(),
            pending_limit: self.pending_limit,
            running_limit: self.native_limit,
            oldest_age_ms: self
                .stats
                .pending_since
                .try_lock()
                .ok()
                .and_then(|pending| {
                    pending
                        .first_key_value()
                        .map(|(_, started)| started.elapsed().as_millis() as u64)
                }),
            admitted: self.stats.admitted.load(Ordering::Relaxed),
            rejected: self.stats.rejected.load(Ordering::Relaxed),
            finished: self.stats.finished.load(Ordering::Relaxed),
            unavailable: self.stats.unavailable.load(Ordering::Relaxed),
        }
    }
}

fn resolver() -> &'static NameResolver {
    static RESOLVER: OnceLock<NameResolver> = OnceLock::new();
    RESOLVER.get_or_init(|| NameResolver::new(PENDING_LIMIT, NATIVE_CONCURRENCY))
}

pub(crate) fn diagnostics() -> NameResolutionDiagnostics {
    resolver().diagnostics()
}

pub(super) fn schedule(confirm: SessionNameWrite, process_path: &str, app_user_model_id: &str) {
    if process_path.trim().is_empty() && app_user_model_id.trim().is_empty() {
        return;
    }
    let resolver = resolver();
    let process_path = process_path.to_owned();
    let app_user_model_id = app_user_model_id.to_owned();
    resolver.schedule(confirm, move || {
        if app_user_model_id.trim().is_empty() {
            app_metadata::resolve_process_display_name(&process_path)
        } else {
            app_metadata::resolve_app_display_name(&process_path, &app_user_model_id)
        }
    });
}
