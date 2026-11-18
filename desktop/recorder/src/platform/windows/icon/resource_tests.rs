use super::*;
use crate::platform::windows::{
    handles::release_checks, resource::current_process_resource_snapshot,
};

#[test]
#[ignore = "real installed executable icon resource experiment"]
fn file_icon_resource_boundaries() {
    // perf:helper-resources owns the process deadline and captures the evidence.
    let path =
        std::env::var("PATINA_ICON_RESOURCE_PATH").expect("explicit executable path required");
    assert!(std::path::Path::new(&path).is_file());
    let baseline = current_process_resource_snapshot();
    for (phase, cached) in [("uncached", false), ("cached", true)] {
        let mut warm = None;
        for iteration in 0..=1_000 {
            let value = if cached {
                get_icon_base64(&path)
            } else {
                get_icon_base64_uncached(&path)
            };
            assert!(
                value.is_some(),
                "real executable must contain an extractable icon"
            );
            let size = value.as_ref().unwrap().len();
            drop(value);
            if matches!(iteration, 0 | 50 | 100 | 500 | 1_000) {
                let resource = current_process_resource_snapshot();
                println!(
                    "FILE_ICON_RESOURCES {}",
                    serde_json::json!({
                        "phase": phase, "iteration": iteration, "encoded_bytes": size,
                        "baseline": baseline, "resource": resource,
                        "release_attempts_failures": release_checks::counts(),
                    })
                );
                if iteration == 50 {
                    warm = Some(resource.clone());
                }
                if iteration == 1_000 {
                    assert_eq!(resource.gdi_objects, warm.as_ref().unwrap().gdi_objects);
                    assert_eq!(resource.user_objects, warm.as_ref().unwrap().user_objects);
                }
            }
        }
    }
    for [attempts, failed] in release_checks::counts() {
        assert_eq!(failed, 0, "native release failure in {attempts} attempts");
    }
}
