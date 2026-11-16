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
