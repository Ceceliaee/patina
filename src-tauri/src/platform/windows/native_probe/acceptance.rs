//! Debug-only integration entry: exercise the actual executable and Job owner.
use super::*;
use protocol::{RequestBody, TestAction};
mod diagnostics;
mod shell;
use diagnostics::verify_diagnostic_admission;
use shell::{verify_exception_context, verify_shell_lifetime};

pub(crate) fn extract_icon(
    executable: &std::path::Path,
    path: &str,
    package: &str,
) -> Option<String> {
    let mut lane = Lane::default();
    let result = lane.call(
        executable,
        ProbeKind::Icon,
        RequestBody::Icon(IconRequest {
            process_id: 0,
            process_path: path.into(),
            exe_name: "refresh-native-fixture.exe".into(),
            app_user_model_id: package.into(),
            window_class: String::new(),
            root_owner_hwnd: String::new(),
            hwnd: String::new(),
        }),
        Duration::from_secs(10),
    );
    if let Some(process) = lane.process.as_mut() {
        assert!(process.stop(CLEANUP_BUDGET));
    }
    result.expect("native icon response")
}

pub(crate) fn verify(executable: &std::path::Path) -> Result<(), String> {
    verify_diagnostic_admission(executable)?;
    verify_exception_context(executable)?;
    verify_shell_lifetime(executable)?;
    verify_idle_exit_recovery(executable)?;
    process::verify_partial_startup(executable)?;
    verify_executable_paths(executable)?;
    verify_parent_crash(executable)?;
    verify_timeout_cpu_boundary(executable)?;
    verify_independent_fault_domains(executable)?;
    verify_audio_apartment(executable)?;
    verify_media_resources(executable)?;
    let mut lane = Lane::default();
    let value: u64 = lane.call(
        executable,
        ProbeKind::Name,
        RequestBody::Test(TestAction::Echo(7)),
        Duration::from_secs(10),
    )?;
    assert_eq!(value, 7);
    let initial_pid = lane.process.as_ref().unwrap().id();
    for value in 0..100 {
        let received: u64 = lane.call(
            executable,
            ProbeKind::Name,
            RequestBody::Test(TestAction::Echo(value)),
            Duration::from_secs(2),
        )?;
        assert_eq!(received, value);
        assert_eq!(lane.process.as_ref().unwrap().id(), initial_pid);
    }
    let started = Instant::now();
    let result: Result<u64, _> = lane.call(
        executable,
        ProbeKind::Name,
        RequestBody::Test(TestAction::Busy),
        Duration::from_millis(100),
    );
    assert!(result.is_err());
    assert!(started.elapsed() < Duration::from_secs(6));
    assert!(
        lane.process.is_none(),
        "hot process must actually exit before slot release"
    );
    assert!(!lane.retired);
    // A separate lane remains usable while the first one is cooling down.
    let mut other = Lane::default();
    let value: u64 = other.call(
        executable,
        ProbeKind::Foreground,
        RequestBody::Test(TestAction::Echo(9)),
        Duration::from_secs(10),
    )?;
    assert_eq!(value, 9);
    let result: Result<u64, _> = lane.call(
        executable,
        ProbeKind::Name,
        RequestBody::Test(TestAction::Echo(10)),
        Duration::from_secs(2),
    );
    assert_eq!(result.unwrap_err(), "probe cooling down");
    lane.retry_after = None;
    let value: u64 = lane.call(
        executable,
        ProbeKind::Name,
        RequestBody::Test(TestAction::Echo(11)),
        Duration::from_secs(10),
    )?;
    assert_eq!(value, 11);
    assert_eq!(lane.failures, 0);
    assert!(lane.retry_after.is_none());
    for action in [TestAction::Crash, TestAction::Malformed] {
        let result: Result<u64, _> = lane.call(
            executable,
            ProbeKind::Name,
            RequestBody::Test(action),
            Duration::from_secs(2),
        );
        assert!(result.is_err());
        assert!(lane.process.is_none());
        assert!(!lane.retired);
        lane.retry_after = None;
    }
    if let Some(process) = other.process.as_mut() {
        assert!(process.stop(CLEANUP_BUDGET));
    }
    drop(other);
    let before = super::super::resource::current_process_resource_snapshot();
    for cycle in 0..100 {
        lane.retry_after = None;
        let echoed: u64 = lane.call(
            executable,
            ProbeKind::Name,
            RequestBody::Test(TestAction::Echo(cycle)),
            Duration::from_secs(10),
        )?;
        assert_eq!(echoed, cycle);
        let action = match cycle % 5 {
            0 => TestAction::Busy,
            1 => TestAction::Crash,
            2 => TestAction::Malformed,
            3 => TestAction::WrongResponse,
            _ => TestAction::PartialResponse,
        };
        let result: Result<u64, _> = lane.call(
            executable,
            ProbeKind::Name,
            RequestBody::Test(action),
            Duration::from_millis(50),
        );
        assert!(result.is_err());
        assert!(
            lane.process.is_none(),
            "cycle {cycle}: process or IO thread not reaped"
        );
        assert!(!lane.retired);
    }
    let after = super::super::resource::current_process_resource_snapshot();
    assert!(
        after.handle_count.expect("handle count") <= before.handle_count.expect("handle count") + 4,
        "handle growth: {before:?} -> {after:?}"
    );
    assert!(
        after.thread_count.expect("thread count") <= before.thread_count.expect("thread count") + 1,
        "thread growth: {before:?} -> {after:?}"
    );
    println!("NATIVE_PROBE_CYCLES count=100 before={before:?} after={after:?}");
    Ok(())
}

