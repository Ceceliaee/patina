//! Read the image and arguments of live children owned by a test process.
use std::{
    ffi::OsString,
    os::windows::ffi::OsStringExt,
    path::{Path, PathBuf},
};
use windows::{
    Wdk::System::Threading::{NtQueryInformationProcess, ProcessCommandLineInformation},
    Win32::{
        Foundation::{HANDLE, HLOCAL, UNICODE_STRING},
        System::{Diagnostics::ToolHelp::*, Threading::*},
        UI::Shell::CommandLineToArgvW,
    },
    core::{Owned, PCWSTR, PWSTR, Result},
};

pub struct ChildProcess {
    pub pid: u32,
    pub arguments: Vec<String>,
}

fn open(pid: u32) -> Result<Owned<HANDLE>> {
    unsafe {
        Ok(Owned::new(OpenProcess(
            PROCESS_QUERY_LIMITED_INFORMATION,
            false,
            pid,
        )?))
    }
}

fn image(handle: HANDLE) -> Result<PathBuf> {
    let mut buffer = vec![0u16; 32768];
    let mut len = buffer.len() as u32;
    unsafe {
        QueryFullProcessImageNameW(
            handle,
            PROCESS_NAME_FORMAT(0),
            PWSTR(buffer.as_mut_ptr()),
            &mut len,
        )?
    };
    Ok(PathBuf::from(OsString::from_wide(&buffer[..len as usize])))
}

pub fn path(pid: u32) -> Option<PathBuf> {
    image(*open(pid).ok()?).ok()
}

fn arguments(handle: HANDLE) -> Option<Vec<String>> {
    let mut needed = 0;
    let _ = unsafe {
        NtQueryInformationProcess(
            handle,
            ProcessCommandLineInformation,
            std::ptr::null_mut(),
            0,
            &mut needed,
        )
    };
    if !(size_of::<UNICODE_STRING>()..=128 * 1024).contains(&(needed as usize)) {
        return None;
    }
    let mut buffer = vec![0usize; (needed as usize).div_ceil(size_of::<usize>())];
    unsafe {
        NtQueryInformationProcess(
            handle,
            ProcessCommandLineInformation,
            buffer.as_mut_ptr().cast(),
            needed,
            &mut needed,
        )
        .ok()
        .ok()?;
        // The kernel returns a UNICODE_STRING and its UTF-16 text in the same aligned allocation.
        let line = &*buffer.as_ptr().cast::<UNICODE_STRING>();
        let offset = (line.Buffer.0 as usize).checked_sub(buffer.as_ptr() as usize)?;
        if line.Length == 0
            || !offset.is_multiple_of(size_of::<u16>())
            || !line.Length.is_multiple_of(2)
            || offset.checked_add(line.Length as usize)? > needed as usize
        {
            return None;
        }
        let mut text = std::slice::from_raw_parts(line.Buffer.0, line.Length as usize / 2).to_vec();
        text.push(0);
        let mut count = 0;
        let argv = CommandLineToArgvW(PCWSTR(text.as_ptr()), &mut count);
        if argv.is_null() {
            return None;
        }
        let _allocated = Owned::new(HLOCAL(argv.cast()));
        Some(
            std::slice::from_raw_parts(argv, count as usize)
                .iter()
                .map(|a| String::from_utf16_lossy(a.as_wide()))
                .collect(),
        )
    }
}

pub fn children(parent: u32, executable: &Path) -> Result<Vec<ChildProcess>> {
    let expected = executable.canonicalize()?;
    let snapshot = unsafe { Owned::new(CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0)?) };
    let mut row = PROCESSENTRY32W {
        dwSize: size_of::<PROCESSENTRY32W>() as _,
        ..Default::default()
    };
    let mut found = Vec::new();
    let mut next = unsafe { Process32FirstW(*snapshot, &mut row) };
    while next.is_ok() {
        if row.th32ParentProcessID == parent
            && let Ok(process) = open(row.th32ProcessID)
            && image(*process)
                .ok()
                .and_then(|p| p.canonicalize().ok())
                .as_ref()
                == Some(&expected)
            && let Some(arguments) = arguments(*process)
        {
            found.push(ChildProcess {
                pid: row.th32ProcessID,
                arguments,
            });
        }
        next = unsafe { Process32NextW(*snapshot, &mut row) };
    }
    Ok(found)
}
