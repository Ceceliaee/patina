//! Offline transport for native debug tests. This module is absent from release builds.
use crate::{Config, Result, Service, Target, Transport};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::Arc,
};

struct Fixture(PathBuf);
impl Transport for Fixture {
    fn get(
        &self,
        url: &str,
        limit: u64,
        output: &mut dyn Write,
        progress: &mut dyn FnMut(u64),
    ) -> Result<()> {
        let file = match url {
            "https://fixture.invalid/manifest" => "manifest.json",
            "https://fixture.invalid/setup.exe" => "payload.bin",
            _ => return Err("Unknown fixture URL".into()),
        };
        let bytes = fs::read(self.0.join(file)).map_err(|e| e.to_string())?;
        if bytes.len() as u64 > limit {
            return Err("Fixture exceeds response limit".into());
        }
        for chunk in bytes.chunks(8) {
            output.write_all(chunk).map_err(|e| e.to_string())?;
            progress(bytes.len() as u64);
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
        Ok(())
    }
}
pub fn service(root: PathBuf, fixture: &Path) -> Result<Service> {
    let config: Config =
        serde_json::from_slice(&fs::read(fixture.join("config.json")).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
    Service::new(
        // The signed 0.2.0 fixture must remain newer when the application version advances.
        "0.1.0",
        Target::current()?,
        config,
        root,
        Arc::new(Fixture(fixture.into())),
    )
}
