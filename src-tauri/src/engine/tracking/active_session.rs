use super::metadata;
use super::ports::{TrackingDataError, TrackingDataStore};
use crate::platform::windows::foreground as tracker;
use std::future::Future;
use std::pin::Pin;

pub(crate) async fn start_session_with_continuity_group_start_time(
    data: &dyn TrackingDataStore,
    window: &tracker::WindowInfo,
    start_time: i64,
    continuity_group_start_time: i64,
) -> Result<bool, TrackingDataError> {
    let continuity_group_start_time = continuity_group_start_time.min(start_time);
    let app_name = metadata::map_app_name(&window.exe_name, &window.process_path);
    let did_start = data
        .start_session(
            &app_name,
            &window.exe_name,
            &window.title,
            start_time,
            continuity_group_start_time,
        )
        .await?;
    if !did_start {
        return Ok(false);
    }

    if !window.exe_name.is_empty() {
        let data = data.clone_store();
        let exe_name = window.exe_name.clone();
        let process_path = window.process_path.clone();
        let window_class = window.window_class.clone();
        let hwnd = window.hwnd.clone();
        let root_owner_hwnd = window.root_owner_hwnd.clone();

        tauri::async_runtime::spawn(async move {
            if let Err(error) = metadata::ensure_icon_cache(
                data.as_ref(),
                &exe_name,
                &process_path,
                &window_class,
                &root_owner_hwnd,
                &hwnd,
            )
            .await
            {
                eprintln!("[tracker] failed to update icon cache: {error}");
            }
        });
    }

    Ok(did_start)
}

#[cfg(test)]
pub(crate) async fn start_session(
    pool: &sqlx::SqlitePool,
    window: &tracker::WindowInfo,
    start_time: i64,
) -> Result<bool, TrackingDataError> {
    let data = crate::data::tracking_runtime::TrackingRuntimeDataStore::new(pool.clone());
    start_session_with_continuity_group_start_time(&data, window, start_time, start_time).await
}

pub(crate) fn start_session_for_transition<'a>(
    data: &'a dyn TrackingDataStore,
    window: &'a tracker::WindowInfo,
    start_time: i64,
    continuity_group_start_time: i64,
) -> Pin<Box<dyn Future<Output = Result<bool, TrackingDataError>> + Send + 'a>> {
    Box::pin(start_session_with_continuity_group_start_time(
        data,
        window,
        start_time,
        continuity_group_start_time,
    ))
}
