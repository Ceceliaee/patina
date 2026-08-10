use crate::platform::app_paths::AppProfile;

const WEBDAV_BACKUP_LEGACY_CREDENTIAL_TARGET: &str = "com.ceceliaee.patina.backup.webdav.default";
const WEBDAV_BACKUP_CREDENTIAL_TARGET_PREFIX: &str = "com.ceceliaee.patina.backup.webdav";

fn webdav_backup_credential_target(profile: AppProfile) -> String {
    format!("{WEBDAV_BACKUP_CREDENTIAL_TARGET_PREFIX}.{}", profile.key())
}

fn credential_lookup_targets(profile: AppProfile) -> Vec<String> {
    let mut targets = vec![webdav_backup_credential_target(profile)];
    if profile == AppProfile::Production {
        targets.push(WEBDAV_BACKUP_LEGACY_CREDENTIAL_TARGET.to_string());
    }
    targets
}

#[cfg(target_os = "windows")]
mod windows_credentials {
    use std::ptr;
    use std::sync::atomic::{compiler_fence, Ordering};
    use windows::core::PWSTR;
    use windows::Win32::Foundation::ERROR_NOT_FOUND;
    use windows::Win32::Security::Credentials::{
        CredDeleteW, CredFree, CredReadW, CredWriteW, CREDENTIALW, CRED_PERSIST_LOCAL_MACHINE,
        CRED_TYPE_GENERIC,
    };

    struct SensitiveBytes(Vec<u8>);

    impl SensitiveBytes {
        fn as_mut_ptr(&mut self) -> *mut u8 {
            self.0.as_mut_ptr()
        }

        fn len(&self) -> usize {
            self.0.len()
        }
    }

    impl Drop for SensitiveBytes {
        fn drop(&mut self) {
            for byte in &mut self.0 {
                unsafe { ptr::write_volatile(byte, 0) };
            }
            compiler_fence(Ordering::SeqCst);
        }
    }

    struct CredentialAllocation(*mut CREDENTIALW);

    impl Drop for CredentialAllocation {
        fn drop(&mut self) {
            if !self.0.is_null() {
                unsafe { CredFree(self.0.cast()) };
            }
        }
    }

    fn wide_null(value: &str) -> Vec<u16> {
        value.encode_utf16().chain(std::iter::once(0)).collect()
    }

    fn is_not_found(error: &windows::core::Error) -> bool {
        error.code() == ERROR_NOT_FOUND.to_hresult()
    }

    fn copy_credential_blob(blob: *const u8, size: usize) -> Result<Vec<u8>, String> {
        if size == 0 {
            return Ok(Vec::new());
        }
        if blob.is_null() {
            return Err("stored WebDAV credential has an invalid null blob pointer".to_string());
        }
        Ok(unsafe { std::slice::from_raw_parts(blob, size) }.to_vec())
    }

    pub fn save_webdav_password(
        credential_target: &str,
        username: &str,
        password: &str,
    ) -> Result<(), String> {
        let mut target = wide_null(credential_target);
        let mut comment = wide_null("Patina WebDAV backup credential");
        let mut username = wide_null(username);
        let mut password_bytes = SensitiveBytes(password.as_bytes().to_vec());

        let credential = CREDENTIALW {
            Type: CRED_TYPE_GENERIC,
            TargetName: PWSTR(target.as_mut_ptr()),
            Comment: PWSTR(comment.as_mut_ptr()),
            CredentialBlobSize: password_bytes
                .len()
                .try_into()
                .map_err(|_| "WebDAV password is too large to store".to_string())?,
            CredentialBlob: password_bytes.as_mut_ptr(),
            Persist: CRED_PERSIST_LOCAL_MACHINE,
            UserName: PWSTR(username.as_mut_ptr()),
            ..Default::default()
        };

        unsafe {
            CredWriteW(&credential, 0)
                .map_err(|error| format!("failed to save WebDAV credential: {error}"))
        }
    }

    pub fn read_webdav_password(credential_target: &str) -> Result<Option<String>, String> {
        let target = wide_null(credential_target);
        let mut credential: *mut CREDENTIALW = ptr::null_mut();

        let result = unsafe {
            CredReadW(
                windows::core::PCWSTR(target.as_ptr()),
                CRED_TYPE_GENERIC,
                None,
                &mut credential,
            )
        };

        match result {
            Ok(()) => {
                if credential.is_null() {
                    return Ok(None);
                }
                let allocation = CredentialAllocation(credential);
                let credential_ref = unsafe { &*allocation.0 };
                let bytes = copy_credential_blob(
                    credential_ref.CredentialBlob,
                    credential_ref.CredentialBlobSize as usize,
                )?;
                let secret = String::from_utf8(bytes)
                    .map_err(|_| "stored WebDAV credential is not valid UTF-8".to_string())?;
                Ok(Some(secret))
            }
            Err(error) if is_not_found(&error) => Ok(None),
            Err(error) => Err(format!("failed to read WebDAV credential: {error}")),
        }
    }

