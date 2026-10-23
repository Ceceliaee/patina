#[test]
fn native_probe_processes_are_reused_reaped_and_recovered() {
    patina_lib::verify_native_probe_lifecycle(std::path::Path::new(env!("CARGO_BIN_EXE_patina")))
        .expect("native probe process lifecycle");
}
