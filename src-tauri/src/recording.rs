//! Native recording entry point. Both desktop hosts compile the same sampling
//! loop, Windows probes, SQLite migrations and session store.
#[path = "data"]
#[allow(
    dead_code,
    reason = "shared repositories also serve the main desktop views"
)]
mod data {
    #[path = "repositories"]
    pub mod repositories {
        pub mod anonymous_activity;
        pub mod app_links;
        pub mod app_settings;
        pub mod classification_settings;
        #[allow(unused_imports, reason = "cache maintenance is used by the Tauri host")]
        pub mod icon_cache;
        pub mod session_title_samples;
        pub mod sessions;
        #[allow(
            unused_imports,
            reason = "the shared tools repository also exports Tauri backup operations"
        )]
        pub mod tools;
        pub mod tracker_settings;
        pub mod web_activity;
        #[allow(
            unused_imports,
            reason = "classification writes also validate website links"
        )]
        pub mod web_links;
    }
    #[path = "activity_read_model/hourly.rs"]
    pub mod hourly;
    pub mod schema;
    pub mod schema_contracts;
    pub mod sqlite_error;
    #[path = "web_activity_analysis/range.rs"]
    pub mod web_range;
    #[path = "sqlite_pool"]
    pub mod sqlite_pool {
        pub mod bootstrap;
        pub mod diagnostics;
    }
    pub mod tracking_runtime;
}
#[path = "domain"]
#[allow(
    dead_code,
    reason = "shared domain types include other desktop features"
)]
mod domain {
    pub mod activity_read_model;
    pub mod backup;
    pub mod browser_title_privacy;
    pub mod classification;
    pub mod focus_history;
    pub mod free_focus;
    pub mod localization;
    pub mod mini_window;
    pub mod reminder_schedule;
    pub mod settings;
    pub mod tool_notifications;
    pub mod tools;
    pub mod tracking;
    pub mod web_activity;
    pub mod web_links;
    pub mod window_geometry;
}
#[path = "engine"]
#[allow(
    dead_code,
    reason = "shared engine diagnostics are also consumed by Tauri"
)]
mod engine {
    pub mod tracking;
}
#[path = "platform"]
#[allow(
    dead_code,
    reason = "shared native probes include full application diagnostics"
)]
mod platform {
    pub mod clock;
    #[path = "windows"]
    pub mod windows {
        pub mod app_metadata;
        pub mod audio;
        pub mod foreground;
        pub mod handles;
        pub mod icon;
        pub mod job;
        pub mod media;
        pub mod native_probe;
        pub mod notification_sound;
        pub mod packaged_app;
        pub mod resource;
        pub mod signal_sampling;
    }
}
pub use domain::localization::{format_text, text, Locale};
pub use domain::mini_window::{
    bounds as mini_bounds, Interaction, Placement, Rect as MiniRect, LEAVE_DELAY,
};
pub use domain::mini_window::{PANEL_HEIGHT, PANEL_WIDTH};

pub fn run_probe_if_requested() -> Option<i32> {
    platform::windows::native_probe::run_if_requested()
}

#[path = "recording/desktop.rs"]
mod desktop;
pub use desktop::{open_database, Activity, Recorder};
#[path = "recording/tools.rs"]
mod tools;
pub use domain::tool_notifications::{
    Delivery as NoticeDelivery, Preferences as NoticePreferences,
    PreferencesPatch as NoticePreferencesPatch, Sound as NoticeSound,
};
pub use tools::{NativeToolData, Shortcut, ToolTarget};
#[path = "recording/color.rs"]
mod color;
#[path = "recording/recent.rs"]
mod recent;
pub use recent::Recent;

#[path = "recording/today.rs"]
mod today;
pub use today::{AppEdit, AppUsage, Category, DaySummary};

pub use platform::windows::job::kill_on_close as child_job;

#[path = "recording/history.rs"]
mod history;
pub use history::{HistoryDay, HistoryRecord};

#[path = "recording/analysis.rs"]
mod analysis;
pub use analysis::{SeriesKind, Trends};

#[path = "recording/manage.rs"]
mod manage;
pub use manage::{AppRule, CategoryEdit, Rules, Theme, TrackingPreferences};
