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
pub mod mini_window;
pub mod reminder_schedule;
pub mod settings;
pub mod tool_notifications;
pub mod tools;
pub mod tracking;
pub mod views;
pub mod web_activity;
pub mod web_links;
pub mod window_geometry;

pub use classification::default_category_color;
pub use color::{app_color as default_app_color, icon_color, icon_png, icon_png_from_bgra};
pub use localization::{format_text, localized_data, text, Locale};
pub use mini_window::{
    bounds as mini_bounds, Interaction, Placement, Rect as MiniRect, LEAVE_DELAY, PANEL_HEIGHT,
    PANEL_WIDTH,
};
pub use settings::{
    CloseBehavior, DesktopBehaviorSettings, RemoteStatusBridgeSettings, WebActivityBridgeSettings,
};
pub use tool_notifications::{
    Delivery as NoticeDelivery, Preferences as NoticePreferences,
    PreferencesPatch as NoticePreferencesPatch, Sound as NoticeSound,
};
pub use views::{
    analysis::{Series, SeriesKind, Trends},
    classification::{AppLinkEdit, AppRule, CategoryEdit, Rules},
    deletion::Impact as DeletionImpact,
    draft::{WebDraft, WebRule},
    history::{HistoryDay, HistoryRecord},
    preferences::{Theme, TrackingPreferences},
    recent::Recent,
    shortcuts::{Shortcut, ToolTarget},
    storage::{ExportDataRequest, StorageRequest, ALL_EXPORT_FIELDS, DEFAULT_EXPORT_FIELDS},
    today::{AppEdit, AppUsage, Category, DaySummary},
    tracking::Activity,
};
