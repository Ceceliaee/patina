use super::{Recorder, TrackingHost};
use crate::data::{
    backup, export, import, remote_backup::native::Dav, repositories::import_batches,
    user_data_maintenance as cleanup,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::{Connection, SqlitePool};
use std::{
    fs,
    future::Future,
    io::Write,
    path::{Path, PathBuf},
    sync::Arc,
};
use tokio::sync::Mutex;

#[derive(Serialize, Deserialize)]
pub enum StorageRequest {
    Info,
    Export(export::write::ExportDataRequest),
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
    SaveSchedule {
        backup: bool,
        input: Value,
    },
}
#[derive(Serialize, Deserialize)]
struct Location {
    active: PathBuf,
    pending: Option<PathBuf>,
    #[serde(default)]
    staged: Option<PathBuf>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    move_error: Option<String>,
}
fn control(profile: &Path) -> PathBuf {
    profile.join("database-location.json")
}
fn location(profile: &Path) -> Result<Location, String> {
    match fs::read(control(profile)) {
        Ok(b) => serde_json::from_slice(&b).map_err(|e| e.to_string()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Location {
            active: profile.to_owned(),
            pending: None,
            staged: None,
            move_error: None,
        }),
        Err(e) => Err(e.to_string()),
    }
}
fn publish(profile: &Path, state: &Location) -> Result<(), String> {
    let mut f = tempfile::NamedTempFile::new_in(profile).map_err(|e| e.to_string())?;
    serde_json::to_writer(f.as_file_mut(), state).map_err(|e| e.to_string())?;
    f.flush()
        .and_then(|_| f.as_file().sync_all())
        .map_err(|e| e.to_string())?;
    f.persist(control(profile)).map_err(|e| e.to_string())?;
    Ok(())
}
fn check_destination(root: &Path) -> Result<(), String> {
    if !root.is_absolute() || !root.is_dir() {
        return Err("Select an existing absolute directory".into());
    }
    for name in [
        "patina.db",
        "patina.db-wal",
        "patina.db-shm",
        "patina.db-journal",
    ] {
        if fs::symlink_metadata(root.join(name)).is_ok() {
            return Err("The destination already contains a Patina database".into());
        }
    }
    Ok(())
}
fn is_migration_stage(path: &Path, destination: &Path) -> bool {
    path.parent() == Some(destination)
        && path
            .file_name()
            .and_then(|n| n.to_str())
            .is_some_and(|n| n.starts_with(".patina-move-"))
}
fn publish_candidate(
    profile: &Path,
    state: &mut Location,
    old: &Path,
    next: &Path,
    destination: &Path,
) -> Result<PathBuf, String> {
    // A hard link makes publication exclusive. The staged link identifies our
    // candidate after an interruption between publication and pointer commit.
    let stage = if let Some(staged) = &state.staged {
        if !is_migration_stage(staged, next) {
            return Err("Invalid migration state".into());
        }
        staged.clone()
    } else {
        check_destination(next)?;
        let temp = tempfile::Builder::new()
            .prefix(".patina-move-")
            .tempfile_in(next)
            .map_err(|e| e.to_string())?
            .into_temp_path();
        let stage = temp.to_path_buf();
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .map_err(|e| e.to_string())?;
        rt.block_on(async {
            let mut db = sqlx::SqliteConnection::connect_with(
                &sqlx::sqlite::SqliteConnectOptions::new()
                    .filename(old)
                    .read_only(true),
            )
            .await
            .map_err(|e| e.to_string())?;
            sqlx::query("VACUUM INTO ?")
                .bind(stage.to_string_lossy().as_ref())
                .execute(&mut db)
                .await
                .map_err(|e| e.to_string())?;
            db.close().await.map_err(|e| e.to_string())?;
            let mut candidate = sqlx::SqliteConnection::connect_with(
                &sqlx::sqlite::SqliteConnectOptions::new()
                    .filename(&stage)
                    .read_only(true),
            )
            .await
            .map_err(|e| e.to_string())?;
            let check: String = sqlx::query_scalar("PRAGMA integrity_check")
                .fetch_one(&mut candidate)
                .await
                .map_err(|e| e.to_string())?;
            if check != "ok" {
                return Err("Migrated database failed integrity check".to_string());
            }
            candidate.close().await.map_err(|e| e.to_string())
        })?;
        fs::OpenOptions::new()
            .write(true)
            .open(&stage)
            .and_then(|f| f.sync_all())
            .map_err(|e| format!("flush migration candidate: {e}"))?;
        state.staged = Some(stage.clone());
        state.pending = Some(next.to_owned());
        publish(profile, state)?;
        temp.keep().map_err(|e| e.to_string())?;
        stage
    };
    if destination.exists() {
        if !same_file::is_same_file(&stage, destination).map_err(|e| e.to_string())? {
            return Err("Destination changed during migration".into());
        }
    } else {
        fs::hard_link(&stage, destination).map_err(|e| e.to_string())?;
    }
    Ok(stage)
}
pub fn database_for_profile(profile: &Path) -> Result<PathBuf, String> {
    let mut state = location(profile)?;
    let old = state.active.join("patina.db");
    if control(profile).exists() && (!old.is_file() || !state.active.is_absolute()) {
        return Err("Configured database is unavailable".into());
    }
    if let Some(next) = state.pending.take() {
        let destination = next.join("patina.db");
        let stage = match publish_candidate(profile, &mut state, &old, &next, &destination) {
            Ok(stage) => stage,
            Err(error) => {
                state.pending = None;
                let stage = state.staged.take();
                state.move_error = Some(error);
                publish(profile, &state)?;
                if let Some(stage) = stage.filter(|p| is_migration_stage(p, &next)) {
                    let _ = fs::remove_file(stage);
                }
                return Ok(old);
            }
        };
        state.pending = None;
        state.staged = None;
        state.move_error = None;
        state.active = next;
        publish(profile, &state)?;
        // Only remove the previous DB after the location pointer is durable.
        // Leave a closed source in place if Windows refuses to delete it.
        let _ = fs::remove_file(stage);
        let _ = fs::remove_file(&old);
        return Ok(destination);
    }
    Ok(old)
}

pub(super) struct Storage {
    profile: PathBuf,
    database: PathBuf,
    dav: Dav,
    jobs: crate::data::storage_jobs::StorageJobs,
    operation: Mutex<()>,
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
            backups: profile.join("backups"),
            temp: profile.join("remote-backup-temp"),
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
            prepared: Default::default(),
        }
    }
    pub(super) async fn run_jobs(self: Arc<Self>) -> Result<(), String> {
        loop {
            {
                let _op = self.operation.lock().await;
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
            control(&self.profile),
            self.profile.join("instance.lock"),
        ] {
            if export::common::paths_refer_to_same_file(path, &p) {
                return Err("Cannot overwrite active Patina storage".into());
            }
        }
        Ok(())
    }
}
impl Recorder {
    pub fn storage(
        &self,
        request: StorageRequest,
    ) -> impl Future<Output = Result<Value, String>> + 'static {
        let storage = Arc::clone(&self.storage);
        let pool = self.pool.clone();
        let host = self.host.clone();
        let task = self
            .runtime
            .spawn(async move { storage.execute(&pool, &host, request).await });
        async move { task.await.map_err(|e| e.to_string())? }
    }
}

