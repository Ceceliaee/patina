use crate::Result;
use base64::{Engine, engine::general_purpose::STANDARD};
use minisign_verify::{PublicKey, Signature};
use semver::Version;
use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, io::Read};

pub const MAX_MANIFEST: u64 = 1024 * 1024;
pub const MAX_INSTALLER: u64 = 1024 * 1024 * 1024;

#[derive(Clone, Deserialize)]
pub struct Config {
    pub application: String,
    pub endpoints: Vec<String>,
    pub public_key: String,
}

impl Config {
    pub fn bundled() -> Self {
        serde_json::from_str(include_str!("../config.json")).expect("bundled update configuration")
    }
    pub fn key(&self) -> Result<PublicKey> {
        let bytes = STANDARD
            .decode(&self.public_key)
            .map_err(|e| e.to_string())?;
        PublicKey::decode(std::str::from_utf8(&bytes).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum Target {
    X64,
    Arm64,
}

impl Target {
    pub fn current() -> Result<Self> {
        match std::env::consts::ARCH {
            "x86_64" => Ok(Self::X64),
            "aarch64" => Ok(Self::Arm64),
            _ => Err("Unsupported updater architecture".into()),
        }
    }
    pub fn key(self) -> &'static str {
        match self {
            Self::X64 => "windows-x86_64",
            Self::Arm64 => "windows-aarch64",
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Release {
    pub version: String,
    pub notes: String,
    pub target: Target,
    pub url: String,
    pub signature: String,
    pub size: u64,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
pub struct Manifest {
    pub schema: u32,
    pub application: String,
    pub version: String,
    #[serde(default)]
    pub notes: String,
    pub platforms: BTreeMap<String, Artifact>,
}
#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
pub struct Artifact {
    pub url: String,
    pub signature: String,
    pub size: u64,
}

pub fn https_url(value: &str) -> Result<url::Url> {
    let url = url::Url::parse(value).map_err(|e| e.to_string())?;
    if url.scheme() != "https"
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
    {
        return Err("Update URL must use HTTPS without credentials or fragments".into());
    }
    Ok(url)
}

pub fn parse(
    bytes: &[u8],
    config: &Config,
    current: &str,
    target: Target,
) -> Result<Option<Release>> {
    if bytes.len() as u64 > MAX_MANIFEST {
        return Err("Update manifest is too large".into());
    }
    let manifest: Manifest = serde_json::from_slice(bytes).map_err(|e| e.to_string())?;
    if manifest.schema != 1 || manifest.application != config.application {
        return Err("Update manifest belongs to a different application or schema".into());
    }
    let installed = Version::parse(current).map_err(|e| e.to_string())?;
    let offered = Version::parse(&manifest.version).map_err(|e| e.to_string())?;
    if offered <= installed || (!offered.pre.is_empty() && installed.pre.is_empty()) {
        return Ok(None);
    }
    let artifact = manifest
        .platforms
        .get(target.key())
        .ok_or("No installer for this architecture")?;
    https_url(&artifact.url)?;
    if artifact.size == 0 || artifact.size > MAX_INSTALLER {
        return Err("Invalid installer size".into());
    }
    let release = Release {
        version: manifest.version,
        notes: manifest.notes,
        target,
        url: artifact.url.clone(),
        signature: artifact.signature.clone(),
        size: artifact.size,
    };
    signature(&release, config)?;
    Ok(Some(release))
}

fn signature(release: &Release, config: &Config) -> Result<(PublicKey, Signature)> {
    let bytes = STANDARD
        .decode(&release.signature)
        .map_err(|e| e.to_string())?;
    let signature = Signature::decode(std::str::from_utf8(&bytes).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    let expected = format!(
        "{} {} {}",
        config.application,
        release.version,
        release.target.key()
    );
    if signature.trusted_comment() != expected {
        return Err(
            "Installer signature does not match application, version and architecture".into(),
        );
    }
    Ok((config.key()?, signature))
}

pub fn verify(reader: &mut impl Read, release: &Release, config: &Config) -> Result<()> {
    let (key, signature) = signature(release, config)?;
    let mut verifier = key.verify_stream(&signature).map_err(|e| e.to_string())?;
    let mut bytes = [0; 65536];
    let mut size = 0u64;
    loop {
        let read = reader.read(&mut bytes).map_err(|e| e.to_string())?;
        if read == 0 {
            break;
        }
        size += read as u64;
        if size > release.size {
            return Err("Installer exceeded advertised size".into());
        }
        verifier.update(&bytes[..read]);
    }
    if size != release.size {
        return Err("Installer download was truncated".into());
    }
    verifier.finalize().map_err(|e| e.to_string())
}
