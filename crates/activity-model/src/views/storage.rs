use super::{dav, imports};
use crate::{backup, backup_schedule, export_schedule};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::PathBuf;
pub const DEFAULT_EXPORT_FIELDS: &[&str] = &[
    "record_type",
    "category",
    "start_time",
    "end_time",
    "duration_ms",
    "app_name",
    "exe_name",
    "window_title",
    "domain",
    "normalized_domain",
    "url",
    "page_title",
];

pub const ALL_EXPORT_FIELDS: &[&str] = &[
    "record_type",
    "category",
    "start_time",
    "end_time",
    "duration_ms",
    "app_name",
    "exe_name",
    "window_title",
    "domain",
    "normalized_domain",
    "url",
    "page_title",
    "category_id",
    "local_date",
    "local_week",
    "local_month",
    "weekday",
    "start_hour",
    "duration_minutes",
    "source_key",
    "source_name",
    "session_id",
    "web_segment_id",
    "continuity_group_start_time",
    "browser_client_id",
    "browser_kind",
    "browser_exe_name",
    "favicon_url",
    "web_source",
    "created_at",
    "updated_at",
    "category_color",
];

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportDataRequest {
    pub format: String,
    pub output_path: String,
    pub start_time: Option<i64>,
    pub end_time: Option<i64>,
    pub selected_fields: Option<Vec<String>>,
}

#[derive(Clone, Serialize, Deserialize)]
pub enum StorageRequest {
    ExportPreferences(Option<ExportPreferences>),
    ResumeAfterUpdate(Option<String>),
    Info,
    Export(ExportDataRequest),
    Convert(String),
    PreviewCsv(String),
    Import {
        path: String,
        fingerprint: String,
    },
    Batches,
    DeleteBatch(String),
    Backup(PathBuf),
    PreviewRestore(String),
    Restore {
        hash: String,
        replace: bool,
    },
    Cleanup(u16),
    Move(Option<PathBuf>),
    PreviewMove(Option<PathBuf>),
    DavInfo,
    DavReveal(usize),
    DavSave {
        url: String,
        username: String,
        directory: String,
        password: Option<String>,
    },
    DavClear,
    DavTest {
        url: String,
        username: String,
        directory: String,
        password: Option<String>,
    },
    DavUpload {
        file: String,
        url: String,
        username: String,
        directory: String,
    },
    DavList,
    DavDownload(String),
    Schedule {
        backup: bool,
    },
    SaveBackupSchedule(backup_schedule::ScheduledBackupConfigInput),
    SaveExportSchedule(export_schedule::ScheduledExportConfigInput),
}

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct ExportPreferences {
    pub format: Option<String>,
    pub mode: Option<String>,
    pub fields: BTreeMap<String, Vec<String>>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DavAccount {
    pub url: String,
    pub username: String,
    pub remote_dir: String,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageInfo {
    pub install: PathBuf,
    pub install_bytes: u64,
    pub data: Option<PathBuf>,
    pub default: PathBuf,
    pub bytes: u64,
    pub pending: Option<PathBuf>,
    pub move_error: Option<String>,
    pub dav: Option<DavAccount>,
}
#[derive(Clone, Serialize, Deserialize)]
pub struct MovePreview {
    pub from: Option<PathBuf>,
    pub to: PathBuf,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RestorePreview {
    #[serde(flatten)]
    pub preview: backup::BackupPreview,
    pub file_path: PathBuf,
}
#[derive(Clone, Serialize, Deserialize)]
pub enum StorageReply {
    Done,
    ExportPreferences(Option<ExportPreferences>),
    Text(Option<String>),
    Info(StorageInfo),
    Move(MovePreview),
    ExportCount(u64),
    Converted(imports::DestructureReportDto),
    Csv(imports::ImportPreviewDto),
    Imported(imports::ImportCommitReportDto),
    Batches(Vec<imports::ImportBatchDto>),
    Deleted(imports::ImportDeleteReportDto),
    Backup(backup::BackupPreview),
    Restore(RestorePreview),
    DavConfig(dav::ConfigSnapshot),
    DavUpload(dav::RemoteBackupUploadResult),
    DavList(Vec<dav::RemoteBackupEntry>),
    BackupSchedule(Box<backup_schedule::ScheduledBackupSnapshot>),
    ExportSchedule(Box<export_schedule::ScheduledExportSnapshot>),
}
