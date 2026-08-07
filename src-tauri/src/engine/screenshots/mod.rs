pub mod capture;
pub mod ports;

pub use domain_screenshots::{ScreenshotEntry, ScreenshotSettings};
pub use ports::{ScreenshotDataError, ScreenshotDataStore, SharedScreenshotDataStore};

use crate::domain::screenshot as domain_screenshots;

pub async fn load_settings(
    store: &SharedScreenshotDataStore,
) -> Result<ScreenshotSettings, ScreenshotDataError> {
    store.load_settings().await
}

pub async fn save_settings(
    store: &SharedScreenshotDataStore,
    settings: &ScreenshotSettings,
) -> Result<(), ScreenshotDataError> {
    store.save_settings(settings.clone()).await
}

pub async fn query_screenshots(
    store: &SharedScreenshotDataStore,
    start_time: i64,
    end_time: i64,
    limit: Option<i64>,
) -> Result<Vec<ScreenshotEntry>, ScreenshotDataError> {
    store.query(start_time, end_time, limit).await
}

pub async fn query_screenshot_metadata(
    store: &SharedScreenshotDataStore,
    start_time: i64,
    end_time: i64,
    limit: Option<i64>,
) -> Result<Vec<ScreenshotEntry>, ScreenshotDataError> {
    store.query_metadata(start_time, end_time, limit).await
}

pub async fn get_screenshot_thumbnail(
    store: &SharedScreenshotDataStore,
    id: i64,
) -> Result<String, ScreenshotDataError> {
    store.get_thumbnail(id).await
}

pub async fn get_screenshot_file_path(
    store: &SharedScreenshotDataStore,
    id: i64,
) -> Result<String, ScreenshotDataError> {
    store.get_file_path(id).await
}

pub async fn get_screenshot_data(
    store: &SharedScreenshotDataStore,
    id: i64,
) -> Result<String, ScreenshotDataError> {
    use base64::engine::general_purpose::STANDARD as BASE64;
    use base64::Engine;
    let file_path = store.get_file_path(id).await?;
    let data =
        std::fs::read(&file_path).map_err(|e| ScreenshotDataError::new(format!("read: {e}")))?;
    Ok(BASE64.encode(data))
}

pub async fn reveal_screenshot_in_folder(
    store: &SharedScreenshotDataStore,
    id: i64,
) -> Result<(), ScreenshotDataError> {
    let file_path = store.get_file_path(id).await?;
    let path = std::path::Path::new(&file_path);
    if !path.exists() {
        return Err(ScreenshotDataError::new(format!(
            "file not found: {file_path}"
        )));
    }

    #[cfg(windows)]
    {
        use std::process::Command;
        Command::new("explorer")
            .args(["/select,", &file_path])
            .spawn()
            .map_err(|e| ScreenshotDataError::new(format!("failed to open explorer: {e}")))?;
        Ok(())
    }

    #[cfg(not(windows))]
    {
        Err(ScreenshotDataError::new("unsupported platform"))
    }
}
