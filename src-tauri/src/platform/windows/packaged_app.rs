use std::collections::{BTreeMap, HashMap};
use std::sync::{Mutex, OnceLock};

use windows::core::{BOOL, PWSTR};
use windows::Win32::Foundation::{
    APPMODEL_ERROR_NO_APPLICATION, ERROR_INSUFFICIENT_BUFFER, ERROR_SUCCESS, HWND, LPARAM,
};
use windows::Win32::Storage::Packaging::Appx::GetApplicationUserModelId;
use windows::Win32::System::Threading::{OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION};
use windows::Win32::UI::WindowsAndMessaging::{
    EnumChildWindows, GetWindowThreadProcessId, IsWindowVisible,
};

use crate::platform::windows::handles::OwnedHandle;

use super::foreground;

pub(crate) const APPLICATION_FRAME_HOST_EXE: &str = "ApplicationFrameHost.exe";
const IDENTITY_CACHE_TTL_MS: u64 = 10_000;
const IDENTITY_NEGATIVE_CACHE_TTL_MS: u64 = 1_000;
const IDENTITY_CACHE_MAX_ENTRIES: usize = 128;

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ResolvedHostedApp {
    pub process_id: u32,
    pub exe_name: String,
    pub process_path: String,
    pub app_user_model_id: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum HostedAppResolution {
    NotApplicable,
    Resolved(ResolvedHostedApp),
    Unavailable,
    Ambiguous,
}

#[derive(Clone, Debug, PartialEq, Eq)]
enum ProcessAppIdentity {
    Resolved(String),
    NoApplication,
    Unavailable,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum InitialIdentityQuery {
    Read(usize),
    NoApplication,
    Unavailable,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum BufferedIdentityQuery {
    Success,
    Resize(usize),
    NoApplication,
    Unavailable,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct HostedAppCandidate {
    process_id: u32,
    exe_name: String,
    process_path: String,
    app_user_model_id: String,
    owns_visible_window: bool,
}

#[derive(Clone, Debug)]
struct ProcessIdentityCacheEntry {
    process_path: String,
    identity: ProcessAppIdentity,
    cached_at_ms: u64,
}

#[derive(Default)]
struct DescendantCollection {
    windows: Vec<HWND>,
    allocation_failed: bool,
}

pub(crate) fn resolve_hosted_app(
    root_owner_hwnd: HWND,
    root_process_id: u32,
    root_exe_name: &str,
) -> HostedAppResolution {
    if !root_exe_name.eq_ignore_ascii_case(APPLICATION_FRAME_HOST_EXE) {
        return HostedAppResolution::NotApplicable;
    }

    let Some(descendants) = collect_descendant_windows(root_owner_hwnd) else {
        return HostedAppResolution::Unavailable;
    };
    let mut candidates = Vec::new();
    for hwnd in descendants {
        let mut process_id = 0u32;
        unsafe {
            GetWindowThreadProcessId(hwnd, Some(&mut process_id));
        }
        if process_id == 0 || process_id == root_process_id {
            continue;
        }

        let process_path = foreground::get_process_path(process_id);
        let exe_name = foreground::get_process_exe_name(process_id);
        if process_path.trim().is_empty()
            || exe_name.trim().is_empty()
            || exe_name.eq_ignore_ascii_case(APPLICATION_FRAME_HOST_EXE)
        {
            continue;
        }

        let identity = resolve_process_app_identity(process_id, &process_path);
        let ProcessAppIdentity::Resolved(app_user_model_id) = identity else {
            continue;
        };
        if app_user_model_id.trim().is_empty() {
            continue;
        }

        candidates.push(HostedAppCandidate {
            process_id,
            exe_name,
            process_path,
            app_user_model_id,
            owns_visible_window: unsafe { IsWindowVisible(hwnd).as_bool() },
        });
    }

    select_hosted_app_candidate(candidates)
}

pub(crate) fn find_descendant_window_for_process(
    root_owner_hwnd: HWND,
    process_id: u32,
) -> Option<HWND> {
    collect_descendant_windows(root_owner_hwnd)?
        .into_iter()
        .filter(|hwnd| {
            let mut candidate_process_id = 0u32;
            unsafe {
                GetWindowThreadProcessId(*hwnd, Some(&mut candidate_process_id));
            }
            candidate_process_id == process_id
        })
        .max_by_key(|hwnd| unsafe { IsWindowVisible(*hwnd).as_bool() })
}

fn select_hosted_app_candidate(candidates: Vec<HostedAppCandidate>) -> HostedAppResolution {
    let mut by_identity = BTreeMap::<String, Vec<HostedAppCandidate>>::new();
    for candidate in candidates {
        let identity_key = candidate.app_user_model_id.trim().to_ascii_lowercase();
        if candidate.process_id == 0
            || candidate.exe_name.trim().is_empty()
            || candidate.process_path.trim().is_empty()
            || identity_key.is_empty()
        {
            continue;
        }
        by_identity.entry(identity_key).or_default().push(candidate);
    }

    if by_identity.is_empty() {
        return HostedAppResolution::Unavailable;
    }
    if by_identity.len() != 1 {
        return HostedAppResolution::Ambiguous;
    }

    let candidates = by_identity.into_values().next().unwrap_or_default();
    let mut preferred = candidates
        .iter()
        .filter(|candidate| candidate.owns_visible_window)
        .cloned()
        .collect::<Vec<_>>();
    if preferred.is_empty() {
        preferred = candidates;
    }

    let executable_keys = preferred
        .iter()
        .map(|candidate| candidate.exe_name.trim().to_ascii_lowercase())
        .collect::<std::collections::BTreeSet<_>>();
    if executable_keys.len() != 1 {
        return HostedAppResolution::Ambiguous;
    }

    preferred.sort_by_key(|candidate| candidate.process_id);
    let Some(candidate) = preferred.into_iter().next() else {
        return HostedAppResolution::Unavailable;
    };

    HostedAppResolution::Resolved(ResolvedHostedApp {
        process_id: candidate.process_id,
        exe_name: candidate.exe_name,
        process_path: candidate.process_path,
        app_user_model_id: candidate.app_user_model_id,
    })
}

fn collect_descendant_windows(root_owner_hwnd: HWND) -> Option<Vec<HWND>> {
    let mut collection = DescendantCollection::default();
    let enumerated = unsafe {
        EnumChildWindows(
            Some(root_owner_hwnd),
            Some(collect_descendant_window),
            LPARAM((&mut collection as *mut DescendantCollection) as isize),
        )
        .as_bool()
    };
    if !enumerated || collection.allocation_failed {
        None
    } else {
        Some(collection.windows)
    }
}

unsafe extern "system" fn collect_descendant_window(hwnd: HWND, lparam: LPARAM) -> BOOL {
    let Some(collection) = (lparam.0 as *mut DescendantCollection).as_mut() else {
        return false.into();
    };
    if collection.windows.try_reserve(1).is_err() {
        collection.allocation_failed = true;
        return false.into();
    }
    collection.windows.push(hwnd);
    true.into()
}

fn resolve_process_app_identity(process_id: u32, process_path: &str) -> ProcessAppIdentity {
    let now_ms = now_ms();
    if let Some(identity) = read_cached_process_identity(process_id, process_path, now_ms) {
        return identity;
    }

    let identity = query_process_app_identity(process_id);
    write_cached_process_identity(process_id, process_path, identity.clone(), now_ms);
    identity
}

fn query_process_app_identity(process_id: u32) -> ProcessAppIdentity {
    let Some(process) = (unsafe {
        OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, process_id)
            .ok()
            .and_then(OwnedHandle::new)
    }) else {
        return ProcessAppIdentity::Unavailable;
    };

    let mut length = 0u32;
    let initial_status = unsafe { GetApplicationUserModelId(process.raw(), &mut length, None) };
    let initial_query = classify_initial_identity_query(initial_status, length);
    let InitialIdentityQuery::Read(initial_length) = initial_query else {
        return match initial_query {
            InitialIdentityQuery::NoApplication => ProcessAppIdentity::NoApplication,
            InitialIdentityQuery::Read(_) | InitialIdentityQuery::Unavailable => {
                ProcessAppIdentity::Unavailable
            }
        };
    };
    length = initial_length as u32;

    for _ in 0..2 {
        let mut buffer = vec![0u16; length as usize];
        let status = unsafe {
            GetApplicationUserModelId(process.raw(), &mut length, Some(PWSTR(buffer.as_mut_ptr())))
        };
        match classify_buffered_identity_query(status, length, buffer.len()) {
            BufferedIdentityQuery::Success => {}
            BufferedIdentityQuery::Resize(required_length) => {
                length = required_length as u32;
                continue;
            }
            BufferedIdentityQuery::NoApplication => return ProcessAppIdentity::NoApplication,
            BufferedIdentityQuery::Unavailable => return ProcessAppIdentity::Unavailable,
        }

        let terminator = buffer
            .iter()
            .position(|value| *value == 0)
            .unwrap_or(buffer.len());
        let Ok(identity) = String::from_utf16(&buffer[..terminator]) else {
            return ProcessAppIdentity::Unavailable;
        };
        return if identity.trim().is_empty() {
            ProcessAppIdentity::Unavailable
        } else {
            ProcessAppIdentity::Resolved(identity)
        };
    }

    ProcessAppIdentity::Unavailable
}

fn classify_initial_identity_query(
    status: windows::Win32::Foundation::WIN32_ERROR,
    required_length: u32,
) -> InitialIdentityQuery {
    if status == APPMODEL_ERROR_NO_APPLICATION {
        InitialIdentityQuery::NoApplication
    } else if status == ERROR_INSUFFICIENT_BUFFER && required_length >= 2 {
        InitialIdentityQuery::Read(required_length as usize)
    } else {
        InitialIdentityQuery::Unavailable
    }
}

fn classify_buffered_identity_query(
    status: windows::Win32::Foundation::WIN32_ERROR,
    required_length: u32,
    buffer_length: usize,
) -> BufferedIdentityQuery {
    if status == ERROR_SUCCESS {
        BufferedIdentityQuery::Success
    } else if status == APPMODEL_ERROR_NO_APPLICATION {
        BufferedIdentityQuery::NoApplication
    } else if status == ERROR_INSUFFICIENT_BUFFER && required_length as usize > buffer_length {
        BufferedIdentityQuery::Resize(required_length as usize)
    } else {
        BufferedIdentityQuery::Unavailable
    }
}

fn read_cached_process_identity(
    process_id: u32,
    process_path: &str,
    now_ms: u64,
) -> Option<ProcessAppIdentity> {
    let mut cache = process_identity_cache().lock().ok()?;
    let entry = cache.get(&process_id)?;
    if entry.process_path.eq_ignore_ascii_case(process_path)
        && is_process_identity_cache_entry_fresh(entry, now_ms)
    {
        Some(entry.identity.clone())
    } else {
        cache.remove(&process_id);
        None
    }
}

fn write_cached_process_identity(
    process_id: u32,
    process_path: &str,
    identity: ProcessAppIdentity,
    now_ms: u64,
) {
    if let Ok(mut cache) = process_identity_cache().lock() {
        prune_process_identity_cache(&mut cache, now_ms);
        if cache.len() >= IDENTITY_CACHE_MAX_ENTRIES && !cache.contains_key(&process_id) {
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
            ProcessIdentityCacheEntry {
                process_path: process_path.to_string(),
                identity,
                cached_at_ms: now_ms,
            },
        );
    }
}

fn is_process_identity_cache_entry_fresh(entry: &ProcessIdentityCacheEntry, now_ms: u64) -> bool {
    let ttl_ms = if matches!(entry.identity, ProcessAppIdentity::Resolved(_)) {
        IDENTITY_CACHE_TTL_MS
    } else {
        IDENTITY_NEGATIVE_CACHE_TTL_MS
    };
    now_ms.saturating_sub(entry.cached_at_ms) <= ttl_ms
}

fn prune_process_identity_cache(cache: &mut HashMap<u32, ProcessIdentityCacheEntry>, now_ms: u64) {
    cache.retain(|_, entry| is_process_identity_cache_entry_fresh(entry, now_ms));
}

fn process_identity_cache() -> &'static Mutex<HashMap<u32, ProcessIdentityCacheEntry>> {
    static CACHE: OnceLock<Mutex<HashMap<u32, ProcessIdentityCacheEntry>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn now_ms() -> u64 {
    crate::platform::clock::unix_timestamp_millis_u64()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cache_test_guard() -> std::sync::MutexGuard<'static, ()> {
        static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        LOCK.get_or_init(|| Mutex::new(())).lock().unwrap()
    }

    fn candidate(
        process_id: u32,
        app_user_model_id: &str,
        exe_name: &str,
        owns_visible_window: bool,
    ) -> HostedAppCandidate {
        HostedAppCandidate {
            process_id,
            exe_name: exe_name.to_string(),
            process_path: format!(r"C:\Apps\{exe_name}"),
            app_user_model_id: app_user_model_id.to_string(),
            owns_visible_window,
        }
    }

    #[test]
    fn non_host_process_is_not_applicable() {
        assert_eq!(
            resolve_hosted_app(HWND::default(), 1, "Code.exe"),
            HostedAppResolution::NotApplicable
        );
    }

    #[test]
    fn single_candidate_resolves_real_application() {
        let result =
            select_hosted_app_candidate(vec![candidate(42, "Publisher.App!Main", "App.exe", true)]);

        assert!(matches!(
            result,
            HostedAppResolution::Resolved(ResolvedHostedApp {
                process_id: 42,
                ref exe_name,
                ref app_user_model_id,
                ..
            }) if exe_name == "App.exe" && app_user_model_id == "Publisher.App!Main"
        ));
    }

    #[test]
    fn zero_candidate_is_unavailable() {
        assert_eq!(
            select_hosted_app_candidate(Vec::new()),
            HostedAppResolution::Unavailable
        );
    }

    #[test]
    fn same_identity_prefers_visible_application_window() {
        let result = select_hosted_app_candidate(vec![
            candidate(10, "Publisher.App!Main", "Background.exe", false),
            candidate(20, "publisher.app!main", "App.exe", true),
        ]);

        assert!(matches!(
            result,
            HostedAppResolution::Resolved(ResolvedHostedApp { process_id: 20, .. })
        ));
    }

    #[test]
    fn different_identities_are_ambiguous() {
        assert_eq!(
            select_hosted_app_candidate(vec![
                candidate(10, "Publisher.First!Main", "First.exe", true),
                candidate(20, "Publisher.Second!Main", "Second.exe", true),
            ]),
            HostedAppResolution::Ambiguous
        );
    }

    #[test]
    fn same_identity_with_multiple_visible_executables_is_ambiguous() {
        assert_eq!(
            select_hosted_app_candidate(vec![
                candidate(10, "Publisher.App!Main", "First.exe", true),
                candidate(20, "publisher.app!main", "Second.exe", true),
            ]),
            HostedAppResolution::Ambiguous
        );
    }

    #[test]
    fn empty_identity_is_not_a_candidate() {
        assert_eq!(
            select_hosted_app_candidate(vec![candidate(10, "", "App.exe", true)]),
            HostedAppResolution::Unavailable
        );
    }

    #[test]
    fn incomplete_process_details_are_not_candidates() {
        let mut missing_path = candidate(10, "Publisher.App!Main", "App.exe", true);
        missing_path.process_path.clear();
        let missing_executable = candidate(20, "Publisher.App!Main", "", true);

        assert_eq!(
            select_hosted_app_candidate(vec![missing_path, missing_executable]),
            HostedAppResolution::Unavailable
        );
    }

    #[test]
    fn identity_cache_expires_and_invalidates_pid_reuse() {
        let mut cache = HashMap::new();
        cache.insert(
            42,
            ProcessIdentityCacheEntry {
                process_path: r"C:\Apps\App.exe".to_string(),
                identity: ProcessAppIdentity::Resolved("Publisher.App!Main".to_string()),
                cached_at_ms: 1_000,
            },
        );

        let entry = cache.get(&42).unwrap();
        assert!(is_process_identity_cache_entry_fresh(entry, 10_000));
        assert!(!is_process_identity_cache_entry_fresh(entry, 12_001));
        assert!(!entry
            .process_path
            .eq_ignore_ascii_case(r"C:\Other\ReusedPid.exe"));
    }

    #[test]
    fn negative_identity_cache_expires_quickly() {
        let entry = ProcessIdentityCacheEntry {
            process_path: r"C:\Apps\App.exe".to_string(),
            identity: ProcessAppIdentity::NoApplication,
            cached_at_ms: 1_000,
        };

        assert!(is_process_identity_cache_entry_fresh(&entry, 1_500));
        assert!(!is_process_identity_cache_entry_fresh(&entry, 2_001));
    }

    #[test]
    fn application_identity_status_mapping_covers_supported_outcomes() {
        assert_eq!(
            classify_initial_identity_query(ERROR_INSUFFICIENT_BUFFER, 32),
            InitialIdentityQuery::Read(32)
        );
        assert_eq!(
            classify_initial_identity_query(APPMODEL_ERROR_NO_APPLICATION, 0),
            InitialIdentityQuery::NoApplication
        );
        assert_eq!(
            classify_initial_identity_query(windows::Win32::Foundation::ERROR_ACCESS_DENIED, 0,),
            InitialIdentityQuery::Unavailable
        );
        assert_eq!(
            classify_buffered_identity_query(ERROR_SUCCESS, 32, 32),
            BufferedIdentityQuery::Success
        );
        assert_eq!(
            classify_buffered_identity_query(ERROR_INSUFFICIENT_BUFFER, 64, 32),
            BufferedIdentityQuery::Resize(64)
        );
        assert_eq!(
            classify_buffered_identity_query(
                windows::Win32::Foundation::ERROR_ACCESS_DENIED,
                32,
                32,
            ),
            BufferedIdentityQuery::Unavailable
        );
    }

    #[test]
    fn process_identity_cache_is_bounded_and_rejects_pid_path_reuse() {
        let _guard = cache_test_guard();
        process_identity_cache().lock().unwrap().clear();
        for index in 0..(IDENTITY_CACHE_MAX_ENTRIES + 8) {
            write_cached_process_identity(
                1_000 + index as u32,
                &format!(r"C:\Apps\App{index}.exe"),
                ProcessAppIdentity::Resolved(format!("Publisher.App{index}!Main")),
                20_000 + index as u64,
            );
        }

        assert_eq!(
            process_identity_cache().lock().unwrap().len(),
            IDENTITY_CACHE_MAX_ENTRIES
        );
        let newest_pid = 1_000 + IDENTITY_CACHE_MAX_ENTRIES as u32 + 7;
        assert!(read_cached_process_identity(
            newest_pid,
            &format!(r"C:\Apps\App{}.exe", IDENTITY_CACHE_MAX_ENTRIES + 7),
            30_000,
        )
        .is_some());
        assert!(
            read_cached_process_identity(newest_pid, r"C:\Apps\Different.exe", 30_000,).is_none()
        );
    }
}
