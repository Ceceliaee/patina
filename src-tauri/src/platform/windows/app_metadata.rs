use super::{icon, packaged_app};
use std::collections::HashMap;
use std::ffi::OsStr;
use std::os::windows::ffi::OsStrExt;
use std::path::{Path, PathBuf};
use std::sync::{
    mpsc::{sync_channel, RecvTimeoutError, SyncSender, TrySendError},
    Arc, Mutex, OnceLock,
};
use std::time::Duration;
use windows::core::{Interface, PCWSTR};
use windows::Win32::Foundation::{RPC_E_CHANGED_MODE, SIZE};
use windows::Win32::Storage::FileSystem::{
    GetFileVersionInfoSizeW, GetFileVersionInfoW, VerQueryValueW,
};
use windows::Win32::System::Com::{
    CoInitializeEx, CoTaskMemFree, CoUninitialize, COINIT_APARTMENTTHREADED,
};
use windows::Win32::UI::Shell::{
    FOLDERID_AppsFolder, IShellItem, IShellItemImageFactory, SHCreateItemInKnownFolder,
    KF_FLAG_DEFAULT, SIGDN_NORMALDISPLAY, SIIGBF_BIGGERSIZEOK, SIIGBF_ICONONLY,
};

const VERSION_INFO_NAME_KEYS: [&str; 3] = ["FileDescription", "ProductName", "CompanyName"];
const SHELL_ICON_SIZE: i32 = 64;
const SHELL_PRESENTATION_CACHE_MAX_ENTRIES: usize = 128;
const SHELL_PRESENTATION_CACHE_TTL_MS: u64 = 10 * 60 * 1000;
const SHELL_PRESENTATION_PARTIAL_CACHE_TTL_MS: u64 = 30 * 1000;
const SHELL_PRESENTATION_QUEUE_CAPACITY: usize = 8;
const SHELL_PRESENTATION_TIMEOUT: Duration = Duration::from_secs(2);

#[derive(Clone)]
struct ShellValueCacheEntry {
    value: Option<String>,
    cached_at_ms: u64,
}

#[derive(Clone, Copy)]
enum ShellPresentationKind {
    DisplayName,
    Icon,
}

struct ComApartmentGuard {
    owns_initialization: bool,
}

impl ComApartmentGuard {
    fn initialize() -> Option<Self> {
        let result = unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) };
        if result.is_ok() {
            Some(Self {
                owns_initialization: true,
            })
        } else if result == RPC_E_CHANGED_MODE {
            Some(Self {
                owns_initialization: false,
            })
        } else {
            None
        }
    }
}

impl Drop for ComApartmentGuard {
    fn drop(&mut self) {
        if self.owns_initialization {
            unsafe { CoUninitialize() };
        }
    }
}

struct ShellPresentationRequest {
    app_user_model_id: String,
    kind: ShellPresentationKind,
    response: SyncSender<Option<String>>,
}

struct ShellPresentationWorker {
    requests: SyncSender<ShellPresentationRequest>,
}

#[derive(Debug, PartialEq, Eq)]
enum ShellWorkerOutcome {
    Completed(Option<String>),
    Busy,
    TimedOut,
    Disconnected,
}

impl ShellPresentationWorker {
    fn start() -> Option<Self> {
        let (requests, receiver) =
            sync_channel::<ShellPresentationRequest>(SHELL_PRESENTATION_QUEUE_CAPACITY);
        let (ready, readiness) = sync_channel(1);
        std::thread::Builder::new()
            .name("patina-shell-presentation".into())
            .spawn(move || {
                let apartment = ComApartmentGuard::initialize();
                let _ = ready.send(apartment.is_some());
                let Some(_apartment) = apartment else {
                    return;
                };
                while let Ok(request) = receiver.recv() {
                    let presentation = resolve_shell_value_on_current_thread(
                        &request.app_user_model_id,
                        request.kind,
                    );
                    let _ = request.response.send(presentation);
                }
            })
            .ok()?;
        match readiness.recv_timeout(SHELL_PRESENTATION_TIMEOUT) {
            Ok(true) => Some(Self { requests }),
            Ok(false) | Err(_) => None,
        }
    }

    fn resolve(&self, app_user_model_id: &str, kind: ShellPresentationKind) -> ShellWorkerOutcome {
        let (response, receiver) = sync_channel(1);
        let request = ShellPresentationRequest {
            app_user_model_id: app_user_model_id.to_string(),
            kind,
            response,
        };
        match self.requests.try_send(request) {
            Ok(()) => match receiver.recv_timeout(SHELL_PRESENTATION_TIMEOUT) {
                Ok(value) => ShellWorkerOutcome::Completed(value),
                Err(RecvTimeoutError::Timeout) => ShellWorkerOutcome::TimedOut,
                Err(RecvTimeoutError::Disconnected) => ShellWorkerOutcome::Disconnected,
            },
            Err(TrySendError::Full(_)) => ShellWorkerOutcome::Busy,
            Err(TrySendError::Disconnected(_)) => ShellWorkerOutcome::Disconnected,
        }
    }
}

