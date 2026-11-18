use super::*;
use crate::release::assets::*;
use base64::{Engine, engine::general_purpose::STANDARD};
use patina_updater::{Artifact, Config, Manifest};
use serde_json::{Value, json};
use std::collections::BTreeMap;

fn pe_bytes(t: Target) -> Vec<u8> {
    let mut bytes = vec![0; 128];
    bytes[..2].copy_from_slice(b"MZ");
    bytes[60..64].copy_from_slice(&64u32.to_le_bytes());
    bytes[64..68].copy_from_slice(b"PE\0\0");
    bytes[68..70].copy_from_slice(
        &(match t {
            Target::X64 => 0x8664u16,
            Target::Arm64 => 0xaa64u16,
        })
        .to_le_bytes(),
    );
    bytes
}
#[test]
fn signed_bundles_require_one_program_for_each_architecture() -> Result<()> {
    let fixture: Value = serde_json::from_str(include_str!(
        "../../../crates/updater/tests/fixtures/signed.json"
    ))?;
    let ver = version("0.2.0")?;
    let root = tempfile::tempdir()?;
    let input = root.path().join("input");
    let output = root.path().join("dist");
    let config = Config {
        public_key: fixture["public_key"].as_str().unwrap().into(),
        ..Config::bundled()
    };
    let payload = STANDARD.decode(fixture["payload"].as_str().unwrap())?;
    for t in TARGETS {
        let dir = input.join(arch(t));
        fs::create_dir_all(&dir)?;
        fs::write(dir.join(installer_name(&ver, t)), &payload)?;
        fs::write(dir.join(EXECUTABLE), pe_bytes(t))?;
        let entry = Artifact {
            url: asset_url(&ver, "example/patina", t)?,
            size: payload.len() as u64,
            signature: fixture[match t {
                Target::X64 => "signature",
                Target::Arm64 => "signature_arm64",
            }]
            .as_str()
            .unwrap()
            .into(),
        };
        write_manifest(
            &dir.join(MANIFEST),
            &Manifest {
                schema: 1,
                application: config.application.clone(),
                platforms: BTreeMap::from([(t.key().to_owned(), entry)]),
                version: ver.to_string(),
                notes: String::new(),
            },
        )?;
    }
    let original = read_build_installers(&input, &ver, "example/patina", &config)?;
    prepare(&output, &ver, "notes", &config, &original)?;
    let check = || {
        verify_assets(
            &output,
            &ver,
            "notes",
            &config,
            &read_build_installers(&input, &ver, "example/patina", &config)?,
        )
    };
    check()?;
    assert!(prepare(&output, &ver, "notes", &config, &original).is_err());
    check()?;
    let manifest = read_manifest(&output.join(MANIFEST))?;
    let mirrored = mirror(
        manifest.clone(),
        "example/patina",
        "https://mirror.example/patina",
    )?;
    assert!(
        mirrored.platforms["windows-x86_64"]
            .url
            .ends_with("/patina/desktop/releases/v0.2.0/Patina_0.2.0_x64-setup.exe")
    );
    for failure in [None, Some(1), Some(2), Some(3)] {
        let mut published = Vec::new();
        let result =
            delivery::publish_mirror_files(&output, &mirrored, &config, |path, key, root| {
                assert!(path.is_file());
                published.push(key.to_owned());
                if Some(published.len()) == failure {
                    return Err("simulated object readback failure".into());
                }
                if root {
                    assert_eq!(key, MANIFEST);
                    assert_eq!(read_manifest(path)?, mirrored);
                }
                Ok(())
            });
        assert_eq!(result.is_err(), failure.is_some());
        assert_eq!(published.len(), failure.unwrap_or(3));
        assert_eq!(
            published.contains(&MANIFEST.to_owned()),
            failure.is_none_or(|n| n == 3)
        );
    }
    advance(&mirrored, &mirrored)?;
    let mut newer = mirrored.clone();
    newer.version = "0.10.0".into();
    assert!(advance(&mirrored, &newer).is_err());
    advance(&newer, &mirrored)?;
    newer.version = "0.2.0".into();
    newer.notes = "different".into();
    assert!(advance(&mirrored, &newer).is_err());
    for bad in [
        "http://mirror.example",
        "https://user@mirror.example",
        "https://mirror.example/?x=1",
        "https://mirror.example/#frag",
    ] {
        assert!(mirror(manifest.clone(), "example/patina", bad).is_err());
    }
    for which in 0..7 {
        let mut changed = manifest.clone();
        match which {
            0 => {
                changed.platforms.remove("windows-x86_64");
            }
            1 => changed.application = "other".into(),
            2 => changed.version = "2.0.0".into(),
            3 => changed.notes.clear(),
            4 => changed.platforms.get_mut("windows-x86_64").unwrap().size += 1,
            5 => {
                changed
                    .platforms
                    .get_mut("windows-x86_64")
                    .unwrap()
                    .signature = fixture["signature_arm64"].to_string()
            }
            _ => {
                changed.platforms.get_mut("windows-x86_64").unwrap().url =
                    "https://example.com/invalid".into()
            }
        }
        fs::write(output.join(MANIFEST), serde_json::to_vec(&changed)?)?;
        assert!(check().is_err());
    }
    fs::write(output.join(MANIFEST), serde_json::to_vec(&manifest)?)?;
    let sum = output.join("SHA256SUMS.txt");
    let valid = fs::read_to_string(&sum)?;
    for bad in [
        valid.replace('\n', "\r\n"),
        format!("\u{feff}{valid}"),
        valid.replace("  ", " "),
        format!("{valid}{valid}"),
        valid.trim_end().to_owned(),
    ] {
        fs::write(&sum, bad)?;
        assert!(check().is_err());
    }
    fs::write(sum, valid)?;
    fs::write(output.join("unintended.txt"), "example")?;
    assert!(check().is_err());
    fs::remove_file(output.join("unintended.txt"))?;
    let installer = output.join(installer_name(&ver, Target::X64));
    let mut bytes = payload.clone();
    bytes[0] ^= 1;
    fs::write(&installer, bytes)?;
    assert!(check().is_err());
    fs::write(installer, payload)?;
    let file = input.join("arm64").join(EXECUTABLE);
    fs::remove_file(&file)?;
    assert!(check().is_err());
    fs::write(&file, pe_bytes(Target::X64))?;
    assert!(check().is_err());
    fs::write(file, pe_bytes(Target::Arm64))?;
    let obsolete = input.join("arm64").join("patina-ui.exe");
    fs::write(&obsolete, pe_bytes(Target::Arm64))?;
    assert!(check().is_err());
    fs::remove_file(obsolete)?;
    check()?;
    Ok(())
}
#[test]
fn release_notes_validate_limits_and_visible_sections() -> Result<()> {
    let v = version("2.0.0")?;
    let source = "## [2.0.0] - 2026-01-01\nRelease: Stable\nApp note: 中文\nApp note en: English\n### Changed\n- First\n### Internal\n- Hidden\n### Removed\n- Old\n";
    let notes = changelog::parse(source, &v)?;
    assert_eq!(notes.app(), "zh-CN: 中文\nen-US: English");
    let public = notes.public(&v)?;
    for x in [
        "### 改进",
        "### 移除",
        "- First",
        "- Old",
        "x64-setup.exe",
        "arm64-setup.exe",
    ] {
        assert!(public.contains(x));
    }
    assert!(!public.contains("Hidden"));
    assert_eq!(
        changelog::parse(&source.replace("App note en: English\n", ""), &v)?.app(),
        "中文"
    );
    for x in ["Release: Stable", "App note: 中文"] {
        assert!(changelog::parse(&source.replace(x, ""), &v).is_err());
    }
    assert!(changelog::parse(&source.replace("Release: Stable", "Release: TODO"), &v).is_err());
    let too_many = format!("{source}{}", "- More\n".repeat(6));
    assert!(changelog::parse(&too_many, &v).is_err());
    let minor = version("1.10.0-rc.1")?;
    assert!(changelog::parse(&too_many.replace("2.0.0", &minor.to_string()), &minor).is_ok());
    for invalid in ["2.0", "v2.0.0", "1.2.3+build", "../0.2.3", "0.1.2-01"] {
        assert!(version(invalid).is_err());
    }
    Ok(())
}

