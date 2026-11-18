use base64::{Engine, engine::general_purpose::STANDARD};
use patina_plugin_host::{Manifest, Package};
use ring::{rand::SystemRandom, signature::Ed25519KeyPair};
use std::{
    env, fs,
    io::{self, Write},
    path::{Path, PathBuf},
};

fn signing_key(path: &Path) -> io::Result<Ed25519KeyPair> {
    let bytes = match fs::read(path) {
        Ok(bytes) => bytes,
        Err(e) if e.kind() == io::ErrorKind::NotFound => {
            let doc = Ed25519KeyPair::generate_pkcs8(&SystemRandom::new())
                .map_err(|_| io::Error::other("generate publisher key"))?;
            let dir = path
                .parent()
                .filter(|p| !p.as_os_str().is_empty())
                .unwrap_or_else(|| Path::new("."));
            let mut tmp = tempfile::NamedTempFile::new_in(dir)?;
            tmp.write_all(doc.as_ref())?;
            tmp.as_file().sync_all()?;
            match tmp.persist_noclobber(path) {
                Ok(_) => (),
                Err(e) if e.error.kind() == io::ErrorKind::AlreadyExists => (),
                Err(e) => return Err(e.error),
            }
            fs::read(path)?
        }
        Err(e) => return Err(e),
    };
    Ed25519KeyPair::from_pkcs8(&bytes).map_err(|_| io::Error::other("invalid publisher key"))
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let [manifest, wasm, output, key]: [PathBuf; 4] = env::args_os()
        .skip(1)
        .map(PathBuf::from)
        .collect::<Vec<_>>()
        .try_into()
        .map_err(|_| "Usage: pack-tool MANIFEST WASM OUTPUT PUBLISHER_KEY")?;
    let manifest: Manifest = serde_json::from_slice(&fs::read(manifest)?)?;
    let mut package = Package {
        manifest,
        wasm: STANDARD.encode(fs::read(wasm)?),
        publisher: String::new(),
        signature: String::new(),
    };
    package.validated_wasm().map_err(io::Error::other)?;
    package
        .sign(&signing_key(&key)?)
        .map_err(io::Error::other)?;
    let dir = output
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or_else(|| std::path::Path::new("."));
    let mut file = tempfile::NamedTempFile::new_in(dir)?;
    serde_json::to_writer(file.as_file_mut(), &package)?;
    Package::read_verified(file.path()).map_err(io::Error::other)?;
    file.persist(output)?;
    Ok(())
}
