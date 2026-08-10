use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::ffi::OsString;
use std::os::windows::prelude::OsStringExt;
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Mutex, OnceLock,
};
use windows::Win32::Foundation::{HANDLE, HWND};
use windows::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
};
use windows::Win32::System::SystemInformation::GetTickCount;
use windows::Win32::System::Threading::{
    OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
};
use windows::Win32::UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO};
use windows::Win32::UI::WindowsAndMessaging::{
    GetAncestor, GetClassNameW, GetForegroundWindow, GetWindow, GetWindowLongPtrW, GetWindowTextW,
    GetWindowThreadProcessId, IsIconic, IsWindow, IsWindowVisible, GA_ROOTOWNER, GWL_EXSTYLE,
    GW_OWNER, WS_EX_TOOLWINDOW,
};

use crate::platform::windows::handles::OwnedHandle;

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct WindowInfo {
    pub hwnd: String,
    pub root_owner_hwnd: String,
    pub process_id: u32,
    pub window_class: String,
    pub title: String,
    pub exe_name: String,
    pub process_path: String,
    pub is_afk: bool,
    pub idle_time_ms: u32,
}

static AFK_THRESHOLD_SECS: AtomicU64 = AtomicU64::new(180);
const PROCESS_DETAILS_CACHE_TTL_MS: u64 = 10_000;
const PROCESS_DETAILS_NEGATIVE_CACHE_TTL_MS: u64 = 1_000;
const PROCESS_DETAILS_CACHE_MAX_ENTRIES: usize = 128;

#[derive(Clone, Debug)]
struct ProcessDetailsCacheEntry {
    exe_name: String,
    process_path: String,
    cached_at_ms: u64,
    is_negative: bool,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub struct ProcessDetailsCacheStats {
    pub entries: usize,
    pub positive_entries: usize,
    pub negative_entries: usize,
    pub max_entries: usize,
    pub ttl_ms: u64,
    pub negative_ttl_ms: u64,
}

pub fn has_meaningful_change(previous: Option<&WindowInfo>, next: &WindowInfo) -> bool {
    let Some(previous) = previous else {
        return true;
    };

    previous.title != next.title
        || previous.exe_name != next.exe_name
        || previous.process_path != next.process_path
        || previous.hwnd != next.hwnd
        || previous.root_owner_hwnd != next.root_owner_hwnd
        || previous.process_id != next.process_id
        || previous.window_class != next.window_class
        || previous.is_afk != next.is_afk
}

pub fn cmd_set_afk_threshold(threshold_secs: u64) {
    AFK_THRESHOLD_SECS.store(threshold_secs, Ordering::Relaxed);
}

pub fn get_active_window() -> WindowInfo {
    unsafe {
        // AFK detection uses the configured threshold from the tracking runtime.
        let mut last_input = LASTINPUTINFO {
            cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32,
            dwTime: 0,
        };

        let idle_time = if GetLastInputInfo(&mut last_input).ok().is_ok() {
            GetTickCount().wrapping_sub(last_input.dwTime)
        } else {
            0
        };

        let afk_threshold_ms = (AFK_THRESHOLD_SECS.load(Ordering::Relaxed) as u32) * 1000;
        let is_afk = idle_time > afk_threshold_ms;

        let hwnd = GetForegroundWindow();
        if should_treat_window_as_inactive(hwnd) {
            return build_inactive_window(idle_time, is_afk);
        }

        let root_owner_hwnd = get_root_owner_window(hwnd);
        if should_treat_window_as_inactive(root_owner_hwnd) {
            return build_inactive_window(idle_time, is_afk);
        }

        let title = get_window_title(hwnd);
        let window_class = get_window_class(hwnd);
        let (process_id, exe_name, process_path) = get_process_info(root_owner_hwnd);
        if !has_resolved_window_process(process_id, &exe_name) {
            return build_inactive_window(idle_time, is_afk);
        }
        if should_treat_shell_surface_as_inactive(root_owner_hwnd, &exe_name, &window_class) {
            return build_inactive_window(idle_time, is_afk);
        }

        WindowInfo {
            hwnd: format_hwnd(hwnd),
            root_owner_hwnd: format_hwnd(root_owner_hwnd),
            process_id,
            window_class,
            title,
            exe_name,
            process_path,
            is_afk,
            idle_time_ms: idle_time,
        }
    }
}

fn build_inactive_window(idle_time_ms: u32, is_afk: bool) -> WindowInfo {
    WindowInfo {
        hwnd: String::new(),
        root_owner_hwnd: String::new(),
        process_id: 0,
        window_class: String::new(),
        title: String::new(),
        exe_name: String::new(),
        process_path: String::new(),
        is_afk,
        idle_time_ms,
    }
}

fn format_hwnd(hwnd: HWND) -> String {
    format!("0x{:X}", hwnd.0 as usize)
}

unsafe fn should_treat_window_as_inactive(hwnd: HWND) -> bool {
    hwnd.0.is_null()
        || !IsWindow(Some(hwnd)).as_bool()
        || !IsWindowVisible(hwnd).as_bool()
        || IsIconic(hwnd).as_bool()
}

fn has_resolved_window_process(process_id: u32, exe_name: &str) -> bool {
    process_id != 0 && !exe_name.trim().is_empty()
}

unsafe fn should_treat_shell_surface_as_inactive(
    root_owner_hwnd: HWND,
    exe_name: &str,
    window_class: &str,
) -> bool {
    if !exe_name.eq_ignore_ascii_case("explorer.exe") {
        return false;
    }

    let class_key = window_class.to_ascii_lowercase();
    if !matches!(class_key.as_str(), "cabinetwclass" | "explorewclass") {
        return true;
    }

    !is_application_top_level_window(root_owner_hwnd)
}

unsafe fn is_application_top_level_window(hwnd: HWND) -> bool {
    if should_treat_window_as_inactive(hwnd) {
        return false;
    }

    if let Ok(owner) = GetWindow(hwnd, GW_OWNER) {
        if !owner.0.is_null() {
            return false;
        }
    }

    let extended_style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE) as u32;
    if (extended_style & WS_EX_TOOLWINDOW.0) != 0 {
        return false;
    }

