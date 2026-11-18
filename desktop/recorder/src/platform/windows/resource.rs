use crate::platform::windows::handles::OwnedHandle;
use serde::Serialize;
use windows::Win32::Foundation::{GetLastError, SetLastError, ERROR_NO_MORE_FILES, ERROR_SUCCESS};
use windows::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, Thread32First, Thread32Next, TH32CS_SNAPTHREAD, THREADENTRY32,
};
use windows::Win32::System::ProcessStatus::{GetProcessMemoryInfo, PROCESS_MEMORY_COUNTERS_EX};
use windows::Win32::System::Threading::{
    GetCurrentProcess, GetCurrentProcessId, GetGuiResources, GetProcessHandleCount,
    GET_GUI_RESOURCES_FLAGS, GR_GDIOBJECTS, GR_USEROBJECTS,
};

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub struct WindowsProcessResourceSnapshot {
    pub handle_count: Option<u32>,
    pub thread_count: Option<u32>,
    pub working_set_bytes: Option<usize>,
    pub private_usage_bytes: Option<usize>,
    pub gdi_objects: Option<u32>,
    pub user_objects: Option<u32>,
}

pub fn current_process_resource_snapshot() -> WindowsProcessResourceSnapshot {
    let memory = current_process_memory_counters();

    WindowsProcessResourceSnapshot {
        handle_count: current_process_handle_count(),
        thread_count: current_process_thread_count(),
        working_set_bytes: memory.map(|counters| counters.WorkingSetSize),
        private_usage_bytes: memory.map(|counters| counters.PrivateUsage),
        gdi_objects: current_gui_resources(GR_GDIOBJECTS),
        user_objects: current_gui_resources(GR_USEROBJECTS),
    }
}

fn current_process_handle_count() -> Option<u32> {
    let mut handle_count = 0_u32;
    unsafe {
        GetProcessHandleCount(GetCurrentProcess(), &mut handle_count).ok()?;
    }
    Some(handle_count)
}

fn current_process_thread_count() -> Option<u32> {
    let process_id = unsafe { GetCurrentProcessId() };
    let snapshot =
        unsafe { OwnedHandle::new(CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD, 0).ok()?) }?;
    let mut entry = THREADENTRY32 {
        dwSize: std::mem::size_of::<THREADENTRY32>() as u32,
        ..Default::default()
    };
    let mut count = 0_u32;

    unsafe {
        if let Err(error) = Thread32First(snapshot.raw(), &mut entry) {
            return (error.code() == ERROR_NO_MORE_FILES.to_hresult()).then_some(count);
        }

        loop {
            if entry.th32OwnerProcessID == process_id {
                count = count.saturating_add(1);
            }

            if let Err(error) = Thread32Next(snapshot.raw(), &mut entry) {
                if error.code() == ERROR_NO_MORE_FILES.to_hresult() {
                    break;
                }
                return None;
            }
        }
    }

    Some(count)
}

fn current_gui_resources(flags: GET_GUI_RESOURCES_FLAGS) -> Option<u32> {
    unsafe {
        SetLastError(ERROR_SUCCESS);
        let count = GetGuiResources(GetCurrentProcess(), flags);
        (count > 0 || GetLastError() == ERROR_SUCCESS).then_some(count)
    }
}

fn current_process_memory_counters() -> Option<PROCESS_MEMORY_COUNTERS_EX> {
    let mut counters = PROCESS_MEMORY_COUNTERS_EX {
        cb: std::mem::size_of::<PROCESS_MEMORY_COUNTERS_EX>() as u32,
        ..Default::default()
    };

    unsafe {
        GetProcessMemoryInfo(
            GetCurrentProcess(),
            &mut counters as *mut PROCESS_MEMORY_COUNTERS_EX as *mut _,
            counters.cb,
        )
        .ok()?;
    }

    Some(counters)
}
