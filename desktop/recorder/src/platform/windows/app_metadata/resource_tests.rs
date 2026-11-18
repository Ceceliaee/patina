//! Real Shell resource experiment; opt in because it depends on installed apps.
use super::*;
use crate::platform::windows::{
    handles::release_checks, resource::current_process_resource_snapshot,
};
use std::cell::{Cell, RefCell};

thread_local! {
    static TRACE: Cell<bool> = const { Cell::new(false) };
    static MARKS: RefCell<Vec<serde_json::Value>> = const { RefCell::new(Vec::new()) };
    static CALLS: Cell<u64> = const { Cell::new(0) };
}

pub(super) fn mark(phase: &str) {
    if phase == "before-com" {
        CALLS.with(|count| count.set(count.get() + 1));
    }
    if TRACE.with(Cell::get) {
        MARKS.with(|values| {
            values.borrow_mut().push(serde_json::json!({
                "phase": phase,
                "resources": current_process_resource_snapshot(),
                "release_attempts_failures": release_checks::counts(),
            }))
        });
    }
}

#[test]
#[ignore = "real installed Shell resource experiment"]
fn shell_icon_resource_boundaries() {
    // perf:helper-resources owns the process deadline and captures the evidence.
    let mode = std::env::var("PATINA_SHELL_RESOURCE_CASE").expect("explicit Shell case required");
    assert!([
        "uncached",
        "cached",
        "missing",
        "com-only",
        "uncached-retained",
        "missing-retained",
        "uncached-pumped",
        "missing-pumped",
        "uncached-mta",
        "missing-mta",
        "parsing",
        "missing-parsing"
    ]
    .contains(&mode.as_str()));
    let aumid = if mode.starts_with("missing") {
        "Patina.Resource.Test.Does.Not.Exist!App"
    } else {
        "windows.immersivecontrolpanel_cw5n1h2txyewy!microsoft.windows.immersivecontrolpanel"
    };
    let _retained = (mode.ends_with("-retained") || mode.ends_with("-pumped"))
        .then(|| ComApartmentGuard::initialize().unwrap());
    let _mta = mode
        .ends_with("-mta")
        .then(|| crate::platform::windows::audio::ComGuard::initialize().unwrap());
    let baseline = current_process_resource_snapshot();
    let native_calls = || {
        if mode == "cached" {
            super::super::native_probe::shell_diagnostics().map_or(0, |stats| stats.requests)
        } else {
            CALLS.with(Cell::get)
        }
    };
    let mut warmed = None;
    for iteration in 0..=2_000 {
        TRACE.with(|trace| trace.set(iteration == 0));
        let icon = if mode == "com-only" {
            drop(ComApartmentGuard::initialize().unwrap());
            None
        } else if mode.ends_with("parsing") {
            let _com = ComApartmentGuard::initialize().unwrap();
            mark("before-com");
            let name = format!("shell:AppsFolder\\{aumid}");
            let name = name.encode_utf16().chain(Some(0)).collect::<Vec<_>>();
            let item: Option<IShellItem> = unsafe {
                windows::Win32::UI::Shell::SHCreateItemFromParsingName(PCWSTR(name.as_ptr()), None)
                    .ok()
            };
            item.and_then(|item| resolve_shell_item_value(item, ShellPresentationKind::Icon))
        } else if mode == "cached" {
            resolve_shell_app_icon(aumid)
        } else {
            request_shell_value(aumid, ShellPresentationKind::Icon)
        };
        assert_eq!(
            icon.is_some(),
            !mode.starts_with("missing") && mode != "com-only"
        );
        drop(icon);
        if mode.ends_with("-pumped") {
            pump_messages();
        }
        if iteration == 0 {
            MARKS.with(|marks| {
                println!(
                    "SHELL_PHASES mode={mode} {}",
                    serde_json::to_string(&*marks.borrow()).unwrap()
                )
            });
        }
        if matches!(iteration, 0 | 50 | 100 | 250 | 500 | 1_000 | 2_000) {
            let resource = current_process_resource_snapshot();
            println!(
                "SHELL_RESOURCES {}",
                serde_json::json!({
                    "mode": mode, "iteration": iteration, "resource": resource,
                    "native_calls": native_calls(), "baseline": baseline,
                    "release_attempts_failures": release_checks::counts()
                })
            );
            if iteration == 50 {
                warmed = Some(resource.clone());
            }
            if iteration == 2_000 {
                let warmed = warmed.as_ref().unwrap();
                assert_eq!(
                    resource.gdi_objects, warmed.gdi_objects,
                    "repeated extraction retained GDI objects"
                );
            }
        }
        // Pace native calls so system callbacks can run; this is a workload,
        // not a substitute for waiting for a test state.
        std::thread::sleep(std::time::Duration::from_millis(10));
    }
    assert_eq!(
        native_calls(),
        if mode == "cached" {
            1
        } else if mode == "com-only" {
            0
        } else {
            2_001
        }
    );
    for [attempts, failed] in release_checks::counts() {
        assert_eq!(failed, 0, "native release failure in {attempts} attempts");
    }
    if mode.ends_with("-pumped") || mode.ends_with("-retained") {
        let until = std::time::Instant::now() + std::time::Duration::from_secs(10);
        while std::time::Instant::now() < until {
            if mode.ends_with("-pumped") {
                pump_messages();
            }
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
        println!(
            "SHELL_SETTLED {}",
            serde_json::json!({
                "mode": mode, "resource": current_process_resource_snapshot()
            })
        );
    }
}

fn pump_messages() {
    use windows::Win32::UI::WindowsAndMessaging::{
        DispatchMessageW, PeekMessageW, TranslateMessage, MSG, PM_REMOVE,
    };
    let mut message = MSG::default();
    // Bound only this experimental pump; the process deadline remains external.
    for _ in 0..64 {
        if !unsafe { PeekMessageW(&mut message, None, 0, 0, PM_REMOVE) }.as_bool() {
            break;
        }
        unsafe {
            let _ = TranslateMessage(&message);
            DispatchMessageW(&message);
        }
    }
}