    pub fn delete_webdav_password(credential_target: &str) -> Result<(), String> {
        let target = wide_null(credential_target);
        let result = unsafe {
            CredDeleteW(
                windows::core::PCWSTR(target.as_ptr()),
                CRED_TYPE_GENERIC,
                None,
            )
        };

        match result {
            Ok(()) => Ok(()),
            Err(error) if is_not_found(&error) => Ok(()),
            Err(error) => Err(format!("failed to delete WebDAV credential: {error}")),
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn empty_credential_blob_never_dereferences_a_null_pointer() {
            assert_eq!(
                copy_credential_blob(ptr::null(), 0).unwrap(),
                Vec::<u8>::new()
            );
        }

        #[test]
        fn nonempty_credential_blob_requires_a_valid_pointer() {
            assert!(copy_credential_blob(ptr::null(), 1).is_err());
        }
    }
}

#[cfg(not(target_os = "windows"))]
mod windows_credentials {
    pub fn save_webdav_password(
        _credential_target: &str,
        _username: &str,
        _password: &str,
    ) -> Result<(), String> {
        Err("WebDAV credential storage is only available on Windows".to_string())
    }

    pub fn read_webdav_password(_credential_target: &str) -> Result<Option<String>, String> {
        Ok(None)
    }

    pub fn delete_webdav_password(_credential_target: &str) -> Result<(), String> {
        Ok(())
    }
}

pub fn save_webdav_backup_password(
    profile: AppProfile,
    username: &str,
    password: &str,
) -> Result<(), String> {
    let target = webdav_backup_credential_target(profile);
    windows_credentials::save_webdav_password(&target, username, password)?;
    let verified = windows_credentials::read_webdav_password(&target)?;
    if verified.as_deref() != Some(password) {
        return Err("failed to verify the saved WebDAV credential".to_string());
    }
    if profile == AppProfile::Production {
        windows_credentials::delete_webdav_password(WEBDAV_BACKUP_LEGACY_CREDENTIAL_TARGET)?;
    }
    Ok(())
}

pub fn read_webdav_backup_password(profile: AppProfile) -> Result<Option<String>, String> {
    let targets = credential_lookup_targets(profile);
    for (index, target) in targets.iter().enumerate() {
        let Some(password) = windows_credentials::read_webdav_password(target)? else {
            continue;
        };
        if index > 0 {
            let scoped_target = &targets[0];
            windows_credentials::save_webdav_password(scoped_target, "Patina", &password)?;
            let verified = windows_credentials::read_webdav_password(scoped_target)?;
            if verified.as_deref() != Some(password.as_str()) {
                return Err("failed to verify migrated WebDAV credential".to_string());
            }
            windows_credentials::delete_webdav_password(target)?;
        }
        return Ok(Some(password));
    }
    Ok(None)
}

pub fn has_webdav_backup_password(profile: AppProfile) -> Result<bool, String> {
    Ok(read_webdav_backup_password(profile)?.is_some())
}

pub fn delete_webdav_backup_password(profile: AppProfile) -> Result<(), String> {
    for target in credential_lookup_targets(profile) {
        windows_credentials::delete_webdav_password(&target)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn webdav_credential_targets_are_isolated_by_app_profile() {
        let production = webdav_backup_credential_target(AppProfile::Production);
        let local = webdav_backup_credential_target(AppProfile::Local);
        let dev = webdav_backup_credential_target(AppProfile::Dev);

        assert_ne!(production, local);
        assert_ne!(production, dev);
        assert_ne!(local, dev);
        assert!(production.ends_with(".production"));
        assert!(local.ends_with(".local"));
        assert!(dev.ends_with(".dev"));
    }

    #[test]
    fn only_production_reads_the_legacy_unscoped_target_for_migration() {
        assert_eq!(credential_lookup_targets(AppProfile::Production).len(), 2);
        assert_eq!(credential_lookup_targets(AppProfile::Local).len(), 1);
        assert_eq!(credential_lookup_targets(AppProfile::Dev).len(), 1);
        assert_eq!(
            credential_lookup_targets(AppProfile::Production)[1],
            WEBDAV_BACKUP_LEGACY_CREDENTIAL_TARGET
        );
    }
}
