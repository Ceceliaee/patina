use super::{
    MANIFEST, Result, TARGETS, Version, assets, gate, installer_name, repository, version,
};
use std::{env, fs::OpenOptions, io::Write, path::Path, process::Command};

fn checked(command: &mut Command) -> Result<Vec<u8>> {
    let result = command.output()?;
    if !result.status.success() {
        return Err(format!(
            "{} exited with {}",
            command.get_program().to_string_lossy(),
            result.status
        )
        .into());
    }
    Ok(result.stdout)
}

pub(super) fn tag_commit<'a>(
    advertised: &'a str,
    reference: &str,
    event_sha: &str,
) -> Result<&'a str> {
    let peeled = format!("{reference}^{{}}");
    let mut tag = None;
    let mut commit = None;
    for line in advertised.lines() {
        let (sha, name) = line.split_once('\t').ok_or("Malformed remote tag record")?;
        if sha.len() != 40 || !sha.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Err("Invalid remote tag identity".into());
        }
        let entry = if name == reference {
            &mut tag
        } else if name == peeled {
            &mut commit
        } else {
            continue;
        };
        if entry.replace(sha).is_some() {
            return Err("Ambiguous Git tag advertisement".into());
        }
    }
    let tag = tag.ok_or("Missing release tag on origin")?;
    let commit = commit.unwrap_or(tag);
    if event_sha != tag && event_sha != commit {
        return Err("Tag differs from triggering revision".into());
    }
    Ok(commit)
}

pub fn resolve(root: &Path) -> Result<()> {
    let repo = env::var("GITHUB_REPOSITORY")?;
    repository(&repo)?;
    let reference = env::var("GITHUB_REF")?;
    let ver = version(
        reference
            .strip_prefix("refs/tags/v")
            .ok_or("Select a version tag for this workflow")?,
    )?;
    let tag = format!("v{ver}");
    if env::var("GITHUB_EVENT_NAME")? == "workflow_dispatch"
        && env::var("REQUESTED_VERSION")? != ver.to_string()
    {
        return Err("Dispatch input must match selected version tag".into());
    }
    let peeled = format!("{reference}^{{}}");
    let advertised = String::from_utf8(checked(Command::new("git").current_dir(root).args([
        "ls-remote",
        "--tags",
        "origin",
        &reference,
        &peeled,
    ]))?)?;
    let commit = tag_commit(&advertised, &reference, &env::var("GITHUB_SHA")?)?;
    let response = Command::new("gh")
        .args([
            "api",
            "--include",
            &format!("repos/{repo}/releases/tags/{tag}"),
        ])
        .output()?;
    if response.status.success() {
        return Err("Release already exists; assets are immutable".into());
    }
    let status = String::from_utf8_lossy(&response.stdout);
    if status
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        != Some("404")
    {
        return Err("Cannot verify absence of an existing Release".into());
    }
    gate::verify(&repo, commit)?;
    let mut outputs = OpenOptions::new()
        .append(true)
        .open(env::var_os("GITHUB_OUTPUT").ok_or("Missing CI output")?)?;
    writeln!(outputs, "version={ver}\ntag={tag}\ncommit={commit}")?;
    Ok(())
}

pub fn readback(dir: &Path, ver: &Version, repo: &str) -> Result<()> {
    repository(repo)?;
    let temp = tempfile::tempdir()?;
    let mut files = vec![MANIFEST.to_owned(), "SHA256SUMS.txt".to_owned()];
    files.extend(TARGETS.map(|t| installer_name(ver, t)));
    let mut command = Command::new("gh");
    command
        .args([
            "release",
            "download",
            &format!("v{ver}"),
            "--repo",
            repo,
            "--dir",
        ])
        .arg(temp.path());
    for file in &files {
        command.arg("--pattern").arg(file);
    }
    checked(&mut command)?;
    for file in files {
        if assets::sha256_file(&dir.join(&file))? != assets::sha256_file(&temp.path().join(&file))?
        {
            return Err(format!("Published readback mismatch for {file}").into());
        }
    }
    Ok(())
}

