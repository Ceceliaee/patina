use super::Change;
use regex::Regex;
use std::collections::BTreeSet;

const AREAS: &[(&str, &str, &str)] = &[
    (
        "window process and command dispatch",
        r"^(?:apps/patina/src/(?:main\.rs|lib\.rs|window_process|tray|message_loop)|apps/patina-ui/src/(?:lib\.rs|windows/mod\.rs|client/)|crates/desktop-protocol/src/)",
        r"^(?:apps/patina/tests/(?:today|pages/resident|resources|lifecycle|handshake)|crates/desktop-protocol/)",
    ),
    (
        "tracking lifecycle",
        r"^crates/(?:activity/src/(?:engine/tracking|data/tracking_runtime)|activity-model/src/tracking)",
        r"^crates/(?:activity|activity-model)/(?:src/.*tracking|tests/.*(?:tracking|services))",
    ),
    (
        "SQLite storage",
        r"^crates/(?:storage/src/|activity/src/data/(?:repositories/|sqlite|schema|tracking_runtime|activity_read_model))",
        r"^crates/(?:storage/|activity/tests/contracts(?:\.rs|/)|activity/src/data/)",
    ),
    (
        "backup and restore",
        r"^crates/(?:activity|storage)/src/.*(?:backup|restore)",
        r"^(?:crates/(?:activity|storage)/(?:src/.*(?:backup|restore)|tests/contracts/storage)|apps/patina(?:-ui)?/tests/pages/storage)",
    ),
    (
        "export",
        r"^(?:crates/(?:activity|storage)/src/.*export|apps/patina-ui/src/.*export)",
        r"^(?:crates/(?:activity|storage)/(?:src/.*export|tests/contracts/storage)|apps/patina(?:-ui)?/tests/pages/storage)",
    ),
    (
        "tool alerts",
        r"^(?:apps/patina/src/tool_events\.rs|apps/patina-ui/src/(?:features/tools/|windows/notice\.rs))",
        r"^(?:apps/patina(?:-ui)?/tests/pages/tools\.rs|crates/tool-host/.*(?:alerts|notification))",
    ),
    (
        "data read model",
        r"^(?:crates/activity/src/data/activity_read_model|apps/patina-ui/src/features/data|crates/storage/src/.*activity_read_model)",
        r"^(?:crates/(?:activity|storage)/(?:src/.*activity_read_model|tests/contracts\.rs)|apps/patina(?:-ui)?/tests/pages/(?:data_range|trend_chart))",
    ),
    (
        "native probe",
        r"^crates/windows-integration/src/.*native_probe",
        r"^(?:apps/patina/tests/(?:native_probe|lifecycle)|crates/windows-integration/src/.*native_probe)",
    ),
    (
        "settings persistence",
        r"^(?:apps/patina-ui/src/features/settings|crates/(?:activity|storage)/src/data/repositories/[^/]*settings)",
        r"^(?:apps/patina(?:-ui)?/tests/pages/(?:storage|services|schemes)|crates/(?:activity|storage)/.*settings)",
    ),
    (
        "updater and installation",
        r"^(?:crates/updater/src/|packaging/windows/)",
        r"^(?:crates/updater/|apps/patina/tests/updater)",
    ),
];

pub(super) fn check(files: &[Change], registered: &BTreeSet<String>, errors: &mut Vec<String>) {
    let inline = Regex::new(r"^\s*#\[\s*(?:(?:tokio|gpui)::)?test(?:\s*\(.*\))?\s*\]").unwrap();
    for (name, production, evidence) in AREAS {
        let production = Regex::new(production).unwrap();
        let focused = Regex::new(evidence).unwrap();
        let changed = files
            .iter()
            .filter(|f| production.is_match(&f.path) && !test_path(&f.path))
            .collect::<Vec<_>>();
        if changed.is_empty() {
            continue;
        }
        if !files.iter().any(|f| {
            f.add > 0
                && !f.binary
                && f.status != b'D'
                && registered.contains(&f.path)
                && ((focused.is_match(&f.path) && test_path(&f.path))
                    || (production.is_match(&f.path) && f.lines.iter().any(|l| inline.is_match(l))))
        }) {
            errors.push(format!(
                "risk-path-without-tests: {name} requires a focused registered test for {}",
                changed[0].path
            ))
        }
    }
}
pub(super) fn test_path(p: &str) -> bool {
    p.split('/').any(|s| {
        s == "tests"
            || s == "test"
            || s == "tests.rs"
            || s.ends_with("_tests.rs")
            || s.starts_with("test_")
    })
}
