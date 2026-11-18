//! Activity recording, native probes and local data services.
#[allow(
    dead_code,
    reason = "shared repositories also serve the main desktop views"
)]
mod data;
use patina_activity_model as domain;
mod recording;
use recording::{analysis, desktop, history, manage, recent, today, tools};
#[allow(
    dead_code,
    reason = "shared engine diagnostics are available to diagnostics"
)]
mod engine;
#[allow(
    dead_code,
    reason = "shared native probes include full application diagnostics"
)]
mod platform;
pub use data::classification_deletion::Impact as DeletionImpact;
pub use domain::classification::default_category_color;
pub use patina_i18n::{format_text, localized_data, text, Locale};

pub use domain::mini_window::{
    bounds as mini_bounds, Interaction, Placement, Rect as MiniRect, LEAVE_DELAY,
};
pub use domain::mini_window::{PANEL_HEIGHT, PANEL_WIDTH};
pub use domain::settings::{
    CloseBehavior, DesktopBehaviorSettings, RemoteStatusBridgeSettings, WebActivityBridgeSettings,
};

pub use color::app_color as default_app_color;
pub use color::icon_color;
pub use color::icon_png;
pub use color::icon_png_from_bgra;
pub use data::export::common::{ALL_EXPORT_FIELDS, DEFAULT_EXPORT_FIELDS};
pub use data::export::write::ExportDataRequest;
pub use desktop::storage::{database_for_profile, StorageRequest};
pub use desktop::{open_database, Activity, Recorder};
pub use domain::tool_notifications::{
    Delivery as NoticeDelivery, Preferences as NoticePreferences,
    PreferencesPatch as NoticePreferencesPatch, Sound as NoticeSound,
};
use patina_activity_model::color;
pub use recent::Recent;
pub use tools::{NativeToolData, Shortcut, ToolTarget};

pub use today::load as day_summary_at;
pub use today::{AppEdit, AppUsage, Category, DaySummary};

pub use history::{HistoryDay, HistoryRecord};

pub use analysis::{Series, SeriesKind, Trends};

pub use manage::{
    AppLinkEdit, AppRule, CategoryEdit, Rules, Theme, TrackingPreferences, WebDraft, WebRule,
};

#[cfg(debug_assertions)]
#[path = "data/tracking_runtime/native_icon_acceptance.rs"]
mod native_icon_acceptance;

#[cfg(debug_assertions)]
pub fn verify_native_probe_lifecycle(executable: &std::path::Path) -> Result<(), String> {
    platform::windows::native_probe::acceptance::verify(executable)?;
    native_icon_acceptance::verify(executable);
    Ok(())
}
