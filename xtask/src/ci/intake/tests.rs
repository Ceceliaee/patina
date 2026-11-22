use super::*;
use std::{collections::BTreeMap, fs, process::Command};

fn change(path: &str) -> Change {
    Change {
        path: path.into(),
        status: b'M',
        add: 1,
        ..Change::default()
    }
}
const BODY: &str = "## Purpose\nFix the report.\n## Accepted Scope\nRefs #123\n## Changes\nFix the report heading.\n## Scope Boundary\n- In scope: report\n- Out of scope: other reports\n## Owner Check\n- UI owner: report page\n- Rust owner: report model\n- Why this placement fits: owner handles headings\n## Risk Review\n- Tracking correctness: N/A\n- Local data safety: N/A\n- Privacy or security: N/A\n- Compatibility and migration: N/A\n- Failure and recovery behavior: N/A\n## UI Review\n- [x] UI follows Quiet Pro\n- [x] Screenshots attached externally\n- Affected states: empty\n- Keyboard and focus: unchanged order\n- Repeatable test or existing owner test: cargo test -p patina-ui\n## Validation\n- [x] \x60cargo xtask check\x60\n## Screenshots\nhttps://github.com/user-attachments/assets/test-id\n## Contributor Checklist\n- [x] Completed owner review.";
fn body_fails(body: &str, files: &[Change]) -> bool {
    let mut errors = vec![];
    body::assess(body, files, &mut errors);
    !errors.is_empty()
}

