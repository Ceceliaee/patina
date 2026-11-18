use super::{services::ActivityBridges, storage::StorageOperations};
use sqlx::SqlitePool;
use std::sync::Arc;

pub struct ActivityMaintenance<'runtime> {
    runtime: &'runtime tokio::runtime::Runtime,
    bridges: Arc<ActivityBridges>,
    storage: StorageOperations,
    tasks: Vec<tokio::task::JoinHandle<Result<(), String>>>,
}

impl<'runtime> ActivityMaintenance<'runtime> {
    pub fn start(
        runtime: &'runtime tokio::runtime::Runtime,
        pool: SqlitePool,
        bridges: Arc<ActivityBridges>,
        storage: StorageOperations,
        preferences: &crate::AppPreferences,
    ) -> Self {
        let _entered = runtime.enter();
        let tasks = vec![
            runtime.spawn(crate::data::activity_read_model::maintain(pool)),
            runtime.spawn(bridges.clone().expire()),
            runtime.spawn(storage.clone().run_jobs()),
        ];
        bridges.apply(preferences);
        Self {
            runtime,
            bridges,
            storage,
            tasks,
        }
    }
    pub fn shutdown(&mut self) -> Result<(), String> {
        if self.tasks.is_empty() {
            return Ok(());
        }
        self.runtime.block_on(async {
            tokio::join!(self.bridges.stop(), self.storage.stop());
            let mut stopped = Ok(());
            for task in self.tasks.drain(..) {
                task.abort();
                match task.await {
                    Ok(outcome) => stopped = stopped.and(outcome),
                    Err(error) if !error.is_cancelled() => {
                        stopped = stopped.and(Err(error.to_string()))
                    }
                    Err(_) => {}
                }
            }
            stopped
        })
    }
}
impl Drop for ActivityMaintenance<'_> {
    fn drop(&mut self) {
        if let Err(error) = self.shutdown() {
            eprintln!("stop activity maintenance: {error}");
        }
    }
}
