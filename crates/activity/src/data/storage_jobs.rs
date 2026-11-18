use crate::data::remote_backup::{scheduled_remote_backup_id, ScheduledWebDavTarget};
use crate::domain::backup_schedule::ScheduledBackupRun;
use sqlx::SqlitePool;
use std::{
    future::Future,
    path::{Path, PathBuf},
    pin::Pin,
};

type Job<T> = Pin<Box<dyn Future<Output = Result<T, String>> + Send>>;
pub(crate) struct StorageJobs {
    pub pool: SqlitePool,
    pub profile: PathBuf,
    pub legacy: PathBuf,
    pub database: PathBuf,
    pub backups: PathBuf,
    pub temp: PathBuf,
    pub target: Box<dyn Fn() -> Job<ScheduledWebDavTarget> + Send + Sync>,
    pub snapshot: Box<dyn Fn(PathBuf) -> Job<()> + Send + Sync>,
}
impl StorageJobs {
    pub async fn remote_target(&self, _pool: &SqlitePool) -> Result<ScheduledWebDavTarget, String> {
        (self.target)().await
    }
    pub async fn create_backup(&self, path: &Path) -> Result<(), String> {
        (self.snapshot)(path.into()).await
    }
    pub fn temp_paths(&self, run: &ScheduledBackupRun) -> Result<(PathBuf, PathBuf), String> {
        std::fs::create_dir_all(&self.temp).map_err(|e| e.to_string())?;
        let id = scheduled_remote_backup_id(run);
        let name = format!("Patina-{id}.zip");
        crate::data::remote_backup::index::validate_backup_file_name(&name)?;
        Ok((
            self.temp.join(name),
            self.temp.join(format!("Patina-{id}-verify.zip")),
        ))
    }
    pub fn clean_temp(&self, path: &Path) -> Result<(), String> {
        if path.parent() != Some(self.temp.as_path()) {
            return Err("Unexpected backup staging path".into());
        }
        match std::fs::remove_file(path) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(e.to_string()),
        }
    }
}
