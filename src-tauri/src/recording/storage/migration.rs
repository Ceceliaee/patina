use super::*;

const MARKER: &str = ".patina-migration-owner";

fn regular(path: &Path) -> Result<fs::Metadata, String> {
    let meta = fs::symlink_metadata(path).map_err(|e| e.to_string())?;
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if meta.file_attributes() & 0x400 != 0 {
            return Err("Migration does not follow directory junctions or links".into());
        }
    }
    if meta.file_type().is_symlink() {
        return Err("Migration does not follow links".into());
    }
    Ok(meta)
}

pub(super) fn destination(profile: &Path, selected: Option<&Path>) -> Result<PathBuf, String> {
    let Some(selected) = selected else {
        return Ok(profile.to_owned());
    };
    let root = selected.canonicalize().map_err(|e| e.to_string())?;
    if !regular(&root)?.is_dir() {
        return Err("Select a directory".into());
    }
    let target = if root
        .file_name()
        .is_some_and(|v| v.eq_ignore_ascii_case("Patina"))
    {
        root
    } else {
        root.join("Patina")
    };
    if target.exists() {
        regular(&target)?;
    }
    Ok(target)
}

fn copy_tree(source: &Path, target: &Path) -> Result<(), String> {
    for entry in fs::read_dir(source).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let metadata = regular(&entry.path())?;
        let dest = target.join(entry.file_name());
        if metadata.is_dir() {
            fs::create_dir(&dest).map_err(|e| e.to_string())?;
            copy_tree(&entry.path(), &dest)?;
        } else if metadata.is_file() {
            let mut input = fs::File::open(entry.path()).map_err(|e| e.to_string())?;
            let mut output = fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(dest)
                .map_err(|e| e.to_string())?;
            std::io::copy(&mut input, &mut output).map_err(|e| e.to_string())?;
            output.sync_all().map_err(|e| e.to_string())?;
        } else {
            return Err("Unsupported backup entry".into());
        }
    }
    Ok(())
}

fn marker(stage: &Path) -> String {
    stage
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .into_owned()
}
fn owned(stage: &Path, root: &Path) -> bool {
    stage.parent() == root.parent()
        && marker(stage).starts_with(".patina-backups-")
        && fs::read_to_string(root.join(MARKER)).ok().as_deref() == Some(marker(stage).as_str())
}

pub(super) fn publish_backups(
    profile: &Path,
    state: &mut Location,
    next: &Path,
) -> Result<(), String> {
    let target = next.join("backups");
    let stage = if let Some(stage) = &state.staged_backups {
        if stage.parent() != Some(next) || !marker(stage).starts_with(".patina-backups-") {
            return Err("Invalid backup migration state".into());
        }
        stage.clone()
    } else {
        if target.exists() {
            return Err("Destination already contains backups".into());
        }
        let temp = tempfile::Builder::new()
            .prefix(".patina-backups-")
            .tempdir_in(next)
            .map_err(|e| e.to_string())?;
        let source = state
            .backups
            .clone()
            .unwrap_or_else(|| profile.join("backups"));
        if source.exists() {
            regular(&source)?;
            copy_tree(&source, temp.path())?;
        }
        let stage = temp.path().to_owned();
        let mut proof = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(stage.join(MARKER))
            .map_err(|e| e.to_string())?;
        proof
            .write_all(marker(&stage).as_bytes())
            .and_then(|_| proof.sync_all())
            .map_err(|e| e.to_string())?;
        state.staged_backups = Some(stage.clone());
        publish(profile, state)?;
        let _ = temp.keep();
        stage
    };
    if target.exists() {
        if !owned(&stage, &target) {
            return Err("Backup destination changed during migration".into());
        }
    } else {
        if !owned(&stage, &stage) {
            return Err("Backup migration candidate is unavailable".into());
        }
        fs::rename(&stage, &target).map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub(super) fn rollback_backups(state: &mut Location, next: &Path) {
    if let Some(stage) = state
        .staged_backups
        .take()
        .filter(|p| p.parent() == Some(next))
    {
        for root in [&stage, &next.join("backups")] {
            if owned(&stage, root) && regular(root).is_ok() {
                let _ = fs::remove_dir_all(root);
            }
        }
    }
}

fn remove_copied(source: &Path, target: &Path) {
    let Ok(entries) = fs::read_dir(source) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(meta) = regular(&path) else {
            continue;
        };
        let dest = target.join(entry.file_name());
        if meta.is_dir() {
            remove_copied(&path, &dest);
            let _ = fs::remove_dir(&path);
        } else if meta.is_file() && same_file_contents(&path, &dest).unwrap_or(false) {
            let _ = fs::remove_file(path);
        }
    }
    let _ = fs::remove_dir(source);
}

fn same_file_contents(source: &Path, target: &Path) -> std::io::Result<bool> {
    use std::io::Read;
    let mut source = fs::File::open(source)?;
    let mut target = fs::File::open(target)?;
    let mut remaining = source.metadata()?.len();
    if remaining != target.metadata()?.len() {
        return Ok(false);
    }
    let mut a = [0u8; 64 * 1024];
    let mut b = [0u8; 64 * 1024];
    while remaining > 0 {
        let size = remaining.min(a.len() as u64) as usize;
        source.read_exact(&mut a[..size])?;
        target.read_exact(&mut b[..size])?;
        if a[..size] != b[..size] {
            return Ok(false);
        }
        remaining -= size as u64;
    }
    Ok(true)
}

pub(super) fn finish_backups(source: &Path, target: &Path, stage: Option<&Path>) {
    if stage.is_some_and(|stage| owned(stage, target)) {
        remove_copied(source, target);
        let _ = fs::remove_file(target.join(MARKER));
    }
}

pub(super) fn directory_size(root: &Path, excluded: &[&Path]) -> u64 {
    let Ok(entries) = fs::read_dir(root) else {
        return 0;
    };
    entries
        .flatten()
        .map(|entry| {
            let path = entry.path();
            if excluded.iter().any(|excluded| path == *excluded) {
                return 0;
            }
            let Ok(meta) = regular(&path) else {
                return 0;
            };
            if meta.is_dir() {
                directory_size(&path, excluded)
            } else if meta.is_file() {
                meta.len()
            } else {
                0
            }
        })
        .sum()
}
