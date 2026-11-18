use super::{
    EXECUTABLE, MANIFEST, Result, TARGETS, Target, Version, arch, asset_url, installer_name,
    version,
};
use patina_updater::{Artifact, Config, MAX_INSTALLER, MAX_MANIFEST, Manifest, Release};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeSet,
    fs::{self, File},
    io::{Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
};

pub struct InstallerInput {
    pub target: Target,
    pub name: String,
    pub path: PathBuf,
    pub entry: Artifact,
}

pub fn plain_https(base: &str) -> Result<String> {
    let url = patina_updater::https_url(base)?;
    if url.query().is_some() {
        return Err("Download base URL cannot include a query".into());
    }
    Ok(url.as_str().trim_end_matches('/').to_owned())
}

pub fn read_manifest(path: &Path) -> Result<Manifest> {
    let mut bytes = Vec::new();
    File::open(path)?
        .take(MAX_MANIFEST + 1)
        .read_to_end(&mut bytes)?;
    if bytes.len() as u64 > MAX_MANIFEST {
        return Err("Manifest exceeds 1 MiB".into());
    }
    let raw: serde_json::Value = serde_json::from_slice(&bytes)?;
    let manifest: Manifest = serde_json::from_value(raw.clone())?;
    if serde_json::to_value(&manifest)? != raw {
        return Err("Unexpected or missing manifest fields".into());
    }
    Ok(manifest)
}

pub fn write_manifest(path: &Path, manifest: &Manifest) -> Result<()> {
    let mut bytes = serde_json::to_vec_pretty(manifest)?;
    bytes.push(b'\n');
    if bytes.len() as u64 > MAX_MANIFEST {
        return Err("Manifest exceeds 1 MiB".into());
    }
    let parent = path.parent().ok_or("Missing manifest directory")?;
    fs::create_dir_all(parent)?;
    let mut stage = tempfile::NamedTempFile::new_in(parent)?;
    stage.write_all(&bytes)?;
    stage.persist_noclobber(path)?;
    Ok(())
}

pub fn sha256_file(path: &Path) -> Result<String> {
    let mut file = File::open(path)?;
    let mut hash = Sha256::new();
    let mut buf = [0u8; 65536];
    loop {
        let size = file.read(&mut buf)?;
        if size == 0 {
            break;
        }
        hash.update(&buf[..size]);
    }
    Ok(format!("{:x}", hash.finalize()))
}

pub fn verify_pe_architecture(path: &Path, target: Target) -> Result<()> {
    let mut file = File::open(path)?;
    let mut dos = [0; 64];
    file.read_exact(&mut dos)?;
    let offset = u32::from_le_bytes(dos[60..].try_into()?) as u64;
    if &dos[..2] != b"MZ" || offset < 64 || offset + 24 > file.metadata()?.len() {
        return Err(format!("Invalid PE header: {}", path.display()).into());
    }
    file.seek(SeekFrom::Start(offset))?;
    let mut header = [0; 6];
    file.read_exact(&mut header)?;
    let machine = match target {
        Target::X64 => 0x8664,
        Target::Arm64 => 0xaa64,
    };
    if &header[..4] != b"PE\0\0" || u16::from_le_bytes(header[4..].try_into()?) != machine {
        return Err(format!(
            "Incorrect PE architecture for {}: {}",
            target.key(),
            path.display()
        )
        .into());
    }
    Ok(())
}

pub fn verify_signed_installer(
    file: &Path,
    version: &Version,
    target: Target,
    entry: &Artifact,
    config: &Config,
) -> Result<()> {
    if entry.size == 0 || entry.size > MAX_INSTALLER || fs::metadata(file)?.len() != entry.size {
        return Err(format!("Incorrect size: {}", file.display()).into());
    }
    let release = Release {
        version: version.to_string(),
        notes: String::new(),
        target,
        url: entry.url.clone(),
        signature: entry.signature.clone(),
        size: entry.size,
    };
    patina_updater::verify(&mut File::open(file)?, &release, config)?;
    Ok(())
}

pub fn read_build_installers(
    dir: &Path,
    ver: &Version,
    repo: &str,
    config: &Config,
) -> Result<Vec<InstallerInput>> {
    let mut inputs = Vec::new();
    for target in TARGETS {
        let arch_dir = dir.join(arch(target));
        let manifest = read_manifest(&arch_dir.join(MANIFEST))?;
        if manifest.schema != 1
            || manifest.application != config.application
            || manifest.version != ver.to_string()
            || manifest.platforms.len() != 1
        {
            return Err(format!("Invalid build manifest for {}", arch(target)).into());
        }
        let entry = manifest
            .platforms
            .get(target.key())
            .ok_or("Missing signed target")?
            .clone();
        if entry.url != asset_url(ver, repo, target)? {
            return Err("Build installer URL mismatch".into());
        }
        let name = installer_name(ver, target);
        let path = arch_dir.join(&name);
        verify_signed_installer(&path, ver, target, &entry, config)?;
        verify_pe_architecture(&arch_dir.join(EXECUTABLE), target)?;
        for file in fs::read_dir(&arch_dir)? {
            let file = file?;
            if !file.file_type()?.is_file()
                || ![EXECUTABLE, MANIFEST, &name].contains(&file.file_name().to_str().unwrap_or(""))
            {
                return Err(format!("Unexpected build input {}", file.path().display()).into());
            }
        }
        inputs.push(InstallerInput {
            target,
            name,
            path,
            entry,
        });
    }
    Ok(inputs)
}

