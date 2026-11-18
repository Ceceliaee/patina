use super::index::*;
use crate::data::{backup, repositories::remote_backup_settings};
use crate::domain::backup_schedule::ScheduledBackupRun;
use crate::platform::webdav::{WebDavClient, WebDavConfig};
use std::{cmp::Reverse, path::Path};
pub(crate) struct ScheduledWebDavTarget {
    pub config: WebDavConfig,
    pub client: WebDavClient,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ScheduledRemotePruneOutcome {
    Pruned,
    Missing,
    Conflict,
}

#[derive(Debug)]
pub(crate) struct ScheduledRemoteUploadOutcome {
    pub etag: Option<String>,
    pub created_new: bool,
}

pub(crate) async fn lock_remote_transfer() -> tokio::sync::MutexGuard<'static, ()> {
    REMOTE_TRANSFER_LOCK.lock().await
}

pub(crate) fn scheduled_target_identity(target: &ScheduledWebDavTarget) -> String {
    remote_backup_settings::target_identity(&target.config)
}

pub(crate) fn scheduled_remote_backup_paths(
    target: &ScheduledWebDavTarget,
    run: &ScheduledBackupRun,
) -> Vec<String> {
    let hours = run.logical_time_minutes / 60;
    let minutes = run.logical_time_minutes % 60;
    let timestamp = format!(
        "{}-{hours:02}{minutes:02}00",
        run.logical_date.replace('-', "")
    );
    (1..=MAX_REMOTE_NAME_CANDIDATES)
        .map(|candidate| {
            let suffix = if candidate == 1 {
                String::new()
            } else {
                format!("-{candidate:02}")
            };
            remote_path(
                &target.config.remote_dir,
                &format!("Patina-scheduled-backup-{timestamp}{suffix}.zip"),
            )
        })
        .collect()
}

pub(crate) fn scheduled_remote_backup_id(run: &ScheduledBackupRun) -> String {
    let hours = run.logical_time_minutes / 60;
    let minutes = run.logical_time_minutes % 60;
    let date = run.logical_date.replace('-', "");
    let generation = run.target_generation.chars().take(8).collect::<String>();
    format!(
        "scheduled-{date}-{hours:02}{minutes:02}-{generation}-a{}",
        run.attempt_count
    )
}

pub(crate) async fn upload_scheduled_snapshot(
    target: &ScheduledWebDavTarget,
    local_path: &Path,
    remote_path: &str,
    expected_size: u64,
    allow_existing: bool,
) -> Result<ScheduledRemoteUploadOutcome, crate::ActivityError> {
    target.client.ensure_dir(&target.config.remote_dir).await?;
    if let Some(metadata) = target.client.object_metadata(remote_path).await? {
        if !allow_existing {
            return Err(crate::ActivityError::Conflict(
                "remote_name_conflict".into(),
            ));
        }
        if metadata
            .size_bytes
            .is_some_and(|size| size != expected_size)
        {
            return Err(crate::ActivityError::Conflict(
                "remote_name_conflict".into(),
            ));
        }
        return Ok(ScheduledRemoteUploadOutcome {
            etag: metadata.etag,
            created_new: false,
        });
    }
    target
        .client
        .upload_file_create_new(local_path, remote_path)
        .await?;
    let metadata = target
        .client
        .object_metadata(remote_path)
        .await?
        .ok_or_else(|| "uploaded WebDAV backup is not observable".to_string())?;
    if metadata
        .size_bytes
        .is_some_and(|size| size != expected_size)
    {
        return Err("remote_validation_failed".into());
    }
    Ok(ScheduledRemoteUploadOutcome {
        etag: metadata.etag,
        created_new: true,
    })
}

pub(crate) async fn verify_scheduled_snapshot(
    target: &ScheduledWebDavTarget,
    remote_path: &str,
    verification_path: &Path,
    expected_hash: &str,
    expected_size: u64,
) -> Result<(), String> {
    let verification_dir = verification_path
        .parent()
        .map(Path::to_path_buf)
        .ok_or_else(|| "scheduled verification path has no parent".to_string())?;
    let result = async {
        target
            .client
            .download_file(remote_path, verification_path)
            .await?;
        let (actual_hash, actual_size) =
            backup::validate_scheduled_snapshot(verification_path).await?;
        if actual_hash != expected_hash || actual_size != expected_size {
            return Err("remote_validation_failed".to_string());
        }
        Ok(())
    }
    .await;
    let _ = remove_temp_backup_file(verification_path, &verification_dir);
    result
}

pub(crate) async fn discard_failed_scheduled_snapshot(
    target: &ScheduledWebDavTarget,
    run: &ScheduledBackupRun,
) -> Result<bool, String> {
    if run.target_kind != "webdav" || run.target_path == "pending://webdav" {
        return Ok(false);
    }
    let file_name = Path::new(&run.target_path)
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "failed scheduled WebDAV path has no safe file name".to_string())?;
    validate_backup_file_name(file_name)?;
    if run.target_path != remote_path(&target.config.remote_dir, file_name) {
        return Err(
            "refusing to discard a failed backup outside the configured directory".to_string(),
        );
    }
    let Some(metadata) = target.client.object_metadata(&run.target_path).await? else {
        return Ok(false);
    };
    let recorded_etag = run.remote_etag.as_deref().ok_or_else(|| {
        "refusing to discard a failed backup without a recorded remote identity".to_string()
    })?;
    if metadata.etag.as_deref() != Some(recorded_etag) {
        return Err(
            "refusing to discard a failed backup whose remote identity changed".to_string(),
        );
    }
    target
        .client
        .delete_file(&run.target_path, Some(recorded_etag))
        .await
}

