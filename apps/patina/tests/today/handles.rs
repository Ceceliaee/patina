use super::{children, command, desktop::*, hash, named, seed};
use serde::Serialize;
use std::{
    fs, io,
    mem::size_of,
    os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle},
    path::Path,
    process::Command,
    thread,
    time::Duration,
};
use windows::{
    Win32::{
        Foundation::*,
        System::{Diagnostics::ProcessSnapshotting::*, Threading::*},
        UI::WindowsAndMessaging::*,
    },
    core::w,
};

#[derive(Default, Serialize)]
struct Census {
    total: usize,
    sections: usize,
    mutexes: usize,
}
fn checked(status: u32) -> io::Result<()> {
    if status == 0 {
        Ok(())
    } else {
        Err(io::Error::from_raw_os_error(status as i32))
    }
}
struct Snapshot(HPSS);
impl Drop for Snapshot {
    fn drop(&mut self) {
        unsafe {
            PssFreeSnapshot(GetCurrentProcess(), self.0);
        }
    }
}
struct Marker(HPSSWALK);
impl Drop for Marker {
    fn drop(&mut self) {
        unsafe {
            PssWalkMarkerFree(self.0);
        }
    }
}

fn census(process: HANDLE) -> Result<Census, Error> {
    let mut snapshot = HPSS::default();
    unsafe {
        checked(PssCaptureSnapshot(
            process,
            PSS_CAPTURE_HANDLES
                | PSS_CAPTURE_HANDLE_NAME_INFORMATION
                | PSS_CAPTURE_HANDLE_BASIC_INFORMATION
                | PSS_CAPTURE_HANDLE_TYPE_SPECIFIC_INFORMATION,
            None,
            &mut snapshot,
        ))?;
    }
    let snapshot = Snapshot(snapshot);
    let mut marker = HPSSWALK::default();
    unsafe {
        checked(PssWalkMarkerCreate(None, &mut marker))?;
    }
    let marker = Marker(marker);
    let mut stats = Census::default();
    loop {
        let mut entry = PSS_HANDLE_ENTRY::default();
        let bytes = unsafe {
            std::slice::from_raw_parts_mut(
                (&raw mut entry).cast::<u8>(),
                size_of::<PSS_HANDLE_ENTRY>(),
            )
        };
        let status =
            unsafe { PssWalkSnapshot(snapshot.0, PSS_WALK_HANDLES, marker.0, Some(bytes)) };
        if status == ERROR_NO_MORE_ITEMS.0 {
            return Ok(stats);
        }
        checked(status)?;
        stats.total += 1;
        if entry.ObjectNameLength == 0 || entry.ObjectName.is_null() {
            continue;
        }
        let name = String::from_utf16_lossy(unsafe {
            std::slice::from_raw_parts(entry.ObjectName.0, usize::from(entry.ObjectNameLength) / 2)
        });
        const SECTION: &str = r"\{2627E361-24E2-4F14-99ED-A20D0685D8DD}_v22";
        const MUTEX: &str = r"\{2627E361-24E2-4F14-99ED-A20D0685D8DD}_v22_0";
        let name = name.trim_end_matches('\0');
        match entry.ObjectType {
            PSS_OBJECT_TYPE_SECTION if name.ends_with(SECTION) => stats.sections += 1,
            PSS_OBJECT_TYPE_MUTANT if name.ends_with(MUTEX) => stats.mutexes += 1,
            _ => (),
        }
    }
}

fn run_path(scenario: &str) -> io::Result<std::path::PathBuf> {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../artifacts/runtime-smoke");
    fs::create_dir_all(&dir)?;
    Ok(dir.join(format!(
        "{scenario}-{}",
        chrono::Utc::now().format("%Y%m%dT%H%M%S%.3fZ")
    )))
}

fn check_renderer_stderr(path: &Path) -> Result<(), Error> {
    let stderr = fs::read_to_string(path)?;
    assert!(!stderr.contains("panicked at"), "window teardown: {stderr}");
    Ok(())
}

