use std::fs;
use std::path::Path;

pub(super) fn remove_path_if_exists(path: &Path) -> Result<(), String> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(format!("failed to inspect `{}`: {error}", path.display())),
    };

    if metadata.is_dir() {
        if is_reparse_or_symlink(&metadata) {
            fs::remove_dir(path)
        } else {
            fs::remove_dir_all(path)
        }
    } else {
        fs::remove_file(path)
    }
    .map_err(|error| format!("failed to remove `{}`: {error}", path.display()))
}

pub(super) fn remove_migration_path_if_safe(path: &Path) -> Result<(), String> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(format!("failed to inspect `{}`: {error}", path.display())),
    };
    if is_reparse_or_symlink(&metadata) {
        return Err(format!(
            "refusing to remove linked migration path `{}`",
            path.display()
        ));
    }
    if metadata.is_dir() {
        fs::remove_dir_all(path)
    } else {
        fs::remove_file(path)
    }
    .map_err(|error| format!("failed to remove `{}`: {error}", path.display()))
}

fn is_reparse_or_symlink(metadata: &fs::Metadata) -> bool {
    if metadata.file_type().is_symlink() {
        return true;
    }

    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x0400;
        metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
    }

    #[cfg(not(windows))]
    {
        false
    }
}
