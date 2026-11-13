use std::os::windows::io::{FromRawHandle, OwnedHandle};
use windows::Win32::System::Diagnostics::ToolHelp::*;

pub fn children(parent: u32) -> windows::core::Result<Vec<u32>> {
    let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0)? };
    let _handle = unsafe { OwnedHandle::from_raw_handle(snapshot.0) };
    let mut row = PROCESSENTRY32W {
        dwSize: std::mem::size_of::<PROCESSENTRY32W>() as _,
        ..Default::default()
    };
    let mut ids = Vec::new();
    unsafe {
        Process32FirstW(snapshot, &mut row)?;
    }
    loop {
        if row.th32ParentProcessID == parent {
            ids.push(row.th32ProcessID);
        }
        if let Err(e) = unsafe { Process32NextW(snapshot, &mut row) } {
            if e.code() != windows::Win32::Foundation::ERROR_NO_MORE_FILES.to_hresult() {
                return Err(e);
            }
            break;
        }
    }
    Ok(ids)
}

pub fn find<T>(parent: u32, lookup: impl FnMut(u32) -> Option<T>) -> Option<T> {
    children(parent).ok()?.into_iter().find_map(lookup)
}
