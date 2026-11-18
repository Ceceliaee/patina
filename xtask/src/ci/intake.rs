mod body;
mod git;
mod registration;
mod risk;
#[cfg(test)]
mod tests;

use super::Result;
use regex::Regex;
use std::{collections::BTreeSet, env, path::Path};

#[derive(Debug, Default)]
struct Change {
    path: String,
    status: u8,
    add: usize,
    del: usize,
    binary: bool,
    lines: Vec<String>,
    module_removed: bool,
}

fn generated(p: &str) -> bool {
    p == "Cargo.lock"
        || p.ends_with("/Cargo.lock")
        || p.starts_with("target/")
        || p.rsplit_once('.').is_some_and(|(_, ext)| {
            [
                "png", "jpg", "jpeg", "gif", "webp", "ico", "icns", "bmp", "mp4", "mov", "zip",
                "gz", "7z", "pdf",
            ]
            .contains(&ext.to_ascii_lowercase().as_str())
        })
}
fn size(changes: &[Change]) -> Result<()> {
    let files: Vec<_> = changes.iter().filter(|f| !generated(&f.path)).collect();
    let lines: usize = files
        .iter()
        .fold(0usize, |n, f| n.saturating_add(f.add).saturating_add(f.del));
    if lines > 1000 || files.len() > 25 {
        return Err(format!("oversized-manual-diff: {lines} changed lines in {} files (maximum 1000 lines, 25 files)",files.len()).into());
    }
    Ok(())
}
fn ui(path: &str) -> bool {
    (path.starts_with("apps/patina-ui/src/features/")
        || path.starts_with("apps/patina-ui/src/windows/")
        || path.starts_with("crates/quietpro/src/"))
        && !risk::test_path(path)
}
fn owner(p: &str) -> Option<String> {
    let (kind, rest) = p.split_once('/')?;
    if !matches!(kind, "apps" | "crates") {
        return None;
    }
    let (name, _) = rest.split_once('/')?;
    Some(format!("{kind}/{name}"))
}
fn governance(p: &str) -> bool {
    p.starts_with(".github/workflows/")
        || p.starts_with("xtask/")
        || p.starts_with(".cargo/")
        || p == "rust-toolchain.toml"
}
fn rules(files: &[Change], errors: &mut Vec<String>) {
    let media=Regex::new(r"(?i)\.(?:png|apng|jpe?g|gif|webp|avif|bmp|svg|tiff?|heic|heif|mp4|m4v|mov|webm|mkv|avi|wmv|flv|mpe?g)$").unwrap();
    let review=Regex::new(r"(?i)(?:^|[/_.-])(?:review|evidence|before|after|demo|screenshot|screen[-_]?recording)(?:$|[/_.-])").unwrap();
    let colored=Regex::new(r#"(?i)(?:\b(?:rgb|rgba|hsla?)\s*\(\s*(?:0x|\d)|["']#[0-9a-f]{3,8}\b|\.rounded\s*\(\s*px\s*\(\s*\d)"#).unwrap();
    let text=Regex::new(r#"\.(?:child|tooltip|placeholder|accessible_name|accessibility_label)\s*\(\s*"[^"]*[\p{L}][^"]*""#).unwrap();
    for f in files {
        let p = f.path.as_str();
        if governance(p) {
            errors.push(format!("quality-gate-modified: {p} is maintainer-owned"))
        }
        if f.status != b'D'
            && (p.starts_with("src/")
                || p.starts_with("desktop/")
                || p.ends_with(".ts")
                || p.ends_with(".tsx")
                || p.ends_with(".css"))
        {
            errors.push(format!("retired-or-unowned-tree-path: {p}"))
        }
        if f.status == b'A'
            && media.is_match(p)
            && (review.is_match(p)
                || !(p.starts_with("apps/patina/assets/")
                    || p.starts_with("apps/patina-ui/assets/")
                    || p.starts_with("crates/quietpro/assets/")))
        {
            errors.push(format!(
                "repository-review-media-added: attach {p} outside the repository"
            ))
        }
        for line in &f.lines {
            if line.contains('\u{feff}') || line.contains("\u{ef}\u{bb}\u{bf}") {
                errors.push(format!("encoding-marker-added: {p}"));
                break;
            }
        }
        if ui(p) && !p.starts_with("crates/quietpro/src/theme") {
            let code = f
                .lines
                .iter()
                .map(|s| s.trim())
                .filter(|s| !s.starts_with("//"));
            if code.clone().any(|s| colored.is_match(s)) {
                errors.push(format!(
                    "hardcoded-visual-style: use Quiet Pro tokens in {p}"
                ))
            }
            if code.clone().any(|s| text.is_match(s)) {
                errors.push(format!(
                    "hardcoded-ui-copy: use the locale owner for labels in {p}"
                ))
            }
        }
    }
}

fn strings(value: Option<&toml::Value>) -> BTreeSet<&str> {
    value
        .and_then(toml::Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(toml::Value::as_str)
        .collect()
}
fn preserved_manifest(base: &str, head: &str) -> Result<bool> {
    let old: toml::Value = toml::from_str(base)?;
    let new: toml::Value = toml::from_str(head)?;
    if let Some(before) = old.get("workspace") {
        let Some(after) = new.get("workspace") else {
            return Ok(false);
        };
        for k in ["members", "default-members"] {
            if !strings(before.get(k)).is_subset(&strings(after.get(k))) {
                return Ok(false);
            }
        }
        if !strings(after.get("exclude")).is_subset(&strings(before.get("exclude"))) {
            return Ok(false);
        }
    }
    for k in ["autotests", "autobins", "autolib"] {
        if old
            .get("package")
            .and_then(|p| p.get(k))
            .and_then(toml::Value::as_bool)
            != Some(false)
            && new
                .get("package")
                .and_then(|p| p.get(k))
                .and_then(toml::Value::as_bool)
                == Some(false)
        {
            return Ok(false);
        }
    }
    for kind in ["test", "example", "bin", "lib"] {
        let entries = |v: Option<&toml::Value>| -> Vec<toml::Value> {
            match v {
                Some(toml::Value::Array(a)) => a.to_vec(),
                Some(v) => vec![v.clone()],
                None => vec![],
            }
        };
        let before = entries(old.get(kind));
        let after = entries(new.get(kind));
        for t in &before {
            if t.get("test")
                .and_then(toml::Value::as_bool)
                .unwrap_or(kind != "example")
            {
                let Some(next) = after.iter().find(|n| n.get("name") == t.get("name")) else {
                    return Ok(false);
                };
                if next.get("path") != t.get("path")
                    || next.get("test").and_then(toml::Value::as_bool) == Some(false)
                    || next.get("harness") != t.get("harness")
                    || !strings(next.get("required-features"))
                        .is_subset(&strings(t.get("required-features")))
                {
                    return Ok(false);
                }
            }
        }
        if after.iter().any(|n| {
            !before.iter().any(|t| t.get("name") == n.get("name"))
                && (n.get("test").and_then(toml::Value::as_bool) == Some(false)
                    || !strings(n.get("required-features")).is_empty())
                && kind != "example"
        }) {
            return Ok(false);
        }
    }
    Ok(true)
}
fn static_tree(root: &Path) -> Result<()> {
    for path in ["src/lib", "src/types", "src/styles/shared"] {
        if root.join(path).exists() {
            return Err(format!("retired-or-unowned-tree-path: {path}").into());
        }
    }
    Ok(())
}
pub(super) fn run(root: &Path, args: &[String]) -> Result<()> {
    static_tree(root)?;
    if args.is_empty() {
        return Ok(());
    }
    let mut args = args.iter().map(String::as_str);
    let (mut base, mut head, mut body_env, mut require) = (None, None, None, false);
    while let Some(arg) = args.next() {
        let slot = match arg {
            "--base" => &mut base,
            "--head" => &mut head,
            "--body-env" => &mut body_env,
            "--require-pr-body" if !require => {
                require = true;
                continue;
            }
            _ => return Err(format!("Invalid intake argument {arg}").into()),
        };
        if slot
            .replace(args.next().ok_or("Missing intake argument")?)
            .is_some()
        {
            return Err("Repeated intake option".into());
        }
    }
    let sha = |s: Option<&str>| {
        s.is_some_and(|v| v.len() == 40 && v.bytes().all(|b| b.is_ascii_hexdigit()))
    };
    if !sha(base) || !sha(head) {
        return Err("Intake requires full base and head commit SHAs".into());
    }
    let (base, head) = (base.unwrap(), head.unwrap());
    let files = git::changes(root, base, head)?;
    let mut failures = Vec::new();
    rules(&files, &mut failures);
    if require {
        body::assess(
            &env::var(body_env.ok_or("Missing PR body environment variable")?).unwrap_or_default(),
            &files,
            &mut failures,
        )
    }
    for f in &files {
        if f.path.ends_with("Cargo.toml")
            && f.status != b'A'
            && (f.status == b'D'
                || !preserved_manifest(
                    &git::blob(root, base, &f.path)?,
                    &git::blob(root, head, &f.path)?,
                )?)
        {
            failures.push(format!(
                "validation-chain-weakened: Cargo test targets or workspace scope changed in {}",
                f.path
            ))
        }
    }
    let new_features = files
        .iter()
        .filter(|f| f.status == b'A')
        .filter_map(|f| {
            f.path
                .strip_prefix("apps/patina-ui/src/features/")?
                .split_once('/')
                .map(|(name, _)| name)
        })
        .collect::<BTreeSet<_>>();
    if !new_features.is_empty() {
        let existing = git::blob(root, base, "apps/patina-ui/src/features/mod.rs")?;
        let features = syn::parse_file(&existing)?
            .items
            .into_iter()
            .filter_map(|item| match item {
                syn::Item::Mod(m) => Some(m.ident.to_string()),
                _ => None,
            })
            .collect::<BTreeSet<_>>();
        for feature in new_features {
            if !features.contains(feature) {
                failures.push(format!("suspicious-new-feature-owner: {feature} is absent from the trusted feature tree"));
            }
        }
    }
    let owners = files
        .iter()
        .filter(|f| f.path.ends_with(".rs") || f.path.ends_with("Cargo.toml"))
        .filter_map(|f| owner(&f.path))
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();
    let mut registered = BTreeSet::new();
    if !owners.is_empty() {
        registered = registration::registered(&git::sources(root, head, &owners)?, &owners)?;
        if files.iter().any(|f| {
            f.module_removed
                || ((risk::test_path(&f.path) || f.path.ends_with("/Cargo.toml"))
                    && f.status == b'D')
        }) {
            let before = registration::registered(&git::sources(root, base, &owners)?, &owners)?;
            for removed in before.difference(&registered) {
                failures.push(format!("validation-chain-weakened: previously registered tests disappeared from {removed}"))
            }
        }
    }
    risk::check(&files, &registered, &mut failures);
    if !failures.is_empty() {
        return Err(failures.join("\n").into());
    }
    Ok(())
}