    true
}

unsafe fn get_root_owner_window(hwnd: HWND) -> HWND {
    let root_owner = GetAncestor(hwnd, GA_ROOTOWNER);
    if root_owner.0.is_null() {
        hwnd
    } else {
        root_owner
    }
}

unsafe fn get_window_title(hwnd: HWND) -> String {
    let mut buffer = [0u16; 512];
    let len = GetWindowTextW(hwnd, &mut buffer);
    if len > 0 {
        OsString::from_wide(&buffer[..len as usize])
            .to_string_lossy()
            .into_owned()
    } else {
        String::new()
    }
}

unsafe fn get_window_class(hwnd: HWND) -> String {
    let mut buffer = [0u16; 256];
    let len = GetClassNameW(hwnd, &mut buffer);
    if len > 0 {
        OsString::from_wide(&buffer[..len as usize])
            .to_string_lossy()
            .into_owned()
    } else {
        String::new()
    }
}

unsafe fn get_process_info(hwnd: HWND) -> (u32, String, String) {
    let mut process_id = 0;
    GetWindowThreadProcessId(hwnd, Some(&mut process_id));
    if process_id == 0 {
        return (0, String::new(), String::new());
    }

    let (exe_name, process_path) = get_process_details(process_id);
    (process_id, exe_name, process_path)
}

pub fn get_process_path(process_id: u32) -> String {
    get_process_details(process_id).1
}

pub fn get_process_exe_name(process_id: u32) -> String {
    get_process_details(process_id).0
}

