use super::snapshot;
use crate::domain::backup::BackupError;
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

const MAX_BACKUP_FILE_BYTES: u64 = snapshot::MAX_DATABASE_BYTES + 2 * 1024 * 1024;

pub(super) fn prepare_snapshot_source(
    path: &str,
    expected_hash: Option<&str>,
) -> Result<PreparedBackupSource, BackupError> {
    if path.trim().is_empty() {
        return Err("backup path cannot be empty".to_string().into());
    }
    let source = prepare_backup_source(Path::new(path.trim()), expected_hash)?;
    if !snapshot::is_snapshot_archive(&source.path)? {
        return Err(BackupError::UnsupportedFormat);
    }
    Ok(source)
}

pub(super) struct PreparedBackupSource {
    work_dir: PathBuf,
    pub(super) path: PathBuf,
    pub(super) content_sha256: String,
}

impl Drop for PreparedBackupSource {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.work_dir);
    }
}

fn is_sha256(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

pub(super) fn prepare_backup_source(
    source_path: &Path,
    expected_content_sha256: Option<&str>,
) -> Result<PreparedBackupSource, String> {
    if expected_content_sha256.is_some_and(|expected| !is_sha256(expected)) {
        return Err("backup preview identity is invalid; preview the backup again".to_string());
    }

    let metadata = fs::metadata(source_path).map_err(|error| {
        format!(
            "failed to inspect backup file `{}`: {error}",
            source_path.display()
        )
    })?;
    if !metadata.is_file() || metadata.len() == 0 || metadata.len() > MAX_BACKUP_FILE_BYTES {
        return Err("backup file size is invalid".to_string());
    }

    let work_dir =
        snapshot::create_private_work_dir(&std::env::temp_dir(), "patina-backup-source")?;
    let prepared_path = work_dir.join("backup.bin");
    let result = (|| {
        let source = File::open(source_path).map_err(|error| {
            format!(
                "failed to open backup file `{}`: {error}",
                source_path.display()
            )
        })?;
        let mut source = source.take(MAX_BACKUP_FILE_BYTES + 1);
        let mut prepared = File::create(&prepared_path)
            .map_err(|error| format!("failed to prepare backup file: {error}"))?;
        let copied = std::io::copy(&mut source, &mut prepared)
            .map_err(|error| format!("failed to prepare backup file: {error}"))?;
        if copied == 0 || copied > MAX_BACKUP_FILE_BYTES {
            return Err("backup file size is invalid".to_string());
        }
        prepared
            .flush()
            .and_then(|()| prepared.sync_all())
            .map_err(|error| format!("failed to flush prepared backup file: {error}"))?;
        let content_sha256 = snapshot::sha256_file(&prepared_path)?;
        if expected_content_sha256.is_some_and(|expected| expected != content_sha256) {
            return Err(
                "backup file changed after preview; preview the backup again before restoring"
                    .to_string(),
            );
        }
        Ok(PreparedBackupSource {
            work_dir: work_dir.clone(),
            path: prepared_path.clone(),
            content_sha256,
        })
    })();
    if result.is_err() {
        let _ = fs::remove_dir_all(&work_dir);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn changed_bytes_are_rejected_after_preview() {
        let work_dir =
            snapshot::create_private_work_dir(&std::env::temp_dir(), "patina-binding-test")
                .expect("create test directory");
        let source = work_dir.join("backup.zip");
        fs::write(&source, b"previewed bytes").expect("write previewed backup");
        let previewed = prepare_backup_source(&source, None).expect("prepare preview source");
        let expected = previewed.content_sha256.clone();
        drop(previewed);

        fs::write(&source, b"different restored bytes").expect("replace selected backup");
        let error = prepare_backup_source(&source, Some(&expected))
            .err()
            .expect("changed source must be rejected");

        assert!(error.contains("changed after preview"));
        fs::remove_dir_all(work_dir).expect("remove test directory");
    }
}
