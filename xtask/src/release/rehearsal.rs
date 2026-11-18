use super::*;
use base64::{Engine, engine::general_purpose::STANDARD};
use patina_updater::Config;
use std::{env, io::Write, path::PathBuf, process::Command};

#[test]
#[ignore = "builds and signs real Windows installers using NSIS, Minisign, and a disposable key"]
fn sign_product_installers_with_disposable_key() -> Result<()> {
    let source = env::var_os("PATINA_TEST_RELEASE_SOURCE").map(PathBuf::from);
    let root = source
        .as_deref()
        .unwrap_or_else(|| Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap());
    let private = tempfile::tempdir()?;
    let output = env::var_os("PATINA_TEST_RELEASE_OUTPUT")
        .map(PathBuf::from)
        .unwrap_or_else(|| private.path().join("release"));
    fs::create_dir_all(&output)?;
    let input = output.join("bundles");
    let dist = output.join("public");
    let tool = env::var("PATINA_TEST_MINISIGN").unwrap_or_else(|_| "minisign".into());
    let nsis = env::var("PATINA_TEST_MAKENSIS").unwrap_or_else(|_| "makensis".into());
    let key = private.path().join("disposable.key");
    let public = private.path().join("disposable.pub");
    let status = Command::new(&tool)
        .args(["-G", "-W", "-s"])
        .arg(&key)
        .arg("-p")
        .arg(&public)
        .stdout(std::process::Stdio::null())
        .status()?;
    if !status.success() {
        return Err("Could not generate disposable signing key".into());
    }
    let verification_key = fs::read(public)?;
    fs::File::create_new(output.join("rehearsal.pub"))?.write_all(&verification_key)?;
    let config = Config {
        public_key: STANDARD.encode(verification_key),
        ..Config::bundled()
    };
    let version = version::current(root)?;
    let base = format!("https://github.com/example/patina/releases/download/v{version}");
    let target = env::var("PATINA_TEST_RELEASE_TARGET").ok();
    if target
        .as_deref()
        .is_some_and(|a| !["x64", "arm64"].contains(&a))
    {
        return Err("Unrecognized rehearsal architecture".into());
    }
    for t in TARGETS
        .into_iter()
        .filter(|t| target.as_deref().is_none_or(|a| a == arch(*t)))
    {
        let dir = input.join(arch(t));
        package::package(
            root,
            &[
                "--target",
                arch(t),
                "--output",
                dir.to_str().ok_or("Invalid bundle path")?,
                "--makensis",
                &nsis,
                "--minisign",
                &tool,
                "--signing-key",
                key.to_str().ok_or("Invalid key path")?,
                "--base-url",
                &base,
            ],
            config.clone(),
        )?;
        let m = assets::read_manifest(&dir.join(MANIFEST))?;
        assets::signed(
            &dir.join(installer_name(&version, t)),
            &version,
            t,
            &m.platforms[t.key()],
            &config,
        )?;
        assets::pe(&dir.join(EXECUTABLE), t)?;
        println!("Verified {} {} with disposable key", t.key(), version);
    }
    if target.is_none() {
        let notes = changelog::read(root, &version)?.app();
        assets::prepare(
            &dist,
            &version,
            &notes,
            &config,
            &assets::inputs(&input, &version, "example/patina", &config)?,
        )?;
        assets::verify_assets(
            &dist,
            &version,
            &notes,
            &config,
            &assets::inputs(&input, &version, "example/patina", &config)?,
        )?;
        println!("Verified both release installers, signed platform notes, manifest and checksums");
        let mirror = assets::mirror(
            assets::read_manifest(&dist.join(MANIFEST))?,
            "example/patina",
            "https://updates.example",
        )?;
        let bucket = output.join("mirror");
        delivery::publish_mirror_files(&dist, &mirror, &config, |file, key, _| {
            let destination = bucket.join(key);
            fs::create_dir_all(destination.parent().ok_or("Invalid mirror key")?)?;
            fs::copy(file, &destination)?;
            assert_eq!(assets::digest(file)?, assets::digest(&destination)?);
            Ok(())
        })?;
        let current = assets::read_manifest(&bucket.join(MANIFEST))?;
        assert_eq!(current, mirror);
        assets::advance(&mirror, &current)?;
        for t in TARGETS {
            let asset = &current.platforms[t.key()];
            let key = asset.url.strip_prefix("https://updates.example/").unwrap();
            assets::signed(&bucket.join(key), &version, t, asset, &config)?;
        }
        println!("Verified both mirrored installers and the published root manifest on local disk");
    }
    Ok(())
}
