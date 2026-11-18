use super::*;

pub(super) fn verify_diagnostic_admission(executable: &std::path::Path) -> Result<(), String> {
    let kind = ProbeKind::Foreground;
    let _: u64 = lanes()[kind as usize].lock().unwrap().call(
        executable,
        kind,
        RequestBody::Test(TestAction::Echo(1)),
        Duration::from_secs(10),
    )?;
    let rejected = counters()[kind as usize].rejected.load(Ordering::Relaxed);
    let (entered, observing) = std::sync::mpsc::sync_channel(1);
    let (resume, resumed) = std::sync::mpsc::sync_channel(1);
    let observer = std::thread::spawn(move || {
        process::gate_next_observation(entered, resumed);
        diagnostics()
    });
    observing.recv_timeout(Duration::from_secs(10)).unwrap();
    // The helper is already running. Exercise ordinary admission while the
    // diagnostic observer is paused at the actual process-exit check.
    let response: Result<u64, _> = call(kind, RequestBody::Test(TestAction::Echo(2)));
    resume.send(()).unwrap();
    observer.join().unwrap();
    let mut lane = lanes()[kind as usize].lock().unwrap();
    assert!(lane.process.as_mut().unwrap().stop(CLEANUP_BUDGET));
    lane.process = None;
    assert_eq!(
        response?, 2,
        "diagnostics must not consume foreground admission"
    );
    assert_eq!(
        counters()[kind as usize].rejected.load(Ordering::Relaxed),
        rejected
    );
    println!("NATIVE_DIAGNOSTIC_ADMISSION concurrent_foreground=true rejected_delta=0");
    drop(lane);
    verify_observer_generation(executable)?;
    Ok(())
}

fn verify_observer_generation(executable: &std::path::Path) -> Result<(), String> {
    let kind = ProbeKind::Foreground;
    let _: u64 = lanes()[kind as usize].lock().unwrap().call(
        executable,
        kind,
        RequestBody::Test(TestAction::Echo(3)),
        CALL_BUDGET,
    )?;
    let (entered, observing) = std::sync::mpsc::sync_channel(1);
    let (resume, resumed) = std::sync::mpsc::sync_channel(1);
    let observer = std::thread::spawn(move || {
        process::gate_next_observation(entered, resumed);
        super::super::diagnostics()
    });
    observing.recv_timeout(Duration::from_secs(10)).unwrap();
    let mut lane = lanes()[kind as usize].lock().unwrap();
    assert!(lane.process.as_mut().unwrap().stop(CLEANUP_BUDGET));
    lane.process = None;
    let _: u64 = lane.call(
        executable,
        kind,
        RequestBody::Test(TestAction::Echo(4)),
        CALL_BUDGET,
    )?;
    let pid = lane.process.as_ref().unwrap().id();
    let exits = counters()[kind as usize].exits.load(Ordering::Relaxed);
    resume.send(()).unwrap();
    let result = observer
        .join()
        .unwrap()
        .into_iter()
        .find(|value| value.kind == "foreground")
        .unwrap();
    assert_eq!(
        result.process_id, pid,
        "an old observer must not clear the replacement identity"
    );
    assert_eq!(
        result.exits, exits,
        "an old observer must not duplicate the exit"
    );
    assert!(result.last_response_age_ms.is_some());
    assert!(result.caches.is_some());
    assert!(lane.process.as_mut().unwrap().stop(CLEANUP_BUDGET));
    lane.process = None;
    println!("NATIVE_DIAGNOSTIC_GENERATION delayed_old_observer=true replacement_preserved=true");
    Ok(())
}