#[test]
fn verification_binds_exact_repo_revision_attempt_and_jobs() -> Result<()> {
    let sha = "ab".repeat(20);
    let repo = "example/patina";
    let tag = "refs/tags/v1.10.0";
    let object = "ef".repeat(20);
    let advertised = format!("{object}\t{tag}\n{sha}\t{tag}^{{}}\n");
    assert_eq!(delivery::tag_commit(&advertised, tag, &object)?, sha);
    assert_eq!(delivery::tag_commit(&advertised, tag, &sha)?, sha);
    assert!(delivery::tag_commit(&advertised, tag, &"00".repeat(20)).is_err());
    assert_eq!(
        delivery::tag_commit(&format!("{sha}\t{tag}\n"), tag, &sha)?,
        sha
    );
    let run = json!({"id":7,"run_attempt":2,"path":".github/workflows/verify.yml","event":"push","head_branch":"main","head_sha":sha,"repository":{"full_name":repo},"head_repository":{"full_name":repo},"status":"completed","conclusion":"success"});
    let names = [
        "Resolve and verify immutable candidate",
        "Repository tooling checks",
        "Native desktop checks (x64)",
        "Native desktop checks (arm64)",
        "Native Windows acceptance (x64)",
        "Native Windows acceptance (arm64)",
    ];
    let jobs=names.map(|name|json!({"name":name,"run_id":7,"head_sha":sha,"status":"completed","conclusion":"success"}));
    let inspect = |run: Value, jobs: Value, count: usize| {
        gate::verified(repo, &sha, |url| {
            if url.ends_with("/7/attempts/2/jobs?per_page=100") {
                Ok(json!({"jobs":jobs,"total_count":count}))
            } else if url.ends_with(&format!("branch=main&event=push&head_sha={sha}&per_page=1")) {
                Ok(json!({"workflow_runs":[run]}))
            } else {
                Err("Unexpected API route".into())
            }
        })
    };
    assert!(inspect(run.clone(), json!(jobs), 6)?.ends_with("/7/attempts/2"));
    for field in [
        "head_sha",
        "status",
        "conclusion",
        "event",
        "head_branch",
        "path",
    ] {
        let mut bad = run.clone();
        bad[field] = json!("different");
        assert!(inspect(bad, json!(jobs), 6).is_err());
    }
    for field in ["repository", "head_repository"] {
        let mut bad = run.clone();
        bad[field]["full_name"] = json!("elsewhere/patina");
        assert!(inspect(bad, json!(jobs), 6).is_err());
    }
    for field in ["run_id", "head_sha", "status", "conclusion", "name"] {
        let mut bad = json!(jobs);
        bad[0][field] = json!("wrong");
        assert!(inspect(run.clone(), bad, 6).is_err());
    }
    assert!(inspect(run, json!(jobs), 7).is_err());
    Ok(())
}