fn verify_idle_exit_recovery(executable: &std::path::Path) -> Result<(), String> {
    use windows::Win32::{
        Foundation::WAIT_OBJECT_0,
        System::Threading::{
            OpenProcess, TerminateProcess, WaitForSingleObject, PROCESS_SYNCHRONIZE,
            PROCESS_TERMINATE,
        },
    };
    // These are deliberate exits of an owned fixture, not reproductions of the
    // historical access violation. Keep its handle through cleanup and recovery.
    for (exit_code, observe_first) in [(0xc0000005_u32, true), (17, false)] {
        let kind = ProbeKind::Icon;
        let mut lane = lanes()[kind as usize].lock().unwrap();
        let _: u64 = lane.call(
            executable,
            kind,
            RequestBody::Test(TestAction::Echo(1)),
            Duration::from_secs(10),
        )?;
        let pid = lane.process.as_ref().unwrap().id();
        let handle = super::super::handles::OwnedHandle::new(unsafe {
            OpenProcess(PROCESS_SYNCHRONIZE | PROCESS_TERMINATE, false, pid)
                .map_err(|error| error.to_string())?
        })
        .unwrap();
        unsafe { TerminateProcess(handle.raw(), exit_code) }.map_err(|error| error.to_string())?;
        assert_eq!(
            unsafe { WaitForSingleObject(handle.raw(), 3_000) },
            WAIT_OBJECT_0
        );
        if observe_first {
            let diagnostic = diagnostics()
                .into_iter()
                .find(|value| value.kind == "icon")
                .unwrap();
            assert_eq!(
                diagnostic.process_id, 0,
                "idle exit must not report a cached live PID"
            );
            assert!(diagnostic.caches.is_none());
            assert!(diagnostic.last_response_age_ms.is_none());
            let exit = diagnostic.last_exit.unwrap();
            assert_eq!(exit.code, exit_code);
            assert_eq!(exit.process_id, pid);
            assert!(!exit.termination_requested);
            assert!(
                exit.fault.is_none(),
                "external termination is not an observed exception"
            );
            assert!(exit
                .created_filetime
                .as_ref()
                .is_some_and(|value| value.len() == 18));
            assert!(exit
                .exited_filetime
                .as_ref()
                .is_some_and(|value| value.len() == 18));
            let repeated = diagnostics()
                .into_iter()
                .find(|value| value.kind == "icon")
                .unwrap();
            assert_eq!(
                repeated.exits, diagnostic.exits,
                "one exit must be recorded only once"
            );
        }
        drop(lane);
        let mut lane = lanes()[kind as usize].lock().unwrap();
        let started = Instant::now();
        let recovered: u64 = lane.call(
            executable,
            kind,
            RequestBody::Test(TestAction::Echo(2)),
            CALL_BUDGET,
        )?;
        let recovery_elapsed = started.elapsed();
        assert_eq!(
            recovered, 2,
            "the first request after a confirmed idle exit must recover"
        );
        assert!(recovery_elapsed < CLEANUP_BUDGET + CALL_BUDGET);
        assert!(!lane.retired);
        let exit = counters()[kind as usize]
            .last_exit
            .lock()
            .unwrap()
            .clone()
            .unwrap();
        assert_eq!(exit.code, exit_code);
        assert!(!exit.termination_requested);
        assert!(exit
            .cleanup_elapsed_ms
            .is_some_and(|elapsed| elapsed < 5_000));
        assert_eq!(
            unsafe { WaitForSingleObject(handle.raw(), 0) },
            WAIT_OBJECT_0
        );
        assert!(
            diagnostics()
                .into_iter()
                .find(|value| value.kind == "icon")
                .unwrap()
                .process_id
                > 0,
            "a held busy lane must not block diagnostics"
        );
        assert!(lane.process.as_mut().unwrap().stop(CLEANUP_BUDGET));
        lane.process = None;
        println!("NATIVE_IDLE_EXIT injected_code={exit_code:#x} observed_before_request={observe_first} recovery_ms={}", recovery_elapsed.as_millis());
    }
    Ok(())
}

