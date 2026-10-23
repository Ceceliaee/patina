use super::*;

pub(super) fn verify_exception_context(executable: &std::path::Path) -> Result<(), String> {
    for idle in [false, true] {
        let mut process = ProbeProcess::start(executable, ProbeKind::Icon)?;
        let reply = process.request(Request {
            version: protocol::VERSION,
            id: 71,
            body: RequestBody::Test(if idle {
                TestAction::IdleAccessViolation
            } else {
                TestAction::AccessViolation
            }),
        })?;
        let response = reply
            .recv_timeout(Duration::from_secs(3))
            .map_err(|e| e.to_string())?;
        assert_eq!(response.is_ok(), idle);
        let deadline = Instant::now() + Duration::from_secs(3);
        while !process.observe_exit()? && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(2));
        }
        assert!(process.observe_exit()?);
        let exit = counters()[ProbeKind::Icon as usize]
            .last_exit
            .lock()
            .unwrap()
            .clone()
            .unwrap();
        let fault = exit.fault.as_ref().expect("real native exception context");
        assert_eq!(exit.code, 0xc0000005);
        assert_eq!(fault.code, exit.code);
        assert_eq!(fault.process_id, process.id());
        assert_eq!(fault.request_id, "71");
        assert_eq!(
            fault.phase,
            if idle {
                "waiting-for-request"
            } else {
                "executing-request"
            }
        );
        assert_eq!(
            fault.parameters[0], "0x0",
            "fixture must fault on a native read"
        );
        assert_ne!(fault.parameters[1], "0x0");
        assert_ne!(fault.instruction_pointer, "0x0");
        assert_ne!(fault.stack_pointer, "0x0");
        assert!(fault
            .image_path
            .as_ref()
            .unwrap()
            .to_ascii_lowercase()
            .ends_with("\\ntdll.dll"));
        assert!(!exit.termination_requested);
        assert!(process.stop(CLEANUP_BUDGET));
        println!(
            "NATIVE_EXCEPTION_CONTEXT idle={idle} {}",
            serde_json::to_string(&exit).unwrap()
        );
    }
    // A faulting OS query/filter may stall after publishing context. The
    // ordinary deadline then terminates the child, but must retain that fault.
    let mut stalled = Lane::default();
    let result: Result<bool, _> = stalled.call(
        executable,
        ProbeKind::Icon,
        RequestBody::Test(TestAction::StalledAccessViolation),
        CALL_BUDGET,
    );
    assert_eq!(result.unwrap_err(), "probe deadline exceeded");
    assert!(stalled.process.is_none());
    let exit = counters()[ProbeKind::Icon as usize]
        .last_abnormal_exit
        .lock()
        .unwrap()
        .clone()
        .unwrap();
    assert!(exit.termination_requested);
    assert_eq!(exit.fault.as_ref().unwrap().code, 0xc0000005);
    assert_eq!(exit.fault.as_ref().unwrap().process_id, exit.process_id);
    println!(
        "NATIVE_EXCEPTION_AFTER_CLEANUP {}",
        serde_json::to_string(&exit).unwrap()
    );
    Ok(())
}

