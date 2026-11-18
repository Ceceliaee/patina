//! Windows observations and bounded native probe channels.
#[cfg(feature = "sampling")]
pub mod clock;
pub mod windows {
    #[cfg(feature = "sampling")]
    pub mod app_metadata;
    #[cfg(feature = "sampling")]
    pub mod audio;
    #[cfg(feature = "sampling")]
    pub mod foreground;
    #[cfg(feature = "sampling")]
    pub mod handles;
    #[cfg(feature = "sampling")]
    pub mod icon;
    pub mod job;
    #[cfg(feature = "sampling")]
    pub mod media;
    #[cfg(feature = "sampling")]
    pub mod native_probe;
    #[cfg(feature = "sampling")]
    pub mod notification_sound;
    #[cfg(feature = "sampling")]
    pub mod packaged_app;
    #[cfg(feature = "sampling")]
    pub mod resource;
    #[cfg(feature = "sampling")]
    pub mod signal_sampling;
}

mod dpi;
pub use dpi::enable_monitor_dpi;

#[cfg(feature = "credentials")]
pub mod credentials {
    mod store;
    mod windows_credentials;
    pub use store::{CredentialStore, WebDavCredentialStore};
}