fn verify_timeout_cpu_boundary(executable: &std::path::Path) -> Result<(), String> {
    use std::sync::{atomic::AtomicBool, Arc};
    use windows::Win32::System::Threading::{
        GetCurrentThreadId, OpenProcess, OpenThread, PROCESS_QUERY_LIMITED_INFORMATION,
        THREAD_QUERY_LIMITED_INFORMATION,
    };
    struct StopOnDrop(Arc<AtomicBool>);
    impl Drop for StopOnDrop {
        fn drop(&mut self) {
            self.0.store(true, Ordering::Release);
        }
    }
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_time()
        .max_blocking_threads(1)
        .build()
        .map_err(|error| error.to_string())?;
    let stopped = Arc::new(AtomicBool::new(false));
    let stop = StopOnDrop(stopped.clone());
    let (started, thread_id) = std::sync::mpsc::sync_channel(1);
    runtime.block_on(async {
        let mut busy = tokio::task::spawn_blocking(move || {
            started.send(unsafe { GetCurrentThreadId() }).unwrap();
            let deadline = Instant::now() + Duration::from_secs(5);
            while !stopped.load(Ordering::Acquire) && Instant::now() < deadline {
                std::hint::spin_loop();
            }
        });
        let id = thread_id.recv_timeout(Duration::from_secs(3)).unwrap();
        let handle = super::super::handles::OwnedHandle::new(unsafe {
            OpenThread(THREAD_QUERY_LIMITED_INFORMATION, false, id).unwrap()
        })
        .unwrap();
        assert!(tokio::time::timeout(Duration::from_millis(50), &mut busy)
            .await
            .is_err());
        busy.abort();
        let before = cpu_time(handle.raw(), true);
        tokio::time::sleep(Duration::from_millis(150)).await;
        let after = cpu_time(handle.raw(), true);
        stop.0.store(true, Ordering::Release);
        busy.await.unwrap();
        assert!(
            after > before,
            "timeout and abort must leave the running blocking thread consuming CPU"
        );
        println!(
            "NATIVE_PROBE_THREAD_TIMEOUT cpu_after_timeout_100ns={}",
            after - before
        );
    });
    let mut lane = Lane::default();
    let _: u64 = lane.call(
        executable,
        ProbeKind::Name,
        RequestBody::Test(TestAction::Echo(0)),
        Duration::from_secs(10),
    )?;
    let process_id = lane.process.as_ref().unwrap().id();
    let handle = super::super::handles::OwnedHandle::new(
        unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, process_id) }
            .map_err(|error| error.to_string())?,
    )
    .ok_or("CPU probe process handle missing")?;
    let before = cpu_time(handle.raw(), false);
    let result: Result<u64, _> = lane.call(
        executable,
        ProbeKind::Name,
        RequestBody::Test(TestAction::Busy),
        Duration::from_millis(200),
    );
    assert!(result.is_err());
    assert!(
        lane.process.is_none(),
        "deadline must reap the helper and its IO thread"
    );
    let after = cpu_time(handle.raw(), false);
    assert!(after > before, "helper fault must have consumed real CPU");
    std::thread::sleep(Duration::from_millis(150));
    assert_eq!(
        cpu_time(handle.raw(), false),
        after,
        "helper CPU must stop after confirmed termination"
    );
    lane.retry_after = None;
    let reply: u64 = lane.call(
        executable,
        ProbeKind::Name,
        RequestBody::Test(TestAction::Echo(42)),
        Duration::from_secs(10),
    )?;
    assert_eq!(reply, 42);
    assert!(lane.process.as_mut().unwrap().stop(CLEANUP_BUDGET));
    println!("NATIVE_PROBE_PROCESS_TIMEOUT cpu_before_exit_100ns={} cpu_after_exit_100ns=0 recovered=true", after - before);
    Ok(())
}

