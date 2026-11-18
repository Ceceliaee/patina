pub mod activity_read_model;
pub mod backup;
pub mod classification_deletion;
#[path = "remote_backup_config/core.rs"]
pub mod dav_config;
pub mod export;
pub mod import;
pub mod repositories;
pub use patina_storage::storage_path_safety;
pub mod remote_backup;
#[path = "user_data_maintenance/history.rs"]
pub mod user_data_maintenance;

#[path = "scheduled_backup/runtime.rs"]
pub mod scheduled_backup;
#[path = "scheduled_export/runtime.rs"]
pub mod scheduled_export;
pub use patina_storage::schema;
pub use patina_storage::schema_contracts;
pub use patina_storage::sqlite_error;
#[cfg(test)]
mod query_plan_diagnostics;
pub mod storage_jobs;
#[cfg(test)]
pub mod web_activity_analysis;
#[path = "web_activity_store/sqlite.rs"]
pub mod web_activity_store;
#[path = "web_activity_analysis/range.rs"]
pub mod web_range;
pub use patina_storage::sqlite_pool;
pub mod tracking_runtime;
