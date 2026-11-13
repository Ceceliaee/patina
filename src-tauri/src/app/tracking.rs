use crate::engine::tracking::{
    host::TrackingHost, pause_state::TrackingPauseRuntimeState,
    runtime_snapshot::TrackingRuntimeSnapshotState, title_state::TitleRecordingRuntimeState,
};
use crate::platform::windows::power::PowerLifecycleEvent;
use tauri::{App, AppHandle, Emitter, Listener, Manager, Runtime};

impl<R: Runtime> TrackingHost for AppHandle<R> {
    fn pause(&self) -> &TrackingPauseRuntimeState {
        self.state::<TrackingPauseRuntimeState>().inner()
    }
    fn titles(&self) -> &TitleRecordingRuntimeState {
        self.state::<TitleRecordingRuntimeState>().inner()
    }
    fn projection(&self) -> &TrackingRuntimeSnapshotState {
        self.state::<TrackingRuntimeSnapshotState>().inner()
    }
    fn active_window_changed(&self, window: &crate::platform::windows::foreground::WindowInfo) {
        let _ = self.emit("active-window-changed", window);
    }
    fn data_changed(&self, reason: &str, at_ms: u64) -> Result<(), String> {
        self.emit(
            "tracking-data-changed",
            crate::domain::tracking::TrackingDataChangedPayload::new(reason, at_ms),
        )
        .map_err(|e| e.to_string())
    }
}

const POWER_LIFECYCLE_CHANGED_EVENT: &str = "power-lifecycle-changed";

pub(crate) fn register_power_lifecycle_handler<R: Runtime>(app: &App<R>) {
    let app_handle = app.handle().clone();
    app.listen(POWER_LIFECYCLE_CHANGED_EVENT, move |event| {
        let Ok(event) = serde_json::from_str::<PowerLifecycleEvent>(event.payload()) else {
            eprintln!("[tracker] ignored malformed power lifecycle event");
            return;
        };
        app_handle
            .state::<crate::engine::tracking::runtime_snapshot::TrackingRuntimeSnapshotState>()
            .note_power_event(&event.state, event.timestamp_ms as i64);
        let app_handle = app_handle.clone();
        tauri::async_runtime::spawn(async move {
            if let Err(error) = handle_power_lifecycle_event(app_handle).await {
                eprintln!("[tracker] power lifecycle handling failed: {error}");
            }
        });
    });
}

pub async fn handle_power_lifecycle_event<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    let data = crate::data::tracking_runtime_tauri::shared_from_app(&app).await?;
    crate::engine::tracking::runtime::handle_power_lifecycle_event(app, data.as_ref()).await
}