fn cpu_time(handle: windows::Win32::Foundation::HANDLE, thread: bool) -> u64 {
    use windows::Win32::{
        Foundation::FILETIME,
        System::Threading::{GetProcessTimes, GetThreadTimes},
    };
    let (mut created, mut exited, mut kernel, mut user): (FILETIME, FILETIME, FILETIME, FILETIME) =
        Default::default();
    unsafe {
        if thread {
            GetThreadTimes(handle, &mut created, &mut exited, &mut kernel, &mut user)
        } else {
            GetProcessTimes(handle, &mut created, &mut exited, &mut kernel, &mut user)
        }
    }
    .unwrap();
    ((u64::from(kernel.dwHighDateTime) << 32) | u64::from(kernel.dwLowDateTime))
        + ((u64::from(user.dwHighDateTime) << 32) | u64::from(user.dwLowDateTime))
}

fn verify_executable_paths(executable: &std::path::Path) -> Result<(), String> {
    let root = std::env::temp_dir().join(format!("patina probe paths {}", uuid::Uuid::new_v4()));
    std::fs::create_dir(&root).map_err(|error| error.to_string())?;
    let path = root.join("Patina probe fixture.exe");
    std::fs::hard_link(executable, &path).map_err(|error| error.to_string())?;
    let mut lane = Lane::default();
    let result: Result<u64, _> = lane.call(
        &path,
        ProbeKind::Name,
        RequestBody::Test(TestAction::Echo(37)),
        Duration::from_secs(10),
    );
    if let Some(process) = lane.process.as_mut() {
        assert!(process.stop(CLEANUP_BUDGET));
    }
    drop(lane);
    std::fs::remove_file(&path).map_err(|error| error.to_string())?;
    std::fs::remove_dir(&root).map_err(|error| error.to_string())?;
    assert_eq!(
        result?, 37,
        "paths containing spaces must preserve the helper protocol"
    );
    let mut missing = Lane::default();
    let result: Result<u64, _> = missing.call(
        &path,
        ProbeKind::Name,
        RequestBody::Test(TestAction::Echo(1)),
        Duration::from_millis(50),
    );
    assert!(result.is_err());
    assert!(missing.process.is_none());
    assert!(missing.retry_after.is_some());
    Ok(())
}

