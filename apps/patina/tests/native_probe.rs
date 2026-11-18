#[cfg(debug_assertions)]
#[test]
fn native_probe_processes_are_reused_reaped_and_recovered() {
    patina_recorder::verify_native_probe_lifecycle(std::path::Path::new(env!(
        "CARGO_BIN_EXE_patina"
    )))
    .expect("native probe process lifecycle");
}

#[test]
fn invalid_probe_role_exits_before_opening_a_profile() {
    use std::process::{Command, Stdio};

    let profile = tempfile::tempdir().unwrap();
    for (arguments, expected) in [
        (&[][..], 2),
        (&["unknown"][..], 2),
        (&["foreground", "extra"][..], 2),
        (&["foreground"][..], 1),
    ] {
        let status = Command::new(env!("CARGO_BIN_EXE_patina"))
            .args(["--role", "Patina Probe"])
            .args(arguments)
            .env("PATINA_GPUI_PROFILE_PARENT", profile.path())
            .stdin(Stdio::null())
            .status()
            .unwrap();
        assert_eq!(status.code(), Some(expected), "{arguments:?}");
    }
    assert!(profile.path().read_dir().unwrap().next().is_none());
}
