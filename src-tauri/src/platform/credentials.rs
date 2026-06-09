const WEBDAV_BACKUP_CREDENTIAL_TARGET: &str = "com.timetracker.backup.webdav.default";

#[cfg(target_os = "windows")]
mod windows_credentials {
    use super::WEBDAV_BACKUP_CREDENTIAL_TARGET;
    use std::ptr;
    use windows::core::PWSTR;
    use windows::Win32::Foundation::ERROR_NOT_FOUND;
    use windows::Win32::Security::Credentials::{
        CredDeleteW, CredFree, CredReadW, CredWriteW, CREDENTIALW, CRED_PERSIST_LOCAL_MACHINE,
        CRED_TYPE_GENERIC,
    };

    fn wide_null(value: &str) -> Vec<u16> {
        value.encode_utf16().chain(std::iter::once(0)).collect()
    }

    fn is_not_found(error: &windows::core::Error) -> bool {
        error.code() == ERROR_NOT_FOUND.to_hresult()
    }

    pub fn save_webdav_password(username: &str, password: &str) -> Result<(), String> {
        let mut target = wide_null(WEBDAV_BACKUP_CREDENTIAL_TARGET);
        let mut comment = wide_null("Patina WebDAV backup credential");
        let mut username = wide_null(username);
        let mut password_bytes = password.as_bytes().to_vec();

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

    pub fn read_webdav_password() -> Result<Option<String>, String> {
        let target = wide_null(WEBDAV_BACKUP_CREDENTIAL_TARGET);
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

                let secret = unsafe {
                    let credential_ref = &*credential;
                    let bytes = std::slice::from_raw_parts(
                        credential_ref.CredentialBlob,
                        credential_ref.CredentialBlobSize as usize,
                    );
                    let secret = String::from_utf8(bytes.to_vec())
                        .map_err(|_| "stored WebDAV credential is not valid UTF-8".to_string())?;
                    CredFree(credential.cast());
                    secret
                };
                Ok(Some(secret))
            }
            Err(error) if is_not_found(&error) => Ok(None),
            Err(error) => Err(format!("failed to read WebDAV credential: {error}")),
        }
    }

    pub fn delete_webdav_password() -> Result<(), String> {
        let target = wide_null(WEBDAV_BACKUP_CREDENTIAL_TARGET);
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
}

#[cfg(not(target_os = "windows"))]
mod windows_credentials {
    pub fn save_webdav_password(_username: &str, _password: &str) -> Result<(), String> {
        Err("WebDAV credential storage is only available on Windows".to_string())
    }

    pub fn read_webdav_password() -> Result<Option<String>, String> {
        Ok(None)
    }

    pub fn delete_webdav_password() -> Result<(), String> {
        Ok(())
    }
}

pub fn save_webdav_backup_password(username: &str, password: &str) -> Result<(), String> {
    windows_credentials::save_webdav_password(username, password)
}

pub fn read_webdav_backup_password() -> Result<Option<String>, String> {
    windows_credentials::read_webdav_password()
}

pub fn has_webdav_backup_password() -> Result<bool, String> {
    Ok(read_webdav_backup_password()?.is_some())
}

pub fn delete_webdav_backup_password() -> Result<(), String> {
    windows_credentials::delete_webdav_password()
}