#[test]
fn intake_requires_accepted_scope_complete_visible_fields_and_external_evidence() {
    let files = [change("apps/patina-ui/src/features/today/mod.rs")];
    assert!(!body_fails(BODY, &files));
    assert!(!body_fails(
        &BODY.replace("- UI owner:", "- GPUI owner:"),
        &files
    ));
    for (old, new) in [
        ("Refs #123", "<!-- Refs #123 -->"),
        ("- In scope: report", "- In scope:"),
        ("- Rust owner: report model", "- Rust owner:"),
        ("- UI owner: report page", "- UI owner:"),
        ("## Changes", "## Else"),
        ("[x] Completed", "[ ] Completed"),
        ("[x] UI follows Quiet Pro", "[ ] UI follows Quiet Pro"),
        ("cargo test -p patina-ui", "I looked at it"),
        (
            "https://github.com/user-attachments/assets/test-id",
            "https://github.com/owner/project/blob/main/a.png",
        ),
        (
            "https://github.com/user-attachments/assets/test-id",
            "https://raw.githubusercontent.com/owner/a.png",
        ),
        (
            "https://github.com/user-attachments/assets/test-id",
            "<!-- https://example.org/review.png -->",
        ),
    ] {
        assert!(body_fails(&BODY.replace(old, new), &files), "{old}")
    }
    assert!(!body_fails(
        &BODY.replace(
            "https://github.com/user-attachments/assets/test-id",
            "https://images.example.org/review.png"
        ),
        &files
    ));
}
#[test]
fn docs_only_and_governance_evidence_match_actual_file_types() {
    let docs = BODY.replace("cargo xtask check", "cargo xtask docs check");
    assert!(!body_fails(&docs, &[change("docs/guide.md")]));
    let governed = docs.replace(
        "## Screenshots",
        "- [x] \x60cargo test -p xtask docs::\x60\n## Screenshots",
    );
    for path in [
        "CONTRIBUTING.md",
        "docs/documentation.md",
        "docs/quality.md",
    ] {
        assert!(body_fails(&docs, &[change(path)]), "{path}");
        assert!(!body_fails(&governed, &[change(path)]), "{path}");
        assert!(!body_fails(BODY, &[change(path)]), "{path}");
    }
    assert!(body_fails(
        &docs,
        &[Change {
            binary: true,
            ..change("docs/guide.md")
        }]
    ));
    assert!(body_fails(
        &docs,
        &[Change {
            status: b'T',
            ..change("docs/guide.md")
        }]
    ));
    assert!(body_fails(&docs, &[change("Cargo.toml")]));
    assert!(!body_fails(
        &BODY.replace("cargo xtask check", "cargo test --locked -p patina-ui"),
        &[change("Cargo.toml")]
    ));
    assert!(body_fails(&docs, &[]));
    let application = [change("apps/patina/src/main.rs")];
    for cmd in [
        "cargo test --no-run",
        "cargo test -- --list",
        "cargo xtask check tools",
    ] {
        assert!(body_fails(
            &BODY.replace("cargo xtask check", cmd),
            &application
        ));
    }
}
#[test]
fn metadata_keeps_unusual_paths_and_fails_closed_on_malformed_counts() {
    let files = git::metadata(
        b"A\0docs/a\t.md\0M\0img\n.bin\0",
        b"1\t0\tdocs/a\t.md\0-\t-\timg\n.bin\0",
    )
    .unwrap();
    assert_eq!(files[0].path, "docs/a\t.md");
    assert!(files[1].binary);
    for counts in [
        b"1\t0\tname".as_slice(),
        b"-\t1\tname\0",
        b"01\t0\tname\0",
        b"1\t0\tother\0",
        b"1\t0\tname\x001\t0\tname\0",
    ] {
        assert!(git::metadata(b"M\0name\0", counts).is_err());
    }
    assert!(git::metadata(b"R100\0name\0", b"1\t0\tname\0").is_err());
}
#[test]
fn manual_size_ownership_and_design_rules_apply_to_new_workspace() {
    assert!(!generated("dist/manual.rs"));
    assert!(
        size(&[Change {
            add: 999,
            del: 2,
            ..change("crates/storage/x.rs")
        }])
        .is_err()
    );
    assert!(
        size(&[Change {
            add: 20000,
            ..change("Cargo.lock")
        }])
        .is_ok()
    );
    assert!(
        size(
            &(0..26)
                .map(|i| change(&format!("docs/{i}.md")))
                .collect::<Vec<_>>()
        )
        .is_err()
    );
    for (path, lines, rule) in [
        ("xtask/src/check.rs", vec![], "quality-gate-modified"),
        (
            ".github/workflows/verify.yml",
            vec![],
            "quality-gate-modified",
        ),
        (
            "src/styles/shared/token.css",
            vec![],
            "retired-or-unowned-tree-path",
        ),
        ("docs/test.png", vec![], "repository-review-media-added"),
        (
            "apps/patina-ui/src/features/history/mod.rs",
            vec![".child(\"Close\")"],
            "hardcoded-ui-copy",
        ),
        (
            "apps/patina-ui/src/features/history/mod.rs",
            vec![".bg(rgb(0x123456))"],
            "hardcoded-visual-style",
        ),
        (
            "docs/text.md",
            vec!["\u{feff}hello"],
            "encoding-marker-added",
        ),
    ] {
        let mut errors = vec![];
        rules(
            &[Change {
                status: b'A',
                lines: lines.into_iter().map(str::to_owned).collect(),
                ..change(path)
            }],
            &mut errors,
        );
        assert!(errors.iter().any(|e| e.contains(rule)), "{path}")
    }
    let mut errors = vec![];
    rules(
        &[Change {
            status: b'A',
            ..change("apps/patina-ui/assets/about/icon.png")
        }],
        &mut errors,
    );
    assert!(errors.is_empty());
}
#[test]
fn only_reachable_focused_positive_tests_cover_each_risk() {
    let owner = "apps/patina".to_string();
    let mut files = BTreeMap::from([
        (
            "apps/patina/Cargo.toml".into(),
            "[package]\nname='patina'\nversion='1.0.0'".into(),
        ),
        (
            "apps/patina/src/lib.rs".into(),
            "#[cfg(test)] mod tests;".into(),
        ),
        (
            "apps/patina/src/tests.rs".into(),
            "#[test] fn existing() {}".into(),
        ),
        (
            "apps/patina/tests/pages.rs".into(),
            "#[path=\"pages/resident.rs\"] mod resident;".into(),
        ),
        (
            "apps/patina/tests/pages/resident.rs".into(),
            "#[test] fn checks_window() {}".into(),
        ),
        (
            "apps/patina/tests/pages/unused.rs".into(),
            "#[test] fn disconnected() {}".into(),
        ),
    ]);
    let graph = registration::registered(&files, std::slice::from_ref(&owner)).unwrap();
    assert!(graph.contains("apps/patina/src/tests.rs"));
    assert!(graph.contains("apps/patina/tests/pages/resident.rs"));
    assert!(!graph.contains("apps/patina/tests/pages/unused.rs"));
    let window = "apps/patina/src/window_process.rs";
    let resident = "apps/patina/tests/pages/resident.rs";
    let evaluate = |files: &[Change], tests: &BTreeSet<String>| {
        let mut errors = vec![];
        risk::check(files, tests, &mut errors);
        errors
    };
    assert!(!evaluate(&[change(window)], &graph).is_empty());
    assert!(evaluate(&[change(window), change(resident)], &graph).is_empty());
    assert!(
        !evaluate(
            &[
                change(window),
                Change {
                    add: 0,
                    del: 1,
                    ..change(resident)
                }
            ],
            &graph
        )
        .is_empty()
    );
    assert!(
        !evaluate(
            &[
                change("apps/patina-ui/src/windows/notice.rs"),
                change(resident)
            ],
            &graph
        )
        .is_empty()
    );
    assert!(
        !evaluate(
            &[
                change("apps/patina-ui/src/features/data/trend.rs"),
                change(resident)
            ],
            &graph
        )
        .is_empty()
    );
    let inline = Change {
        lines: vec!["#[test]".into()],
        ..change(window)
    };
    assert!(evaluate(&[inline], &BTreeSet::from([window.to_owned()])).is_empty());
    files
        .get_mut("apps/patina/Cargo.toml")
        .unwrap()
        .push_str("\nautotests=false");
    assert!(
        !registration::registered(&files, &[owner])
            .unwrap()
            .contains(resident)
    );
}
#[test]
fn workspace_and_test_manifest_changes_cannot_weaken_validation() {
    let old = "[workspace]\nmembers=['a','b']\nexclude=['out']\n";
    assert!(preserved_manifest(old, &old.replace("'b'", "'b','c'")).unwrap());
    assert!(!preserved_manifest(old, &old.replace("'a','b'", "'a'")).unwrap());
    assert!(!preserved_manifest(old, &old.replace("'out'", "'out','a'")).unwrap());
    let package =
        "[package]\nname='a'\nversion='1'\n[[test]]\nname='native'\npath='tests/native.rs'\n";
    for head in [
        package.replace("native.rs", "noop.rs"),
        format!("{package}test=false"),
        format!("{package}required-features=['disabled']"),
        package.replace("version=", "autotests=false\nversion="),
    ] {
        assert!(!preserved_manifest(package, &head).unwrap())
    }
}
#[test]
fn trusted_intake_reads_git_blobs_without_checking_out_or_executing_head() -> Result<()> {
    let root = tempfile::tempdir()?;
    let root = root.path();
    let git_cmd = |args: &[&str]| -> Result<String> {
        let out = Command::new("git")
            .current_dir(root)
            .args([
                "-c",
                "user.name=Test",
                "-c",
                "user.email=test@example.invalid",
                "-c",
                "commit.gpgsign=false",
            ])
            .args(args)
            .output()?;
        if !out.status.success() {
            return Err(String::from_utf8_lossy(&out.stderr).into_owned().into());
        }
        Ok(String::from_utf8(out.stdout)?.trim().into())
    };
    git_cmd(&["init", "-q"])?;
    fs::create_dir_all(root.join("apps/patina/src"))?;
    fs::write(
        root.join("apps/patina/Cargo.toml"),
        "[package]\nname='patina'\nversion='1.0.0'\n",
    )?;
    fs::write(root.join("apps/patina/src/lib.rs"), "mod window_process;\n")?;
    fs::write(
        root.join("apps/patina/src/window_process.rs"),
        "fn open() {}\n",
    )?;
    git_cmd(&["add", "."])?;
    git_cmd(&["commit", "-qm", "base"])?;
    let base = git_cmd(&["rev-parse", "HEAD"])?;
    fs::write(
        root.join("apps/patina/src/window_process.rs"),
        "fn open()->bool{true}\n",
    )?;
    fs::create_dir_all(root.join("apps/patina/tests/pages"))?;
    fs::write(
        root.join("apps/patina/tests/pages/resident.rs"),
        "#[test] fn opens(){ assert!(true); }\n",
    )?;
    git_cmd(&["add", "."])?;
    git_cmd(&["commit", "-qm", "unregistered"])?;
    let bad = git_cmd(&["rev-parse", "HEAD"])?;
    fs::write(
        root.join("apps/patina/tests/pages.rs"),
        "#[path=\"pages/resident.rs\"] mod resident;\n",
    )?;
    git_cmd(&["add", "."])?;
    git_cmd(&["commit", "-qm", "registered"])?;
    let good = git_cmd(&["rev-parse", "HEAD"])?;
    git_cmd(&["checkout", "-q", &base])?;
    let args = |head: String| vec!["--base".to_owned(), base.clone(), "--head".into(), head];
    assert!(
        run(root, &args(bad))
            .unwrap_err()
            .to_string()
            .contains("risk-path-without-tests")
    );
    run(root, &args(good))?;
    assert!(!root.join("apps/patina/tests/pages.rs").exists());
    Ok(())
}
