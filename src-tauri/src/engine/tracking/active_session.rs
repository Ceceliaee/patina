use super::ports::{SessionNameWrite, TrackingDataError, TrackingDataStore};
use super::{app_names, metadata};
use crate::platform::windows::foreground as tracker;
use std::future::Future;
use std::pin::Pin;

pub(crate) async fn start_session_with_continuity_group_start_time(
    data: &dyn TrackingDataStore,
    window: &tracker::WindowInfo,
    start_time: i64,
    continuity_group_start_time: i64,
) -> Result<bool, TrackingDataError> {
    start_session_with_name_scheduler(
        data,
        window,
        start_time,
        continuity_group_start_time,
        |confirm, window| {
            app_names::schedule(confirm, &window.process_path, &window.app_user_model_id)
        },
    )
    .await
}

pub(crate) async fn start_session_with_name_scheduler(
    data: &dyn TrackingDataStore,
    window: &tracker::WindowInfo,
    start_time: i64,
    continuity_group_start_time: i64,
    schedule_name: impl FnOnce(SessionNameWrite, &tracker::WindowInfo),
) -> Result<bool, TrackingDataError> {
    let continuity_group_start_time = continuity_group_start_time.min(start_time);
    let Some(confirm_name) = data
        .start_session(
            &window.exe_name,
            &window.title,
            start_time,
            continuity_group_start_time,
        )
        .await?
    else {
        return Ok(false);
    };
    schedule_name(confirm_name, window);

    if !window.exe_name.is_empty() {
        let data = data.clone_store();
        let process_id = window.process_id;
        let exe_name = window.exe_name.clone();
        let process_path = window.process_path.clone();
        let app_user_model_id = window.app_user_model_id.clone();
        let window_class = window.window_class.clone();
        let hwnd = window.hwnd.clone();
        let root_owner_hwnd = window.root_owner_hwnd.clone();

        tauri::async_runtime::spawn(async move {
            if let Err(error) = metadata::ensure_icon_cache(
                data.as_ref(),
                metadata::IconMetadataSource {
                    process_id,
                    exe_name: &exe_name,
                    process_path: &process_path,
                    app_user_model_id: &app_user_model_id,
                    window_class: &window_class,
                    root_owner_hwnd: &root_owner_hwnd,
                    hwnd: &hwnd,
                },
            )
            .await
            {
                eprintln!("[tracker] failed to update icon cache: {error}");
            }
        });
    }

    Ok(true)
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
