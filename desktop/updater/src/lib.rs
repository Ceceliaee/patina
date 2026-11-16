#[cfg(debug_assertions)]
pub mod fixture;
mod manifest;
mod service;
#[cfg(test)]
mod tests;
mod transport;

pub use manifest::{Config, Release, Target, verify};
pub use service::{Phase, Request, Service, Snapshot};
pub use transport::{Transport, WindowsHttp};

pub type Result<T> = std::result::Result<T, String>;
