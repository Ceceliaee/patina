use crate::platform::windows::foreground as tracker;
use tokio::task::spawn_blocking;
use tokio::time::{timeout, Duration};

const WINDOW_POLL_TIMEOUT_SECS: u64 = 3;

pub(super) async fn poll_active_window_with_timeout() -> Result<tracker::WindowInfo, String> {
    match timeout(
        Duration::from_secs(WINDOW_POLL_TIMEOUT_SECS),
        spawn_blocking(tracker::get_active_window),
    )
    .await
    {
        Ok(Ok(window_info)) => Ok(window_info),
        Ok(Err(error)) => Err(format!("active window poll task failed: {error}")),
        Err(_) => Err(format!(
            "active window poll timed out after {} seconds",
            WINDOW_POLL_TIMEOUT_SECS
        )),
    }
}
