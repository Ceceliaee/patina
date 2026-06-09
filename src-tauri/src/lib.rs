mod app;
mod commands;
mod data;
mod domain;
mod engine;
mod platform;

use std::sync::Arc;

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
    let app_identifier = context.config().identifier.clone();

    if let Err(error) = tauri::async_runtime::block_on(
        data::sqlite_pool::normalize_current_baseline_migration_history(&app_identifier),
    ) {
        eprintln!("[sql] failed to normalize current baseline migration history: {error}");
    }

    app::bootstrap::build(app::bootstrap::BootstrapInput {
        runtime_health,
        launched_by_autostart,
        app_version,
    })
    .build(context)
    .expect("error while building tauri application")
    .run(app::bootstrap::handle_run_event);
}
