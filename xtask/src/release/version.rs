use super::{Result, Version, version};
use std::{fs, io::Write, path::Path};
use toml_edit::{DocumentMut, value};

pub fn current(root: &Path) -> Result<Version> {
    let text = fs::read_to_string(root.join("Cargo.toml"))?;
    let doc: toml::Value = toml::from_str(&text)?;
    version(
        doc.get("workspace")
            .and_then(|v| v.get("package"))
            .and_then(|v| v.get("version"))
            .and_then(|v| v.as_str())
            .ok_or("Missing workspace.package.version")?,
    )
}

fn members(root: &Path) -> Result<Vec<String>> {
    let metadata =
        std::process::Command::new(std::env::var_os("CARGO").unwrap_or_else(|| "cargo".into()))
            .current_dir(root)
            .args([
                "metadata",
                "--offline",
                "--no-deps",
                "--format-version",
                "1",
            ])
            .output()?;
    if !metadata.status.success() {
        return Err(format!(
            "Could not read workspace members: {}",
            String::from_utf8_lossy(&metadata.stderr)
        )
        .into());
    }
    let doc: serde_json::Value = serde_json::from_slice(&metadata.stdout)?;
    let mut inherited = Vec::new();
    for package in doc["packages"]
        .as_array()
        .ok_or("Missing workspace packages")?
    {
        let path = Path::new(
            package["manifest_path"]
                .as_str()
                .ok_or("Missing package manifest")?,
        );
        let text = fs::read_to_string(path)?;
        let manifest: toml::Value = toml::from_str(&text)?;
        if manifest["package"]["version"]
            .get("workspace")
            .and_then(toml::Value::as_bool)
            == Some(true)
        {
            inherited.push(
                package["name"]
                    .as_str()
                    .ok_or("Missing package name")?
                    .to_owned(),
            );
        }
    }
    if !inherited.iter().any(|n| n == "patina") {
        return Err("patina must inherit the product version".into());
    }
    Ok(inherited)
}

fn update_lock(
    lock: &mut DocumentMut,
    ver: &Version,
    check: bool,
    members: &[String],
) -> Result<()> {
    let packages = lock
        .get_mut("package")
        .and_then(|v| v.as_array_of_tables_mut())
        .ok_or("Cargo.lock has no package array")?;
    let text = ver.to_string();
    for name in members {
        let mut local = packages.iter_mut().filter(|p| {
            !p.contains_key("source")
                && p.get("name").and_then(|v| v.as_str()) == Some(name.as_str())
        });
        let entry = local
            .next()
            .ok_or_else(|| format!("Cargo.lock lacks {name}"))?;
        if local.next().is_some() {
            return Err(format!("Ambiguous local package {name}").into());
        }
        if check && entry.get("version").and_then(|v| v.as_str()) != Some(text.as_str()) {
            return Err(format!("Cargo.lock {name} differs from {ver}").into());
        }
        entry["version"] = value(&text);
    }
    Ok(())
}

pub fn validate(root: &Path, expected: &Version) -> Result<()> {
    if current(root)? != *expected {
        return Err("Workspace version differs from release tag".into());
    }
    let members = members(root)?;
    let mut lock = fs::read_to_string(root.join("Cargo.lock"))?.parse()?;
    update_lock(&mut lock, expected, true, &members)
}

pub fn sync(root: &Path, next: &Version) -> Result<()> {
    let members = members(root)?;
    let manifest_path = root.join("Cargo.toml");
    let lock_path = root.join("Cargo.lock");
    let original = fs::read(&manifest_path)?;
    let mut manifest: DocumentMut = std::str::from_utf8(&original)?.parse()?;
    current(root)?;
    let mut lock = fs::read_to_string(&lock_path)?.parse()?;
    update_lock(&mut lock, next, false, &members)?;
    manifest["workspace"]["package"]["version"] = value(next.to_string());
    let write = |path: &Path, data: &[u8]| -> Result<()> {
        let mut file = tempfile::NamedTempFile::new_in(root)?;
        file.write_all(data)?;
        file.as_file().sync_all()?;
        file.persist(path)?;
        Ok(())
    };
    write(&manifest_path, manifest.to_string().as_bytes())?;
    if let Err(err) = write(&lock_path, lock.to_string().as_bytes()) {
        write(&manifest_path, &original)?;
        return Err(err);
    }
    validate(root, next)
}
