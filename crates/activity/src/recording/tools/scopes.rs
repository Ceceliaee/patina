use super::NativeToolData;
use sha2::{Digest, Sha256};
use sqlx::{
    sqlite::{SqliteConnectOptions, SqlitePoolOptions},
    SqlitePool,
};
use std::{collections::BTreeMap, path::PathBuf};

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum TaskKind {
    Focus,
    Reminders,
}

impl TaskKind {
    fn name(self) -> &'static str {
        match self {
            Self::Focus => "focus",
            Self::Reminders => "reminders",
        }
    }
}

#[derive(Default)]
pub(super) struct Scopes {
    directory: Option<PathBuf>,
    legacy: BTreeMap<TaskKind, String>,
    pools: BTreeMap<(String, TaskKind), SqlitePool>,
}

impl Scopes {
    fn file(&self, id: &str, kind: TaskKind) -> Result<PathBuf, String> {
        let root = self
            .directory
            .as_ref()
            .ok_or("Missing plugin data directory")?;
        Ok(root.join(format!(
            "{}-{:x}.sqlite",
            kind.name(),
            Sha256::digest(id.as_bytes())
        )))
    }
}

impl NativeToolData {
    /// Existing tracker databases predate plugin installation records.
    pub fn configure_plugin_storage(
        &self,
        directory: PathBuf,
        legacy: BTreeMap<TaskKind, String>,
    ) -> Result<(), String> {
        let mut scopes = self
            .scopes
            .lock()
            .map_err(|_| "Plugin task store unavailable")?;
        if scopes.directory.as_ref().is_some_and(|d| d != &directory) {
            return Err("Plugin data directory changed".into());
        }
        scopes.directory = Some(directory);
        scopes.legacy = legacy;
        Ok(())
    }

    pub fn plugin_tasks(&self, id: &str, kind: TaskKind) -> Result<Self, String> {
        let mut scopes = self
            .scopes
            .lock()
            .map_err(|_| "Plugin task store unavailable")?;
        if scopes.legacy.get(&kind).is_some_and(|owner| owner == id) {
            return Ok(self.clone());
        }
        let key = (id.to_owned(), kind);
        if !scopes.pools.contains_key(&key) {
            let file = scopes.file(id, kind)?;
            std::fs::create_dir_all(file.parent().unwrap()).map_err(|e| e.to_string())?;
            let tracker = self.pool.connect_options().get_filename().to_owned();
            let pool = self
                .runtime
                .block_on(open_task_database(&file, tracker, kind))?;
            scopes.pools.insert(key.clone(), pool);
        }
        Ok(Self {
            pool: scopes.pools[&key].clone(),
            ..self.clone()
        })
    }

    pub fn remove_plugin_tasks(&self, id: &str, kind: TaskKind) -> Result<(), String> {
        let mut scopes = self
            .scopes
            .lock()
            .map_err(|_| "Plugin task store unavailable")?;
        if scopes.legacy.get(&kind).is_some_and(|owner| owner == id) {
            return match kind {
                TaskKind::Focus => self.focus().delete_data(),
                TaskKind::Reminders => self.reminders().delete_data(),
            };
        }
        if let Some(pool) = scopes.pools.remove(&(id.to_owned(), kind)) {
            self.runtime.block_on(pool.close());
        }
        let file = scopes.file(id, kind)?;
        match std::fs::remove_file(file) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(e.to_string()),
        }
    }
}

async fn open_task_database(
    file: &std::path::Path,
    tracker: PathBuf,
    kind: TaskKind,
) -> Result<SqlitePool, String> {
    let prepared = crate::open_database(file).await?;
    if kind == TaskKind::Focus {
        return Ok(prepared);
    }
    prepared.close().await;
    let options = SqliteConnectOptions::new()
        .filename(file)
        .foreign_keys(true);
    SqlitePoolOptions::new()
        .max_connections(1)
        .after_connect(move |connection,_| {
            let tracker = tracker.clone();
            Box::pin(async move {
                sqlx::query("ATTACH DATABASE ? AS recorder")
                    .bind(tracker.to_string_lossy().into_owned())
                    .execute(&mut *connection).await?;
                // Only these read-only views supply recorder inputs to usage rules.
                sqlx::raw_sql(
                    "CREATE TEMP VIEW sessions AS SELECT * FROM recorder.sessions;
                     CREATE TEMP VIEW web_activity_segments AS SELECT * FROM recorder.web_activity_segments;
                     CREATE TEMP VIEW settings AS SELECT key,value FROM recorder.settings;"
                ).execute(connection).await?;
                Ok(())
            })
        })
        .connect_with(options).await.map_err(|e|e.to_string())
}
