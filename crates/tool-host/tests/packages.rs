use patina_tool_host::{Control, Host, Package};
use std::{fs, path::PathBuf};

#[test]
#[ignore = "requires the two compiled Rust counter packages"]
fn install_update_restart_uninstall() -> Result<(), Box<dyn std::error::Error>> {
    let original = PathBuf::from(std::env::var("PATINA_COUNTER_PACKAGE")?);
    let update = PathBuf::from(std::env::var("PATINA_COUNTER_UPDATE")?);
    let tmp = tempfile::tempdir()?;
    let root = tmp.path().join("profile");
    let mut host = Host::open(root.clone())?;
    let install = host.inspect(&original)?;
    let first = host.install(&original, &install, "en-US")?;
    let id = &first.manifest.id;
    let panel = host.panel(id, &first.generation, Some("increment".into()), "en-US")?;
    assert!(
        matches!(&panel[..], [Control::Text(n), Control::Button {label, ..}] if n == "1" && label == "Add one")
    );

    let candidate = tmp.path().join("new.patina-tool");
    let mut invalid: Package = serde_json::from_slice(&fs::read(&update)?)?;
    let key = ring::signature::Ed25519KeyPair::from_pkcs8(&fs::read(std::env::var(
        "PATINA_COUNTER_SIGNING_KEY",
    )?)?)
    .map_err(|_| "invalid fixture key")?;
    invalid.manifest.entry = "missing".into();
    invalid.sign(&key)?;
    fs::write(&candidate, serde_json::to_vec(&invalid)?)?;
    let preview = host.inspect(&candidate)?;
    assert!(host.install(&candidate, &preview, "en-US").is_err());
    fs::copy(&update, &candidate)?;
    assert!(host.install(&candidate, &preview, "en-US").is_err());
    let latest = host.inspect(&candidate)?;
    let second = host.install(&candidate, &latest, "en-US")?;
    {
        use std::os::windows::fs::OpenOptionsExt;
        let lock = fs::OpenOptions::new()
            .read(true)
            .share_mode(1)
            .open(root.join("tools.json"))?;
        let unchanged = host.inspect(&original)?;
        assert!(host.install(&original, &unchanged, "en-US").is_err());
        assert_eq!(host.list()[0].generation, second.generation);
        drop(lock);
    }
    assert!(host.uninstall(id, &first.generation).is_err());
    drop(host);
    let mut host = Host::open(root.clone())?;
    let panel = host.panel(id, &second.generation, None, "en-US")?;
    assert!(
        matches!(&panel[..], [Control::Text(n), Control::Button {label, ..}] if n == "1" && label == "Increment")
    );
    let mut separate: Package = serde_json::from_slice(&fs::read(&original)?)?;
    separate.manifest.id = "example.other".into();
    separate.sign(&key)?;
    fs::write(&candidate, serde_json::to_vec(&separate)?)?;
    let preview = host.inspect(&candidate)?;
    let other = host.install(&candidate, &preview, "en-US")?;
    assert!(
        matches!(&host.panel(&other.manifest.id, &other.generation, None, "en-US")?[0], Control::Text(n) if n == "0")
    );
    host.uninstall(id, &second.generation)?;
    assert!(
        host.panel(id, &second.generation, Some("increment".into()), "en-US")
            .is_err()
    );
    drop(host);
    let mut host = Host::open(root)?;
    assert_eq!(host.list().len(), 1);
    let preview = host.inspect(&original)?;
    let restored = host.install(&original, &preview, "en-US")?;
    assert!(
        matches!(&host.panel(id, &restored.generation, None, "en-US")?[0], Control::Text(n) if n == "1")
    );
    separate.manifest.id = "patina.focus".into();
    separate.sign(&key)?;
    fs::write(&candidate, serde_json::to_vec(&separate)?)?;
    assert!(host.inspect(&candidate).is_err());
    let mut impostor: Package = serde_json::from_slice(&fs::read(&original)?)?;
    let alt = ring::signature::Ed25519KeyPair::generate_pkcs8(&ring::rand::SystemRandom::new())
        .map_err(|_| "fixture key generation")?;
    let alt = ring::signature::Ed25519KeyPair::from_pkcs8(alt.as_ref())
        .map_err(|_| "invalid fixture key")?;
    impostor.sign(&alt)?;
    fs::write(&candidate, serde_json::to_vec(&impostor)?)?;
    assert!(host.inspect(&candidate).is_err());
    host.uninstall(id, &restored.generation)?;
    assert!(host.inspect(&candidate).is_err());
    Ok(())
}