fn get_process_details(process_id: u32) -> (String, String) {
    let now_ms = now_ms();
    if let Some(entry) = read_cached_process_details(process_id, now_ms) {
        return (entry.exe_name, entry.process_path);
    }

    if let Some(process_path) = unsafe { get_process_path_from_handle(process_id) } {
        let details = if let Some(exe_name) = extract_exe_name_from_process_path(&process_path) {
            (exe_name, process_path)
        } else {
            resolve_process_details(Some(process_path), unsafe {
                get_process_name_from_snapshot(process_id)
            })
        };
        write_cached_process_details(process_id, &details, now_ms);
        return details;
    }

    let details =
        resolve_process_details(None, unsafe { get_process_name_from_snapshot(process_id) });
    write_cached_process_details(process_id, &details, now_ms);
    details
}

unsafe fn get_process_path_from_handle(process_id: u32) -> Option<String> {
    let handle =
        OwnedHandle::new(OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, process_id).ok()?)?;
    query_process_image_path(handle.raw())
}

unsafe fn query_process_image_path(handle: HANDLE) -> Option<String> {
    let mut buffer = [0u16; 1024];
    let mut size = buffer.len() as u32;
    QueryFullProcessImageNameW(
        handle,
        PROCESS_NAME_WIN32,
        windows::core::PWSTR(buffer.as_mut_ptr()),
        &mut size,
    )
    .ok()?;

    if size == 0 {
        return None;
    }

    Some(
        OsString::from_wide(&buffer[..size as usize])
            .to_string_lossy()
            .into_owned(),
    )
}

fn extract_exe_name_from_process_path(path: &str) -> Option<String> {
    std::path::Path::new(path)
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .filter(|name| !name.trim().is_empty())
}

fn resolve_process_details(
    process_path: Option<String>,
    fallback_exe_name: Option<String>,
) -> (String, String) {
    match process_path.filter(|path| !path.trim().is_empty()) {
        Some(path) => (
            extract_exe_name_from_process_path(&path)
                .or(fallback_exe_name)
                .unwrap_or_default(),
            path,
        ),
        None => (fallback_exe_name.unwrap_or_default(), String::new()),
    }
}

unsafe fn get_process_name_from_snapshot(process_id: u32) -> Option<String> {
    let snapshot = OwnedHandle::new(CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0).ok()?)?;

    let mut entry = PROCESSENTRY32W {
        dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
        ..Default::default()
    };

    let mut exe_name = None;

    if Process32FirstW(snapshot.raw(), &mut entry).is_ok() {
        loop {
            if entry.th32ProcessID == process_id {
                let len = entry
                    .szExeFile
                    .iter()
                    .position(|&ch| ch == 0)
                    .unwrap_or(entry.szExeFile.len());

                exe_name = Some(
                    OsString::from_wide(&entry.szExeFile[..len])
                        .to_string_lossy()
                        .into_owned(),
                );
                break;
            }

            if Process32NextW(snapshot.raw(), &mut entry).is_err() {
                break;
            }
        }
    }

    exe_name
}

fn read_cached_process_details(process_id: u32, now_ms: u64) -> Option<ProcessDetailsCacheEntry> {
    let mut cache = process_details_cache().lock().ok()?;
    let entry = cache.get(&process_id)?;

    if is_process_details_cache_entry_fresh(entry, now_ms) {
        Some(entry.clone())
    } else {
        cache.remove(&process_id);
        None
    }
}

fn write_cached_process_details(process_id: u32, details: &(String, String), now_ms: u64) {
    if let Ok(mut cache) = process_details_cache().lock() {
        prune_expired_process_details_cache(&mut cache, now_ms);
        if cache.len() >= PROCESS_DETAILS_CACHE_MAX_ENTRIES && !cache.contains_key(&process_id) {
            if let Some(oldest_process_id) = cache
                .iter()
                .min_by_key(|(_, entry)| entry.cached_at_ms)
                .map(|(cached_process_id, _)| *cached_process_id)
            {
                cache.remove(&oldest_process_id);
            }
        }

        cache.insert(
            process_id,
            ProcessDetailsCacheEntry {
                exe_name: details.0.clone(),
                process_path: details.1.clone(),
                cached_at_ms: now_ms,
                is_negative: details.0.trim().is_empty() && details.1.trim().is_empty(),
            },
        );
    }
}

