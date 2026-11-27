use sha2::{Digest, Sha256};
use std::{io, os::windows::ffi::OsStrExt, path::Path};
use winreg::{RegKey, enums::HKEY_CURRENT_USER};

/// Reserve two unused registry values for a temporary profile and remove them on drop.
pub struct TestLoginEntry {
    pub key: RegKey,
    pub approval: RegKey,
    pub name: String,
}

impl TestLoginEntry {
    pub fn profile_digest(profile: &Path) -> io::Result<String> {
        let path = profile.canonicalize()?.as_os_str().to_ascii_lowercase();
        let bytes: Vec<_> = path.encode_wide().flat_map(u16::to_le_bytes).collect();
        Ok(format!("{:x}", Sha256::digest(bytes)))
    }

    pub fn for_profile(profile: &Path) -> io::Result<Self> {
        Self::new(format!("Patina.{}", &Self::profile_digest(profile)?[..10]))
    }

    pub fn new(name: String) -> io::Result<Self> {
        let user = RegKey::predef(HKEY_CURRENT_USER);
        let (key, _) = user.create_subkey(r"Software\Microsoft\Windows\CurrentVersion\Run")?;
        let (approval, _) = user.create_subkey(
            r"Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run",
        )?;
        for registry in [&key, &approval] {
            match registry.get_raw_value(&name) {
                Err(e) if e.kind() == io::ErrorKind::NotFound => {}
                Err(e) => return Err(e),
                Ok(_) => return Err(io::Error::new(io::ErrorKind::AlreadyExists, name)),
            }
        }
        Ok(Self {
            key,
            approval,
            name,
        })
    }
}

impl Drop for TestLoginEntry {
    fn drop(&mut self) {
        let _ = self.key.delete_value(&self.name);
        let _ = self.approval.delete_value(&self.name);
    }
}
