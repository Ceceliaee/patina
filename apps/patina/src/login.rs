use patina_desktop_protocol::LoginStatus;
use std::{
    env,
    ffi::{OsStr, OsString},
    io,
    path::{Path, PathBuf},
};
use winreg::{
    RegKey, RegValue,
    enums::{HKEY_CURRENT_USER, KEY_QUERY_VALUE, KEY_SET_VALUE, REG_BINARY, REG_SZ},
    types::FromRegValue,
};

const RUN: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
const APPROVAL: &str = r"Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run";

pub(super) struct LoginEntry {
    name: String,
    command: OsString,
    previous_command: OsString,
    exe: PathBuf,
    retired_command: Option<OsString>,
    pub(super) previous: Vec<(String, bool)>,
}

impl LoginEntry {
    pub(super) fn new(profile_digest: &str, profile_parent: Option<&Path>) -> io::Result<Self> {
        let exe = env::current_exe()?;
        #[cfg(debug_assertions)]
        let exe = if env::var_os("PATINA_DEV_SESSION").is_some()
            && let Some(built) = env::var_os("PATINA_DEV_BINARY")
        {
            built.into()
        } else {
            exe
        };
        let arguments = |compact: bool| {
            let Some(parent) = profile_parent else {
                return OsString::from("\" --autostart");
            };
            let mut args = OsString::from(if compact {
                "\" -a \""
            } else {
                "\" --autostart --profile-parent \""
            });
            args.push(parent);
            // A trailing backslash would escape the closing quote for a drive root.
            if parent.as_os_str().as_encoded_bytes().ends_with(b"\\") {
                args.push(".");
            }
            args.push("\"");
            args
        };
        let quoted = |file: &Path, compact: bool| {
            let mut command = OsString::from("\"");
            command.push(file);
            command.push(arguments(compact));
            command
        };
        let retired_command = (exe
            .file_name()
            .is_some_and(|name| name.eq_ignore_ascii_case("patina.exe"))
            && exe.with_file_name("patina-installation").is_file())
        .then(|| quoted(&exe.with_file_name("patina-gpui.exe"), false));
        Ok(Self {
            // Explorer can abandon the rest of Run when a single record is too large.
            name: format!("Patina.{}", &profile_digest[..10]),
            command: quoted(&exe, true),
            previous_command: quoted(&exe, false),
            exe,
            retired_command,
            previous: vec![(format!("{}.{profile_digest}", super::APP_ID), false)],
        })
    }

    pub(super) fn registered(&self) -> io::Result<bool> {
        match command(&self.name)? {
            None => Ok(false),
            Some(cmd) if cmd.eq_ignore_ascii_case(&self.command) => Ok(true),
            Some(_) => Err(io::Error::new(
                io::ErrorKind::AlreadyExists,
                "login entry belongs to a different command",
            )),
        }
    }

    fn owns_previous(&self, cmd: &OsStr, tauri: bool) -> bool {
        cmd.eq_ignore_ascii_case(&self.command)
            || cmd.eq_ignore_ascii_case(&self.previous_command)
            || self
                .retired_command
                .as_ref()
                .is_some_and(|old| cmd.eq_ignore_ascii_case(old))
            || (tauri
                && [
                    format!("\"{}\" --autostart", self.exe.display()),
                    format!("{} --autostart", self.exe.display()),
                    format!("\"{}\"", self.exe.display()),
                ]
                .iter()
                .any(|s| cmd.eq_ignore_ascii_case(OsStr::new(s))))
    }

    fn system_registration(
        &self,
        registered: bool,
    ) -> io::Result<(bool, Option<RegValue<'static>>)> {
        let mut present = registered;
        let mut disabled = approval(&self.name)?;
        for (name, tauri) in &self.previous {
            let source = command(name)?;
            let owned = source
                .as_ref()
                .filter(|cmd| self.owns_previous(cmd, *tauri));
            if let Some(cmd) = owned {
                present |= !self
                    .retired_command
                    .as_ref()
                    .is_some_and(|old| old.eq_ignore_ascii_case(cmd));
            }
            if owned.is_some() || (source.is_none() && *tauri && !registered) {
                disabled = disabled.or(approval(name)?);
            }
        }
        Ok((present, disabled))
    }

