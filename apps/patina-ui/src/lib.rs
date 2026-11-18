mod client;
mod features;
mod windows;

use patina_desktop_protocol::APP_ID;

pub use client::run_if_requested;
pub use windows::mini::geometry::MINI_PANEL_SIZE_DIP;
