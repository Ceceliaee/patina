//! Pure activity rules and types shared between sampling, persistence and presentation.
pub use patina_i18n as localization;
pub mod activity_read_model;
pub mod backup;
pub mod backup_schedule;
pub mod browser_title_privacy;
pub mod classification;
pub mod color;
pub mod export_schedule;
pub mod focus_history;
pub mod free_focus;
pub mod icon_color;
pub mod reminder_schedule;
pub mod settings;
pub mod tool_notifications;
pub mod tools;
pub mod tracking;
pub mod views;
pub mod web_activity;
pub mod web_links;

pub use classification::default_category_color;
pub use color::{
    app_color as default_app_color, icon_color, icon_color_from_bgra, icon_png, icon_png_from_bgra,
};
pub use localization::{format_text, localized_data, text, Locale};
pub use settings::{
    CloseBehavior, DesktopBehaviorSettings, RemoteStatusBridgeSettings, WebActivityBridgeSettings,
};
pub use tool_notifications::{
    Delivery as NoticeDelivery, Preferences as NoticePreferences,
    PreferencesPatch as NoticePreferencesPatch, Sound as NoticeSound,
};
pub use views::{
    analysis::{Series, SeriesKind, Trends},
    classification::{AppLinkEdit, AppRule, CategoryEdit, ClassificationRules},
    deletion::Impact as DeletionImpact,
    history::{HistoryDay, HistoryRecord},
    preferences::{AppPreferences, Theme},
    recent::Recent,
    shortcuts::{Shortcut, ToolTarget},
    storage::{ExportDataRequest, StorageRequest, ALL_EXPORT_FIELDS, DEFAULT_EXPORT_FIELDS},
    today::{AppEdit, AppUsage, CategoryUsage, DaySummary},
    tracking::CurrentActivity,
    website_rules::{WebsiteRule, WebsiteRuleDraft},
};