    pub(super) fn status(&self) -> LoginStatus {
        let present = match self.registered() {
            Ok(present) => present,
            Err(e) if e.kind() == io::ErrorKind::AlreadyExists => return LoginStatus::Conflict,
            Err(_) => return LoginStatus::Unavailable,
        };
        match self.system_registration(present) {
            Err(_) => LoginStatus::Unavailable,
            Ok((_, Some(_))) => LoginStatus::DisabledByWindows,
            Ok((true, None)) => LoginStatus::Registered,
            Ok((false, None)) => LoginStatus::Missing,
        }
    }

    pub(super) fn migrate_previous(&self, enabled: bool) -> io::Result<()> {
        self.update_retired_executable(enabled)?;
        for (name, tauri) in &self.previous {
            self.migrate(name, *tauri, enabled)?;
        }
        Ok(())
    }

    fn update_retired_executable(&self, enabled: bool) -> io::Result<()> {
        let Some(retired) = &self.retired_command else {
            return Ok(());
        };
        if command(&self.name)?.is_some_and(|cmd| cmd.eq_ignore_ascii_case(retired)) {
            if enabled {
                if let (_, Some(disabled)) = self.system_registration(true)? {
                    self.preserve_disabled(&disabled)?;
                }
                self.write_command()?;
            } else {
                delete(RUN, &self.name)?;
            }
        }
        Ok(())
    }

    fn write_command(&self) -> io::Result<()> {
        use std::os::windows::ffi::OsStrExt;
        if self.command.encode_wide().count() > 260 {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "Windows Run commands are limited to 260 UTF-16 characters",
            ));
        }
        let (key, _) =
            RegKey::predef(HKEY_CURRENT_USER).create_subkey_with_flags(RUN, KEY_SET_VALUE)?;
        key.set_value(&self.name, &self.command)?;
        if !self.registered()? {
            return Err(io::Error::other("failed to verify login command"));
        }
        Ok(())
    }

    pub(super) fn apply(&self, enabled: bool) -> io::Result<()> {
        let present = self.registered()?;
        if enabled == present {
            return Ok(());
        }
        if enabled {
            if let (_, Some(disabled)) = self.system_registration(false)? {
                self.preserve_disabled(&disabled)?;
            }
            return self.write_command();
        }
        delete(RUN, &self.name)?;
        if self.registered()? {
            return Err(io::Error::other("login entry changed before verification"));
        }
        Ok(())
    }

    fn preserve_disabled(&self, disabled: &RegValue<'_>) -> io::Result<()> {
        if approval(&self.name)?.is_none() {
            let (key, _) = RegKey::predef(HKEY_CURRENT_USER)
                .create_subkey_with_flags(APPROVAL, KEY_SET_VALUE)?;
            key.set_raw_value(&self.name, disabled)?;
            if approval(&self.name)?.is_none() {
                return Err(io::Error::other("failed to preserve disabled startup item"));
            }
        }
        Ok(())
    }

    // Move only a command owned by this installation. A disabled item must stay
    // disabled throughout the handoff, including between the two Run writes.
    pub(super) fn migrate(&self, old: &str, tauri: bool, enabled: bool) -> io::Result<()> {
        self.transfer(old, tauri, enabled, |name| delete(RUN, name))
    }

    fn transfer(
        &self,
        old: &str,
        tauri: bool,
        enabled: bool,
        remove_source: impl FnOnce(&str) -> io::Result<()>,
    ) -> io::Result<()> {
        if old.eq_ignore_ascii_case(&self.name) {
            return Err(io::Error::other("login identities must be distinct"));
        }
        let old_command = command(old)?;
        let owned = old_command
            .as_ref()
            .is_some_and(|cmd| self.owns_previous(cmd, tauri));
        if old_command.is_some() && !owned {
            return Ok(());
        }
        if !owned && !(tauri && enabled && !self.registered()?) {
            return Ok(());
        }
        let disabled = approval(old)?;
        if !owned && disabled.is_none() {
            return Ok(());
        }
        let present = self.registered()?;
        if let Some(value) = &disabled {
            self.preserve_disabled(value)?;
        } else if enabled {
            approval(&self.name)?;
        }
        self.apply(enabled)?;
        if disabled.is_some() && approval(&self.name)?.is_none() {
            if enabled && !present {
                self.apply(false)?;
            }
            return Err(io::Error::other(
                "startup approval changed during migration",
            ));
        }
        if owned {
            if command(old)? != old_command {
                return Err(io::Error::other(
                    "previous login entry changed during migration",
                ));
            }
            remove_source(old)?;
        }
        // The new identity now owns this decision. A later Windows re-enable
        // must survive the user switching Patina's preference off and on again.
        if let Some(transferred) = disabled
            && command(old)?.is_none()
            && approval(old)?
                .as_ref()
                .is_some_and(|v| v.bytes == transferred.bytes)
        {
            delete(APPROVAL, old)?;
        }
        Ok(())
    }
}

