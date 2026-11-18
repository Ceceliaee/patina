use std::{fs, path::Path};

fn workflow(name: &str) -> String {
    fs::read_to_string(
        Path::new(env!("CARGO_MANIFEST_DIR")).join(format!("../.github/workflows/{name}.yml")),
    )
    .unwrap()
    .replace("\r\n", "\n")
}

#[test]
fn workflows_pin_reviewed_actions() {
    let reviewed = [
        "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7",
        "actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7",
        "actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c # v8",
        "actions/attest@1e69f48acb82d1966a394da916b4c1698aa569d6 # v4",
        "softprops/action-gh-release@3d0d9888cb7fd7b750713d6e236d1fcb99157228 # v3",
    ];
    for name in ["pr-intake", "verify", "prepare-release"] {
        let source = workflow(name);
        let actions: Vec<_> = source
            .lines()
            .filter_map(|l| l.trim().strip_prefix("uses: "))
            .collect();
        assert!(!actions.is_empty(), "{name}");
        for action in actions {
            assert!(
                reviewed.contains(&action),
                "{name}: review new action revision {action}"
            );
        }
    }
}

#[test]
fn release_jobs_publish_only_verified_immutable_assets() {
    let flow = workflow("prepare-release");
    let (before, after) = flow.split_once("\n  publish:\n").unwrap();
    let (publish, mirror) = after.split_once("\n  r2:\n").unwrap();
    for phrase in [
        "ref: refs/heads/main",
        "persist-credentials: false",
        "cargo xtask release resolve",
        "needs: [resolve, version-files, changelog, release-notes]",
        "target: x86_64-pc-windows-msvc",
        "runner: windows-11-arm",
        "target: aarch64-pc-windows-msvc",
        "name: native-bundle-",
        "cargo install --locked --path xtask",
        "--signing-key-env SIGNING_PRIVATE_KEY",
        "--password-env SIGNING_PASSWORD",
        "permissions:\n  contents: read",
        "group: publish-release-",
        "cancel-in-progress: false",
    ] {
        assert!(before.contains(phrase), "{phrase}");
    }
    assert!(!before.contains("contents: write") && !before.contains("id-token: write"));
    for phrase in [
        "needs: [resolve, release-notes, windows-build]",
        "contents: write",
        "id-token: write",
        "attestations: write",
        "artifact-metadata: write",
        "overwrite_files: false",
    ] {
        assert!(publish.contains(phrase), "{phrase}");
    }
    let mut tail = publish;
    for phase in [
        "cargo xtask release prepare",
        "cargo xtask release verify",
        "subject-path: dist-release/Patina_",
        "_x64-setup.exe",
        "subject-path: dist-release/Patina_",
        "_arm64-setup.exe",
        "name: Upload release assets",
        "uses: softprops/action-gh-release@",
        "cargo xtask release readback",
    ] {
        tail = tail.split_once(phase).unwrap().1;
    }
    let public_files = publish
        .split_once("          files: |\n")
        .unwrap()
        .1
        .lines()
        .take_while(|l| l.starts_with("            "))
        .map(str::trim)
        .collect::<Vec<_>>();
    assert_eq!(
        public_files,
        [
            "dist-release/Patina_\x24{{ needs.resolve.outputs.version }}_x64-setup.exe",
            "dist-release/Patina_\x24{{ needs.resolve.outputs.version }}_arm64-setup.exe",
            "dist-release/SHA256SUMS.txt",
            "dist-release/gpui-latest.json"
        ]
    );
    for phrase in [
        "needs: [resolve, publish]",
        "group: patina-updater-mirror",
        "cancel-in-progress: false",
        "cargo xtask release sync-mirror",
    ] {
        assert!(mirror.contains(phrase), "{phrase}");
    }
    for id in super::gate::JOBS {
        assert!(
            workflow("verify").contains(
                id.replace("(x64)", "(\x24{{ matrix.arch }})")
                    .replace("(arm64)", "(\x24{{ matrix.arch }})")
                    .as_str()
            ),
            "{id}"
        );
    }
}