fn combined(ver: &Version, notes: &str, config: &Config, inputs: &[InstallerInput]) -> Manifest {
    Manifest {
        schema: 1,
        application: config.application.clone(),
        version: ver.to_string(),
        notes: notes.to_owned(),
        platforms: inputs
            .iter()
            .map(|i| (i.target.key().to_owned(), i.entry.clone()))
            .collect(),
    }
}

pub fn prepare(
    output: &Path,
    ver: &Version,
    notes: &str,
    config: &Config,
    inputs: &[InstallerInput],
) -> Result<()> {
    fs::create_dir_all(output)?;
    // Stage and validate every byte before publishing any final filenames.
    let stage = tempfile::tempdir_in(output)?;
    let mut names = Vec::new();
    let mut sums = String::new();
    for i in inputs {
        let dst = stage.path().join(&i.name);
        fs::copy(&i.path, &dst)?;
        verify_signed_installer(&dst, ver, i.target, &i.entry, config)?;
        let hash = sha256_file(&dst)?;
        if sha256_file(&i.path)? != hash {
            return Err("Source bundle changed during preparation".into());
        }
        sums.push_str(&format!("{hash}  {}\n", i.name));
        names.push(i.name.as_str());
    }
    fs::write(stage.path().join("SHA256SUMS.txt"), sums)?;
    write_manifest(
        &stage.path().join(MANIFEST),
        &combined(ver, notes, config, inputs),
    )?;
    names.extend(["SHA256SUMS.txt", MANIFEST]);
    publish_files(stage.path(), output, names)
}

pub fn publish_files(
    stage: &Path,
    output: &Path,
    names: impl IntoIterator<Item = impl AsRef<Path>>,
) -> Result<()> {
    let mut installed = Vec::new();
    for name in names {
        let name = name.as_ref();
        let path = output.join(name);
        // Both directories reside on the same volume. Creation fails if another run owns the name.
        if let Err(err) =
            tempfile::TempPath::try_from_path(stage.join(name))?.persist_noclobber(&path)
        {
            for item in installed {
                fs::remove_file(item)?;
            }
            return Err(err.into());
        }
        installed.push(path);
    }
    Ok(())
}

pub fn verify_assets(
    output: &Path,
    ver: &Version,
    notes: &str,
    config: &Config,
    inputs: &[InstallerInput],
) -> Result<()> {
    if read_manifest(&output.join(MANIFEST))? != combined(ver, notes, config, inputs) {
        return Err("Published manifest differs from signed inputs and release notes".into());
    }
    let mut allowed: BTreeSet<String> = [MANIFEST, "SHA256SUMS.txt", "release-notes.md"]
        .into_iter()
        .map(str::to_owned)
        .collect();
    let mut sums = String::new();
    for i in inputs {
        let dst = output.join(&i.name);
        verify_signed_installer(&dst, ver, i.target, &i.entry, config)?;
        let hash = sha256_file(&dst)?;
        if sha256_file(&i.path)? != hash {
            return Err("Published installer differs from build input".into());
        }
        sums.push_str(&format!("{hash}  {}\n", i.name));
        allowed.insert(i.name.clone());
    }
    if fs::read(output.join("SHA256SUMS.txt"))? != sums.as_bytes() {
        return Err("Published checksums differ from installers".into());
    }
    for entry in fs::read_dir(output)? {
        let entry = entry?;
        if !entry.file_type()?.is_file()
            || !allowed.contains(&entry.file_name().to_string_lossy().into_owned())
        {
            return Err(format!(
                "Unexpected public release asset {}",
                entry.file_name().to_string_lossy()
            )
            .into());
        }
    }
    Ok(())
}

fn mirror_version(manifest: &Manifest) -> Result<Version> {
    let ver = version(&manifest.version)?;
    if manifest.schema != 1
        || manifest.application != Config::bundled().application
        || !ver.pre.is_empty()
        || manifest.platforms.len() != 2
        || TARGETS
            .iter()
            .any(|t| !manifest.platforms.contains_key(t.key()))
    {
        return Err("Mirror requires both platforms of a stable Patina manifest".into());
    }
    Ok(ver)
}

pub fn mirror(mut manifest: Manifest, repo: &str, base: &str) -> Result<Manifest> {
    let ver = mirror_version(&manifest)?;
    let base = plain_https(base)?;
    for target in TARGETS {
        let e = manifest.platforms.get_mut(target.key()).unwrap();
        if e.url != asset_url(&ver, repo, target)?
            || e.signature.is_empty()
            || e.size == 0
            || e.size > MAX_INSTALLER
        {
            return Err("Invalid input for mirror".into());
        }
        e.url = format!(
            "{base}/desktop/releases/v{ver}/{}",
            installer_name(&ver, target)
        );
    }
    Ok(manifest)
}

pub fn advance(next: &Manifest, current: &Manifest) -> Result<()> {
    let new = mirror_version(next)?;
    let old = mirror_version(current)?;
    if new < old || (new == old && next != current) {
        return Err("Mirror cannot go backwards or replace immutable version content".into());
    }
    Ok(())
}
