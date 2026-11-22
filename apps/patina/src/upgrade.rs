use serde::Deserialize;
use std::{
    error::Error,
    ffi::OsStr,
    fs, io,
    path::{Path, PathBuf},
};
use winreg::{
    RegKey,
    enums::{HKEY_CURRENT_USER, KEY_READ, KEY_WOW64_64KEY, REG_BINARY},
};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct StorageControl {
    format: String,
    profile: String,
    data_root: Option<PathBuf>,
    pending: Option<serde_json::Value>,
}

fn released_data_directory(roaming: &Path, key: &OsStr) -> Result<PathBuf, Box<dyn Error>> {
    let state = RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey_with_flags(key, KEY_READ | KEY_WOW64_64KEY)
        .and_then(|key| key.get_raw_value("State"));
    let (bytes, format) = match state {
        Ok(value) if value.vtype == REG_BINARY && value.bytes.len() <= 65536 => {
            (value.bytes.into_owned(), "patina.storage-control.v1")
        }
        Ok(_) => return Err("Invalid Patina storage registration".into()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            if roaming
                .join("storage-migration-pending.json")
                .try_exists()?
            {
                return Err("Finish the pending data move in Patina before updating".into());
            }
            match fs::read(roaming.join("data-anchor.json")) {
                Ok(bytes) => (bytes, "patina.data-anchor.v1"),
                Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(roaming.to_path_buf()),
                Err(e) => return Err(e.into()),
            }
        }
        Err(error) => return Err(error.into()),
    };
    let control: StorageControl = serde_json::from_slice(&bytes)?;
    if control.format != format
        || control.profile != "production"
        || (format == "patina.data-anchor.v1" && control.data_root.is_none())
    {
        return Err("Unknown Patina storage registration".into());
    }
    if control.pending.is_some() {
        return Err("Finish the pending data move in Patina before updating".into());
    }
    Ok(control.data_root.unwrap_or_else(|| roaming.to_owned()))
}

pub fn adopt_tauri_profile(
    parent: Option<&Path>,
    roaming: &Path,
    registry_key: &OsStr,
    login_enabled: bool,
) -> Result<(), Box<dyn Error>> {
    let source = released_data_directory(roaming, registry_key)?;
    let parent = parent
        .map(Path::to_owned)
        .or_else(super::profile_parent_from_env);
    let profile = super::profile_root(parent.as_deref())?;
    let _lock = super::lock_profile(&profile)?;
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()?
        .block_on(patina_activity::adopt_existing_database(
            &profile,
            &source,
            login_enabled,
        ))?;
    Ok(())
}
