use super::*;
use crate::platform::windows::resource::current_process_resource_snapshot;
use std::cell::{Cell, RefCell};
use windows::core::Interface;
use windows::Win32::Media::Audio::{
    eMultimedia, eRender, IAudioSessionManager2, IMMDeviceEnumerator, MMDeviceEnumerator,
};
use windows::Win32::System::Com::{CoCreateInstance, CLSCTX_ALL};

thread_local! {
    static TRACE: Cell<bool> = const { Cell::new(false) };
    static MARKS: RefCell<Vec<serde_json::Value>> = const { RefCell::new(Vec::new()) };
    static INVENTORY: Cell<i32> = const { Cell::new(0) };
}
pub(super) fn inventory(count: i32) {
    INVENTORY.with(|value| value.set(count));
}
pub(super) fn mark(phase: &str) {
    if TRACE.with(Cell::get) {
        MARKS.with(|values| {
            values.borrow_mut().push(serde_json::json!({
                "phase": phase, "resources": current_process_resource_snapshot(),
            }))
        });
    }
}

#[test]
#[ignore = "real WASAPI allocation attribution experiment"]
fn audio_resource_boundaries() {
    // perf:helper-resources owns the process deadline and captures the evidence.
    let mode = std::env::var("PATINA_AUDIO_RESOURCE_CASE")
        .expect("explicit audio experiment case required");
    assert!([
        "echo",
        "device",
        "query",
        "activation-query",
        "lifecycle",
        "silent-client",
        "manager",
        "enumerator",
        "retained-enumerator"
    ]
    .contains(&mode.as_str()));
    if mode == "lifecycle" {
        super::native::verify_lifecycle();
        return;
    }
    if mode == "silent-client" {
        super::native::run_silent_client();
        return;
    }
    let _apartment = ComGuard::initialize().unwrap();
    let mut counts = (i32::MAX, 0);
    let mut retained: Option<IAudioSessionManager2> = None;
    let mut probe = (mode == "query").then(|| AudioSessionProbe::new().unwrap());
    for iteration in 0..=3_000 {
        TRACE.with(|trace| trace.set(iteration == 0));
        match mode.as_str() {
            "query" | "activation-query" => {
                let snapshot = if mode == "query" {
                    probe.as_mut().unwrap().query(now_ms()).unwrap()
                } else {
                    query_with_repeated_activation(now_ms()).unwrap()
                };
                assert_eq!(snapshot.probe_status, AudioProbeStatus::Ok);
                let count = INVENTORY.with(Cell::get);
                counts = (counts.0.min(count), counts.1.max(count));
                drop(snapshot);
            }
            "device" => unsafe {
                let enumerator: IMMDeviceEnumerator =
                    CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL).unwrap();
                let device = enumerator
                    .GetDefaultAudioEndpoint(eRender, eMultimedia)
                    .unwrap();
                drop(device);
                drop(enumerator);
            },
            "manager" | "enumerator" | "retained-enumerator" => unsafe {
                let manager = if let Some(manager) = retained.as_ref() {
                    manager.clone()
                } else {
                    let enumerator: IMMDeviceEnumerator =
                        CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL).unwrap();
                    let device = enumerator
                        .GetDefaultAudioEndpoint(eRender, eMultimedia)
                        .unwrap();
                    device
                        .Activate::<IAudioSessionManager2>(CLSCTX_ALL, None)
                        .unwrap()
                };
                if mode != "manager" {
                    let enumerator = manager.GetSessionEnumerator().unwrap();
                    let count = enumerator.GetCount().unwrap();
                    counts = (counts.0.min(count), counts.1.max(count));
                }
                if mode == "retained-enumerator" && retained.is_none() {
                    retained = Some(manager);
                }
            },
            _ => (),
        }
        if iteration == 0 {
            MARKS.with(|values| {
                println!(
                    "AUDIO_PHASES {}",
                    serde_json::to_string(&*values.borrow()).unwrap()
                )
            });
        }
        if iteration % 250 == 0 {
            println!(
                "AUDIO_RESOURCES {}",
                serde_json::json!({
                    "mode": mode, "iteration": iteration,
                    "resource": current_process_resource_snapshot(),
                    "native_session_count_range": if counts.0 != i32::MAX { Some(counts) } else { None },
                })
            );
        }
        // Pace the experimental workload; no test state depends on this delay.
        std::thread::sleep(std::time::Duration::from_millis(10));
    }
}

// Counterexample for the per-poll activation path observed in the heap capture.
fn query_with_repeated_activation(now_ms: i64) -> Result<AudioSnapshot, String> {
    mark("before-query");
    let _apartment = ComGuard::initialize()?;
    unsafe {
        let enumerator: IMMDeviceEnumerator =
            CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL).map_err(|e| e.to_string())?;
        mark("after-device-enumerator");
        let device = enumerator
            .GetDefaultAudioEndpoint(eRender, eMultimedia)
            .map_err(|e| e.to_string())?;
        mark("after-default-endpoint");
        let manager = device
            .Activate::<IAudioSessionManager2>(CLSCTX_ALL, None)
            .map_err(|e| e.to_string())?;
        mark("after-manager");
        let enumerator = manager.GetSessionEnumerator().map_err(|e| e.to_string())?;
        let count = enumerator.GetCount().map_err(|e| e.to_string())?;
        inventory(count);
        mark("after-session-enumerator");
        let controls = (0..count)
            .map(|index| {
                enumerator
                    .GetSession(index)?
                    .cast::<IAudioSessionControl2>()
            })
            .collect::<windows::core::Result<Vec<_>>>()
            .map_err(|e| e.to_string())?;
        snapshot_from_sessions(now_ms, controls)
    }
}
