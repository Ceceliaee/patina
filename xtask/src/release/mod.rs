mod assets;
mod changelog;
mod delivery;
mod gate;
mod package;
mod version;

use patina_updater::Target;
use semver::Version;
use std::{env, error::Error, fs, path::Path};

type Result<T> = std::result::Result<T, Box<dyn Error>>;

const EXECUTABLE: &str = "patina.exe";
const TARGETS: [Target; 2] = [Target::X64, Target::Arm64];
const MANIFEST: &str = "gpui-latest.json";

fn version(text: &str) -> Result<Version> {
    let value = Version::parse(text)?;
    if !value.build.is_empty() {
        return Err("Release versions cannot contain build metadata".into());
    }
    Ok(value)
}

fn arch(target: Target) -> &'static str {
    match target {
        Target::X64 => "x64",
        Target::Arm64 => "arm64",
    }
}

fn installer_name(version: &Version, target: Target) -> String {
    format!("Patina_{version}_{}-setup.exe", arch(target))
}

fn repository(value: &str) -> Result<&str> {
    let parts: Vec<_> = value.split('/').collect();
    if parts.len() != 2
        || parts.iter().any(|s| {
            s.is_empty()
                || *s == "."
                || *s == ".."
                || !s
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b"_-.".contains(&b))
        })
    {
        return Err("Expected an owner/repository identifier".into());
    }
    Ok(value)
}

fn asset_url(version: &Version, repo: &str, target: Target) -> Result<String> {
    Ok(format!(
        "https://github.com/{}/releases/download/v{version}/{}",
        repository(repo)?,
        installer_name(version, target)
    ))
}

pub fn run(root: &Path, args: &[String]) -> Result<()> {
    let args: Vec<_> = args.iter().map(String::as_str).collect();
    match args.as_slice() {
        ["version"] => println!("{}", version::current(root)?),
        ["sync-version", value] => version::sync(root, &version(value)?)?,
        ["validate-version-files", value] => {
            let ver = version(value)?;
            version::validate(root, &ver)?;
            changelog::read(root, &ver)?;
        }
        ["validate-changelog" | "print-release-notes", ..] if args.len() <= 2 => {
            let ver = match args.get(1) {
                Some(text) => version(text)?,
                None => version::current(root)?,
            };
            let notes = changelog::read(root, &ver)?;
            if args[0] == "print-release-notes" {
                print!("{}", notes.public(&ver)?);
            }
        }
        ["write-release-notes", value, file] => {
            let ver = version(value)?;
            let notes = changelog::read(root, &ver)?.public(&ver)?;
            let path = root.join(file);
            fs::create_dir_all(
                path.parent()
                    .ok_or("Release notes need a parent directory")?,
            )?;
            fs::write(path, notes)?;
        }
        ["verify-commit", commit] => gate::verify(&env::var("GITHUB_REPOSITORY")?, commit)?,
        ["resolve"] => delivery::resolve(root)?,
        ["readback", ver, dir, repo] => delivery::readback(&root.join(dir), &version(ver)?, repo)?,
        ["sync-mirror", dir, repo] => delivery::sync_mirror(&root.join(dir), repo)?,
        ["package", params @ ..] => package::run(root, params)?,
        [
            operation @ ("prepare" | "verify"),
            value,
            input,
            output,
            repo,
            tag,
        ] => {
            let ver = version(value)?;
            if *tag != format!("v{ver}") {
                return Err("Release version differs from tag".into());
            }
            let config = patina_updater::Config::bundled();
            let notes = changelog::read(root, &ver)?.app();
            let inputs =
                assets::read_build_installers(root.join(input).as_path(), &ver, repo, &config)?;
            let output = root.join(output);
            if *operation == "prepare" {
                assets::prepare(&output, &ver, &notes, &config, &inputs)?;
            } else {
                assets::verify_assets(&output, &ver, &notes, &config, &inputs)?;
            }
        }
        ["mirror", file, repo, base, destination] => {
            let manifest = assets::read_manifest(&root.join(file))?;
            let result = assets::mirror(manifest, repo, base)?;
            assets::write_manifest(&root.join(destination), &result)?;
        }
        ["mirror-advance", next, current] => {
            assets::advance(
                &assets::read_manifest(&root.join(next))?,
                &assets::read_manifest(&root.join(current))?,
            )?;
        }
        ["--help" | "-h"] => println!(
            "release version | sync-version VERSION | validate-version-files VERSION | validate-changelog [VERSION] | print-release-notes [VERSION] | write-release-notes VERSION FILE | verify-commit SHA | resolve | readback VERSION DIR REPO | sync-mirror DIR REPO | package --help | prepare/verify VERSION INPUT OUTPUT REPO TAG | mirror MANIFEST REPO URL FILE | mirror-advance NEXT CURRENT"
        ),
        _ => return Err("Unrecognized release command. Run cargo xtask release --help".into()),
    }
    Ok(())
}

#[cfg(test)]
mod tests;

#[cfg(test)]
mod workflow_tests;

#[cfg(all(windows, test))]
mod rehearsal;
