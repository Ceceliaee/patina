use std::ffi::OsString;
use std::fs::{self, OpenOptions};
use std::io::{ErrorKind, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

static WRITE_PROBE_SEQUENCE: AtomicU64 = AtomicU64::new(0);

struct WriteProbeGuard {
    path: PathBuf,
    armed: bool,
}

impl WriteProbeGuard {
    fn new(path: PathBuf) -> Self {
        Self { path, armed: true }
    }

    fn disarm(&mut self) {
        self.armed = false;
    }
}

impl Drop for WriteProbeGuard {
    fn drop(&mut self) {
        if self.armed {
            let _ = fs::remove_file(&self.path);
        }
    }
}

pub(super) fn probe_directory_writable(directory: &Path, label: &str) -> Result<(), String> {
    for _ in 0..16 {
        let sequence = WRITE_PROBE_SEQUENCE.fetch_add(1, Ordering::Relaxed);
        let probe = directory.join(format!(
            ".patina-write-probe-{}-{sequence}",
            std::process::id()
        ));
        let mut file = match OpenOptions::new().write(true).create_new(true).open(&probe) {
            Ok(file) => file,
            Err(error) if error.kind() == ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(format!("{label} is not writable: {error}")),
        };
        let mut guard = WriteProbeGuard::new(probe.clone());
        file.write_all(b"ok")
            .and_then(|_| file.sync_all())
            .map_err(|error| format!("{label} is not writable: {error}"))?;
        drop(file);
        fs::remove_file(&probe)
            .map_err(|error| format!("failed to remove {label} write probe: {error}"))?;
        guard.disarm();
        return Ok(());
    }

    Err(format!(
        "failed to allocate a collision-safe write probe in {label}"
    ))
}

pub(super) fn same_path(left: &Path, right: &Path) -> bool {
    path_key(left) == path_key(right)
}

pub(super) fn ensure_destructive_paths_are_disjoint(
    source: &Path,
    target: &Path,
) -> Result<(), String> {
    if resolved_path_is_same_or_child(source, target)?
        || resolved_path_is_same_or_child(target, source)?
    {
        return Err(format!(
            "storage migration source `{}` and target `{}` resolve to overlapping locations; cleanup was refused",
            source.display(),
            target.display()
        ));
    }
    Ok(())
}

pub(super) fn resolved_paths_equal(left: &Path, right: &Path) -> Result<bool, String> {
    Ok(resolved_path_key(left)? == resolved_path_key(right)?)
}

pub(super) fn resolved_path_is_same_or_child(child: &Path, parent: &Path) -> Result<bool, String> {
    let child_key = resolved_path_key(child)?;
    let parent_key = resolved_path_key(parent)?;
    Ok(child_key == parent_key || child_key.starts_with(&format!("{parent_key}/")))
}

fn resolved_path_key(path: &Path) -> Result<String, String> {
    let normalized = normalize_path_lexically(path);
    let mut existing = normalized.as_path();
    let mut missing_tail: Vec<OsString> = Vec::new();

    while !existing.exists() {
        let Some(name) = existing.file_name() else {
            return Ok(path_key(&normalized));
        };
        missing_tail.push(name.to_os_string());
        let Some(parent) = existing.parent() else {
            return Ok(path_key(&normalized));
        };
        existing = parent;
    }

    let mut resolved = fs::canonicalize(existing).map_err(|error| {
        format!(
            "failed to resolve storage path identity for `{}`: {error}",
            path.display()
        )
    })?;
    for component in missing_tail.iter().rev() {
        resolved.push(component);
    }
    Ok(path_key(&normalize_path_lexically(&resolved)))
}

fn normalize_path_lexically(path: &Path) -> PathBuf {
    use std::path::Component;

    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Prefix(prefix) => normalized.push(prefix.as_os_str()),
            Component::RootDir => normalized.push(component.as_os_str()),
            Component::CurDir => {}
            Component::ParentDir => {
                if !normalized.pop() {
                    normalized.push(component.as_os_str());
                }
            }
            Component::Normal(value) => normalized.push(value),
        }
    }
    normalized
}

pub(super) fn path_key(path: &Path) -> String {
    let mut key = normalize_path_lexically(path)
        .to_string_lossy()
        .replace('\\', "/");
    if let Some(stripped) = key.strip_prefix("//?/") {
        key = stripped.to_string();
    }
    while key.len() > 1 && key.ends_with('/') {
        key.pop();
    }

    #[cfg(windows)]
    {
        key.to_lowercase()
    }

    #[cfg(not(windows))]
    {
        key
    }
}
