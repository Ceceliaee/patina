#[cfg(all(windows, feature = "native-runtime", debug_assertions))]
pub mod fixture;
mod manifest;
mod state;
pub use state::{Phase, Request, Snapshot};
#[cfg(all(windows, feature = "native-runtime"))]
mod service;
#[cfg(all(test, windows, feature = "native-runtime"))]
mod tests;
#[cfg(all(windows, feature = "native-runtime"))]
mod transport;

pub use manifest::{
    Artifact, Config, MAX_INSTALLER, MAX_MANIFEST, Manifest, Release, Target, https_url, parse,
    verify,
};
#[cfg(all(windows, feature = "native-runtime"))]
pub use service::Service;
#[cfg(all(windows, feature = "native-runtime"))]
pub use transport::{Transport, WindowsHttp};

pub type Result<T> = std::result::Result<T, String>;
