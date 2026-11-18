use super::{
    BINARIES, MANIFEST, Result, TARGETS, Target, Version, arch, assets, installer_name, version,
};
use base64::{Engine, engine::general_purpose::STANDARD};
use patina_updater::{Artifact, Config, Manifest};
use std::{
    collections::BTreeMap,
    env,
    ffi::OsString,
    fs,
    io::{BufRead, BufReader, Write},
    path::{Path, PathBuf},
    process::{Command, Stdio},
};

const HELP: &str = "cargo xtask release package --target <x64|arm64> --output <new directory> [--unsigned | --signing-key <file> --base-url <https-url> [--password-env <variable>]] [--makensis <exe>] [--minisign <exe>] [--notes <file>]";
fn triple(t: Target) -> &'static str {
    match t {
        Target::X64 => "x86_64-pc-windows-msvc",
        Target::Arm64 => "aarch64-pc-windows-msvc",
    }
}

fn build(root: &Path, target: Target, secrets: &[&str]) -> Result<BTreeMap<String, PathBuf>> {
    let mut command = Command::new(env::var_os("CARGO").unwrap_or_else(|| "cargo".into()));
    command.current_dir(root).args([
        "build",
        "--locked",
        "--release",
        "--target",
        triple(target),
        "--message-format=json-render-diagnostics",
    ]);
    for name in BINARIES {
        command.args(["-p", name]);
    }
    for var in secrets {
        command.env_remove(var);
    }
    let mut child = command.stdout(Stdio::piped()).spawn()?;
    let mut binaries = BTreeMap::new();
    let read = (|| -> Result<()> {
        for line in BufReader::new(child.stdout.take().unwrap()).lines() {
            let msg: serde_json::Value = serde_json::from_str(&line?)?;
            if msg["reason"] == "compiler-artifact"
                && let (Some(name), Some(path)) =
                    (msg["target"]["name"].as_str(), msg["executable"].as_str())
                && BINARIES.contains(&name)
            {
                binaries.insert(name.to_owned(), PathBuf::from(path));
            }
        }
        Ok(())
    })();
    let status = child.wait()?;
    read?;
    if !status.success() || binaries.len() != BINARIES.len() {
        return Err(format!("Missing release binaries for {}", triple(target)).into());
    }
    Ok(binaries)
}

fn define(key: &str, value: &Path) -> OsString {
    let mut arg = OsString::from(format!("/D{key}="));
    arg.push(value.as_os_str());
    arg
}

fn package_target(
    root: &Path,
    temp: &Path,
    version: &Version,
    target: Target,
    bins: &BTreeMap<String, PathBuf>,
    makensis: &str,
    secrets: &[&str],
) -> Result<PathBuf> {
    for exe in bins.values() {
        assets::pe(exe, target)?;
    }
    let path = temp.join(installer_name(version, target));
    if [version.major, version.minor, version.patch]
        .iter()
        .any(|n| *n > u16::MAX as u64)
    {
        return Err("Version exceeds Windows resource range".into());
    }
    let mut command = Command::new(makensis);
    for var in secrets {
        command.env_remove(var);
    }
    let status = command
        .current_dir(root)
        .arg("/V2")
        .arg(format!("/DAPP_VERSION={version}"))
        .arg(format!(
            "/DRESOURCE_VERSION={}.{}.{}.0",
            version.major, version.minor, version.patch
        ))
        .arg(define("APP_BINARY", &bins["patina"]))
        .arg(define("UI_BINARY", &bins["patina-ui"]))
        .arg(define("PROBE_BINARY", &bins["patina-probe"]))
        .arg(define("OUTPUT_FILE", &path))
        .arg(root.join("packaging/windows/patina.nsi"))
        .status()?;
    if !status.success() {
        return Err(format!("NSIS failed for {}", triple(target)).into());
    }
    Ok(path)
}

pub fn run(root: &Path, args: &[&str]) -> Result<()> {
    package(root, args, Config::bundled())
}