#[repr(C)]
#[derive(Clone, Copy)]
struct LangAndCodePage {
    language: u16,
    code_page: u16,
}

pub fn resolve_process_display_name(process_path: &str) -> Option<String> {
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

pub fn resolve_app_display_name(process_path: &str, app_user_model_id: &str) -> Option<String> {
    select_display_name(
        resolve_shell_app_display_name(app_user_model_id),
        resolve_process_display_name(process_path),
    )
}

pub fn resolve_icon_base64(
    process_id: u32,
    process_path: &str,
    exe_name: &str,
    app_user_model_id: &str,
    window_class: &str,
    root_owner_hwnd: &str,
    hwnd: &str,
) -> Option<String> {
    if !app_user_model_id.trim().is_empty() {
        return select_packaged_icon(
            resolve_shell_app_icon(app_user_model_id),
            || {
                resolve_icon_source_path(process_path, exe_name)
                    .and_then(|icon_source_path| icon::get_icon_base64(&icon_source_path))
            },
            || {
                icon::parse_hwnd(root_owner_hwnd)
                    .and_then(|root_owner_hwnd| {
                        packaged_app::find_descendant_window_for_process(
                            root_owner_hwnd,
                            process_id,
                        )
                    })
                    .and_then(icon::get_window_icon_base64_from_hwnd)
            },
        );
    }

    let file_icon = resolve_icon_source_path(process_path, exe_name)
        .and_then(|icon_source_path| icon::get_icon_base64(&icon_source_path));
    if file_icon.is_some() || should_skip_window_icon_fallback(exe_name, window_class) {
        return file_icon;
    }

    icon::get_window_icon_base64(root_owner_hwnd).or_else(|| icon::get_window_icon_base64(hwnd))
}

fn select_display_name(
    shell_display_name: Option<String>,
    file_display_name: Option<String>,
) -> Option<String> {
    shell_display_name
        .filter(|name| !name.trim().is_empty())
        .or_else(|| file_display_name.filter(|name| !name.trim().is_empty()))
}

fn select_packaged_icon(
    shell_icon: Option<String>,
    file_icon: impl FnOnce() -> Option<String>,
    app_window_icon: impl FnOnce() -> Option<String>,
) -> Option<String> {
    shell_icon.or_else(file_icon).or_else(app_window_icon)
}

fn resolve_shell_app_display_name(app_user_model_id: &str) -> Option<String> {
    resolve_shell_value(
        app_user_model_id,
        ShellPresentationKind::DisplayName,
        shell_display_name_cache(),
    )
}

fn resolve_shell_app_icon(app_user_model_id: &str) -> Option<String> {
    resolve_shell_value(
        app_user_model_id,
        ShellPresentationKind::Icon,
        shell_icon_cache(),
    )
}

fn resolve_shell_value(
    app_user_model_id: &str,
    kind: ShellPresentationKind,
    cache: &Mutex<HashMap<String, ShellValueCacheEntry>>,
) -> Option<String> {
    let cache_key = app_user_model_id.trim().to_ascii_lowercase();
    if cache_key.is_empty() {
        return None;
    }
    let now_ms = now_ms();
    if let Some(cached) = read_shell_value_cache(cache, &cache_key, now_ms) {
        return cached;
    }

    let value = request_shell_value(app_user_model_id, kind);
    write_shell_value_cache(cache, cache_key, value.clone(), now_ms);
    value
}

fn request_shell_value(app_user_model_id: &str, kind: ShellPresentationKind) -> Option<String> {
    let worker = {
        let mut current = shell_presentation_worker().lock().ok()?;
        if current.is_none() {
            *current = ShellPresentationWorker::start().map(Arc::new);
        }
        current.as_ref()?.clone()
    };

    match worker.resolve(app_user_model_id, kind) {
        ShellWorkerOutcome::Completed(value) => value,
        ShellWorkerOutcome::Disconnected => {
            if let Ok(mut current) = shell_presentation_worker().lock() {
                if current
                    .as_ref()
                    .is_some_and(|candidate| Arc::ptr_eq(candidate, &worker))
                {
                    *current = None;
                }
            }
            None
        }
        ShellWorkerOutcome::Busy | ShellWorkerOutcome::TimedOut => None,
    }
}

fn shell_presentation_worker() -> &'static Mutex<Option<Arc<ShellPresentationWorker>>> {
    static WORKER: OnceLock<Mutex<Option<Arc<ShellPresentationWorker>>>> = OnceLock::new();
    WORKER.get_or_init(|| Mutex::new(None))
}

