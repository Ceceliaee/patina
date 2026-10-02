use windows::core::{w, PCWSTR};
use windows::Win32::Foundation::ERROR_FILE_NOT_FOUND;
use windows::Win32::System::Registry::*;

pub const MAX_STATE_BYTES: usize = 64 * 1024;

struct Key(HKEY);

impl Drop for Key {
    fn drop(&mut self) {
        unsafe {
            let _ = RegCloseKey(self.0);
        }
    }
}

fn key_name(name: &str) -> Vec<u16> {
    name.encode_utf16().chain(Some(0)).collect()
}

pub fn read(name: &str) -> Result<Option<Vec<u8>>, String> {
    let name = key_name(name);
    let mut key = HKEY::default();
    let status = unsafe {
        RegOpenKeyExW(
            HKEY_CURRENT_USER,
            PCWSTR(name.as_ptr()),
            None,
            KEY_QUERY_VALUE | KEY_WOW64_64KEY,
            &mut key,
        )
    };
    if status == ERROR_FILE_NOT_FOUND {
        return Ok(None);
    }
    status
        .ok()
        .map_err(|e| format!("cannot open storage registry key: {e}"))?;
    let key = Key(key);
    let mut size = 0;
    let mut kind = REG_VALUE_TYPE::default();
    let status = unsafe {
        RegQueryValueExW(
            key.0,
            w!("State"),
            None,
            Some(&mut kind),
            None,
            Some(&mut size),
        )
    };
    // An existing key without State may be an interrupted first creation.
    if status == ERROR_FILE_NOT_FOUND {
        return Ok(None);
    }
    status
        .ok()
        .map_err(|e| format!("cannot size storage registry state: {e}"))?;
    if kind != REG_BINARY || size == 0 || size as usize > MAX_STATE_BYTES {
        return Err("invalid storage registry value type or size".into());
    }
    let mut bytes = vec![0; size as usize];
    let status = unsafe {
        RegQueryValueExW(
            key.0,
            w!("State"),
            None,
            Some(&mut kind),
            Some(bytes.as_mut_ptr()),
            Some(&mut size),
        )
    };
    status
        .ok()
        .map_err(|e| format!("cannot read storage registry state: {e}"))?;
    if kind != REG_BINARY {
        return Err("storage registry value type changed during read".into());
    }
    bytes.truncate(size as usize);
    Ok(Some(bytes))
}

pub fn write(name: &str, bytes: &[u8]) -> Result<(), String> {
    if bytes.is_empty() || bytes.len() > MAX_STATE_BYTES {
        return Err("storage state exceeds size limit".into());
    }
    let encoded = key_name(name);
    let mut key = HKEY::default();
    let status = unsafe {
        RegCreateKeyExW(
            HKEY_CURRENT_USER,
            PCWSTR(encoded.as_ptr()),
            None,
            PCWSTR::null(),
            REG_OPTION_NON_VOLATILE,
            KEY_QUERY_VALUE | KEY_SET_VALUE | KEY_WOW64_64KEY,
            None,
            &mut key,
            None,
        )
    };
    status
        .ok()
        .map_err(|e| format!("cannot create storage registry key: {e}"))?;
    let key = Key(key);
    let status = unsafe { RegSetValueExW(key.0, w!("State"), None, REG_BINARY, Some(bytes)) };
    status
        .ok()
        .map_err(|e| format!("cannot commit storage registry state: {e}"))?;
    #[cfg(test)]
    fail_at(name, "flush")?;
    // Low-frequency storage commits precede deletion of old configuration or data.
    unsafe { RegFlushKey(key.0) }
        .ok()
        .map_err(|e| format!("cannot flush storage registry state; keep recovery files: {e}"))?;
    #[cfg(test)]
    if FAIL_POINT.with(|point| {
        point
            .borrow()
            .as_ref()
            .is_some_and(|(key, phase)| key == name && *phase == "readback")
    }) {
        // Model another writer replacing the value between commit and verification.
        unsafe {
            RegSetValueExW(
                key.0,
                w!("State"),
                None,
                REG_BINARY,
                Some(b"unexpected writer"),
            )
        }
        .ok()
        .unwrap();
    }
    if read(name)?.as_deref() != Some(bytes) {
        return Err("storage registry commit verification failed".into());
    }
    Ok(())
}

#[cfg(test)]
thread_local! {
    static FAIL_POINT: std::cell::RefCell<Option<(String, &'static str)>> = const { std::cell::RefCell::new(None) };
}

#[cfg(test)]
fn fail_at(name: &str, phase: &str) -> Result<(), String> {
    if FAIL_POINT.with(|point| {
        point
            .borrow()
            .as_ref()
            .is_some_and(|(key, at)| key == name && *at == phase)
    }) {
        return Err(format!("injected registry {phase} failure"));
    }
    Ok(())
}

#[cfg(test)]
pub fn with_failure<T>(name: &str, phase: &'static str, action: impl FnOnce() -> T) -> T {
    assert!(name.starts_with(r"Software\Patina\Storage\tests\"));
    struct Reset;
    impl Drop for Reset {
        fn drop(&mut self) {
            FAIL_POINT.with(|p| *p.borrow_mut() = None);
        }
    }
    FAIL_POINT.with(|p| *p.borrow_mut() = Some((name.into(), phase)));
    let _reset = Reset;
    action()
}

#[cfg(test)]
pub fn remove_test_key(name: &str) {
    assert!(name.starts_with(r"Software\Patina\Storage\tests\"));
    let encoded = key_name(name);
    let status = unsafe { RegDeleteTreeW(HKEY_CURRENT_USER, PCWSTR(encoded.as_ptr())) };
    assert!(status == windows::Win32::Foundation::ERROR_SUCCESS || status == ERROR_FILE_NOT_FOUND);
}