#[cfg(all(test, feature = "native-tests"))]
#[path = "../../../crates/test-support/login.rs"]
mod fixture;

#[cfg(all(test, feature = "native-tests"))]
#[test]
#[ignore = "isolated Win32 desktop and temporary registry entries"]
fn interrupted_cleanup_preserves_both_commands_and_can_retry() -> io::Result<()> {
    if !patina_test_support::run_case()? {
        return Ok(());
    }
    let root = tempfile::tempdir()?;
    let target = fixture::TestLoginEntry::for_profile(root.path())?;
    let digest = super::profile_digest(&root.path().canonicalize()?);
    let entry = LoginEntry::new(&digest, Some(root.path()))?;
    let source = fixture::TestLoginEntry::new(format!("{}.{digest}", super::APP_ID))?;
    assert_eq!(source.name.len(), 81);
    assert_eq!(entry.name.len(), 17);
    assert_eq!(entry.name, target.name);
    assert!(entry.previous.contains(&(source.name.clone(), false)));
    source
        .key
        .set_value(&source.name, &entry.previous_command)?;
    let disabled = RegValue {
        vtype: REG_BINARY,
        bytes: [3, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0].as_slice().into(),
    };
    source.approval.set_raw_value(&source.name, &disabled)?;
    let error = entry
        .transfer(&source.name, false, true, |_| {
            assert!(entry.registered()?);
            assert_eq!(entry.status(), LoginStatus::DisabledByWindows);
            Err(io::ErrorKind::PermissionDenied.into())
        })
        .unwrap_err();
    assert_eq!(error.kind(), io::ErrorKind::PermissionDenied);
    assert_eq!(command(&source.name)?, Some(entry.previous_command.clone()));
    assert!(entry.registered()?);
    entry.migrate(&source.name, false, true)?;
    entry.migrate(&source.name, false, true)?;
    assert!(command(&source.name)?.is_none());
    assert_eq!(entry.status(), LoginStatus::DisabledByWindows);
    target.approval.delete_value(&target.name)?;
    source.key.set_value(&source.name, &entry.command)?;
    source.approval.set_raw_value(&source.name, &disabled)?;
    entry.migrate(&source.name, false, false)?;
    assert!(!entry.registered()?);
    entry.apply(true)?;
    assert_eq!(entry.status(), LoginStatus::DisabledByWindows);
    Ok(())
}

fn raw(path: &str, name: &str) -> io::Result<Option<RegValue<'static>>> {
    match RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey_with_flags(path, KEY_QUERY_VALUE)
        .and_then(|key| key.get_raw_value(name))
    {
        Ok(v) => Ok(Some(v)),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e),
    }
}

fn command(name: &str) -> io::Result<Option<OsString>> {
    raw(RUN, name)?
        .map(|v| {
            if v.vtype != REG_SZ {
                return Err(io::Error::other("unsupported login command type"));
            }
            OsString::from_reg_value(&v)
        })
        .transpose()
}

fn approval(name: &str) -> io::Result<Option<RegValue<'static>>> {
    let Some(v) = raw(APPROVAL, name)? else {
        return Ok(None);
    };
    if v.vtype == REG_BINARY && v.bytes.len() == 12 {
        match &v.bytes[..4] {
            [2 | 6, 0, 0, 0] => return Ok(None),
            [3 | 7, 0, 0, 0] => return Ok(Some(v)),
            _ => {}
        }
    }
    Err(io::Error::other("unknown Windows startup approval state"))
}

fn delete(path: &str, name: &str) -> io::Result<()> {
    match RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey_with_flags(path, KEY_SET_VALUE)
        .and_then(|key| key.delete_value(name))
    {
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(()),
        other => other,
    }
}
