use patina_plugin_host::{Capability, Host, Manifest, Package};
use ring::{rand::SystemRandom, signature::Ed25519KeyPair};
use std::{fs, io::Write, path::Path};

type Result<T> = std::result::Result<T, Box<dyn std::error::Error>>;

fn proof() -> Ed25519KeyPair {
    let key = Ed25519KeyPair::generate_pkcs8(&SystemRandom::new()).unwrap();
    Ed25519KeyPair::from_pkcs8(key.as_ref()).unwrap()
}

fn source(dir: &Path) -> Result<()> {
    let manifest = Manifest {
        id: "example.folder".into(),
        name: "Folder".into(),
        version: "1".into(),
        api: 1,
        entry: "panel".into(),
        capabilities: vec![Capability::Panel],
        presentation: None,
    };
    fs::create_dir(dir)?;
    fs::write(dir.join("manifest.json"), serde_json::to_vec(&manifest)?)?;
    fs::write(dir.join("plugin.wasm"), b"\0asm\x01\0\0\0")?;
    Ok(())
}

fn zip_files(path: &Path, dir: &Path, entries: &[(&str, &str)]) -> Result<()> {
    let mut zip = zip::ZipWriter::new(fs::File::create(path)?);
    for (entry, source) in entries {
        zip.start_file(*entry, zip::write::SimpleFileOptions::default())?;
        zip.write_all(&fs::read(dir.join(source))?)?;
    }
    zip.finish()?;
    Ok(())
}

#[test]
fn ordinary_zip_accepts_one_signed_folder_or_its_contents() -> Result<()> {
    let temp = tempfile::tempdir()?;
    let folder = temp.path().join("author");
    source(&folder)?;
    let p = Package::sign_directory(&folder, &proof())?;
    let zip = temp.path().join("share.zip");
    p.write_zip(fs::File::create(&zip)?)?;
    let (wrapped, _) = Package::read_verified(&zip)?;
    assert_eq!(wrapped.manifest, p.manifest);
    let flat = [
        ("manifest.json", "manifest.json"),
        ("plugin.wasm", "plugin.wasm"),
        ("signature.json", "signature.json"),
    ];
    zip_files(&zip, &folder, &flat[..2])?;
    assert!(
        matches!(Package::read_verified(&zip),Err(reason) if reason.contains("signature.json"))
    );
    zip_files(&zip, &folder, &flat)?;
    let (repacked, _) = Package::read_verified(&zip)?;
    assert_eq!(repacked.signature, wrapped.signature);
    let old = temp.path().join("old.patina-tool");
    fs::write(&old, serde_json::to_vec(&p)?)?;
    assert_eq!(Package::read_verified(&old)?.0.wasm, p.wasm);

    zip_files(
        &zip,
        &folder,
        &[
            ("A/manifest.json", "manifest.json"),
            ("B/plugin.wasm", "plugin.wasm"),
            ("A/signature.json", "signature.json"),
        ],
    )?;
    assert!(Package::read_verified(&zip).is_err());
    fs::write(folder.join("plugin.wasm"), b"\0asm\x01\0\0\0updated")?;
    zip_files(&zip, &folder, &flat)?;
    assert!(Package::read_verified(&zip).is_err());
    Ok(())
}

#[test]
fn interrupted_directory_swap_restores_registry_version() -> Result<()> {
    let temp = tempfile::tempdir()?;
    let root = temp.path();
    let folder = root.join("source");
    source(&folder)?;
    let package = Package::sign_directory(&folder, &proof())?;
    let id = &package.manifest.id;
    let registry = root.join("tools.json");
    fs::write(
        &registry,
        serde_json::to_vec(&serde_json::json!({ id: {
            "package":package,"publisher":package.publisher,"state":17,"generation":"original"
        }}))?,
    )?;
    let host = Host::open(root.into())?;
    assert_eq!(host.list()[0].generation, "original");
    drop(host);
    let active = root.join("plugins").join(id);
    let pending = root.join(".plugin-change");
    fs::create_dir(&pending)?;
    fs::write(
        pending.join("change.json"),
        serde_json::to_vec(&serde_json::json!({
            "id":id,"generation":"unfinished-update","had_directory":true
        }))?,
    )?;
    fs::rename(&active, pending.join("old"))?;
    fs::create_dir(&active)?;
    fs::write(active.join("plugin.wasm"), b"incomplete")?;
    let host = Host::open(root.into())?;
    assert_eq!(host.list()[0].generation, "original");
    assert_eq!(fs::read(active.join("plugin.wasm"))?, package.wasm);
    assert!(!pending.exists());
    drop(host);
    // A committed swap may still have its previous folder awaiting cleanup.
    fs::create_dir(&pending)?;
    fs::create_dir(pending.join("old"))?;
    fs::write(pending.join("old/plugin.wasm"), b"previous")?;
    fs::write(
        pending.join("change.json"),
        serde_json::to_vec(&serde_json::json!({
            "id":id, "generation":"original", "had_directory":true
        }))?,
    )?;
    let reopened = Host::open(root.into())?;
    assert_eq!(reopened.list()[0].generation, "original");
    assert_eq!(fs::read(active.join("plugin.wasm"))?, package.wasm);
    assert!(!pending.exists() && !root.join(".plugin-stage").exists());
    let record: serde_json::Value = serde_json::from_slice(&fs::read(registry)?)?;
    assert_eq!(record[id]["state"], 17);
    assert!(record[id].get("package").is_none());
    Ok(())
}

#[test]
fn locale_files_round_trip_and_are_covered_by_the_publisher_signature() -> Result<()> {
    let tmp = tempfile::tempdir()?;
    let folder = tmp.path().join("source");
    source(&folder)?;
    fs::create_dir(folder.join("locales"))?;
    fs::write(folder.join("locales/es.json"), br#"{"caption":"Hola"}"#)?;
    let signed = Package::sign_directory(&folder, &proof())?;
    let archive = tmp.path().join("share.zip");
    signed.write_zip(fs::File::create(&archive)?)?;
    assert_eq!(
        Package::read_verified(&archive)?.0.locales["es"]["caption"],
        "Hola"
    );
    let entries = [
        ("manifest.json", "manifest.json"),
        ("plugin.wasm", "plugin.wasm"),
        ("signature.json", "signature.json"),
        ("locales/es.json", "locales/es.json"),
    ];
    zip_files(&archive, &folder, &entries)?;
    assert_eq!(Package::read_verified(&archive)?.0.locales, signed.locales);
    fs::write(folder.join("locales/es.json"), br#"{"caption":"Otro"}"#)?;
    zip_files(&archive, &folder, &entries)?;
    assert!(Package::read_verified(&archive).is_err());
    for path in [
        "locales/../file.json",
        "locales/aux.json",
        "other/locales/es.json",
        "locales/es/extra.json",
    ] {
        let mut invalid = entries;
        invalid[3].0 = path;
        zip_files(&archive, &folder, &invalid)?;
        assert!(Package::read_verified(&archive).is_err());
    }
    Ok(())
}
