//! Run a libtest case and its GUI descendants on a temporary Win32 desktop.
pub mod polling;
pub mod process;
use std::{
    env, fs,
    io::{self, Read, Seek},
    mem::{size_of, size_of_val},
    os::windows::{ffi::OsStrExt, fs::OpenOptionsExt, io::AsRawHandle},
    sync::atomic::{AtomicU32, Ordering},
};
use windows::{
    Win32::{
        Foundation::*,
        System::{StationsAndDesktops::*, Threading::*},
    },
    core::{HSTRING, Owned, PCWSTR, PWSTR},
};

use patina_windows_integration::windows::job;

const PREFIX: &str = "Patina-Test-";
const DEDICATED: &str = "PATINA_DEDICATED_TEST_SESSION";
static SERIAL: AtomicU32 = AtomicU32::new(0);

fn desktop_name(desktop: HDESK) -> io::Result<String> {
    let mut name = [0u16; 256];
    let mut bytes = 0;
    unsafe {
        GetUserObjectInformationW(
            HANDLE(desktop.0),
            UOI_NAME,
            Some(name.as_mut_ptr().cast()),
            size_of_val(&name) as u32,
            Some(&mut bytes),
        )?;
    }
    Ok(String::from_utf16_lossy(
        &name[..(bytes as usize / 2).saturating_sub(1)],
    ))
}

fn current() -> io::Result<String> {
    desktop_name(unsafe { GetThreadDesktop(GetCurrentThreadId())? })
}

fn input() -> io::Result<String> {
    let desktop = unsafe {
        Owned::new(OpenInputDesktop(
            Default::default(),
            false,
            DESKTOP_READOBJECTS,
        )?)
    };
    desktop_name(*desktop)
}

/// Set the opt-in only inside the Windows VM or interactive session reserved for testing.
pub fn dedicated_session() -> io::Result<()> {
    if env::var(DEDICATED).as_deref() == Ok("1") && current()? == input()? {
        Ok(())
    } else {
        Err(io::Error::other(format!(
            "Requires a dedicated interactive Windows test session; set {DEDICATED}=1 inside that session."
        )))
    }
}

/// The outer libtest case waits for the same exact case in the isolated worker.
/// Only the worker enters the test body.
pub fn run_case() -> io::Result<bool> {
    let thread = std::thread::current();
    let name = thread
        .name()
        .ok_or_else(|| io::Error::other("expected named Rust test"))?;
    run(
        &[
            "--exact",
            name,
            "--include-ignored",
            "--test-threads=1",
            "--nocapture",
        ],
        true,
    )
}

pub fn run_verify_example() -> io::Result<bool> {
    run(&["--verify"], false)
}

fn run(args: &[&str], expect_one_test: bool) -> io::Result<bool> {
    let here = current()?;
    let mut startup = STARTUPINFOW::default();
    unsafe {
        GetStartupInfoW(&mut startup);
    }
    if !startup.lpDesktop.is_null() {
        let requested = unsafe { startup.lpDesktop.to_string() }.map_err(io::Error::other)?;
        if requested.starts_with(PREFIX) && requested != here {
            return Err(io::Error::other(
                "worker did not start on its assigned desktop",
            ));
        }
    }
    if here.starts_with(PREFIX) {
        if here == input()? {
            return Err(io::Error::other("test desktop is the input desktop"));
        }
        return Ok(true);
    }
    if args
        .iter()
        .any(|s| s.chars().any(|c| c.is_whitespace() || c == '"'))
    {
        return Err(io::Error::other("invalid test selector"));
    }
    let (name, _desktop) = private_desktop()?;
    let (code, report) = run_worker(&name, args)?;
    if code != 0
        || (expect_one_test
            && !report
                .lines()
                .any(|line| line.starts_with("test result: ok. 1 passed;")))
    {
        return Err(io::Error::other(format!(
            "{name}: worker failed (exit {code})\n{report}"
        )));
    }
    print!("{report}");
    Ok(false)
}

fn private_desktop() -> io::Result<(String, Owned<HDESK>)> {
    let name = format!(
        "{PREFIX}{}-{}",
        std::process::id(),
        SERIAL.fetch_add(1, Ordering::Relaxed)
    );
    let wide = HSTRING::from(&name);
    let desktop = unsafe {
        Owned::new(CreateDesktopW(
            &wide,
            None,
            None,
            Default::default(),
            DESKTOP_CREATEWINDOW.0
                | DESKTOP_READOBJECTS.0
                | DESKTOP_WRITEOBJECTS.0
                | DESKTOP_CREATEMENU.0
                | DESKTOP_ENUMERATE.0,
            None,
        )?)
    };
    Ok((name, desktop))
}