fn profile(fixture: &Path, out: &Path, uia: bool) -> Result<(), Error> {
    let _com = if uia {
        Some(ComApartment::init()?)
    } else {
        None
    };
    let root = tempfile::tempdir()?;
    let dir = root.path().join(patina::PROFILE_DIRECTORY);
    fs::create_dir(&dir)?;
    fs::copy(fixture, dir.join("patina.db"))?;
    let diagnostics = out.with_extension("stderr.log");
    let mut child = TestChild(
        Command::new(env!("CARGO_BIN_EXE_patina"))
            .env("PATINA_PROFILE_PARENT", root.path())
            .stderr(fs::File::create(&diagnostics)?)
            .spawn()?,
    );
    let proc = HANDLE(child.0.as_raw_handle());
    let pid = child.0.id();
    let tray = wait("tray", || window(pid, w!("Patina Tray")))?;
    let cold = census(proc)?;
    let mut cycles = Vec::new();
    for cycle in 1..=15 {
        command(tray, 4)?;
        let (worker, hwnd) = wait("visible Today", || {
            children::find(pid, |p| {
                window(p, w!("Patina"))
                    .filter(|&w| unsafe { IsWindowVisible(w).as_bool() })
                    .map(|w| (p, w))
            })
        })?;
        if uia {
            wait("populated Today", || named(hwnd, "Top 3"))?;
        }
        thread::sleep(Duration::from_millis(300));
        let process = unsafe {
            OpenProcess(
                PROCESS_QUERY_INFORMATION
                    | PROCESS_VM_READ
                    | PROCESS_DUP_HANDLE
                    | PROCESS_VM_OPERATION
                    | PROCESS_SYNCHRONIZE,
                false,
                worker,
            )?
        };
        let _process = unsafe { OwnedHandle::from_raw_handle(process.0) };
        let open = census(process)?;
        unsafe {
            PostMessageW(Some(hwnd), WM_CLOSE, WPARAM(0), LPARAM(0))?;
        }
        assert_eq!(
            unsafe { WaitForSingleObject(process, 5000) },
            WAIT_OBJECT_0,
            "closed renderer still running"
        );
        let mut code = u32::MAX;
        unsafe {
            GetExitCodeProcess(process, &mut code)?;
        }
        assert_eq!(code, 0, "renderer did not exit normally");
        thread::sleep(Duration::from_millis(300));
        let closed = census(proc)?;
        assert_eq!(
            (closed.sections, closed.mutexes),
            (cold.sections, cold.mutexes),
            "driver handles retained by recorder"
        );
        cycles.push(serde_json::json!({"cycle":cycle,"renderer":worker,"open":open,"tray":closed}));
    }
    fs::write(
        out,
        serde_json::to_vec_pretty(
            &serde_json::json!({"pid":pid,"uia":uia,"cold":cold,"cycles":cycles}),
        )?,
    )?;
    command(tray, 2)?;
    assert!(wait("exit", || child.0.try_wait().ok().flatten())?.success());
    check_renderer_stderr(&diagnostics)
}

#[test]
#[ignore = "dedicated Windows session: paired handle baseline"]
fn window_handles() -> Result<(), Error> {
    patina_test_support::dedicated_session()?;
    let out = run_path("handles")?;
    fs::create_dir(&out)?;
    let db = out.join("fixture.db");
    super::seed_profile(&db, true)?;
    println!("{} fixture {}", out.display(), hash(&db)?);
    for (uia, name) in [(false, "native.json"), (true, "uia.json")] {
        profile(&db, &out.join(name), uia)?;
    }
    Ok(())
}

