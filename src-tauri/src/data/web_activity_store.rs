mod sqlite;
pub use sqlite::SqliteWebActivityStore;

impl SqliteWebActivityStore {
    pub async fn from_app<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Result<Self, String> {
        Ok(Self::new(
            crate::data::sqlite_pool::wait_for_sqlite_pool(app).await?,
        ))
    }
}
