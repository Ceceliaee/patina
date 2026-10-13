mod app;
mod commands;
mod data;
mod domain;
mod engine;
mod platform;

use std::sync::Arc;

// Only the dedicated coverage compiler wrapper enables this. Desktop tests
// checkpoint native counters before deliberately terminating a process.
#[cfg(patina_coverage)]
pub(crate) fn flush_coverage() {
    unsafe extern "C" {
        fn __llvm_profile_write_file() -> i32;
    }
    if unsafe { __llvm_profile_write_file() } != 0 {
        eprintln!("native coverage checkpoint failed");
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(debug_assertions)]
    let context = tauri::generate_context!("tauri.dev.conf.json");
    #[cfg(all(not(debug_assertions), patina_local_build))]
    let context = tauri::generate_context!("tauri.local.conf.json");
    #[cfg(all(not(debug_assertions), not(patina_local_build)))]
    let context = if app::runtime::should_use_local_build_context() {
        tauri::generate_context!("tauri.local.conf.json")
    } else {
        tauri::generate_context!()
    };
    let runtime_health = Arc::new(engine::tracking::watchdog::RuntimeHealthState::default());
    let launched_by_autostart = app::runtime::was_launched_by_autostart();
    let app_version = context.package_info().version.to_string();

    app::bootstrap::build(app::bootstrap::BootstrapInput {
        runtime_health,
        launched_by_autostart,
        app_version,
    })
    .build(context)
    .expect("error while building tauri application")
    .run(app::bootstrap::handle_run_event);
}
