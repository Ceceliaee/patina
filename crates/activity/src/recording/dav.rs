use super::index::*;
use crate::data::{backup, dav_config as config, repositories::remote_backup_settings as repo};
use crate::platform::{
    credentials::WebDavCredentialStore,
    webdav::{WebDavClient, WebDavConfig},
};
use sqlx::SqlitePool;
use std::path::{Path, PathBuf};

pub(crate) struct Dav {
    store: WebDavCredentialStore,
}
impl Dav {
    pub(crate) async fn reveal(&self, pool: &SqlitePool) -> Result<Option<String>, String> {
        let _guard = config::CONFIG_LOCK.lock().await;
        config::password(&self.store, &repo::load_state(pool).await?)
    }
    pub(crate) fn new(profile: &Path) -> Self {
        Self {
            store: WebDavCredentialStore::scoped(
                profile.join("webdav-credentials"),
                "Patina.GPUI.WebDAV".into(),
                vec![],
            ),
        }
    }
    pub(crate) async fn snapshot(
        &self,
        pool: &SqlitePool,
    ) -> Result<config::ConfigSnapshot, String> {
        let _lock = config::CONFIG_LOCK.lock().await;
        config::snapshot_in_pool(pool, &self.store).await
    }
    pub(crate) async fn save(
        &self,
        pool: &SqlitePool,
        input: config::SaveConfigInput,
    ) -> Result<config::ConfigSnapshot, String> {
        let _lock = config::CONFIG_LOCK.lock().await;
        config::save_in_pool(pool, &self.store, input).await
    }
    pub(crate) async fn clear(&self, pool: &SqlitePool) -> Result<config::ConfigSnapshot, String> {
        let _lock = config::CONFIG_LOCK.lock().await;
        config::clear_in_pool(pool, &self.store).await
    }
    pub(crate) async fn client(
        &self,
        pool: &SqlitePool,
    ) -> Result<(WebDavClient, WebDavConfig), String> {
        let _lock = config::CONFIG_LOCK.lock().await;
        let saved = repo::load_state(pool).await?;
        let password = config::password(&self.store, &saved)?.ok_or("credential_missing")?;
        let target = saved.config.ok_or("webdav_not_configured")?;
        Ok((WebDavClient::new(&target, password)?, target))
    }
    pub(crate) async fn test(
        &self,
        pool: &SqlitePool,
        url: &str,
        username: &str,
        directory: &str,
        password: Option<String>,
    ) -> Result<(), String> {
        let target = repo::normalize_config(url, username, directory)?;
        let client = match password {
            Some(password) => WebDavClient::new(&target, password)?,
            None => {
                let (client, saved) = self.client(pool).await?;
                if saved != target {
                    return Err("webdav_config_changed".into());
                };
                client
            }
        };
        client.ping(&target.remote_dir).await
    }
    pub(crate) async fn list(&self, pool: &SqlitePool) -> Result<Vec<RemoteBackupEntry>, String> {
        let (client, target) = self.client(pool).await?;
        let mut entries = load_index(&client, &target.remote_dir).await?.backups;
        entries.sort_by_key(|e| std::cmp::Reverse(e.created_at_ms));
        entries.truncate(MAX_BACKUP_LIST_ITEMS);
        Ok(entries)
    }
    pub(crate) async fn upload(
        &self,
        pool: &SqlitePool,
        file: String,
        url: &str,
        username: &str,
        directory: &str,
    ) -> Result<RemoteBackupUploadResult, String> {
        validate_upload_file_name(&file)?;
        let _transfer = REMOTE_TRANSFER_LOCK.lock().await;
        let (client, target) = self.client(pool).await?;
        if target != repo::normalize_config(url, username, directory)? {
            return Err("webdav_config_changed".into());
        }
        client.ensure_dir(&target.remote_dir).await?;
        let id = remote_backup_id();
        let tmp = tempfile::tempdir().map_err(|e| e.to_string())?;
        let path = tmp.path().join(remote_backup_file_name(&id));
        let preview =
            backup::write_snapshot_archive(pool, &path, env!("CARGO_PKG_VERSION")).await?;
        let size = path.metadata().map_err(|e| e.to_string())?.len();
        let remote = remote_path(&target.remote_dir, &file);
        client.upload_file_create_new(&path, &remote).await?;
        publish_manual(
            &client,
            &target.remote_dir,
            build_entry(id, file, remote, size, &preview),
        )
        .await
    }
    pub(crate) async fn download(
        &self,
        pool: &SqlitePool,
        id: &str,
        dir: &Path,
    ) -> Result<(PathBuf, crate::domain::backup::BackupPreview), String> {
        let _transfer = REMOTE_TRANSFER_LOCK.lock().await;
        let (client, target) = self.client(pool).await?;
        let entry = load_index(&client, &target.remote_dir)
            .await?
            .backups
            .into_iter()
            .find(|e| e.id == id)
            .ok_or("remote backup no longer listed")?;
        validate_backup_file_name(&entry.file_name)?;
        let path = dir.join("snapshot.zip");
        client
            .download_file(&remote_path(&target.remote_dir, &entry.file_name), &path)
            .await?;
        let preview = backup::preview(path.to_str().ok_or("invalid backup path")?).await?;
        if entry
            .archive_sha256
            .is_some_and(|hash| !hash.eq_ignore_ascii_case(&preview.hash))
        {
            return Err("remote backup checksum mismatch".into());
        }
        Ok((path, preview))
    }
}
