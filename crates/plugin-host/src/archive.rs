use crate::{Package, package::MAX_PACKAGE};
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    fs::{self, File},
    io::{self, Cursor, Read, Seek, Write},
    path::Path,
};
use zip::{CompressionMethod, ZipArchive, ZipWriter, write::SimpleFileOptions};

const MANIFEST: &str = "manifest.json";
const MODULE: &str = "plugin.wasm";
const SIGNATURE: &str = "signature.json";

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Signature {
    publisher: String,
    signature: String,
}

pub(super) fn invalid(message: &str) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, message)
}

pub(super) fn bounded(reader: impl Read, remaining: &mut usize) -> io::Result<Vec<u8>> {
    let mut bytes = Vec::new();
    reader.take(*remaining as u64 + 1).read_to_end(&mut bytes)?;
    *remaining = remaining
        .checked_sub(bytes.len())
        .ok_or_else(|| invalid("Expanded plugin exceeds 8 MiB"))?;
    Ok(bytes)
}

pub(super) fn plain_path(path: &Path) -> io::Result<fs::Metadata> {
    let meta = fs::symlink_metadata(path)?;
    #[cfg(windows)]
    let linked = std::os::windows::fs::MetadataExt::file_attributes(&meta) & 0x400 != 0;
    #[cfg(not(windows))]
    let linked = meta.file_type().is_symlink();
    if linked {
        return Err(invalid("Linked plugin files are unsupported"));
    }
    Ok(meta)
}

impl Package {
    pub fn from_files(
        manifest: &[u8],
        wasm: Vec<u8>,
        signature: Option<&[u8]>,
        locales: crate::Catalogs,
    ) -> io::Result<Self> {
        let signature: Option<Signature> = signature.map(serde_json::from_slice).transpose()?;
        if signature
            .as_ref()
            .is_some_and(|s| s.publisher.is_empty() || s.signature.is_empty())
        {
            return Err(invalid("Invalid plugin publisher proof"));
        }
        let (publisher, signature) = signature
            .map(|s| (s.publisher, s.signature))
            .unwrap_or_default();
        Ok(Self {
            manifest: serde_json::from_slice(manifest)?,
            wasm,
            locales,
            publisher,
            signature,
        })
    }

    fn proof(&self) -> Signature {
        Signature {
            publisher: self.publisher.clone(),
            signature: self.signature.clone(),
        }
    }

    pub fn sign_directory(dir: &Path, key: &ring::signature::Ed25519KeyPair) -> io::Result<Self> {
        let mut package = Self::read_directory(dir)?;
        package.validated_wasm().map_err(io::Error::other)?;
        package.sign(key).map_err(io::Error::other)?;
        let mut tmp = tempfile::NamedTempFile::new_in(dir)?;
        serde_json::to_writer_pretty(tmp.as_file_mut(), &package.proof())?;
        tmp.as_file().sync_all()?;
        tmp.persist(dir.join(SIGNATURE))?;
        Ok(package)
    }

    fn visit_files(&self, mut write: impl FnMut(&str, &[u8]) -> io::Result<()>) -> io::Result<()> {
        let mut remaining = MAX_PACKAGE;
        let mut write = |path: &str, bytes: &[u8]| {
            remaining = remaining
                .checked_sub(bytes.len())
                .ok_or_else(|| invalid("Expanded plugin exceeds 8 MiB"))?;
            write(path, bytes)
        };
        write(MANIFEST, &serde_json::to_vec_pretty(&self.manifest)?)?;
        write(MODULE, &self.wasm)?;
        for (tag, messages) in &self.locales {
            let name = format!("{tag}.json");
            crate::locales::tag_for_file(&name)?;
            write(
                &format!("locales/{name}"),
                &serde_json::to_vec_pretty(messages)?,
            )?;
        }
        if !self.publisher.is_empty() || !self.signature.is_empty() {
            write(SIGNATURE, &serde_json::to_vec_pretty(&self.proof())?)?;
        }
        Ok(())
    }

    pub fn write_zip(&self, output: impl Write + Seek) -> io::Result<()> {
        self.verify_signature().map_err(io::Error::other)?;
        self.validated_wasm().map_err(io::Error::other)?;
        let mut zip = ZipWriter::new(output);
        let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
        self.visit_files(|name, bytes| {
            zip.start_file(
                format!(
                    "{}/{name}",
                    crate::directories::folder_name(&self.manifest.id)
                ),
                options,
            )?;
            zip.write_all(bytes)
        })?;
        zip.finish()?;
        Ok(())
    }