#[test]
fn application_and_version_bound_crates_follow_the_product_version() -> Result<()> {
    let root = tempfile::tempdir()?;
    fs::write(
        root.path().join("Cargo.toml"),
        "[workspace]\nmembers=['apps/*','crates/*']\nresolver='3'\n[workspace.package]\nversion = '1.0.0'\n",
    )?;
    let app = root.path().join("apps/patina");
    fs::create_dir_all(app.join("src"))?;
    fs::write(app.join("src/main.rs"), "fn main() {}")?;
    fs::write(
        app.join("Cargo.toml"),
        "[package]\nname='patina'\nversion.workspace=true\n",
    )?;
    let mut lock = String::from("[[package]]\nname='patina'\nversion='1.0.0'\n");
    let shared = root.path().join("crates/desktop-protocol");
    fs::create_dir_all(shared.join("src"))?;
    fs::write(shared.join("src/lib.rs"), "")?;
    fs::write(
        shared.join("Cargo.toml"),
        "[package]\nname='protocol'\nversion.workspace=true\n",
    )?;
    lock.push_str("[[package]]\nname='protocol'\nversion='1.0.0'\n");
    lock.push_str("[[package]]\nname='sdk'\nversion='9.8.7'\n");
    fs::write(root.path().join("Cargo.lock"), lock)?;
    let old = version("1.0.0")?;
    let next = version("1.1.0-beta.1")?;
    version::validate(root.path(), &old)?;
    assert!(version::validate(root.path(), &next).is_err());
    version::sync(root.path(), &next)?;
    version::validate(root.path(), &next)?;
    assert!(fs::read_to_string(root.path().join("Cargo.lock"))?.contains("version='9.8.7'"));
    Ok(())
}
