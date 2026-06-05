use serde::{Deserialize, Serialize};
use std::ffi::OsString;
use std::os::windows::prelude::OsStringExt;
use std::sync::atomic::{AtomicU64, Ordering};
use windows::Win32::Foundation::{CloseHandle, HANDLE, HWND};
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
    if let Some(process_path) = unsafe { get_process_path_from_handle(process_id) } {
        if let Some(exe_name) = extract_exe_name_from_process_path(&process_path) {
            return (exe_name, process_path);
        }

        return resolve_process_details(Some(process_path), unsafe {
            get_process_name_from_snapshot(process_id)
        });
    }

    resolve_process_details(None, unsafe { get_process_name_from_snapshot(process_id) })
}

unsafe fn get_process_path_from_handle(process_id: u32) -> Option<String> {
    let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, process_id).ok()?;
    let path = query_process_image_path(handle);
    let _ = CloseHandle(handle);
    path
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
    let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0).ok()?;

    let mut entry = PROCESSENTRY32W {
        dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
        ..Default::default()
    };

    let mut exe_name = None;

    if Process32FirstW(snapshot, &mut entry).is_ok() {
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

            if Process32NextW(snapshot, &mut entry).is_err() {
                break;
            }
        }
    }

    let _ = CloseHandle(snapshot);
    exe_name
}

#[cfg(test)]
mod tests {
    use super::{
        build_inactive_window, extract_exe_name_from_process_path, has_resolved_window_process,
        is_application_top_level_window, resolve_process_details,
        should_treat_shell_surface_as_inactive, should_treat_window_as_inactive,
    };
    use windows::Win32::Foundation::HWND;

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