fn is_process_details_cache_entry_fresh(entry: &ProcessDetailsCacheEntry, now_ms: u64) -> bool {
    let ttl_ms = if entry.is_negative {
        PROCESS_DETAILS_NEGATIVE_CACHE_TTL_MS
    } else {
        PROCESS_DETAILS_CACHE_TTL_MS
    };

    now_ms.saturating_sub(entry.cached_at_ms) <= ttl_ms
}

fn prune_expired_process_details_cache(
    cache: &mut HashMap<u32, ProcessDetailsCacheEntry>,
    now_ms: u64,
) {
    cache.retain(|_, entry| is_process_details_cache_entry_fresh(entry, now_ms));
}

fn process_details_cache() -> &'static Mutex<HashMap<u32, ProcessDetailsCacheEntry>> {
    static PROCESS_DETAILS_CACHE: OnceLock<Mutex<HashMap<u32, ProcessDetailsCacheEntry>>> =
        OnceLock::new();
    PROCESS_DETAILS_CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

pub fn process_details_cache_stats() -> ProcessDetailsCacheStats {
    let (entries, positive_entries, negative_entries) = process_details_cache()
        .lock()
        .map(|mut cache| {
            prune_expired_process_details_cache(&mut cache, now_ms());
            let entries = cache.len();
            let negative_entries = cache.values().filter(|entry| entry.is_negative).count();
            (
                entries,
                entries.saturating_sub(negative_entries),
                negative_entries,
            )
        })
        .unwrap_or((0, 0, 0));

    ProcessDetailsCacheStats {
        entries,
        positive_entries,
        negative_entries,
        max_entries: PROCESS_DETAILS_CACHE_MAX_ENTRIES,
        ttl_ms: PROCESS_DETAILS_CACHE_TTL_MS,
        negative_ttl_ms: PROCESS_DETAILS_NEGATIVE_CACHE_TTL_MS,
    }
}

fn now_ms() -> u64 {
    crate::platform::clock::unix_timestamp_millis_u64()
}

#[cfg(test)]
mod tests {
    use super::{
        build_inactive_window, extract_exe_name_from_process_path, has_resolved_window_process,
        is_application_top_level_window, process_details_cache, read_cached_process_details,
        resolve_process_details, should_treat_shell_surface_as_inactive,
        should_treat_window_as_inactive, write_cached_process_details,
        PROCESS_DETAILS_CACHE_MAX_ENTRIES,
    };
    use windows::Win32::Foundation::HWND;

