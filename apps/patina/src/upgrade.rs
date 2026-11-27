use serde::Deserialize;
use sqlx::Connection;
use std::{
    error::Error,
    ffi::OsStr,
    fs, io,
    os::windows::fs::OpenOptionsExt,
    path::{Path, PathBuf},
};
use windows::Win32::Storage::FileSystem::FILE_FLAG_DELETE_ON_CLOSE;
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
    let profile = super::profile_root(parent.as_deref(), super::ProfileUse::TauriUpgrade)?;
    // A failed first adoption must not leave an instance.lock that redirects later launches.
    // On success database-location.json identifies the adopted profile.
    let _lock = match fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .share_mode(0)
        .custom_flags(FILE_FLAG_DELETE_ON_CLOSE.0)
        .open(profile.join("instance.lock"))
    {
        Err(e) if e.kind() == io::ErrorKind::AlreadyExists => super::lock_profile(&profile)?,
        result => result?,
    };
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

pub fn handoff_tauri_login(parent: Option<&Path>, previous: &str) -> Result<(), Box<dyn Error>> {
    let parent = parent
        .map(|p| p.components().collect::<PathBuf>())
        .or_else(super::profile_parent_from_env);
    let root = super::profile_root(parent.as_deref(), super::ProfileUse::Launch)?;
    let _lock = super::lock_profile(&root)?;
    let database =
        patina_activity::adopted_tauri_database(&root)?.ok_or("missing adopted profile")?;
    let setting: String = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()?
        .block_on(async {
            let mut conn = sqlx::SqliteConnection::connect_with(
                &sqlx::sqlite::SqliteConnectOptions::new()
                    .filename(database)
                    .read_only(true),
            )
            .await?;
            sqlx::query_scalar("SELECT value FROM settings WHERE key='launch_at_login'")
                .fetch_one(&mut conn)
                .await
        })?;
    let enabled = match setting.trim().to_ascii_lowercase().as_str() {
        "1" | "yes" | "true" | "on" => true,
        "0" | "no" | "false" | "off" => false,
        _ => return Err("unrecognized launch_at_login preference".into()),
    };
    let mut entry =
        super::login::LoginEntry::new(&super::profile_digest(&root), parent.as_deref())?;
    entry.previous.insert(0, (previous.to_owned(), true));
    entry.migrate_previous(enabled)?;
    Ok(())
}
