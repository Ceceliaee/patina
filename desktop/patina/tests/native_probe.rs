#[cfg(debug_assertions)]
#[test]
fn native_probe_processes_are_reused_reaped_and_recovered() {
    patina_recorder::verify_native_probe_lifecycle(std::path::Path::new(env!(
        "CARGO_BIN_EXE_patina-gpui"
    )))
    .expect("native probe process lifecycle");
}