struct Bucket {
    name: String,
    endpoint: String,
}
impl Bucket {
    fn aws(&self) -> Command {
        let mut cmd = Command::new("aws");
        cmd.args(["--endpoint-url", &self.endpoint, "--no-cli-pager"]);
        cmd
    }
    fn object(&self, key: &str) -> String {
        format!("s3://{}/{key}", self.name)
    }
    fn list(&self, prefix: &str, delimiter: bool) -> Result<Vec<String>> {
        let mut cmd = self.aws();
        cmd.args([
            "s3api",
            "list-objects-v2",
            "--bucket",
            &self.name,
            "--prefix",
            prefix,
            "--output",
            "json",
        ]);
        if delimiter {
            cmd.args([
                "--delimiter",
                "/",
                "--query",
                "CommonPrefixes[].Prefix || `[]`",
            ]);
        } else {
            cmd.args(["--query", "Contents[].Key || `[]`"]);
        }
        Ok(serde_json::from_slice(&checked(&mut cmd)?)?)
    }
    fn publish(&self, path: &Path, key: &str, cache: bool, temp: &Path) -> Result<()> {
        let object = self.object(key);
        let mut put = self.aws();
        put.args(["s3", "cp"]).arg(path).arg(&object).args([
            "--content-type",
            if cache {
                "application/json"
            } else {
                "application/octet-stream"
            },
        ]);
        if cache {
            put.args(["--cache-control", "no-cache"]);
        }
        checked(&mut put)?;
        checked(self.aws().args(["s3", "cp", &object]).arg(temp))?;
        if assets::sha256_file(path)? != assets::sha256_file(temp)? {
            return Err(format!("R2 readback mismatch for {key}").into());
        }
        Ok(())
    }
}

pub fn sync_mirror(dir: &Path, repo: &str) -> Result<()> {
    let account = env::var("R2_ACCOUNT_ID")?;
    let name = env::var("R2_BUCKET")?;
    if account.is_empty()
        || !account.bytes().all(|b| b.is_ascii_hexdigit())
        || name.is_empty()
        || !name
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
    {
        return Err("Invalid R2 account or bucket".into());
    }
    let bucket = Bucket {
        name,
        endpoint: format!("https://{account}.r2.cloudflarestorage.com"),
    };
    let next = assets::mirror(
        assets::read_manifest(&dir.join(MANIFEST))?,
        repo,
        &env::var("R2_PUBLIC_BASE_URL")?,
    )?;
    let ver = version(&next.version)?;
    let temp = tempfile::tempdir()?;
    let downloaded = temp.path().join("readback");
    if bucket
        .list(MANIFEST, false)?
        .iter()
        .any(|key| key == MANIFEST)
    {
        checked(
            bucket
                .aws()
                .args(["s3", "cp", &bucket.object(MANIFEST)])
                .arg(&downloaded),
        )?;
        assets::advance_from_file(&next, &downloaded)?;
    }
    publish_mirror_files(
        dir,
        &next,
        &patina_updater::Config::bundled(),
        |path, key, manifest| bucket.publish(path, key, manifest, &downloaded),
    )?;
    let old = bucket.list("desktop/releases/", true)?;
    for retired in old {
        let Some(released) = retired
            .strip_prefix("desktop/releases/v")
            .and_then(|s| s.strip_suffix('/'))
        else {
            continue;
        };
        if let Ok(v) = version(released)
            && v < ver
            && v.pre.is_empty()
        {
            // Only remove the two published names owned by this mirror.
            for t in TARGETS {
                let key = format!("{retired}{}", installer_name(&v, t));
                checked(bucket.aws().args(["s3", "rm", &bucket.object(&key)]))?;
            }
        }
    }
    Ok(())
}

pub(super) fn publish_mirror_files(
    dir: &Path,
    next: &patina_updater::Manifest,
    config: &patina_updater::Config,
    mut publish: impl FnMut(&Path, &str, bool) -> Result<()>,
) -> Result<()> {
    let ver = version(&next.version)?;
    let prefix = format!("desktop/releases/v{ver}/");
    for t in TARGETS {
        let path = dir.join(installer_name(&ver, t));
        assets::verify_signed_installer(&path, &ver, t, &next.platforms[t.key()], config)?;
    }
    for t in TARGETS {
        let name = installer_name(&ver, t);
        publish(&dir.join(&name), &format!("{prefix}{name}"), false)?;
    }
    let stage = tempfile::tempdir()?;
    let file = stage.path().join(MANIFEST);
    assets::write_manifest(&file, next)?;
    publish(&file, MANIFEST, true)
}
