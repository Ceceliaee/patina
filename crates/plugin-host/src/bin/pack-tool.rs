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
    let args: Vec<PathBuf> = env::args_os().skip(1).map(PathBuf::from).collect();
    let (package, output) = match args.as_slice() {
        [directory, output] => (Package::read_directory(directory)?, output),
        [directory, output, key] if directory.is_dir() => (
            Package::sign_directory(directory, &signing_key(key)?)?,
            output,
        ),
        [manifest, wasm, output, key] => {
            let locales =
                Package::read_locales(manifest.parent().unwrap_or_else(|| Path::new(".")))?;
            let manifest: Manifest = serde_json::from_slice(&fs::read(manifest)?)?;
            let mut package = Package {
                manifest,
                locales,
                wasm: fs::read(wasm)?,
                publisher: String::new(),
                signature: String::new(),
            };
            package.validated_wasm().map_err(io::Error::other)?;
            package.sign(&signing_key(key)?)?;
            (package, output)
        }
        _ => {
            return Err(concat!(
                "Usage: pack-tool PLUGIN_FOLDER OUTPUT.zip [PUBLISHER_KEY]",
                " (or MANIFEST WASM OUTPUT.zip PUBLISHER_KEY)"
            )
            .into());
        }
    };
    let dir = output
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or_else(|| std::path::Path::new("."));
    let mut file = tempfile::NamedTempFile::new_in(dir)?;
    package.write_zip(file.as_file_mut())?;
    Package::read_verified(file.path()).map_err(io::Error::other)?;
    file.persist(output)?;
    Ok(())
}