    pub(super) fn write_directory(&self, dir: &Path) -> io::Result<()> {
        fs::create_dir(dir)?;
        if !self.locales.is_empty() {
            fs::create_dir(dir.join("locales"))?;
        }
        self.visit_files(|name, bytes| {
            let mut file = File::create_new(dir.join(name))?;
            file.write_all(bytes)?;
            file.sync_all()
        })
    }

    pub fn read_locales(dir: &Path) -> io::Result<crate::Catalogs> {
        crate::locales::read(dir, &mut { MAX_PACKAGE })
    }

    pub fn read_directory(dir: &Path) -> io::Result<Self> {
        if !plain_path(dir)?.is_dir() {
            return Err(invalid("Expected plugin directory"));
        }
        let mut remaining = MAX_PACKAGE;
        let mut read = |name: &str| {
            let path = dir.join(name);
            if !plain_path(&path)?.is_file() {
                return Err(invalid("Expected regular plugin file"));
            }
            bounded(File::open(path)?, &mut remaining)
        };
        let manifest = read(MANIFEST)?;
        let wasm = read(MODULE)?;
        let signature = match read(SIGNATURE) {
            Ok(bytes) => Some(bytes),
            Err(e) if e.kind() == io::ErrorKind::NotFound => None,
            Err(e) => return Err(e),
        };
        Self::from_files(
            &manifest,
            wasm,
            signature.as_deref(),
            crate::locales::read(dir, &mut remaining)?,
        )
    }
}

pub(super) fn read(bytes: &[u8]) -> Result<Package, String> {
    read_zip(bytes).map_err(|e| e.to_string())
}

fn read_zip(bytes: &[u8]) -> io::Result<Package> {
    let mut zip = ZipArchive::new(Cursor::new(bytes))?;
    if zip.len() > 64 || zip.has_duplicate_names() || zip.has_overlapping_files()? {
        return Err(invalid("Invalid plugin ZIP directory"));
    }
    let mut files = BTreeMap::new();
    let mut directories = Vec::new();
    let mut remaining = MAX_PACKAGE;
    for i in 0..zip.len() {
        let mut entry = zip.by_index(i)?;
        let path = entry.name()?.replace('\\', "/");
        let directory = path.ends_with('/');
        let path = path.strip_suffix('/').unwrap_or(&path);
        if entry.is_symlink()
            || entry.encrypted()
            || path.contains([':', '\0'])
            || path.split('/').any(|part| matches!(part, "" | "." | ".."))
        {
            return Err(invalid("Invalid plugin ZIP entry"));
        }
        if path.starts_with("__MACOSX/")
            || path == "__MACOSX"
            || path.rsplit('/').next() == Some(".DS_Store")
        {
            continue;
        }
        if directory {
            if entry.size() != 0 {
                return Err(invalid("Invalid ZIP folder"));
            }
            directories.push(path.to_owned());
            continue;
        }
        if files.contains_key(path) {
            return Err(invalid("Duplicate plugin file"));
        }
        if entry.size() > remaining as u64 {
            return Err(invalid("Expanded plugin exceeds 8 MiB"));
        }
        let data = bounded(&mut entry, &mut remaining)?;
        if data.len() as u64 != entry.size() {
            return Err(invalid("Truncated plugin file"));
        }
        files.insert(path.to_owned(), data);
    }
    let root = files
        .keys()
        .find_map(|path| {
            let (dir, name) = path.rsplit_once('/').unwrap_or(("", path));
            (name == MANIFEST && !dir.contains('/')).then(|| dir.to_owned())
        })
        .ok_or_else(|| invalid("Missing plugin manifest"))?;
    let prefix = if root.is_empty() {
        String::new()
    } else {
        format!("{root}/")
    };
    if directories
        .iter()
        .any(|d| *d != root && *d != format!("{prefix}locales"))
    {
        return Err(invalid("Unexpected plugin directory"));
    }
    let manifest = files.remove(&format!("{prefix}{MANIFEST}")).unwrap();
    let wasm = files
        .remove(&format!("{prefix}{MODULE}"))
        .ok_or_else(|| invalid("Missing plugin.wasm"))?;
    let signature = files
        .remove(&format!("{prefix}{SIGNATURE}"))
        .ok_or_else(|| invalid("Missing signature.json"))?;
    let mut locales = crate::Catalogs::new();
    let locale_prefix = format!("{prefix}locales/");
    for (path, bytes) in files {
        let name = path
            .strip_prefix(&locale_prefix)
            .ok_or_else(|| invalid("Unexpected plugin file"))?;
        crate::locales::insert(&mut locales, name, &bytes)?;
    }
    Package::from_files(&manifest, wasm, Some(&signature), locales)
}