fn run_worker(name: &str, args: &[&str]) -> io::Result<(u32, String)> {
    let executable = env::current_exe()?;
    let wide = HSTRING::from(name);
    let mut line = vec![u16::from(b'"')];
    line.extend(executable.as_os_str().encode_wide());
    line.push(u16::from(b'"'));
    for arg in args {
        line.push(u16::from(b' '));
        line.extend(arg.encode_utf16());
    }
    line.push(0);
    let mut output = fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create_new(true)
        .custom_flags(windows::Win32::Storage::FileSystem::FILE_FLAG_DELETE_ON_CLOSE.0)
        .share_mode(0)
        .open(env::temp_dir().join(format!("{name}.log")))?;
    let stdin = fs::File::open("NUL")?;
    let inherit = |file: &fs::File| -> windows::core::Result<Owned<HANDLE>> {
        let mut handle = HANDLE::default();
        unsafe {
            DuplicateHandle(
                GetCurrentProcess(),
                HANDLE(file.as_raw_handle()),
                GetCurrentProcess(),
                &mut handle,
                0,
                true,
                DUPLICATE_SAME_ACCESS,
            )?;
            Ok(Owned::new(handle))
        }
    };
    let (log, null) = (inherit(&output)?, inherit(&stdin)?);
    let handles = [*log, *null];
    let job = job::kill_on_close().map_err(io::Error::other)?;
    let job_handle = HANDLE(job.as_raw_handle());
    let mut size = 0;
    unsafe {
        let _ = InitializeProcThreadAttributeList(None, 2, None, &mut size);
    }
    let mut memory = vec![0usize; size.div_ceil(size_of::<usize>())];
    let list = LPPROC_THREAD_ATTRIBUTE_LIST(memory.as_mut_ptr().cast());
    unsafe {
        InitializeProcThreadAttributeList(Some(list), 2, None, &mut size)?;
    }
    let _list = unsafe { Owned::new(list) };
    let startup = STARTUPINFOEXW {
        StartupInfo: STARTUPINFOW {
            cb: size_of::<STARTUPINFOEXW>() as u32,
            lpDesktop: PWSTR(wide.as_ptr().cast_mut()),
            dwFlags: STARTF_USESTDHANDLES,
            hStdInput: *null,
            hStdOutput: *log,
            hStdError: *log,
            ..Default::default()
        },
        lpAttributeList: list,
    };
    let mut process = PROCESS_INFORMATION::default();
    unsafe {
        UpdateProcThreadAttribute(
            list,
            0,
            PROC_THREAD_ATTRIBUTE_HANDLE_LIST as usize,
            Some(handles.as_ptr().cast()),
            size_of_val(&handles),
            None,
            None,
        )?;
        UpdateProcThreadAttribute(
            list,
            0,
            PROC_THREAD_ATTRIBUTE_JOB_LIST as usize,
            Some((&raw const job_handle).cast()),
            size_of::<HANDLE>(),
            None,
            None,
        )?;
        CreateProcessW(
            &HSTRING::from(executable.as_os_str()),
            Some(PWSTR(line.as_mut_ptr())),
            None,
            None,
            true,
            CREATE_NO_WINDOW | EXTENDED_STARTUPINFO_PRESENT,
            None,
            PCWSTR::null(),
            &startup.StartupInfo,
            &mut process,
        )?;
    }
    let child = unsafe { Owned::new(process.hProcess) };
    drop(unsafe { Owned::new(process.hThread) });
    if unsafe { WaitForSingleObject(*child, INFINITE) } != WAIT_OBJECT_0 {
        return Err(io::Error::last_os_error());
    }
    let mut code = 0;
    unsafe {
        GetExitCodeProcess(*child, &mut code)?;
    }
    output.rewind()?;
    let mut report = Vec::new();
    output.read_to_end(&mut report)?;
    Ok((code, String::from_utf8_lossy(&report).into_owned()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;

    #[test]
    fn worker_and_descendants_share_the_non_input_desktop() -> io::Result<()> {
        const EXPECT: &str = "PATINA_TEST_DESKTOP_PROBE";
        if let Ok(expected) = env::var(EXPECT) {
            assert_eq!(current()?, expected);
            assert_ne!(current()?, input()?);
            if env::var_os("PATINA_TEST_DESKTOP_GRANDCHILD").is_some() {
                return Ok(());
            }
        } else if !run_case()? {
            return Ok(());
        }
        let mut child = Command::new(env::current_exe()?);
        child
            .args(["--exact", std::thread::current().name().unwrap()])
            .env(EXPECT, current()?);
        if env::var_os(EXPECT).is_some() {
            child.env("PATINA_TEST_DESKTOP_GRANDCHILD", "1");
        }
        let out = child.output()?;
        assert!(
            out.status.success(),
            "{}",
            String::from_utf8_lossy(&out.stdout)
        );
        Ok(())
    }
}
