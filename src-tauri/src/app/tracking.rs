use crate::platform::windows::power::PowerLifecycleEvent;
use tauri::{App, AppHandle, Listener, Runtime};

const POWER_LIFECYCLE_CHANGED_EVENT: &str = "power-lifecycle-changed";

pub(crate) fn register_power_lifecycle_handler<R: Runtime>(app: &App<R>) {
    let app_handle = app.handle().clone();
    app.listen(POWER_LIFECYCLE_CHANGED_EVENT, move |event| {
        let Ok(event) = serde_json::from_str::<PowerLifecycleEvent>(event.payload()) else {
            eprintln!("[tracker] ignored malformed power lifecycle event");
            return;
        };
        let app_handle = app_handle.clone();
        tauri::async_runtime::spawn(async move {
            if let Err(error) =
                handle_power_lifecycle_event(app_handle, &event.state, event.timestamp_ms as i64)
                    .await
            {
                eprintln!("[tracker] power lifecycle handling failed: {error}");
            }
        });
    });
}

pub async fn handle_power_lifecycle_event<R: Runtime>(
    app: AppHandle<R>,
    state: &str,
    timestamp_ms: i64,
) -> Result<(), String> {
    let data = crate::data::tracking_runtime::shared_from_app(&app).await?;
    crate::engine::tracking::runtime::handle_power_lifecycle_event(
        app,
        data.as_ref(),
        state,
        timestamp_ms,
    )
    .await
}
