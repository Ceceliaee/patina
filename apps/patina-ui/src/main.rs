#![windows_subsystem = "windows"]

mod client;
mod features;
mod windows;

use patina_desktop_protocol::APP_ID;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    client::run_if_requested()
        .unwrap_or_else(|| Err("The resident process starts Patina windows".into()))
}
