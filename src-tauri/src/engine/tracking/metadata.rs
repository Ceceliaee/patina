use crate::data::tracking_runtime::{TrackingRuntimeDataError, TrackingRuntimeDataStore};
use crate::platform::windows::icon as icon_extractor;
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::ffi::OsStr;
use std::os::windows::ffi::OsStrExt;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use tokio::sync::Semaphore;
use windows::core::PCWSTR;
use windows::Win32::Storage::FileSystem::{
    GetFileVersionInfoSizeW, GetFileVersionInfoW, VerQueryValueW,
};

const VERSION_INFO_NAME_KEYS: [&str; 3] = ["FileDescription", "ProductName", "CompanyName"];
const ICON_NEGATIVE_CACHE_TTL_MS: i64 = 60 * 60 * 1000;
const ICON_NEGATIVE_CACHE_LIMIT: usize = 512;
const ICON_CACHE_CONCURRENCY_LIMIT: usize = 2;

#[repr(C)]
#[derive(Clone, Copy)]
struct LangAndCodePage {
    language: u16,
    code_page: u16,
}

#[derive(Clone, Copy, Debug)]
struct IconNegativeCacheEntry {
    last_failed_at_ms: i64,
    last_accessed_at_ms: i64,
}

#[derive(Clone, Debug, Serialize)]
pub struct IconNegativeCacheStats {
    pub entries: usize,
    pub limit: usize,
    pub ttl_ms: i64,
    pub oldest_age_ms: Option<i64>,
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
    data: &TrackingRuntimeDataStore,
    exe_name: &str,
    process_path: &str,
    window_class: &str,
    root_owner_hwnd: &str,
    hwnd: &str,
) -> Result<(), TrackingRuntimeDataError> {
    if should_skip_icon_attempt(exe_name, process_path, window_class, now_ms()) {
        return Ok(());
    }

    let Some(_in_flight) = IconCacheInFlightGuard::try_start(exe_name) else {
        return Ok(());
    };

    let Ok(_permit) = icon_cache_semaphore().clone().try_acquire_owned() else {
        return Ok(());
    };

    if data.is_icon_cached(exe_name).await? {
        return Ok(());
    }

    let base64_icon =
        if let Some(icon_source_path) = resolve_icon_source_path(process_path, exe_name) {
            icon_extractor::get_icon_base64(&icon_source_path)
        } else {
            None
        };

    let base64_icon =
        if base64_icon.is_some() || should_skip_window_icon_fallback(exe_name, window_class) {
            base64_icon
        } else {
            base64_icon
                .or_else(|| icon_extractor::get_window_icon_base64(root_owner_hwnd))
                .or_else(|| icon_extractor::get_window_icon_base64(hwnd))
        };
    let Some(base64_icon) = base64_icon else {
        remember_icon_failure(exe_name, process_path, window_class, now_ms());
        return Ok(());
    };

    data.upsert_icon(exe_name, &base64_icon, now_ms()).await?;

    Ok(())
}

struct IconCacheInFlightGuard {
    key: String,
}

impl IconCacheInFlightGuard {
    fn try_start(exe_name: &str) -> Option<Self> {
        let key = exe_name.trim().to_ascii_lowercase();
        if key.is_empty() {
            return None;
        }

        let mut in_flight = icon_cache_in_flight().lock().ok()?;
        if !in_flight.insert(key.clone()) {
            return None;
        }

        Some(Self { key })
    }
}

impl Drop for IconCacheInFlightGuard {
    fn drop(&mut self) {
        if let Ok(mut in_flight) = icon_cache_in_flight().lock() {
            in_flight.remove(&self.key);
        }
    }
}

fn icon_cache_in_flight() -> &'static Mutex<HashSet<String>> {
    static ICON_CACHE_IN_FLIGHT: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
    ICON_CACHE_IN_FLIGHT.get_or_init(|| Mutex::new(HashSet::new()))
}

fn icon_cache_semaphore() -> &'static Arc<Semaphore> {
    static ICON_CACHE_SEMAPHORE: OnceLock<Arc<Semaphore>> = OnceLock::new();
    ICON_CACHE_SEMAPHORE.get_or_init(|| Arc::new(Semaphore::new(ICON_CACHE_CONCURRENCY_LIMIT)))
}

fn should_skip_window_icon_fallback(exe_name: &str, window_class: &str) -> bool {
    exe_name.eq_ignore_ascii_case("explorer.exe")
        && !matches!(
            window_class.to_ascii_lowercase().as_str(),
            "cabinetwclass" | "explorewclass"
        )
}

fn should_skip_icon_attempt(
    exe_name: &str,
    process_path: &str,
    window_class: &str,
    now_ms: i64,
) -> bool {
    let key = icon_negative_cache_key(exe_name, process_path, window_class);
    let Ok(mut cache) = icon_negative_cache().lock() else {
        return false;
    };
    should_skip_icon_attempt_in_cache(&mut cache, &key, now_ms)
}

fn remember_icon_failure(exe_name: &str, process_path: &str, window_class: &str, now_ms: i64) {
    if let Ok(mut cache) = icon_negative_cache().lock() {
        remember_icon_failure_in_cache(
            &mut cache,
            icon_negative_cache_key(exe_name, process_path, window_class),
            now_ms,
        );
    }
}

fn icon_negative_cache_key(exe_name: &str, process_path: &str, window_class: &str) -> String {
    format!(
        "{}|{}|{}",
        exe_name.trim().to_ascii_lowercase(),
        process_path.trim().to_ascii_lowercase(),
        window_class.trim().to_ascii_lowercase()
    )
}

