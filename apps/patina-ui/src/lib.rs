mod client;
mod features;
#[cfg(all(test, feature = "test-support"))]
mod test_support;
mod windows;

use patina_desktop_protocol::APP_ID;

pub use client::run_if_requested;
pub use windows::mini::geometry::MINI_PANEL_SIZE_DIP;