fn verify_audio_apartment(executable: &std::path::Path) -> Result<(), String> {
    let mut process = ProbeProcess::start(executable, ProbeKind::Audio)?;
    let result = (|| -> Result<(), String> {
        let mut baseline = None;
        for id in 1..=32 {
            let reply = process
                .request(Request {
                    version: protocol::VERSION,
                    id: id * 3,
                    body: RequestBody::Audio {
                        timestamp_ms: 1_000 + id as i64,
                    },
                })?
                .recv_timeout(Duration::from_secs(3))
                .map_err(|e| e.to_string())??;
            // Machines without an endpoint may return an API error. A valid
            // protocol reply still proves the native query returned safely.
            assert_eq!(reply.id, id * 3);
            let apartment = process
                .request(Request {
                    version: protocol::VERSION,
                    id: id * 3 + 1,
                    body: RequestBody::Test(TestAction::ApartmentIsMta),
                })?
                .recv_timeout(Duration::from_secs(3))
                .map_err(|e| e.to_string())??;
            assert_eq!(
                apartment.result?,
                serde_json::json!(true),
                "audio MTA must stay initialized between queries"
            );
            if id == 8 || id == 32 {
                let response = process
                    .request(Request {
                        version: protocol::VERSION,
                        id: id * 3 + 2,
                        body: RequestBody::Test(TestAction::ResourceSnapshot),
                    })?
                    .recv_timeout(Duration::from_secs(3))
                    .map_err(|e| e.to_string())??;
                let current = response.result?;
                if let Some(before) = baseline.as_ref() {
                    for (field, allowance) in [
                        ("handle_count", 24),
                        ("thread_count", 2),
                        ("private_usage_bytes", 16 * 1024 * 1024),
                    ] {
                        let before: &serde_json::Value = before;
                        assert!(
                            current[field].as_u64().expect("helper resource counter")
                                <= before[field]
                                    .as_u64()
                                    .expect("baseline helper resource counter")
                                    + allowance,
                            "audio helper resource growth: {field}: {before} -> {current}"
                        );
                    }
                    eprintln!("NATIVE_AUDIO_RESOURCES before={before} after={current}");
                } else {
                    baseline = Some(current);
                }
            }
            std::thread::sleep(Duration::from_millis(250));
        }
        Ok(())
    })();
    assert!(process.stop(CLEANUP_BUDGET));
    result?;
    eprintln!("NATIVE_AUDIO_APARTMENT repeated_queries=32 retained_mta=true");
    Ok(())
}

fn verify_media_resources(executable: &std::path::Path) -> Result<(), String> {
    let mut process = ProbeProcess::start(executable, ProbeKind::Media)?;
    let result = (|| -> Result<(), String> {
        let mut baseline: Option<serde_json::Value> = None;
        for id in 1..=1_000 {
            let reply = process
                .request(Request {
                    version: protocol::VERSION,
                    id: id * 3,
                    body: RequestBody::Media,
                })?
                .recv_timeout(Duration::from_secs(3))
                .map_err(|error| error.to_string())??;
            // An empty session list is valid; an API failure cannot prove that
            // repeated successful native queries have bounded resource use.
            reply.result?;
            if matches!(id, 100 | 500 | 1_000) {
                let apartment = process
                    .request(Request {
                        version: protocol::VERSION,
                        id: id * 3 + 1,
                        body: RequestBody::Test(TestAction::ApartmentIsMta),
                    })?
                    .recv_timeout(Duration::from_secs(3))
                    .map_err(|error| error.to_string())??;
                assert_eq!(
                    apartment.result?,
                    serde_json::json!(true),
                    "media WinRT apartment must outlive its manager"
                );
                let response = process
                    .request(Request {
                        version: protocol::VERSION,
                        id: id * 3 + 2,
                        body: RequestBody::Test(TestAction::ResourceSnapshot),
                    })?
                    .recv_timeout(Duration::from_secs(3))
                    .map_err(|error| error.to_string())??;
                let current = response.result?;
                if let Some(before) = &baseline {
                    for (field, allowance) in [
                        ("handle_count", 24),
                        ("thread_count", 4),
                        ("private_usage_bytes", 512 * 1024),
                    ] {
                        assert!(
                            current[field].as_u64().expect("media resource counter")
                                <= before[field].as_u64().expect("media baseline counter")
                                    + allowance,
                            "media helper resource growth: {field}: {before} -> {current}"
                        );
                    }
                    eprintln!(
                        "NATIVE_MEDIA_RESOURCES queries={id} before={before} after={current}"
                    );
                } else {
                    baseline = Some(current);
                }
            }
            // Pace native activations so asynchronous cleanup can run. This is
            // an accelerated resource workload, not state synchronization.
            std::thread::sleep(Duration::from_millis(20));
        }
        Ok(())
    })();
    assert!(process.stop(CLEANUP_BUDGET));
    result?;
    Ok(())
}