#[test]
#[ignore = "isolated Win32 desktop"]
fn renderer_recovery() -> Result<(), Error> {
    if !patina_test_support::run_case()? {
        return Ok(());
    }
    use windows::Win32::UI::Shell::{NIN_SELECT, NINF_KEY};
    let _com = ComApartment::init()?;
    let root = tempfile::tempdir()?;
    let dir = root.path().join(patina::PROFILE_DIRECTORY);
    fs::create_dir(&dir)?;
    seed(&dir.join("patina.db"))?;
    let mut diagnostics = run_path("recovery")?;
    diagnostics.add_extension("stderr.log");
    let mut host = TestChild(
        Command::new(env!("CARGO_BIN_EXE_patina"))
            .env("PATINA_PROFILE_PARENT", root.path())
            .stderr(fs::File::create(&diagnostics)?)
            .spawn()?,
    );
    let pid = host.0.id();
    let tray = wait("tray", || window(pid, w!("Patina Tray")))?;
    let ready = || {
        children::find(pid, |p| {
            let hwnd = window(p, w!("Patina"))?;
            named(hwnd, "Top 3").map(|_| (p, hwnd))
        })
    };
    let select_tray_icon = |notification: u32| unsafe {
        PostMessageW(
            Some(tray),
            WM_APP + 1,
            WPARAM(0),
            LPARAM(((1 << 16) | notification) as isize),
        )
    };
    select_tray_icon(NIN_SELECT)?;
    let (_, first) = wait("first Today", ready)?;
    assert!(children::find(pid, |p| window(p, w!("Patina Mini"))).is_none());
    unsafe {
        PostMessageW(Some(first), WM_CLOSE, WPARAM(0), LPARAM(0))?;
    }
    wait("first HWND released", || {
        (!unsafe { IsWindow(Some(first)) }.as_bool()).then_some(())
    })?;
    select_tray_icon(NIN_SELECT | NINF_KEY)?;
    let (worker, _) = wait("reopen during retirement", ready)?;
    let open_worker = |id| -> Result<OwnedHandle, Error> {
        let p = unsafe {
            OpenProcess(
                PROCESS_TERMINATE | PROCESS_SYNCHRONIZE | PROCESS_QUERY_LIMITED_INFORMATION,
                false,
                id,
            )?
        };
        Ok(unsafe { OwnedHandle::from_raw_handle(p.0) })
    };
    let dead = open_worker(worker)?;
    unsafe {
        let h = HANDLE(dead.as_raw_handle());
        TerminateProcess(h, 1)?;
        assert_eq!(WaitForSingleObject(h, 5000), WAIT_OBJECT_0);
    }
    command(tray, 4)?;
    let (replacement, _) = wait("reopen after renderer failure", ready)?;
    let replacement = open_worker(replacement)?;
    host.0.kill()?;
    host.0.wait()?;
    let h = HANDLE(replacement.as_raw_handle());
    assert_eq!(
        unsafe { WaitForSingleObject(h, 5000) },
        WAIT_OBJECT_0,
        "orphaned renderer"
    );
    check_renderer_stderr(&diagnostics)
}

#[test]
#[ignore = "isolated Win32 desktop"]
fn mini_window_handles() -> Result<(), Error> {
    if !patina_test_support::run_case()? {
        return Ok(());
    }
    use windows::Win32::{
        System::ProcessStatus::{GetProcessMemoryInfo, PROCESS_MEMORY_COUNTERS_EX},
        UI::Accessibility::{
            IUIAutomationTogglePattern, ToggleState_Off, ToggleState_On, UIA_TogglePatternId,
        },
    };
    let _com = ComApartment::init()?;
    let root = tempfile::tempdir()?;
    let dir = root.path().join(patina::PROFILE_DIRECTORY);
    fs::create_dir(&dir)?;
    seed(&dir.join("patina.db"))?;
    let mut diagnostics = run_path("mini-handles")?;
    diagnostics.add_extension("stderr.log");
    let mut host = TestChild(
        Command::new(env!("CARGO_BIN_EXE_patina"))
            .env("PATINA_PROFILE_PARENT", root.path())
            .arg("--mini")
            .stderr(fs::File::create(&diagnostics)?)
            .spawn()?,
    );
    let pid = host.0.id();
    let tray = wait("tray", || window(pid, w!("Patina Tray")))?;
    let (renderer, mini) = wait("Mini", || {
        children::find(pid, |p| window(p, w!("Patina Mini")).map(|w| (p, w)))
    })?;
    let pin = wait("pin", || named(mini, "Keep expanded"))?;
    let pin: IUIAutomationTogglePattern = unsafe { pin.GetCurrentPatternAs(UIA_TogglePatternId)? };
    if unsafe { pin.CurrentToggleState()? } == ToggleState_Off {
        unsafe { pin.Toggle()? };
    }
    wait("pinned Mini", || {
        (unsafe { pin.CurrentToggleState().ok()? } == ToggleState_On).then_some(())
    })?;
    let process = unsafe {
        OpenProcess(
            PROCESS_QUERY_INFORMATION | PROCESS_VM_READ | PROCESS_DUP_HANDLE | PROCESS_VM_OPERATION,
            false,
            renderer,
        )?
    };
    let _owned = unsafe { OwnedHandle::from_raw_handle(process.0) };
    let measure = |cycle| -> Result<_, Error> {
        let mut memory = PROCESS_MEMORY_COUNTERS_EX::default();
        unsafe {
            GetProcessMemoryInfo(
                process,
                (&raw mut memory).cast(),
                size_of::<PROCESS_MEMORY_COUNTERS_EX>() as u32,
            )?
        };
        let counts = census(process)?;
        println!(
            "cycle {cycle}: handles {}, section {}, mutex {}, renderer private {:.2} MiB",
            counts.total,
            counts.sections,
            counts.mutexes,
            memory.PrivateUsage as f64 / 1048576.0
        );
        Ok((counts.sections, counts.mutexes))
    };
    let baseline = measure(0)?;
    for cycle in 1..=15 {
        command(tray, 4)?;
        let today = wait("Today on Mini renderer", || window(renderer, w!("Patina")))?;
        wait("populated Today", || named(today, "Top 3"))?;
        unsafe { PostMessageW(Some(today), WM_CLOSE, WPARAM(0), LPARAM(0))? };
        wait("back to Mini", || {
            (window(renderer, w!("Patina")).is_none()
                && window(renderer, w!("Patina Mini")) == Some(mini))
            .then_some(())
        })?;
        thread::sleep(Duration::from_millis(300));
        assert_eq!(
            measure(cycle)?,
            baseline,
            "driver handles accumulated with Mini open"
        );
    }
    assert_eq!(unsafe { pin.CurrentToggleState()? }, ToggleState_On);
    command(tray, 2)?;
    assert!(wait("exit", || host.0.try_wait().ok().flatten())?.success());
    check_renderer_stderr(&diagnostics)
}