impl Storage {
    async fn execute(
        &self,
        pool: &SqlitePool,
        host: &super::Host,
        request: StorageRequest,
    ) -> Result<Value, String> {
        let _op = self.operation.lock().await;
        let s = self;
        use StorageRequest::*;
        let value = match request {
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
                let location = location(&s.profile)?;
                let dav = crate::data::repositories::remote_backup_settings::load_config(pool).await?
                    .map(|config| json!({"url":config.url,"username":config.username,"remoteDir":config.remote_dir}));
                json!({"install":install,"data":s.database.parent(),"default":s.profile,"bytes":bytes,"pending":location.pending,"moveError":location.move_error,"dav":dav})
            }
            Move(directory) => {
                let dest = directory
                    .unwrap_or_else(|| s.profile.clone())
                    .canonicalize()
                    .map_err(|e| e.to_string())?;
                let mut state = location(&s.profile)?;
                if state.active != dest {
                    check_destination(&dest)?;
                }
                state.pending = (state.active != dest).then_some(dest);
                state.move_error = None;
                publish(&s.profile, &state)?;
                Value::Null
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
                json!(count)
            }
            Convert(path) => json!(import::destructure::destructure_external_file(path).await?),
            PreviewCsv(path) => json!(import::preview::preview_in_pool(pool, path).await?),
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
                (host.0.changed)();
                json!(report)
            }
            Batches => json!(import_batches::list(pool).await?),
            DeleteBatch(id) => {
                let report = import_batches::delete(pool, &id).await?;
                (host.0.changed)();
                json!(report)
            }
            Backup(path) => {
                s.protect(&path)?;
                json!(backup::write_snapshot_archive(pool, &path, env!("CARGO_PKG_VERSION")).await?)
            }
            PreviewRestore(path) => {
                let p = backup::preview(&path).await?;
                *s.prepared.lock().await = Some((p.hash.clone(), path.into(), None));
                json!(p)
            }
            Restore { hash, replace } => {
                let mut selected = s.prepared.lock().await;
                let (expected, path, _temp) =
                    selected.as_ref().ok_or("Preview the backup first")?;
                if expected != &hash {
                    return Err("Backup preview expired".into());
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
                    replace_online(pool, &src).await?;
                    src.close().await;
                } else {
                    backup::merge_snapshot_backup(src, pool).await?;
                }
                host.titles().invalidate_app_overrides();
                host.projection().note_tracking_policy_change();
                (host.0.changed)();
                selected.take();
                Value::Null
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
                (host.0.changed)();
                Value::Null
            }
            DavInfo => json!(s.dav.snapshot(pool).await?),
            DavReveal(_) => json!(s.dav.reveal(pool).await?),
            DavClear => json!(s.dav.clear(pool).await?),
            DavSave {
                url,
                username,
                directory,
                password,
            } => {
                use crate::data::dav_config::{PasswordUpdate, SaveConfigInput};
                json!(
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
                                    })
                            }
                        )
                        .await?
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
                Value::Null
            }
            DavUpload {
                file,
                url,
                username,
                directory,
            } => json!(
                s.dav
                    .upload(pool, file, &url, &username, &directory)
                    .await?
            ),
            DavList => json!(s.dav.list(pool).await?),
            DavDownload(id) => {
                let tmp = tempfile::tempdir().map_err(|e| e.to_string())?;
                let (path, p) = s.dav.download(pool, &id, tmp.path()).await?;
                *s.prepared.lock().await = Some((p.hash.clone(), path, Some(tmp)));
                json!(p)
            }
            Schedule { backup: true } => {
                json!(crate::data::scheduled_backup::get_snapshot(&s.jobs).await?)
            }
            Schedule { backup: false } => {
                json!(crate::data::scheduled_export::get_snapshot(&s.jobs).await?)
            }
            SaveSchedule {
                backup: true,
                input,
            } => json!(
                crate::data::scheduled_backup::save_config(
                    &s.jobs,
                    serde_json::from_value(input).map_err(|e| e.to_string())?
                )
                .await?
            ),
            SaveSchedule {
                backup: false,
                input,
            } => json!(
                crate::data::scheduled_export::save_config(
                    &s.jobs,
                    serde_json::from_value(input).map_err(|e| e.to_string())?
                )
                .await?
            ),
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

async fn replace_online(target: &SqlitePool, source: &SqlitePool) -> Result<(), String> {
    let mut target = target.acquire().await.map_err(|e| e.to_string())?;
    let mut source = source.acquire().await.map_err(|e| e.to_string())?;
    let mut dst = target.lock_handle().await.map_err(|e| e.to_string())?;
    let mut src = source.lock_handle().await.map_err(|e| e.to_string())?;
    // The online-backup API commits the replacement in one SQLite transaction.
    // Both SQLx handles stay locked until finish releases the backup object.
    unsafe {
        use libsqlite3_sys::*;
        let copy = sqlite3_backup_init(
            dst.as_raw_handle().as_ptr(),
            c"main".as_ptr(),
            src.as_raw_handle().as_ptr(),
            c"main".as_ptr(),
        );
        if copy.is_null() {
            return Err("Could not begin database replacement".into());
        }
        let step = sqlite3_backup_step(copy, -1);
        let finish = sqlite3_backup_finish(copy);
        if step != SQLITE_DONE || finish != SQLITE_OK {
            return Err(format!("Database replacement failed ({step}, {finish})"));
        }
    }
    Ok(())
}
