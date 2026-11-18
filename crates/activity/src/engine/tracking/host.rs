use super::pause_state::TrackingPauseRuntimeState;
use super::runtime_snapshot::TrackingRuntimeSnapshotState;
use super::title_state::TitleRecordingRuntimeState;
use crate::platform::windows::foreground::WindowInfo;

/// The recorder owns sampling and persistence. The desktop owns the state
/// lifetime and delivery of notifications to its views.
pub trait TrackingHost: Send + Sync {
    fn pause(&self) -> &TrackingPauseRuntimeState;
    fn titles(&self) -> &TitleRecordingRuntimeState;
    fn projection(&self) -> &TrackingRuntimeSnapshotState;
    fn active_window_changed(&self, window: &WindowInfo);
    fn data_changed(&self, reason: &str, at_ms: u64) -> Result<(), String>;
}