pub(super) fn package(root: &Path, args: &[&str], config: Config) -> Result<()> {
    if args == ["--help"] {
        println!("{HELP}");
        return Ok(());
    }
    let mut options = BTreeMap::new();
    let mut args = args.iter().copied();
    while let Some(key) = args.next() {
        let val = match key {
            "--unsigned" => "",
            "--target" | "--output" | "--makensis" | "--minisign" | "--notes"
            | "--signing-key-env" | "--signing-key" | "--password-env" | "--base-url" => {
                args.next().ok_or(HELP)?
            }
            _ => return Err(HELP.into()),
        };
        if options.insert(key, val).is_some() {
            return Err(format!("Duplicate {key}").into());
        }
    }
    let target = TARGETS
        .into_iter()
        .find(|t| {
            options
                .get("--target")
                .is_some_and(|v| *v == arch(*t) || *v == triple(*t))
        })
        .ok_or(HELP)?;
    let dir = root.join(options.get("--output").ok_or(HELP)?);
    let unsigned = options.contains_key("--unsigned");
    if unsigned
        && [
            "--password-env",
            "--signing-key",
            "--signing-key-env",
            "--base-url",
        ]
        .iter()
        .any(|k| options.contains_key(k))
    {
        return Err("Signing options require a signed build".into());
    }
    let mut signing = None;
    let mut key_file = None;
    if !unsigned {
        let key = match (
            options.get("--signing-key"),
            options.get("--signing-key-env"),
        ) {
            (Some(path), None) => root.join(path).canonicalize()?,
            (None, Some(name)) => {
                let bytes = STANDARD.decode(env::var(name)?)?;
                if !bytes.starts_with(b"untrusted comment:") {
                    return Err("Invalid encoded Minisign signing key".into());
                }
                let mut file = tempfile::NamedTempFile::new()?;
                file.write_all(&bytes)?;
                key_file = Some(file.into_temp_path());
                key_file.as_ref().unwrap().to_path_buf()
            }
            _ => return Err("Provide one signing key source".into()),
        };
        let base = assets::plain_https(options.get("--base-url").ok_or(HELP)?)?;
        signing = Some((key, base));
    }
    fs::create_dir_all(&dir)?;
    if fs::read_dir(&dir)?.next().is_some() {
        return Err("Use an empty package output directory".into());
    }
    let ver = version::current(root)?;
    let notes = options
        .get("--notes")
        .map(|f| fs::read_to_string(root.join(f)))
        .transpose()?
        .unwrap_or_default();
    let temp = tempfile::tempdir_in(&dir)?;
    let password_var = options.get("--password-env").copied();
    let secrets: Vec<_> = password_var
        .into_iter()
        .chain(options.get("--signing-key-env").copied())
        .collect();
    let bins = build(root, target, &secrets)?;
    let installer = package_target(
        root,
        &temp.path().canonicalize()?,
        &ver,
        target,
        &bins,
        options.get("--makensis").unwrap_or(&"makensis"),
        &secrets,
    )?;
    let name = installer_name(&ver, target);
    if let Some((key, base)) = signing {
        let sig = temp.path().join("signature.minisig");
        let trusted = format!("{} {ver} {}", config.application, target.key());
        let mut sign = Command::new(options.get("--minisign").unwrap_or(&"minisign"));
        if let Some(name) = options.get("--signing-key-env") {
            sign.env_remove(name);
        }
        sign.arg("-S")
            .arg("-s")
            .arg(key)
            .arg("-m")
            .arg(&installer)
            .arg("-x")
            .arg(&sig)
            .arg("-t")
            .arg(trusted);
        if let Some(var) = password_var {
            let password = env::var(var)?;
            if password.contains(['\r', '\n']) {
                return Err("Signing password must be a single line".into());
            }
            let mut child = sign.env_remove(var).stdin(Stdio::piped()).spawn()?;
            let mut input = child.stdin.take().ok_or("Missing signer input pipe")?;
            let write = writeln!(input, "{password}");
            drop(input);
            let status = child.wait()?;
            write?;
            if !status.success() {
                return Err("Installer signing failed".into());
            }
        } else if !sign.status()?.success() {
            return Err("Installer signing failed".into());
        }
        let entry = Artifact {
            url: format!("{base}/{name}"),
            signature: STANDARD.encode(fs::read(sig)?),
            size: fs::metadata(&installer)?.len(),
        };
        assets::signed(&installer, &ver, target, &entry, &config)?;
        assets::write_manifest(
            &temp.path().join(MANIFEST),
            &Manifest {
                schema: 1,
                application: config.application,
                version: ver.to_string(),
                notes,
                platforms: BTreeMap::from([(target.key().to_owned(), entry)]),
            },
        )?;
    }
    let mut outputs = Vec::new();
    for (name, path) in &bins {
        let file = format!("{name}.exe");
        fs::copy(path, temp.path().join(&file))?;
        outputs.push(file);
    }
    outputs.push(name);
    if !unsigned {
        outputs.push(MANIFEST.to_owned());
    }
    assets::publish_files(temp.path(), &dir, outputs)?;
    drop(key_file);
    println!("Windows {} package: {}", arch(target), dir.display());
    Ok(())
}