pub(crate) async fn publish_scheduled_snapshot(
    target: &ScheduledWebDavTarget,
    run: &ScheduledBackupRun,
    staging_path: &Path,
) -> Result<RemoteBackupEntry, String> {
    let preview = backup::preview_backup(staging_path.to_string_lossy().to_string())
        .await
        .map_err(|error| error.to_string())?;
    let hash = run
        .archive_sha256
        .clone()
        .ok_or_else(|| "scheduled backup is missing its verified checksum".to_string())?;
    let size = run
        .size_bytes
        .ok_or_else(|| "scheduled backup is missing its verified size".to_string())?;
    let trusted_remote_path = run.target_path.clone();
    let file_name = Path::new(&trusted_remote_path)
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "scheduled WebDAV path has no safe file name".to_string())?
        .to_string();
    validate_backup_file_name(&file_name)?;
    if trusted_remote_path != remote_path(&target.config.remote_dir, &file_name) {
        return Err("scheduled WebDAV path is outside the configured directory".to_string());
    }
    let mut entry = build_entry(
        scheduled_remote_backup_id(run),
        file_name,
        trusted_remote_path,
        size,
        &preview,
    );
    entry.origin = "scheduled".to_string();
    entry.target_generation = Some(run.target_generation.clone());
    entry.run_key = Some(run.run_key.clone());
    entry.archive_sha256 = Some(hash);

    let _index_guard = REMOTE_INDEX_LOCK.lock().await;
    let entry_for_update = entry.clone();
    update_index(
        &target.client,
        &target.config.remote_dir,
        |index| {
            index.backups.retain(|item| item.id != entry_for_update.id);
            index.backups.insert(0, entry_for_update.clone());
            index
                .backups
                .sort_by_key(|item| Reverse(item.created_at_ms));
        },
        |index| index.backups.iter().any(|item| item == &entry_for_update),
    )
    .await?;
    Ok(entry)
}

pub(crate) fn scheduled_entry_matches_run(
    entry: &RemoteBackupEntry,
    run: &ScheduledBackupRun,
) -> bool {
    run.target_kind == "webdav"
        && run.status == "succeeded"
        && run.file_state == "present"
        && entry.origin == "scheduled"
        && entry.target_generation.as_deref() == Some(run.target_generation.as_str())
        && entry.run_key.as_deref() == Some(run.run_key.as_str())
        && entry.remote_path == run.target_path
        && entry.archive_sha256.as_deref() == run.archive_sha256.as_deref()
        && Some(entry.size_bytes) == run.size_bytes
}

pub(crate) async fn prune_scheduled_snapshot(
    target: &ScheduledWebDavTarget,
    run: &ScheduledBackupRun,
) -> Result<ScheduledRemotePruneOutcome, String> {
    if run.target_kind != "webdav" || run.status != "succeeded" || run.file_state != "present" {
        return Ok(ScheduledRemotePruneOutcome::Conflict);
    }
    let file_name = Path::new(&run.target_path)
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "scheduled WebDAV path has no safe file name".to_string())?;
    validate_backup_file_name(file_name)?;
    if run.target_path != remote_path(&target.config.remote_dir, file_name) {
        return Ok(ScheduledRemotePruneOutcome::Conflict);
    }

    let _index_guard = REMOTE_INDEX_LOCK.lock().await;
    let index = load_index(&target.client, &target.config.remote_dir).await?;
    let Some(entry) = index
        .backups
        .iter()
        .find(|entry| entry.run_key.as_deref() == Some(run.run_key.as_str()))
        .cloned()
    else {
        return Ok(ScheduledRemotePruneOutcome::Conflict);
    };
    if !scheduled_entry_matches_run(&entry, run) || index.has_other_reference(&entry) {
        return Ok(ScheduledRemotePruneOutcome::Conflict);
    }
    let metadata = target.client.object_metadata(&run.target_path).await?;
    if metadata
        .as_ref()
        .and_then(|value| value.size_bytes)
        .is_some_and(|size| Some(size) != run.size_bytes)
    {
        return Ok(ScheduledRemotePruneOutcome::Conflict);
    }
    let delete_etag = if let Some(metadata) = metadata.as_ref() {
        let Some(recorded_etag) = run.remote_etag.as_deref() else {
            return Ok(ScheduledRemotePruneOutcome::Conflict);
        };
        if metadata.etag.as_deref() != Some(recorded_etag) {
            return Ok(ScheduledRemotePruneOutcome::Conflict);
        }
        Some(recorded_etag)
    } else {
        None
    };

    let entry_id = entry.id.clone();
    update_index(
        &target.client,
        &target.config.remote_dir,
        |index| {
            if !index.has_other_reference(&entry) {
                index.backups.retain(|item| item != &entry);
            }
        },
        |index| {
            !index.has_other_reference(&entry)
                && index.backups.iter().all(|item| item.id != entry_id)
        },
    )
    .await?;

    let Some(delete_etag) = delete_etag else {
        return Ok(ScheduledRemotePruneOutcome::Missing);
    };
    match target
        .client
        .delete_file(&run.target_path, Some(delete_etag))
        .await
    {
        Ok(_) => Ok(ScheduledRemotePruneOutcome::Pruned),
        Err(error) => {
            let entry_for_restore = entry.clone();
            let _ = update_index(
                &target.client,
                &target.config.remote_dir,
                |index| {
                    if index
                        .backups
                        .iter()
                        .all(|item| item.id != entry_for_restore.id)
                    {
                        index.backups.push(entry_for_restore.clone());
                    }
                },
                |index| index.backups.iter().any(|item| item == &entry_for_restore),
            )
            .await;
            Err(error)
        }
    }
}