    fn cache_test_guard() -> std::sync::MutexGuard<'static, ()> {
        static CACHE_TEST_LOCK: std::sync::OnceLock<std::sync::Mutex<()>> =
            std::sync::OnceLock::new();
        CACHE_TEST_LOCK
            .get_or_init(|| std::sync::Mutex::new(()))
            .lock()
            .unwrap()
    }

    fn clear_process_details_cache_for_tests() {
        process_details_cache().lock().unwrap().clear();
    }

    #[test]
    fn inactive_window_snapshot_preserves_non_afk_idle_state() {
        let snapshot = build_inactive_window(12_000, false);

        assert!(snapshot.exe_name.is_empty());
        assert!(snapshot.title.is_empty());
        assert!(!snapshot.is_afk);
        assert_eq!(snapshot.idle_time_ms, 12_000);
    }

    #[test]
    fn null_window_handle_is_treated_as_inactive() {
        let hwnd = HWND::default();

        assert!(unsafe { should_treat_window_as_inactive(hwnd) });
    }

    #[test]
    fn unresolved_window_process_is_not_trackable_foreground() {
        assert!(!has_resolved_window_process(0, ""));
        assert!(!has_resolved_window_process(42, ""));
        assert!(has_resolved_window_process(42, "Code.exe"));
    }

    #[test]
    fn process_path_exe_name_extracts_windows_file_names() {
        assert_eq!(
            extract_exe_name_from_process_path(r"C:\Windows\explorer.exe").as_deref(),
            Some("explorer.exe")
        );
        assert_eq!(
            extract_exe_name_from_process_path(r"C:\Program Files\App\App.exe").as_deref(),
            Some("App.exe")
        );
    }

    #[test]
    fn process_details_prefers_handle_path_exe_name() {
        let (exe_name, process_path) = resolve_process_details(
            Some(r"C:\Program Files\App\App.exe".to_string()),
            Some("Fallback.exe".to_string()),
        );

        assert_eq!(exe_name, "App.exe");
        assert_eq!(process_path, r"C:\Program Files\App\App.exe");
    }

    #[test]
    fn process_details_cache_expires_positive_entries_after_ttl() {
        let _guard = cache_test_guard();
        clear_process_details_cache_for_tests();
        write_cached_process_details(
            42,
            &("App.exe".to_string(), r"C:\App\App.exe".to_string()),
            1_000,
        );

        assert!(read_cached_process_details(42, 10_000).is_some());
        assert!(read_cached_process_details(42, 12_001).is_none());
    }

    #[test]
    fn process_details_cache_expires_negative_entries_quickly() {
        let _guard = cache_test_guard();
        clear_process_details_cache_for_tests();
        write_cached_process_details(43, &(String::new(), String::new()), 1_000);

        assert!(read_cached_process_details(43, 1_500).is_some());
        assert!(read_cached_process_details(43, 2_001).is_none());
    }

    #[test]
    fn process_details_cache_prunes_expired_entries_before_writing() {
        let _guard = cache_test_guard();
        clear_process_details_cache_for_tests();
        write_cached_process_details(
            44,
            &("Old.exe".to_string(), r"C:\Old\Old.exe".to_string()),
            1_000,
        );
        write_cached_process_details(
            45,
            &("New.exe".to_string(), r"C:\New\New.exe".to_string()),
            12_001,
        );

        assert!(read_cached_process_details(44, 12_001).is_none());
        assert!(read_cached_process_details(45, 12_001).is_some());
    }

    #[test]
    fn process_details_cache_keeps_a_bounded_number_of_entries() {
        let _guard = cache_test_guard();
        clear_process_details_cache_for_tests();
        for index in 0..(PROCESS_DETAILS_CACHE_MAX_ENTRIES + 8) {
            write_cached_process_details(
                1_000 + index as u32,
                &(
                    format!("App{index}.exe"),
                    format!(r"C:\Apps\App{index}\App{index}.exe"),
                ),
                20_000 + index as u64,
            );
        }

        assert!(read_cached_process_details(1_000, 30_000).is_none());
        assert!(read_cached_process_details(
            1_000 + PROCESS_DETAILS_CACHE_MAX_ENTRIES as u32 + 7,
            30_000,
        )
        .is_some());
    }

    #[test]
    fn process_details_uses_snapshot_name_when_handle_path_is_missing() {
        let (exe_name, process_path) =
            resolve_process_details(None, Some("Fallback.exe".to_string()));

        assert_eq!(exe_name, "Fallback.exe");
        assert!(process_path.is_empty());
    }

    #[test]
    fn explorer_shell_surfaces_are_not_trackable_foreground_windows() {
        assert!(unsafe {
            should_treat_shell_surface_as_inactive(HWND::default(), "explorer.exe", "Progman")
        });
        assert!(unsafe {
            should_treat_shell_surface_as_inactive(HWND::default(), "explorer.exe", "WorkerW")
        });
        assert!(!unsafe {
            should_treat_shell_surface_as_inactive(HWND::default(), "Code.exe", "Progman")
        });
    }

    #[test]
    fn null_handle_is_not_an_application_top_level_window() {
        assert!(!unsafe { is_application_top_level_window(HWND::default()) });
    }
}
