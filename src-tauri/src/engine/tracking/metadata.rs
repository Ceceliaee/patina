use super::ports::{TrackingDataError, TrackingDataStore};
use crate::platform::windows::app_metadata;
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex, OnceLock};
use tokio::sync::Semaphore;
const ICON_NEGATIVE_CACHE_TTL_MS: i64 = 60 * 60 * 1000;
const ICON_NEGATIVE_CACHE_LIMIT: usize = 512;
const ICON_CACHE_CONCURRENCY_LIMIT: usize = 2;

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
    if let Some(display_name) = app_metadata::resolve_process_display_name(process_path) {
        let normalized = normalize_display_name(&display_name);
        if !normalized.is_empty() {
            return normalized;
        }
    }

    fallback_app_name(exe_name)
}

pub async fn ensure_icon_cache(
    data: &dyn TrackingDataStore,
    exe_name: &str,
    process_path: &str,
    window_class: &str,
    root_owner_hwnd: &str,
    hwnd: &str,
) -> Result<(), TrackingDataError> {
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

    let base64_icon = app_metadata::resolve_icon_base64(
        process_path,
        exe_name,
        window_class,
        root_owner_hwnd,
        hwnd,
    );
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
        IconNegativeCacheEntry, ICON_NEGATIVE_CACHE_LIMIT,
    };
    use std::collections::HashMap;

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
