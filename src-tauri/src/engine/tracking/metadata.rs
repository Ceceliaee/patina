use crate::data::repositories::icon_cache;
use crate::platform::windows::icon as icon_extractor;
use sqlx::{Pool, Sqlite};
use std::ffi::OsStr;
use std::os::windows::ffi::OsStrExt;
use std::path::{Path, PathBuf};
use windows::core::PCWSTR;
use windows::Win32::Storage::FileSystem::{
    GetFileVersionInfoSizeW, GetFileVersionInfoW, VerQueryValueW,
};

const VERSION_INFO_NAME_KEYS: [&str; 3] = ["FileDescription", "ProductName", "CompanyName"];

#[repr(C)]
#[derive(Clone, Copy)]
struct LangAndCodePage {
    language: u16,
    code_page: u16,
}

pub fn map_app_name(exe_name: &str, process_path: &str) -> String {
    if let Some(display_name) = resolve_process_display_name(process_path) {
        let normalized = normalize_display_name(&display_name);
        if !normalized.is_empty() {
            return normalized;
        }
    }

    fallback_app_name(exe_name)
}

pub async fn ensure_icon_cache(
    pool: &Pool<Sqlite>,
    exe_name: &str,
    process_path: &str,
    root_owner_hwnd: &str,
    hwnd: &str,
) -> Result<(), sqlx::Error> {
    if icon_cache::is_icon_cached(pool, exe_name).await? {
        return Ok(());
    }

    let base64_icon =
        if let Some(icon_source_path) = resolve_icon_source_path(process_path, exe_name) {
            icon_extractor::get_icon_base64(&icon_source_path)
        } else {
            None
        };

    let base64_icon = base64_icon
        .or_else(|| icon_extractor::get_window_icon_base64(root_owner_hwnd))
        .or_else(|| icon_extractor::get_window_icon_base64(hwnd));
    let Some(base64_icon) = base64_icon else {
        return Ok(());
    };

    icon_cache::upsert_icon(pool, exe_name, &base64_icon, now_ms()).await?;

    Ok(())
}

fn resolve_icon_source_path(process_path: &str, exe_name: &str) -> Option<String> {
    let trimmed_path = process_path.trim();
    if !trimmed_path.is_empty() {
        return Some(trimmed_path.to_string());
    }

    let exe = exe_name.trim();
    if exe.is_empty() {
        return None;
    }

    // Fallback order when tracker cannot resolve process_path:
    // 1) App execution aliases (WindowsApps, common for Photos and Store apps)
    // 2) System paths
    // 3) Raw exe name as last attempt
    let mut candidates: Vec<PathBuf> = Vec::new();

    if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
        candidates.push(
            Path::new(&local_app_data)
                .join("Microsoft")
                .join("WindowsApps")
                .join(exe),
        );
    }

    if let Ok(windows_dir) = std::env::var("WINDIR") {
        candidates.push(Path::new(&windows_dir).join("System32").join(exe));
        candidates.push(Path::new(&windows_dir).join(exe));
    }

    for path in candidates {
        if path.is_file() {
            return Some(path.to_string_lossy().to_string());
        }
    }

    Some(exe.to_string())
}

fn resolve_process_display_name(process_path: &str) -> Option<String> {
    if process_path.trim().is_empty() {
        return None;
    }

    let path_wide: Vec<u16> = OsStr::new(process_path)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();

    let mut handle = 0u32;
    let size = unsafe { GetFileVersionInfoSizeW(PCWSTR(path_wide.as_ptr()), Some(&mut handle)) };
    if size == 0 {
        return None;
    }

    let mut version_data = vec![0u8; size as usize];
    unsafe {
        GetFileVersionInfoW(
            PCWSTR(path_wide.as_ptr()),
            Some(0),
            size,
            version_data.as_mut_ptr().cast(),
        )
        .ok()?;
    }

    for (language, code_page) in iter_version_translations(&version_data) {
        for key in VERSION_INFO_NAME_KEYS {
            if let Some(value) = query_version_string(&version_data, language, code_page, key) {
                if !value.trim().is_empty() {
                    return Some(value);
                }
            }
        }
    }

    None
}

fn iter_version_translations(version_data: &[u8]) -> Vec<(u16, u16)> {
    let mut translations = Vec::new();
    let translation_key: Vec<u16> = "\\VarFileInfo\\Translation"
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect();
    let mut buffer_ptr: *mut core::ffi::c_void = std::ptr::null_mut();
    let mut buffer_len = 0u32;

    let found_translation = unsafe {
        VerQueryValueW(
            version_data.as_ptr().cast(),
            PCWSTR(translation_key.as_ptr()),
            &mut buffer_ptr,
            &mut buffer_len,
        )
        .as_bool()
    };

    if found_translation
        && !buffer_ptr.is_null()
        && buffer_len >= std::mem::size_of::<LangAndCodePage>() as u32
    {
        let count = buffer_len as usize / std::mem::size_of::<LangAndCodePage>();
        let table =
            unsafe { std::slice::from_raw_parts(buffer_ptr as *const LangAndCodePage, count) };

        for entry in table {
            let pair = (entry.language, entry.code_page);
            if !translations.contains(&pair) {
                translations.push(pair);
            }
        }
    }

    for fallback in [(0x0804u16, 0x04B0u16), (0x0409u16, 0x04B0u16)] {
        if !translations.contains(&fallback) {
            translations.push(fallback);
        }
    }

    translations
}

fn query_version_string(
    version_data: &[u8],
    language: u16,
    code_page: u16,
    key: &str,
) -> Option<String> {
    let query_path = format!(
        "\\StringFileInfo\\{:04X}{:04X}\\{}",
        language, code_page, key
    );
    let query_wide: Vec<u16> = query_path
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect();
    let mut value_ptr: *mut core::ffi::c_void = std::ptr::null_mut();
    let mut value_len = 0u32;

    let found = unsafe {
        VerQueryValueW(
            version_data.as_ptr().cast(),
            PCWSTR(query_wide.as_ptr()),
            &mut value_ptr,
            &mut value_len,
        )
        .as_bool()
    };

    if !found || value_ptr.is_null() || value_len == 0 {
        return None;
    }

    let raw_slice =
        unsafe { std::slice::from_raw_parts(value_ptr as *const u16, value_len as usize) };
    let value = String::from_utf16_lossy(raw_slice);
    let trimmed = value.trim_matches('\0').trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn normalize_display_name(name: &str) -> String {
    name.trim().trim_end_matches(".exe").trim().to_string()
}

fn fallback_app_name(exe_name: &str) -> String {
    let raw = exe_name
        .trim()
        .trim_matches('"')
        .trim_end_matches(".exe")
        .trim();
    if raw.is_empty() {
        return String::new();
    }

    let mut normalized = String::with_capacity(raw.len());
    let mut previous_was_separator = false;
    for ch in raw.chars() {
        let is_separator = matches!(ch, '_' | '-' | '.');
        if is_separator {
            if !normalized.is_empty() && !previous_was_separator {
                normalized.push(' ');
            }
            previous_was_separator = true;
            continue;
        }

        normalized.push(ch);
        previous_was_separator = false;
    }

    let normalized = normalized.trim();
    if normalized.is_empty() {
        return String::new();
    }

    let mut chars = normalized.chars();
    match chars.next() {
        Some(first) => {
            let mut result = first.to_uppercase().collect::<String>();
            result.push_str(chars.as_str());
            result
        }
        None => String::new(),
    }
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or_default()
}
