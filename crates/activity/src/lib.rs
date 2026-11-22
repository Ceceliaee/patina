//! Activity recording, native probes and local data services.
#[allow(
    dead_code,
    reason = "shared repositories also serve the main desktop views"
)]
mod data;
use patina_activity_model as domain;
mod recording;
use recording::{analysis, desktop, history, recent, today, tools};
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

pub use domain::settings::{
    CloseBehavior, DesktopBehaviorSettings, RemoteStatusBridgeSettings, WebActivityBridgeSettings,
};

pub use color::app_color as default_app_color;
pub use color::icon_color;
pub use color::icon_png;
pub use color::icon_png_from_bgra;
pub use data::export::common::{ALL_EXPORT_FIELDS, DEFAULT_EXPORT_FIELDS};
pub use data::export::write::ExportDataRequest;
pub use desktop::{open_database, CurrentActivity, Recorder, RecordingControl, RecordingSignals};
pub use domain::tool_notifications::{
    Delivery as NoticeDelivery, Preferences as NoticePreferences,
    PreferencesPatch as NoticePreferencesPatch, Sound as NoticeSound,
};
use patina_activity_model::color;
pub use patina_storage::location::adopt_existing_database;
pub use recent::Recent;
pub use recording::services::{ensure_machine_id, ActivityBridges};
pub use recording::storage::{prepare_database_for_startup, StorageOperations, StorageRequest};
pub use recording::{
    classification::Classification, error::ActivityError, maintenance::ActivityMaintenance,
    preferences::Preferences, queries::ActivityQueries,
};
pub use tools::{FocusTasks, NativeToolData, ReminderTasks, Shortcut, TaskKind, ToolTarget};

pub use today::{AppEdit, AppUsage, CategoryUsage, DaySummary};

pub use history::{HistoryDay, HistoryRecord};

pub use analysis::{Series, SeriesKind, Trends};

pub use recording::classification_rules::{
    AppLinkEdit, AppRule, CategoryEdit, ClassificationRules, WebsiteRule, WebsiteRuleDraft,
};
pub use recording::preferences::{load_preferences as load_app_preferences, AppPreferences, Theme};

#[cfg(debug_assertions)]
#[path = "data/tracking_runtime/native_icon_acceptance.rs"]
mod native_icon_acceptance;

#[cfg(debug_assertions)]
pub fn verify_native_probe_lifecycle(executable: &std::path::Path) -> Result<(), String> {
    platform::windows::native_probe::acceptance::verify(executable)?;
    native_icon_acceptance::verify(executable);
    Ok(())
}