fn resolve_shell_value_on_current_thread(
    app_user_model_id: &str,
    kind: ShellPresentationKind,
) -> Option<String> {
    let aumid_wide = OsStr::new(app_user_model_id)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let shell_item: IShellItem = unsafe {
        SHCreateItemInKnownFolder(
            &FOLDERID_AppsFolder,
            KF_FLAG_DEFAULT,
            PCWSTR(aumid_wide.as_ptr()),
        )
        .ok()?
    };

    match kind {
        ShellPresentationKind::DisplayName => {
            let value = unsafe { shell_item.GetDisplayName(SIGDN_NORMALDISPLAY) }.ok()?;
            let display_name = unsafe { value.to_string().ok() };
            unsafe { CoTaskMemFree(Some(value.0.cast())) };
            display_name.filter(|name| !name.trim().is_empty())
        }
        ShellPresentationKind::Icon => shell_item
            .cast::<IShellItemImageFactory>()
            .ok()
            .and_then(|factory| unsafe {
                factory
                    .GetImage(
                        SIZE {
                            cx: SHELL_ICON_SIZE,
                            cy: SHELL_ICON_SIZE,
                        },
                        SIIGBF_ICONONLY | SIIGBF_BIGGERSIZEOK,
                    )
                    .ok()
            })
            .and_then(icon::owned_hbitmap_to_base64),
    }
}

fn read_shell_value_cache(
    cache: &Mutex<HashMap<String, ShellValueCacheEntry>>,
    cache_key: &str,
    now_ms: u64,
) -> Option<Option<String>> {
    let mut cache = cache.lock().ok()?;
    let entry = cache.get(cache_key)?;
    if is_shell_value_cache_entry_fresh(entry, now_ms) {
        Some(entry.value.clone())
    } else {
        cache.remove(cache_key);
        None
    }
}

fn write_shell_value_cache(
    cache: &Mutex<HashMap<String, ShellValueCacheEntry>>,
    cache_key: String,
    value: Option<String>,
    now_ms: u64,
) {
    if let Ok(mut cache) = cache.lock() {
        prune_shell_value_cache(&mut cache, now_ms);
        if cache.len() >= SHELL_PRESENTATION_CACHE_MAX_ENTRIES && !cache.contains_key(&cache_key) {
            if let Some(oldest_key) = cache
                .iter()
                .min_by_key(|(_, entry)| entry.cached_at_ms)
                .map(|(key, _)| key.clone())
            {
                cache.remove(&oldest_key);
            }
        }
        cache.insert(
            cache_key,
            ShellValueCacheEntry {
                value,
                cached_at_ms: now_ms,
            },
        );
    }
}

fn is_shell_value_cache_entry_fresh(entry: &ShellValueCacheEntry, now_ms: u64) -> bool {
    let ttl_ms = if entry.value.is_some() {
        SHELL_PRESENTATION_CACHE_TTL_MS
    } else {
        SHELL_PRESENTATION_PARTIAL_CACHE_TTL_MS
    };
    now_ms.saturating_sub(entry.cached_at_ms) <= ttl_ms
}

fn prune_shell_value_cache(cache: &mut HashMap<String, ShellValueCacheEntry>, now_ms: u64) {
    cache.retain(|_, entry| is_shell_value_cache_entry_fresh(entry, now_ms));
}