#[test]
#[ignore = "local DirectX lifetime controls"]
fn graphics_handles() -> Result<(), Error> {
    use windows::Win32::Graphics::{Direct3D::*, Direct3D11::*, Dxgi::*};
    let proc = unsafe { GetCurrentProcess() };
    let count = || -> Result<_, Error> {
        let handles = census(proc)?;
        Ok((handles.sections, handles.mutexes))
    };
    let factory = || unsafe { CreateDXGIFactory2::<IDXGIFactory6>(DXGI_CREATE_FACTORY_FLAGS(0)) };
    let device = |adapter: &IDXGIAdapter1| -> windows::core::Result<_> {
        let mut device = None;
        unsafe {
            D3D11CreateDevice(
                adapter,
                D3D_DRIVER_TYPE_UNKNOWN,
                HMODULE::default(),
                D3D11_CREATE_DEVICE_BGRA_SUPPORT,
                None,
                D3D11_SDK_VERSION,
                Some(&mut device),
                None,
                None,
            )?;
        }
        Ok(device)
    };
    let f = factory()?;
    let adapter = unsafe { f.EnumAdapters1(0)? };
    let retained = device(&adapter)?.unwrap();
    let desc = DXGI_SWAP_CHAIN_DESC1 {
        Width: 64,
        Height: 64,
        Format: Common::DXGI_FORMAT_B8G8R8A8_UNORM,
        SampleDesc: Common::DXGI_SAMPLE_DESC {
            Count: 1,
            Quality: 0,
        },
        BufferUsage: DXGI_USAGE_RENDER_TARGET_OUTPUT,
        BufferCount: 2,
        SwapEffect: DXGI_SWAP_EFFECT_FLIP_SEQUENTIAL,
        AlphaMode: Common::DXGI_ALPHA_MODE_PREMULTIPLIED,
        ..Default::default()
    };
    for mode in [
        "device only",
        "new device and chain",
        "same device and chain",
    ] {
        let mut counts = vec![count()?];
        for _ in 0..5 {
            let d = if mode == "same device and chain" {
                retained.clone()
            } else {
                device(&adapter)?.unwrap()
            };
            if mode != "device only" {
                drop(unsafe { f.CreateSwapChainForComposition(&d, &desc, None)? });
            }
            drop(d);
            counts.push(count()?);
        }
        println!("{mode}: {counts:?}");
    }
    Ok(())
}
