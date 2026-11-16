use std::{env, ffi::OsString, io, path::Path};
use winreg::{
    RegKey,
    enums::{HKEY_CURRENT_USER, KEY_QUERY_VALUE, KEY_SET_VALUE},
};

const RUN: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";

pub(super) struct LoginEntry {
    name: String,
    command: OsString,
}

impl LoginEntry {
    pub(super) fn new(profile_id: &str, profile_parent: Option<&Path>) -> io::Result<Self> {
        let exe = env::current_exe()?;
        #[cfg(debug_assertions)]
        let exe = if env::var_os("PATINA_GPUI_DEV_SESSION").is_some()
            && let Some(built) = env::var_os("PATINA_GPUI_DEV_BINARY")
        {
            built.into()
        } else {
            exe
        };
        let mut command = OsString::from("\"");
        command.push(exe);
        command.push("\" --autostart");
        if let Some(parent) = profile_parent {
            command.push(" --profile-parent \"");
            // Appending "." also quotes drive roots without a trailing backslash.
            command.push(parent.join("."));
            command.push("\"");
        }
        Ok(Self {
            name: profile_id.into(),
            command,
        })
    }

    pub(super) fn apply(&self, enabled: bool) -> io::Result<()> {
        let user = RegKey::predef(HKEY_CURRENT_USER);
        if enabled {
            let (key, _) = user.create_subkey_with_flags(RUN, KEY_QUERY_VALUE | KEY_SET_VALUE)?;
            if key.get_value::<OsString, _>(&self.name).ok().as_ref() != Some(&self.command) {
                key.set_value(&self.name, &self.command)?;
            }
        } else {
            let deleted = user
                .open_subkey_with_flags(RUN, KEY_QUERY_VALUE)
                .and_then(|key| {
                    key.get_raw_value(&self.name)?;
                    user.open_subkey_with_flags(RUN, KEY_SET_VALUE)?
                        .delete_value(&self.name)
                });
            if let Err(error) = deleted
                && error.kind() != io::ErrorKind::NotFound
            {
                return Err(error);
            }
        }
        Ok(())
    }
}
