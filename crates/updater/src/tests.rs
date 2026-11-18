use super::*;
use base64::{Engine, engine::general_purpose::STANDARD};
use serde_json::{Value, json};
use std::{
    io::Write,
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    },
    time::{Duration, Instant},
};

pub(super) fn fixture() -> (Config, Value, Vec<u8>) {
    let fixture: Value =
        serde_json::from_str(include_str!("../tests/fixtures/signed.json")).unwrap();
    let payload = STANDARD
        .decode(fixture["payload"].as_str().unwrap())
        .unwrap();
    let config = Config {
        application: "patina-gpui".into(),
        endpoints: vec!["https://updates.invalid/manifest".into()],
        public_key: fixture["public_key"].as_str().unwrap().into(),
    };
    let manifest = json!({"schema":1,"application":"patina-gpui","version":"0.2.0","notes":"Test release","platforms":{"windows-x86_64":{"url":"https://updates.invalid/setup.exe","signature":fixture["signature"],"size":payload.len()}}});
    (config, manifest, payload)
}
fn parse(value: &Value, config: &Config, current: &str, target: Target) -> Result<Option<Release>> {
    manifest::parse(&serde_json::to_vec(value).unwrap(), config, current, target)
}

#[test]
fn verifies_bytes_and_binds_signed_identity() {
    let (config, mut value, payload) = fixture();
    let release = parse(&value, &config, "0.1.0", Target::X64)
        .unwrap()
        .unwrap();
    verify(&mut &payload[..], &release, &config).unwrap();
    let mut tampered = payload.clone();
    tampered[0] ^= 1;
    assert!(verify(&mut &tampered[..], &release, &config).is_err());
    assert!(verify(&mut &payload[..payload.len() - 1], &release, &config).is_err());
    let mut oversized = payload.clone();
    oversized.push(0);
    assert!(verify(&mut &oversized[..], &release, &config).is_err());
    value["version"] = json!("9.0.0");
    assert!(parse(&value, &config, "0.1.0", Target::X64).is_err());
    // Editing the cleartext trusted comment cannot forge its global signature.
    let signature = String::from_utf8(STANDARD.decode(&release.signature).unwrap())
        .unwrap()
        .replace("0.2.0", "9.0.0");
    value["platforms"]["windows-x86_64"]["signature"] = json!(STANDARD.encode(signature));
    let forged = parse(&value, &config, "0.1.0", Target::X64)
        .unwrap()
        .unwrap();
    assert!(verify(&mut &payload[..], &forged, &config).is_err());
}

#[test]
fn manifest_rejects_wrong_product_architecture_and_unsafe_sources() {
    let (config, value, _) = fixture();
    assert!(
        parse(&value, &config, "0.2.0", Target::X64)
            .unwrap()
            .is_none()
    );
    assert!(
        parse(&value, &config, "1.0.0", Target::X64)
            .unwrap()
            .is_none()
    );
    assert!(parse(&value, &config, "0.1.0", Target::Arm64).is_err());
    for (key, wrong) in [
        ("schema", json!(2)),
        ("application", json!("unrelated-application")),
        ("version", json!("garbage")),
    ] {
        let mut bad = value.clone();
        bad[key] = wrong;
        assert!(parse(&bad, &config, "0.1.0", Target::X64).is_err());
    }
    for url in [
        "http://updates.invalid/setup.exe",
        "https://user:password@updates.invalid/setup.exe",
        "file:///setup.exe",
        "https://updates.invalid/setup.exe#fragment",
    ] {
        let mut bad = value.clone();
        bad["platforms"]["windows-x86_64"]["url"] = json!(url);
        assert!(parse(&bad, &config, "0.1.0", Target::X64).is_err());
    }
    let mut prerelease = value.clone();
    prerelease["version"] = json!("0.3.0-beta.1");
    assert!(
        parse(&prerelease, &config, "0.1.0", Target::X64)
            .unwrap()
            .is_none()
    );
    for size in [0, manifest::MAX_INSTALLER + 1] {
        let mut bad = value.clone();
        bad["platforms"]["windows-x86_64"]["size"] = json!(size);
        assert!(parse(&bad, &config, "0.1.0", Target::X64).is_err());
    }
}