fn cleanup_icon_negative_cache(cache: &mut HashMap<String, IconNegativeCacheEntry>, now_ms: i64) {
    cache.retain(|_, entry| {
        now_ms.saturating_sub(entry.last_failed_at_ms) < ICON_NEGATIVE_CACHE_TTL_MS
    });

    while cache.len() > ICON_NEGATIVE_CACHE_LIMIT {
        let Some(oldest_key) = cache
            .iter()
            .min_by_key(|(_, entry)| entry.last_accessed_at_ms)
            .map(|(key, _)| key.clone())
        else {
            break;
        };
        cache.remove(&oldest_key);
    }
}

fn should_skip_icon_attempt_in_cache(
    cache: &mut HashMap<String, IconNegativeCacheEntry>,
    key: &str,
    now_ms: i64,
) -> bool {
    cleanup_icon_negative_cache(cache, now_ms);

    let Some(entry) = cache.get_mut(key) else {
        return false;
    };
    if now_ms.saturating_sub(entry.last_failed_at_ms) >= ICON_NEGATIVE_CACHE_TTL_MS {
        cache.remove(key);
        return false;
    }

    entry.last_accessed_at_ms = now_ms;
    true
}

fn remember_icon_failure_in_cache(
    cache: &mut HashMap<String, IconNegativeCacheEntry>,
    key: String,
    now_ms: i64,
) {
    cleanup_icon_negative_cache(cache, now_ms);
    cache.insert(
        key,
        IconNegativeCacheEntry {
            last_failed_at_ms: now_ms,
            last_accessed_at_ms: now_ms,
        },
    );
    cleanup_icon_negative_cache(cache, now_ms);
}

pub fn icon_negative_cache_stats(now_ms: i64) -> IconNegativeCacheStats {
    let Ok(cache) = icon_negative_cache().lock() else {
        return IconNegativeCacheStats {
            entries: 0,
            limit: ICON_NEGATIVE_CACHE_LIMIT,
            ttl_ms: ICON_NEGATIVE_CACHE_TTL_MS,
            oldest_age_ms: None,
        };
    };

    IconNegativeCacheStats {
        entries: cache.len(),
        limit: ICON_NEGATIVE_CACHE_LIMIT,
        ttl_ms: ICON_NEGATIVE_CACHE_TTL_MS,
        oldest_age_ms: cache
            .values()
            .map(|entry| now_ms.saturating_sub(entry.last_failed_at_ms))
            .max(),
    }
}

fn icon_negative_cache() -> &'static Mutex<HashMap<String, IconNegativeCacheEntry>> {
    static ICON_NEGATIVE_CACHE: OnceLock<Mutex<HashMap<String, IconNegativeCacheEntry>>> =
        OnceLock::new();
    ICON_NEGATIVE_CACHE.get_or_init(|| Mutex::new(HashMap::new()))
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

#[cfg(test)]
mod tests {
    use super::{
        icon_negative_cache_key, remember_icon_failure_in_cache, should_skip_icon_attempt_in_cache,
        should_skip_window_icon_fallback, IconNegativeCacheEntry, ICON_NEGATIVE_CACHE_LIMIT,
    };
    use std::collections::HashMap;

    #[test]
    fn explorer_shell_surface_skips_window_icon_fallback() {
        assert!(should_skip_window_icon_fallback("explorer.exe", "Progman"));
        assert!(should_skip_window_icon_fallback("explorer.exe", "WorkerW"));
        assert!(!should_skip_window_icon_fallback(
            "explorer.exe",
            "CabinetWClass"
        ));
        assert!(!should_skip_window_icon_fallback("Code.exe", "Progman"));
    }

    #[test]
    fn icon_negative_cache_uses_normalized_identity() {
        assert_eq!(
            icon_negative_cache_key(" App.EXE ", r" C:\Apps\App.exe ", " MainClass "),
            "app.exe|c:\\apps\\app.exe|mainclass"
        );
    }

    #[test]
    fn icon_negative_cache_suppresses_recent_failures() {
        let mut cache = HashMap::<String, IconNegativeCacheEntry>::new();
        let key = icon_negative_cache_key("Missing.exe", "", "MainClass");
        remember_icon_failure_in_cache(&mut cache, key.clone(), 10_000);

        assert!(should_skip_icon_attempt_in_cache(&mut cache, &key, 20_000));
        assert!(!should_skip_icon_attempt_in_cache(
            &mut cache, &key, 3_700_001
        ));
    }

    #[test]
    fn icon_negative_cache_prunes_expired_entries_on_access() {
        let mut cache = HashMap::<String, IconNegativeCacheEntry>::new();
        let key = icon_negative_cache_key("Old.exe", "", "MainClass");
        remember_icon_failure_in_cache(&mut cache, key.clone(), 10_000);

        assert!(!should_skip_icon_attempt_in_cache(
            &mut cache, &key, 3_700_001
        ));
        assert_eq!(cache.len(), 0);
    }

    #[test]
    fn icon_negative_cache_keeps_a_hard_entry_limit() {
        let mut cache = HashMap::<String, IconNegativeCacheEntry>::new();
        for index in 0..(ICON_NEGATIVE_CACHE_LIMIT + 1) {
            remember_icon_failure_in_cache(
                &mut cache,
                icon_negative_cache_key(&format!("Missing{index}.exe"), "", "MainClass"),
                index as i64,
            );
        }

        assert_eq!(cache.len(), ICON_NEGATIVE_CACHE_LIMIT);
        assert!(!should_skip_icon_attempt_in_cache(
            &mut cache,
            &icon_negative_cache_key("Missing0.exe", "", "MainClass"),
            2_000
        ));
    }
}
