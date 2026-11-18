use super::desktop::{RecordingSignals, TrackingHost};
use crate::data::{
    backup, export, import, remote_backup::native::Dav, repositories::import_batches,
    user_data_maintenance as cleanup,
};
use patina_activity_model::views::storage::{
    DavAccount, MovePreview, RestorePreview, StorageInfo, StorageReply,
};
use serde_json::{json, Value};
use sqlx::SqlitePool;
use std::{
    path::{Path, PathBuf},
    sync::Arc,
};
use tokio::sync::Mutex;

pub use patina_activity_model::StorageRequest;
pub use patina_storage::location::prepare_database_for_startup;
use patina_storage::location::{
    directory_size_bytes, load_location, location_file_path, resolve_destination,
    restore_database_in_place,
};

pub(super) struct Storage {
    profile: PathBuf,
    database: PathBuf,
    dav: Dav,
    jobs: crate::data::storage_jobs::StorageJobs,
    operation: Mutex<bool>,
    install_bytes: tokio::sync::OnceCell<u64>,
    prepared: Mutex<Option<(String, PathBuf, Option<tempfile::TempDir>)>>,
}
impl Storage {
    pub(super) fn new(profile: &Path, database: &Path, pool: SqlitePool) -> Self {
        let root = profile.to_owned();
        let remote_pool = pool.clone();
        let snapshot_pool = pool.clone();
        let jobs = crate::data::storage_jobs::StorageJobs {
            pool,
            profile: profile.into(),
            legacy: profile.into(),
            database: database.into(),
            backups: load_location(profile)
                .ok()
                .and_then(|s| s.backups)
                .unwrap_or_else(|| profile.join("backups")),
            temp: database
                .parent()
                .unwrap_or(profile)
                .join("remote-backup-temp"),
            target: Box::new(move || {
                let dav = Dav::new(&root);
                let db = remote_pool.clone();
                Box::pin(async move {
                    let (client, config) = dav.client(&db).await?;
                    Ok(crate::data::remote_backup::ScheduledWebDavTarget { client, config })
                })
            }),
            snapshot: Box::new(move |path| {
                let db = snapshot_pool.clone();
                Box::pin(async move {
                    backup::write_snapshot_archive_create_new(
                        &db,
                        &[path],
                        env!("CARGO_PKG_VERSION"),
                    )
                    .await?;
                    Ok(())
                })
            }),
        };
        Self {
            profile: profile.into(),
            database: database.into(),
            dav: Dav::new(profile),
            jobs,
            operation: Default::default(),
            install_bytes: Default::default(),
            prepared: Default::default(),
        }
    }
    pub(super) async fn run_jobs(self: Arc<Self>) -> Result<(), String> {
        loop {
            {
                let stopped = self.operation.lock().await;
                if *stopped {
                    return Ok(());
                }
                if let Err(e) = crate::data::scheduled_backup::tick(&self.jobs).await {
                    eprintln!("scheduled backup: {e}");
                }
                if let Err(e) = crate::data::scheduled_export::tick(&self.jobs).await {
                    eprintln!("scheduled export: {e}");
                }
            }
            tokio::time::sleep(std::time::Duration::from_secs(60)).await;
        }
    }
    fn protect(&self, path: &Path) -> Result<(), String> {
        for reserved in ["webdav-credentials", "tools", "remote-backup-temp"] {
            if self.profile.join(reserved).exists()
                && crate::data::storage_path_safety::resolved_path_is_same_or_child(
                    path,
                    &self.profile.join(reserved),
                )?
            {
                return Err("Choose an output file outside Patina's managed storage".into());
            }
        }
        if path.exists()
            && same_file::is_same_file(path, &self.database).map_err(|e| e.to_string())?
        {
            return Err("Cannot overwrite active database".into());
        }
        if !path.is_absolute() {
            return Err("Choose an absolute output path".into());
        }
        for p in [
            self.database.clone(),
            self.database.with_extension("db-wal"),
            self.database.with_extension("db-shm"),
            self.database.with_extension("db-journal"),
            location_file_path(&self.profile),
            self.profile.join("instance.lock"),
        ] {
            if export::common::paths_refer_to_same_file(path, &p) {
                return Err("Cannot overwrite active Patina storage".into());
            }
        }
        Ok(())
    }
}
#[derive(Clone)]
pub struct StorageOperations {
    storage: Arc<Storage>,
    pool: SqlitePool,
    signals: RecordingSignals,
    runtime: tokio::runtime::Handle,
}