struct FixtureTransport {
    manifest: Vec<u8>,
    payload: Vec<u8>,
    calls: AtomicUsize,
}
impl Transport for FixtureTransport {
    fn get(
        &self,
        url: &str,
        limit: u64,
        output: &mut dyn Write,
        progress: &mut dyn FnMut(u64),
    ) -> Result<()> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        if url.ends_with("unavailable") {
            return Err("fixture unavailable".into());
        }
        let data = if url.ends_with("manifest") {
            &self.manifest
        } else {
            &self.payload
        };
        if data.len() as u64 > limit {
            return Err("size limit".into());
        }
        // Keep requests in flight long enough to exercise duplicate-request handling.
        std::thread::sleep(Duration::from_millis(30));
        output.write_all(data).map_err(|e| e.to_string())?;
        progress(data.len() as u64);
        Ok(())
    }
}
fn settled(service: &Service) -> Snapshot {
    let start = Instant::now();
    loop {
        let snapshot = service.snapshot();
        if !matches!(snapshot.phase, Phase::Checking | Phase::Downloading) {
            return snapshot;
        }
        assert!(
            start.elapsed() < Duration::from_secs(5),
            "updater did not settle"
        );
        std::thread::sleep(Duration::from_millis(5));
    }
}
#[test]
fn fallback_deduplicates_and_preserves_verified_download() {
    let root = tempfile::tempdir().unwrap();
    let (mut config, manifest, payload) = fixture();
    config
        .endpoints
        .insert(0, "https://updates.invalid/unavailable".into());
    let transport = Arc::new(FixtureTransport {
        manifest: serde_json::to_vec(&manifest).unwrap(),
        payload,
        calls: AtomicUsize::new(0),
    });
    let service = Service::new(
        "0.1.0",
        Target::X64,
        config,
        root.path().into(),
        transport.clone(),
    )
    .unwrap();
    assert!(service.request(Request::Download).is_err());
    service.request(Request::Check).unwrap();
    service.request(Request::Check).unwrap();
    assert_eq!(settled(&service).phase, Phase::Available);
    assert_eq!(transport.calls.load(Ordering::SeqCst), 2);
    service.request(Request::Download).unwrap();
    service.request(Request::Download).unwrap();
    let ready = settled(&service);
    assert_eq!(ready.phase, Phase::Ready);
    assert_eq!(ready.installed_version, "0.1.0");
    assert_eq!(ready.received, ready.release.unwrap().size);
    assert_eq!(transport.calls.load(Ordering::SeqCst), 3);
    assert_eq!(
        service.clone().request(Request::Status).unwrap().phase,
        Phase::Ready
    );
}

#[test]
fn invalid_download_never_becomes_installable_and_cleans_staging() {
    let root = tempfile::tempdir().unwrap();
    let (config, manifest, mut payload) = fixture();
    payload[0] ^= 1;
    let transport = Arc::new(FixtureTransport {
        manifest: serde_json::to_vec(&manifest).unwrap(),
        payload,
        calls: AtomicUsize::new(0),
    });
    let service =
        Service::new("0.1.0", Target::X64, config, root.path().into(), transport).unwrap();
    service.request(Request::Check).unwrap();
    settled(&service);
    service.request(Request::Download).unwrap();
    assert_eq!(settled(&service).phase, Phase::Failed);
    assert!(
        service
            .begin_install(std::path::Path::new("test.exe"))
            .is_err()
    );
    assert_eq!(std::fs::read_dir(root.path()).unwrap().count(), 0);
}

pub(super) fn ready_service(root: &std::path::Path) -> Service {
    let (config, manifest, payload) = fixture();
    let transport = Arc::new(FixtureTransport {
        manifest: serde_json::to_vec(&manifest).unwrap(),
        payload,
        calls: AtomicUsize::new(0),
    });
    let service = Service::new("0.1.0", Target::X64, config, root.into(), transport).unwrap();
    service.request(Request::Check).unwrap();
    settled(&service);
    service.request(Request::Download).unwrap();
    assert_eq!(settled(&service).phase, Phase::Ready);
    service
}
