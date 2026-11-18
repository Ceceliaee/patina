use super::*;
use base64::{Engine, engine::general_purpose::STANDARD};
fn fixture(wat_source: &str) -> Package {
    Package {
        manifest: Manifest {
            id: "example.limits".into(),
            name: "Limits".into(),
            version: "1".into(),
            api: 1,
            entry: "panel".into(),
            capabilities: vec![Capability::Panel],
        },
        wasm: STANDARD.encode(wat::parse_str(wat_source).unwrap()),
        publisher: String::new(),
        signature: String::new(),
    }
}

#[test]
fn computation_is_interrupted_before_returning_a_panel() {
    let p=fixture("(module (func (export \"panel\") (result i32) (local i32)
        (loop local.get 0 i32.const 1 i32.add local.tee 0 i32.const 10000000 i32.lt_u br_if 0) i32.const 0))");
    let mut guest = compile(&p).unwrap();
    let error = guest.call::<_, &[u8]>("panel", &[][..]).unwrap_err();
    let message = format!("{error:#}").to_lowercase();
    assert!(
        message.contains("fuel") || message.contains("interrupt") || message.contains("timeout"),
        "{message}"
    );
}

#[test]
fn guest_has_no_application_database_import() {
    let p = fixture(
        "(module (import \"patina\" \"database\" (func)) (func (export \"panel\") (result i32) i32.const 0))",
    );
    assert!(compile(&p).is_err());
}