fn verify_independent_fault_domains(executable: &std::path::Path) -> Result<(), String> {
    for kind in [
        ProbeKind::Name,
        ProbeKind::Icon,
        ProbeKind::Media,
        ProbeKind::Audio,
        ProbeKind::Foreground,
    ] {
        for fault in [TestAction::Busy, TestAction::PartialResponse] {
            let busy = matches!(fault, TestAction::Busy);
            let mut held = ProbeProcess::start(executable, kind)?;
            let pending = held.request(Request {
                version: protocol::VERSION,
                id: 1,
                body: RequestBody::Test(fault),
            })?;
            let mut independent = Lane::default();
            let available: u64 = independent.call(
                executable,
                if kind == ProbeKind::Foreground {
                    ProbeKind::Name
                } else {
                    ProbeKind::Foreground
                },
                RequestBody::Test(TestAction::Echo(41)),
                Duration::from_secs(10),
            )?;
            assert_eq!(
                available, 41,
                "separate facts lane must advance before the busy optional probe exits"
            );
            assert!(pending.try_recv().is_err());
            assert!(held.stop(CLEANUP_BUDGET));
            assert!(independent.process.as_mut().unwrap().stop(CLEANUP_BUDGET));
            verify_fault_deadline(
                executable,
                kind,
                if busy {
                    TestAction::Busy
                } else {
                    TestAction::PartialResponse
                },
            )?;
        }
    }
    Ok(())
}

fn verify_fault_deadline(
    executable: &std::path::Path,
    kind: ProbeKind,
    fault: TestAction,
) -> Result<(), String> {
    use windows::Win32::{
        Foundation::WAIT_OBJECT_0,
        System::Threading::{
            OpenProcess, WaitForSingleObject, PROCESS_QUERY_LIMITED_INFORMATION,
            PROCESS_SYNCHRONIZE,
        },
    };
    let busy = matches!(fault, TestAction::Busy);
    let mut lane = Lane::default();
    let echoed: u64 = lane.call(
        executable,
        kind,
        RequestBody::Test(TestAction::Echo(41)),
        Duration::from_secs(10),
    )?;
    assert_eq!(echoed, 41);
    // Retain the kernel handle across termination; a recycled PID is not proof
    // that the process which executed the fault has stopped consuming CPU.
    let handle = super::super::handles::OwnedHandle::new(unsafe {
        OpenProcess(
            PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_SYNCHRONIZE,
            false,
            lane.process.as_ref().unwrap().id(),
        )
        .map_err(|error| error.to_string())?
    })
    .ok_or("fault process handle missing")?;
    let before = cpu_time(handle.raw(), false);
    let started = Instant::now();
    let result: Result<u64, _> = lane.call(
        executable,
        kind,
        RequestBody::Test(fault),
        Duration::from_millis(250),
    );
    assert_eq!(result.unwrap_err(), "probe deadline exceeded");
    assert!(started.elapsed() < CLEANUP_BUDGET + Duration::from_secs(1));
    assert!(
        lane.process.is_none(),
        "fault deadline must reap its helper"
    );
    assert!(!lane.retired);
    assert_eq!(
        unsafe { WaitForSingleObject(handle.raw(), 0) },
        WAIT_OBJECT_0
    );
    let after = cpu_time(handle.raw(), false);
    if busy {
        assert!(after > before, "busy fault must consume real CPU");
    }
    let cooldown: Result<u64, _> = lane.call(
        executable,
        kind,
        RequestBody::Test(TestAction::Echo(42)),
        Duration::from_secs(1),
    );
    assert_eq!(cooldown.unwrap_err(), "probe cooling down");
    assert!(
        lane.process.is_none(),
        "cooldown must not spawn a replacement"
    );
    // Exercise the actual retry deadline rather than clearing it in the fixture.
    std::thread::sleep(
        lane.retry_after
            .unwrap()
            .saturating_duration_since(Instant::now()),
    );
    assert_eq!(
        cpu_time(handle.raw(), false),
        after,
        "fault helper CPU must stay stopped throughout cooldown"
    );
    let recovered: u64 = lane.call(
        executable,
        kind,
        RequestBody::Test(TestAction::Echo(43)),
        Duration::from_secs(10),
    )?;
    assert_eq!(recovered, 43);
    assert_eq!(lane.failures, 0);
    assert!(lane.retry_after.is_none());
    assert!(lane.process.as_mut().unwrap().stop(CLEANUP_BUDGET));
    println!(
        "NATIVE_FAULT_DEADLINE kind={} fault={} cpu_before_exit_100ns={} cpu_after_exit_100ns=0 recovered=true",
        kind.argument(),
        if busy { "busy" } else { "partial-response" },
        after - before
    );
    Ok(())
}

