use std::{
    io::Write,
    process::{Command, Stdio},
};

#[test]
fn mismatched_host_is_rejected_before_creating_windows() {
    let mut ui = Command::new(env!("CARGO_BIN_EXE_patina"))
        .args([
            "--role",
            "Patina UI",
            patina_desktop_protocol::WIRE_VERSION,
            "en-US",
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();
    let mut pipe = ui.stdin.take().unwrap();
    writeln!(
        pipe,
        "Patina Desktop {} other-release",
        patina_desktop_protocol::WIRE_VERSION
    )
    .unwrap();
    drop(pipe);
    let result = ui.wait_with_output().unwrap();
    assert!(!result.status.success());
    assert!(result.stdout.is_empty());
}
