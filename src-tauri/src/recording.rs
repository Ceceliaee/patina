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
        pub mod category_management;
        pub mod classification_settings;
        #[allow(unused_imports, reason = "cache maintenance is used by the Tauri host")]
        pub mod icon_cache;
        pub mod icon_retention;
        pub mod import_batches;
        pub mod remote_backup_settings;
        pub mod scheduled_backup;
        pub mod scheduled_export;
        pub mod session_title_samples;
        pub mod sessions;
        pub mod settings;
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
    #[path = "export"]
    pub mod export {
        pub mod common;
        pub mod csv_exporter;
        pub mod markdown_exporter;
        pub mod parquet_exporter;
        pub mod sqlite_exporter;
        pub mod write;
    }
    #[path = "import"]
    pub mod import {
        pub mod canonical_csv;
        pub mod destructure;
        pub mod model;
        pub mod prepared;
        pub mod preview;
    }
    #[path = "backup"]
    pub mod backup {
        pub mod import_data;
        pub mod merge;
        pub mod prepared_source;
        pub mod records;
        pub mod snapshot;
        pub use records::RestoreStrategy;
        pub(crate) use snapshot::{validate_scheduled_snapshot, write_snapshot_archive_create_new};
        pub(crate) async fn preview_backup(
            path: String,
        ) -> Result<crate::domain::backup::BackupPreview, crate::domain::backup::BackupError>
        {
            preview(&path).await.map_err(Into::into)
        }
        pub(crate) use prepared_source::prepare_snapshot_source;
        pub(crate) use snapshot::{
            merge_snapshot_backup, prepare_snapshot_backup, write_snapshot_archive,
        };
        pub(crate) async fn preview(
            path: &str,
        ) -> Result<crate::domain::backup::BackupPreview, String> {
            let src = prepare_snapshot_source(path, None).map_err(|e| e.to_string())?;
            let mut p = snapshot::extract_snapshot_archive(&src.path, false)
                .await?
                .preview
                .clone();
            p.hash = src.content_sha256.clone();
            Ok(p)
        }
    }
    pub mod classification_deletion;
    #[path = "remote_backup_config/core.rs"]
    pub mod dav_config;
    pub mod storage_path_safety;
    #[path = "user_data_maintenance/history.rs"]
    pub mod user_data_maintenance;
    #[path = "remote_backup"]
    pub mod remote_backup {
        pub mod index;
        pub mod scheduled;
        pub(crate) use scheduled::*;
        #[path = "../../recording/dav.rs"]
        pub mod native;
    }

    #[path = "scheduled_backup/runtime.rs"]
    pub mod scheduled_backup;
    #[path = "scheduled_export/runtime.rs"]
    pub mod scheduled_export;
    pub mod schema;
    pub mod schema_contracts;
    pub mod sqlite_error;
    pub mod storage_jobs;
    #[path = "web_activity_store/sqlite.rs"]
    pub mod web_activity_store;
    #[path = "web_activity_analysis/range.rs"]
    pub mod web_range;
    #[path = "sqlite_pool"]
    pub mod sqlite_pool {
        pub mod bootstrap;
        pub mod diagnostics;
        pub mod maintenance;
        pub(crate) use bootstrap::{
            expected_migration_metadata, open_single_connection_sqlite_pool,
        };
        pub(crate) use maintenance::checkpoint_sqlite_pool;
        pub(crate) async fn prepare_pool_schema(
            pool: &sqlx::SqlitePool,
            _path: &std::path::Path,
        ) -> Result<(), String> {
            bootstrap::run_current_migrations(pool).await
        }
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
    pub mod backup_schedule;
    pub mod browser_title_privacy;
    pub mod classification;
    pub mod export_schedule;
    pub mod focus_history;
    pub mod free_focus;
    pub mod icon_color;
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
    pub mod backup_scheduler;
    pub mod export_scheduler;
    pub mod remote_status_bridge;
    pub mod tracking;
    pub mod web_activity;
}
#[path = "platform"]
#[allow(
    dead_code,
    reason = "shared native probes include full application diagnostics"
)]
mod platform {
    #[path = "credentials"]
    pub mod credentials {
        pub mod store;
        pub mod windows_credentials;
        pub use store::{CredentialStore, WebDavCredentialStore};
    }
    pub mod clock;
    pub mod web_activity_bridge;
    pub mod web_activity_bridge_lifecycle;
    pub mod web_activity_request;
    pub mod webdav;
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
pub use data::classification_deletion::Impact as DeletionImpact;
pub use domain::classification::default_category_color;
pub use domain::localization::{format_text, text, Locale};
#[path = "domain/localization/generated_data.rs"]
mod localization_data;

pub use domain::mini_window::{
    bounds as mini_bounds, Interaction, Placement, Rect as MiniRect, LEAVE_DELAY,
};
pub use domain::mini_window::{PANEL_HEIGHT, PANEL_WIDTH};
pub use domain::settings::{
    CloseBehavior, DesktopBehaviorSettings, RemoteStatusBridgeSettings, WebActivityBridgeSettings,
};

pub fn localized_data(locale: Locale, key: &str) -> Option<serde_json::Value> {
    localization_data::lookup_data(locale, key)
        .and_then(|value| serde_json::from_str(value).ok())
        .or_else(|| {
            localization_data::lookup_data(Locale::default(), key)
                .and_then(|value| serde_json::from_str(value).ok())
        })
}

pub fn run_probe_if_requested() -> Option<i32> {
    platform::windows::native_probe::run_if_requested()
}

#[path = "recording/desktop.rs"]
mod desktop;
pub use data::export::common::{ALL_EXPORT_FIELDS, DEFAULT_EXPORT_FIELDS};
pub use data::export::write::ExportDataRequest;
pub use desktop::storage::{database_for_profile, StorageRequest};
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
pub use color::app_color as default_app_color;
pub use color::icon_color;
pub use color::icon_png;
pub use color::icon_png_from_bgra;
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
pub use analysis::{Series, SeriesKind, Trends};

#[path = "recording/manage.rs"]
mod manage;
pub use manage::{AppRule, CategoryEdit, Rules, Theme, TrackingPreferences, WebRule};