impl StorageOperations {
    pub fn new(
        profile: &Path,
        database: &Path,
        pool: SqlitePool,
        signals: RecordingSignals,
        runtime: tokio::runtime::Handle,
    ) -> Self {
        Self {
            storage: Arc::new(Storage::new(profile, database, pool.clone())),
            pool,
            signals,
            runtime,
        }
    }
    pub async fn request(
        &self,
        request: StorageRequest,
    ) -> Result<StorageReply, crate::ActivityError> {
        let storage = self.storage.clone();
        let pool = self.pool.clone();
        let host = self.signals.clone();
        self.runtime
            .spawn(async move { storage.execute(&pool, &host, request).await })
            .await
            .map_err(|error| crate::ActivityError::Rejected(error.to_string()))?
    }
    pub(super) async fn run_jobs(self) -> Result<(), String> {
        self.storage.run_jobs().await
    }
    pub(super) async fn stop(&self) {
        let mut stopped = self.storage.operation.lock().await;
        *stopped = true;
    }
}

impl Storage {
    async fn execute(
        &self,
        pool: &SqlitePool,
        host: &RecordingSignals,
        request: StorageRequest,
    ) -> Result<StorageReply, crate::ActivityError> {
        let stopped = self.operation.lock().await;
        if *stopped {
            return Err("storage has stopped".into());
        }
        let s = self;
        use StorageRequest::*;
        let value = match request {
            ExportPreferences(value) => {
                if let Some(value) = value {
                    sqlx::query("INSERT INTO settings(key,value) VALUES('__export_preferences',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
                        .bind(serde_json::to_string(&value).map_err(|e| e.to_string())?).execute(pool).await.map_err(|e| e.to_string())?;
                    StorageReply::Done
                } else {
                    StorageReply::ExportPreferences(
                        sqlx::query_scalar::<_, String>(
                            "SELECT value FROM settings WHERE key='__export_preferences'",
                        )
                        .fetch_optional(pool)
                        .await
                        .map_err(|e| e.to_string())?
                        .and_then(|v| serde_json::from_str(&v).ok()),
                    )
                }
            }
            ResumeAfterUpdate(page) => {
                if let Some(page) = page {
                    if ![
                        "Today",
                        "History",
                        "Data",
                        "Classification",
                        "Tools",
                        "Settings",
                        "About",
                        "",
                    ]
                    .contains(&page.as_str())
                    {
                        return Err("Invalid resume page".into());
                    }
                    sqlx::query("INSERT INTO settings(key,value) VALUES('__update_resume_page',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
                        .bind(page).execute(pool).await.map_err(|e| e.to_string())?;
                    StorageReply::Done
                } else {
                    let page = sqlx::query_scalar::<_, String>(
                        "DELETE FROM settings WHERE key='__update_resume_page' RETURNING value",
                    )
                    .fetch_optional(pool)
                    .await
                    .map_err(|e| e.to_string())?;
                    StorageReply::Text(page)
                }
            }
            Info => {
                let install = std::env::current_exe()
                    .map_err(|e| e.to_string())?
                    .parent()
                    .ok_or("no install directory")?
                    .to_owned();
                let bytes = [
                    s.database.clone(),
                    s.database.with_extension("db-wal"),
                    s.database.with_extension("db-shm"),
                ]
                .iter()
                .filter_map(|p| p.metadata().ok())
                .map(|m| m.len())
                .sum::<u64>();
                let location = load_location(&s.profile)?;
                let dav = crate::data::repositories::remote_backup_settings::load_config(pool)
                    .await?
                    .map(|config| DavAccount {
                        url: config.url,
                        username: config.username,
                        remote_dir: config.remote_dir,
                    });
                // Each resident executable belongs to one installed generation.
                let install_bytes = *s
                    .install_bytes
                    .get_or_try_init(|| async {
                        let directory = install.clone();
                        let profile = s.profile.clone();
                        let data = s.database.parent().unwrap_or(&profile).to_owned();
                        tokio::task::spawn_blocking(move || {
                            directory_size_bytes(&directory, &[&data, &profile])
                        })
                        .await
                        .map_err(|e| e.to_string())
                    })
                    .await?;
                StorageReply::Info(StorageInfo {
                    install,
                    install_bytes,
                    data: s.database.parent().map(Path::to_owned),
                    default: s.profile.clone(),
                    bytes,
                    pending: location.pending,
                    move_error: location.move_error,
                    dav,
                })
            }
            PreviewMove(directory) => {
                let target = resolve_destination(&s.profile, directory.as_deref())?;
                StorageReply::Move(MovePreview {
                    from: s.database.parent().map(Path::to_owned),
                    to: target,
                })
            }
            Move(directory) => {
                patina_storage::location::schedule_storage_move(&s.profile, directory.as_deref())?;
                StorageReply::Done
            }
            Export(r) => {
                let path = Path::new(&r.output_path);
                s.protect(path)?;
                let tmp = tempfile::NamedTempFile::new_in(
                    path.parent().ok_or("invalid output directory")?,
                )
                .map_err(|e| e.to_string())?
                .into_temp_path();
                let count = export::write::write_export(
                    pool,
                    &s.database,
                    export::write::ExportDataRequest {
                        output_path: tmp.to_string_lossy().into_owned(),
                        ..r.clone()
                    },
                )
                .await?;
                tmp.persist(path).map_err(|e| e.to_string())?;
                StorageReply::ExportCount(count)
            }
            Convert(path) => {
                StorageReply::Converted(import::destructure::destructure_external_file(path).await?)
            }
            PreviewCsv(path) => {
                StorageReply::Csv(import::preview::preview_in_pool(pool, path).await?)
            }
            Import { path, fingerprint } => {
                let mut parsed =
                    import::prepared::prepare_canonical_import(path, fingerprint, vec![]).await?;
                let _lock = host.projection().transition.lock().await;
                let candidates =
                    import::preview::collect_category_candidates(&parsed.parsed.records);
                parsed.classification_mutations = import_categories(pool, candidates).await?;
                let report = import::prepared::commit_in_pool(pool, parsed).await?;
                host.titles().invalidate_app_overrides();
                host.projection().note_tracking_policy_change();
                host.notify();
                StorageReply::Imported(report)
            }
            Batches => StorageReply::Batches(import_batches::list(pool).await?),
            DeleteBatch(id) => {
                let report = import_batches::delete(pool, &id).await?;
                host.notify();
                StorageReply::Deleted(report)
            }
            Backup(path) => {
                s.protect(&path)?;
                StorageReply::Backup(
                    backup::write_snapshot_archive(pool, &path, env!("CARGO_PKG_VERSION")).await?,
                )
            }
            PreviewRestore(path) => {
                let p = backup::preview(&path).await?;
                let file_path = PathBuf::from(&path);
                *s.prepared.lock().await = Some((p.hash.clone(), path.into(), None));
                StorageReply::Restore(RestorePreview {
                    preview: p,
                    file_path,
                })
            }
            Restore { hash, replace } => {
                let mut selected = s.prepared.lock().await;
                let (expected, path, _temp) =
                    selected.as_ref().ok_or("Preview the backup first")?;
                if expected != &hash {
                    return Err(crate::ActivityError::Conflict(
                        "Backup preview expired".into(),
                    ));
                }
                let source = backup::prepare_snapshot_source(
                    path.to_str().ok_or("Invalid path")?,
                    Some(&hash),
                )
                .map_err(|e| e.to_string())?;
                let cand = backup::prepare_snapshot_backup(
                    &source.path,
                    if replace {
                        backup::RestoreStrategy::Replace
                    } else {
                        backup::RestoreStrategy::Merge
                    },
                )
                .await?;
                let _lock = host.projection().transition.lock().await;
                let src = crate::data::sqlite_pool::open_single_connection_sqlite_pool(
                    &cand.db_path,
                    false,
                )
                .await?;
                if replace {
                    restore_database_in_place(pool, &src).await?;
                    src.close().await;
                } else {
                    backup::merge_snapshot_backup(src, pool).await?;
                }
                host.titles().invalidate_app_overrides();
                host.projection().note_tracking_policy_change();
                host.notify();
                selected.take();
                StorageReply::Done
            }
            Cleanup(days) => {
                if ![7, 15, 30, 60, 90, 180].contains(&days) {
                    return Err("Invalid cleanup range".into());
                }
                let _lock = host.projection().transition.lock().await;
                let cutoff = crate::platform::clock::unix_timestamp_millis_i64()
                    - i64::from(days) * 86_400_000;
                cleanup::delete_sessions_before_in_pool(pool, cutoff)
                    .await
                    .map_err(|e| e.to_string())?;
                host.notify();
                StorageReply::Done
            }
            DavInfo => StorageReply::DavConfig(s.dav.snapshot(pool).await?),
            DavReveal(_) => StorageReply::Text(s.dav.reveal(pool).await?),
            DavClear => StorageReply::DavConfig(s.dav.clear(pool).await?),
            DavSave {
                url,
                username,
                directory,
                password,
            } => {
                use crate::data::dav_config::{PasswordUpdate, SaveConfigInput};
                StorageReply::DavConfig(
                    s.dav
                        .save(
                            pool,
                            SaveConfigInput {
                                url,
                                username,
                                remote_dir: Some(directory),
                                operation_id: uuid::Uuid::new_v4().to_string(),
                                password_update: password
                                    .map_or(PasswordUpdate::Keep, |password| {
                                        PasswordUpdate::Replace { password }
                                    }),
                            },
                        )
                        .await?,
                )
            }
            DavTest {
                url,
                username,
                directory,
                password,
            } => {
                s.dav
                    .test(pool, &url, &username, &directory, password)
                    .await?;
                StorageReply::Done
            }
            DavUpload {
                file,
                url,
                username,
                directory,
            } => StorageReply::DavUpload(
                s.dav
                    .upload(pool, file, &url, &username, &directory)
                    .await?,
            ),
            DavList => StorageReply::DavList(s.dav.list(pool).await?),
            DavDownload(id) => {
                let tmp = tempfile::tempdir().map_err(|e| e.to_string())?;
                let (path, p) = s.dav.download(pool, &id, tmp.path()).await?;
                let file_path = PathBuf::from(&path);
                *s.prepared.lock().await = Some((p.hash.clone(), path, Some(tmp)));
                StorageReply::Restore(RestorePreview {
                    preview: p,
                    file_path,
                })
            }
            Schedule { backup: true } => StorageReply::BackupSchedule(Box::new(
                crate::data::scheduled_backup::get_snapshot(&s.jobs).await?,
            )),
            Schedule { backup: false } => StorageReply::ExportSchedule(Box::new(
                crate::data::scheduled_export::get_snapshot(&s.jobs).await?,
            )),
            SaveBackupSchedule(input) => StorageReply::BackupSchedule(Box::new(
                crate::data::scheduled_backup::save_config(&s.jobs, input).await?,
            )),
            SaveExportSchedule(input) => StorageReply::ExportSchedule(Box::new(
                crate::data::scheduled_export::save_config(&s.jobs, input).await?,
            )),
        };
        Ok(value)
    }
}

async fn import_categories(
    pool: &SqlitePool,
    candidates: Vec<import::model::ImportCategoryCandidateDto>,
) -> Result<
    Vec<crate::data::repositories::classification_settings::ClassificationSettingMutation>,
    String,
> {
    use crate::data::repositories::classification_settings::{
        load_classification_snapshot, ClassificationSettingMutation as Change,
    };
    let catalog = load_classification_snapshot(pool)
        .await
        .map_err(|e| e.to_string())?;
    let mut labels = std::collections::HashMap::new();
    for c in catalog.available_categories() {
        labels.insert(c.label.to_lowercase(), c.id.clone());
        labels.insert(c.id.to_lowercase(), c.id);
    }
    for (label, id) in [
        ("开发", "development"),
        ("开发编码", "development"),
        ("dev", "development"),
        ("办公", "office"),
        ("浏览器", "browser"),
        ("通讯", "communication"),
        ("chat", "communication"),
        ("视频", "video"),
        ("音乐", "music"),
        ("游戏", "game"),
        ("设计", "design"),
        ("工具", "utility"),
        ("tools", "utility"),
        ("未分类", "other"),
        ("其他", "other"),
    ] {
        if catalog.resolve_category_by_id(id).is_some() {
            labels.entry(label.to_owned()).or_insert_with(|| id.into());
        }
    }
    let mut changes = vec![];
    let now = crate::platform::clock::unix_timestamp_millis_i64();
    for entry in candidates {
        let Some(exe) = crate::domain::tracking::resolve_app_override_executable(&entry.exe_name)
        else {
            continue;
        };
        let mut ids = vec![];
        for name in entry.categories {
            let id = labels.entry(name.to_lowercase()).or_insert_with(|| {
                let id = format!("custom:category_{}", uuid::Uuid::new_v4().simple());
                changes.push(Change {
                    key: format!("__custom_category::{id}"),
                    value: Some(now.to_string()),
                });
                changes.push(Change {
                    key: format!("__category_label_override::{id}"),
                    value: Some(name),
                });
                id
            });
            ids.push(id.clone());
        }
        if let [id] = ids.as_slice() {
            if id == "other" {
                continue;
            }
            let key = format!("__app_override::{}", catalog.app_owner(&exe));
            let current: Option<String> =
                sqlx::query_scalar("SELECT value FROM settings WHERE key=?")
                    .bind(&key)
                    .fetch_optional(pool)
                    .await
                    .map_err(|e| e.to_string())?;
            let mut value: Value = match current {
                Some(raw) => serde_json::from_str(&raw).map_err(|e| e.to_string())?,
                None => json!({}),
            };
            if value.is_object() && value["category"].as_str().is_none_or(str::is_empty) {
                value["category"] = json!(id);
                value["updatedAt"] = json!(now);
                changes.push(Change {
                    key,
                    value: Some(value.to_string()),
                });
            }
        }
    }
    Ok(changes)
}