pub(super) fn verify_shell_lifetime(executable: &std::path::Path) -> Result<(), String> {
    const SETTINGS: &str =
        "windows.immersivecontrolpanel_cw5n1h2txyewy!microsoft.windows.immersivecontrolpanel";
    let mut lane = Lane::default();
    let mut last_exit = None;
    let mut timings = Vec::new();
    for index in 0..80 {
        let missing = index % 4 == 3;
        let icon = index % 4 != 2;
        let started = Instant::now();
        let value: Option<String> = lane.call(
            executable,
            ProbeKind::Icon,
            RequestBody::Test(TestAction::ShellUncached {
                app_user_model_id: if missing {
                    "Patina.Missing!Test"
                } else {
                    SETTINGS
                }
                .into(),
                icon,
            }),
            CALL_BUDGET,
        )?;
        timings.push(started.elapsed().as_millis());
        assert_eq!(value.is_some(), !missing);
        let shell = counters()[ProbeKind::Icon as usize]
            .shell
            .lock()
            .unwrap()
            .clone()
            .unwrap();
        assert_eq!(shell.requests, index + 1);
        assert_eq!(shell.failed, 0);
        let exit = shell.last_exit.unwrap();
        assert_eq!(exit.code, 0);
        assert!(!exit.termination_requested);
        assert!(exit.fault.is_none());
        assert_ne!(Some(exit.created_filetime.clone()), last_exit);
        last_exit = Some(exit.created_filetime);
        if index % 10 == 9 {
            let resource: serde_json::Value = lane.call(
                executable,
                ProbeKind::Icon,
                RequestBody::Test(TestAction::ResourceSnapshot),
                CALL_BUDGET,
            )?;
            println!(
                "SHELL_OWNER_RESOURCES calls={} {}",
                index + 1,
                serde_json::to_string(&resource).unwrap()
            );
            assert!(resource["gdi_objects"].as_u64().unwrap() <= 4);
        }
    }
    // The normal string cache must suppress a second native Shell process.
    for iteration in 0..2 {
        let value: Option<String> = lane.call(
            executable,
            ProbeKind::Icon,
            RequestBody::Icon(IconRequest {
                process_id: 0,
                process_path: String::new(),
                exe_name: String::new(),
                app_user_model_id: SETTINGS.into(),
                window_class: String::new(),
                root_owner_hwnd: String::new(),
                hwnd: String::new(),
            }),
            CALL_BUDGET,
        )?;
        assert!(value.is_some());
        let shell = counters()[ProbeKind::Icon as usize]
            .shell
            .lock()
            .unwrap()
            .clone()
            .unwrap();
        assert_eq!(
            shell.requests, 81,
            "cache hit {iteration} must not create a Shell process"
        );
    }
    assert!(lane.process.as_mut().unwrap().stop(CLEANUP_BUDGET));
    println!(
        "SHELL_OWNER_TIMINGS_MS {}",
        serde_json::to_string(&timings).unwrap()
    );
    let mut recovery = Lane::default();
    let faulted: bool = recovery.call(
        executable,
        ProbeKind::Icon,
        RequestBody::Test(TestAction::ShellAccessViolation),
        CALL_BUDGET,
    )?;
    assert!(faulted);
    let fault_summary = counters()[ProbeKind::Icon as usize]
        .shell
        .lock()
        .unwrap()
        .clone()
        .unwrap();
    println!(
        "SHELL_EXCEPTION_BEFORE_RECOVERY {}",
        serde_json::to_string(&fault_summary).unwrap()
    );
    let original = fault_summary.last_abnormal_exit.unwrap();
    assert_eq!(original.fault.as_ref().unwrap().code, 0xc0000005);
    let deadline = Instant::now() + Duration::from_secs(4);
    loop {
        let value: Option<String> = recovery.call(
            executable,
            ProbeKind::Icon,
            RequestBody::Test(TestAction::ShellUncached {
                app_user_model_id: SETTINGS.into(),
                icon: true,
            }),
            CALL_BUDGET,
        )?;
        if value.is_some() {
            break;
        }
        assert!(
            Instant::now() < deadline,
            "Shell did not recover after its cooldown"
        );
        std::thread::sleep(Duration::from_millis(20));
    }
    let shell = counters()[ProbeKind::Icon as usize]
        .shell
        .lock()
        .unwrap()
        .clone()
        .unwrap();
    assert_eq!(shell.last_exit.as_ref().unwrap().code, 0);
    let retained = shell.last_abnormal_exit.as_ref().unwrap();
    assert_eq!(retained.created_filetime, original.created_filetime);
    assert_eq!(retained.fault.as_ref().unwrap().code, 0xc0000005);
    assert!(recovery.process.as_mut().unwrap().stop(CLEANUP_BUDGET));
    println!(
        "SHELL_EXCEPTION_RECOVERY {}",
        serde_json::to_string(&shell).unwrap()
    );
    Ok(())
}