fn shell_display_name_cache() -> &'static Mutex<HashMap<String, ShellValueCacheEntry>> {
    static CACHE: OnceLock<Mutex<HashMap<String, ShellValueCacheEntry>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn shell_icon_cache() -> &'static Mutex<HashMap<String, ShellValueCacheEntry>> {
    static CACHE: OnceLock<Mutex<HashMap<String, ShellValueCacheEntry>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn now_ms() -> u64 {
    crate::platform::clock::unix_timestamp_millis_u64()
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

fn should_skip_window_icon_fallback(exe_name: &str, window_class: &str) -> bool {
    exe_name.eq_ignore_ascii_case("explorer.exe")
        && !matches!(
            window_class.to_ascii_lowercase().as_str(),
            "cabinetwclass" | "explorewclass"
        )
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

#[cfg(test)]
mod tests {
    use super::{
        is_shell_value_cache_entry_fresh, read_shell_value_cache, select_display_name,
        select_packaged_icon, shell_display_name_cache, shell_icon_cache,
        should_skip_window_icon_fallback, write_shell_value_cache, ShellPresentationKind,
        ShellPresentationWorker, ShellValueCacheEntry, ShellWorkerOutcome,
        SHELL_PRESENTATION_CACHE_MAX_ENTRIES,
    };

    fn cache_test_guard() -> std::sync::MutexGuard<'static, ()> {
        static LOCK: std::sync::OnceLock<std::sync::Mutex<()>> = std::sync::OnceLock::new();
        LOCK.get_or_init(|| std::sync::Mutex::new(()))
            .lock()
            .unwrap()
    }

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
    fn packaged_display_name_prefers_shell_then_file_metadata() {
        assert_eq!(
            select_display_name(Some("Microsoft Store".into()), Some("WinStore".into())),
            Some("Microsoft Store".into())
        );
        assert_eq!(
            select_display_name(Some("  ".into()), Some("WinStore".into())),
            Some("WinStore".into())
        );
    }

    #[test]
    fn packaged_icon_stops_after_the_first_available_real_application_source() {
        use std::cell::Cell;

        let file_calls = Cell::new(0);
        let window_calls = Cell::new(0);
        assert_eq!(
            select_packaged_icon(
                Some("shell".into()),
                || {
                    file_calls.set(file_calls.get() + 1);
                    Some("file".into())
                },
                || {
                    window_calls.set(window_calls.get() + 1);
                    Some("window".into())
                },
            ),
            Some("shell".into())
        );
        assert_eq!(file_calls.get(), 0);
        assert_eq!(window_calls.get(), 0);

        assert_eq!(
            select_packaged_icon(
                None,
                || {
                    file_calls.set(file_calls.get() + 1);
                    Some("file".into())
                },
                || {
                    window_calls.set(window_calls.get() + 1);
                    Some("window".into())
                },
            ),
            Some("file".into())
        );
        assert_eq!(file_calls.get(), 1);
        assert_eq!(window_calls.get(), 0);

        assert_eq!(
            select_packaged_icon(
                None,
                || None,
                || {
                    window_calls.set(window_calls.get() + 1);
                    Some("window".into())
                },
            ),
            Some("window".into())
        );
        assert_eq!(window_calls.get(), 1);
    }

    #[test]
    fn disconnected_shell_worker_is_distinguishable_for_restart() {
        let (requests, receiver) = std::sync::mpsc::sync_channel(1);
        drop(receiver);
        let worker = ShellPresentationWorker { requests };

        assert_eq!(
            worker.resolve("Publisher.App!Main", ShellPresentationKind::Icon),
            ShellWorkerOutcome::Disconnected
        );
    }

    #[test]
    fn missing_shell_value_retries_quickly() {
        let entry = ShellValueCacheEntry {
            value: None,
            cached_at_ms: 1_000,
        };

        assert!(is_shell_value_cache_entry_fresh(&entry, 20_000));
        assert!(!is_shell_value_cache_entry_fresh(&entry, 31_001));
    }

    #[test]
    fn resolved_shell_value_uses_positive_ttl() {
        let entry = ShellValueCacheEntry {
            value: Some("App".into()),
            cached_at_ms: 1_000,
        };

        assert!(is_shell_value_cache_entry_fresh(&entry, 600_000));
        assert!(!is_shell_value_cache_entry_fresh(&entry, 601_001));
    }

    #[test]
    fn shell_value_cache_stays_bounded() {
        let _guard = cache_test_guard();
        let cache = shell_display_name_cache();
        cache.lock().unwrap().clear();
        for index in 0..(SHELL_PRESENTATION_CACHE_MAX_ENTRIES + 8) {
            write_shell_value_cache(
                cache,
                format!("publisher.app{index}!main"),
                Some(format!("App {index}")),
                700_000 + index as u64,
            );
        }

        assert_eq!(
            cache.lock().unwrap().len(),
            SHELL_PRESENTATION_CACHE_MAX_ENTRIES
        );
        assert_eq!(
            read_shell_value_cache(
                cache,
                &format!(
                    "publisher.app{}!main",
                    SHELL_PRESENTATION_CACHE_MAX_ENTRIES + 7
                ),
                700_500,
            )
            .flatten(),
            Some(format!("App {}", SHELL_PRESENTATION_CACHE_MAX_ENTRIES + 7))
        );
    }

    #[test]
    fn display_name_cache_does_not_suppress_icon_resolution() {
        let _guard = cache_test_guard();
        let display_cache = shell_display_name_cache();
        let icon_cache = shell_icon_cache();
        display_cache.lock().unwrap().clear();
        icon_cache.lock().unwrap().clear();
        write_shell_value_cache(
            display_cache,
            "publisher.app!main".into(),
            Some("App".into()),
            1_000,
        );

        assert_eq!(
            read_shell_value_cache(display_cache, "publisher.app!main", 2_000).flatten(),
            Some("App".into())
        );
        assert!(read_shell_value_cache(icon_cache, "publisher.app!main", 2_000).is_none());
    }
}