fn verify_parent_crash(executable: &std::path::Path) -> Result<(), String> {
    use windows::Win32::{
        Foundation::{FILETIME, WAIT_OBJECT_0},
        System::Threading::{
            GetProcessTimes, OpenProcess, WaitForSingleObject, PROCESS_QUERY_LIMITED_INFORMATION,
            PROCESS_SYNCHRONIZE,
        },
    };
    let mut lane = Lane::default();
    let descendant: u32 = lane.call(
        executable,
        ProbeKind::Name,
        RequestBody::Test(TestAction::SpawnBusyDescendant),
        Duration::from_secs(10),
    )?;
    let owned = super::super::handles::OwnedHandle::new(
        unsafe {
            OpenProcess(
                PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_SYNCHRONIZE,
                false,
                descendant,
            )
        }
        .map_err(|error| error.to_string())?,
    )
    .ok_or("descendant handle missing")?;
    let cpu = || {
        let (mut created, mut exited, mut kernel, mut user): (
            FILETIME,
            FILETIME,
            FILETIME,
            FILETIME,
        ) = Default::default();
        unsafe {
            GetProcessTimes(
                owned.raw(),
                &mut created,
                &mut exited,
                &mut kernel,
                &mut user,
            )
        }
        .unwrap();
        ((u64::from(kernel.dwHighDateTime) << 32) | u64::from(kernel.dwLowDateTime))
            + ((u64::from(user.dwHighDateTime) << 32) | u64::from(user.dwLowDateTime))
    };
    let first = cpu();
    let deadline = Instant::now() + Duration::from_secs(3);
    while cpu() <= first + 100_000 && Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(20));
    }
    assert!(
        cpu() > first + 100_000,
        "injected descendant must really consume CPU"
    );
    let parent = lane.process.as_mut().unwrap();
    let reply = parent.request(Request {
        version: protocol::VERSION,
        id: 2,
        body: RequestBody::Test(TestAction::Crash),
    })?;
    assert!(!matches!(
        reply.recv_timeout(Duration::from_secs(3)),
        Ok(Ok(_))
    ));
    // No explicit parent.stop() occurs until after this assertion: a leaked
    // parent Job handle is closed by process exit, without Rust destructors.
    assert_eq!(
        unsafe { WaitForSingleObject(owned.raw(), 3_000) },
        WAIT_OBJECT_0,
        "parent exit left a hot descendant"
    );
    let stopped = cpu();
    std::thread::sleep(Duration::from_millis(50));
    assert_eq!(
        cpu(),
        stopped,
        "terminated descendant CPU must stop increasing"
    );
    assert!(parent.stop(CLEANUP_BUDGET));
    Ok(())
}
