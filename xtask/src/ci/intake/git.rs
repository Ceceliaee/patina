use super::{Change, Result};
use std::{
    collections::BTreeMap,
    io::{Read, Write},
    path::Path,
    process::{Command, Stdio},
};

fn git(root: &Path, args: &[&str]) -> Result<Vec<u8>> {
    let output = Command::new("git")
        .current_dir(root)
        .arg("--literal-pathspecs")
        .args(args)
        .output()?;
    if !output.status.success() {
        return Err(format!("git {} failed ({})", args[0], output.status).into());
    }
    Ok(output.stdout)
}
fn records(bytes: &[u8]) -> Result<Vec<&str>> {
    if bytes.is_empty() {
        return Ok(vec![]);
    }
    Ok(std::str::from_utf8(
        bytes
            .strip_suffix(&[0])
            .ok_or("Incomplete NUL-terminated Git record")?,
    )?
    .split('\0')
    .collect())
}

pub(super) fn metadata(names: &[u8], counts: &[u8]) -> Result<Vec<Change>> {
    let mut stats = BTreeMap::new();
    for row in records(counts)? {
        let mut parts = row.splitn(3, '\t');
        let a = parts.next().unwrap_or_default();
        let d = parts.next().ok_or("Incomplete numstat record")?;
        let path = parts
            .next()
            .filter(|p| !p.is_empty())
            .ok_or("Missing numstat path")?;
        let binary = a == "-" && d == "-";
        let count = |s: &str| -> Result<usize> {
            let n = s.parse::<usize>()?;
            if n.to_string() != s {
                return Err("Noncanonical Git count".into());
            }
            Ok(n)
        };
        let sizes = if binary {
            (0, 0, true)
        } else {
            (count(a)?, count(d)?, false)
        };
        if stats.insert(path, sizes).is_some() {
            return Err("Duplicate Git stats".into());
        }
    }
    let names = records(names)?;
    let (rows, remainder) = names.as_chunks::<2>();
    if !remainder.is_empty() {
        return Err("Incomplete name-status record".into());
    }
    let mut files = Vec::new();
    for &[status, path] in rows {
        if status.len() != 1 || !"ADMTUXB".contains(status) {
            return Err("Unexpected Git status".into());
        }
        let (add, del, binary) = stats.remove(path).ok_or("Missing or duplicate Git path")?;
        files.push(Change {
            path: path.to_owned(),
            status: status.as_bytes()[0],
            add,
            del,
            binary,
            lines: Vec::new(),
            module_removed: false,
        });
    }
    if !stats.is_empty() {
        return Err("Git metadata counts disagree".into());
    }
    Ok(files)
}

pub(super) fn changes(root: &Path, base: &str, head: &str) -> Result<Vec<Change>> {
    let range = format!("{base}...{head}");
    let names = git(
        root,
        &["diff", "--no-renames", "--name-status", "-z", &range],
    )?;
    let counts = git(root, &["diff", "--no-renames", "--numstat", "-z", &range])?;
    let mut files = metadata(&names, &counts)?;
    super::size(&files)?;
    for f in files
        .iter_mut()
        .filter(|f| !f.binary && (f.add > 0 || f.del > 0) && !super::generated(&f.path))
    {
        let bytes = git(
            root,
            &[
                "diff",
                "--no-ext-diff",
                "--no-textconv",
                "--no-renames",
                "--unified=0",
                &range,
                "--",
                &f.path,
            ],
        )?;
        let patch = std::str::from_utf8(&bytes)?;
        // Only content following a hunk header can contribute added lines.
        f.module_removed = f.path.ends_with(".rs")
            && patch
                .lines()
                .skip_while(|l| !l.starts_with("@@ "))
                .filter_map(|l| l.strip_prefix('-'))
                .any(|l| {
                    let s = l.trim_start();
                    s.contains("mod ")
                        || s.starts_with("#[path")
                        || s.starts_with("#[test")
                        || s.starts_with("#[tokio::test")
                });
        f.lines = patch
            .lines()
            .skip_while(|l| !l.starts_with("@@ "))
            .filter_map(|l| l.strip_prefix('+').map(str::to_owned))
            .collect();
    }
    Ok(files)
}

pub(super) fn blob(root: &Path, rev: &str, path: &str) -> Result<String> {
    Ok(String::from_utf8(git(
        root,
        &["show", &format!("{rev}:{path}")],
    )?)?)
}

pub(super) fn sources(
    root: &Path,
    rev: &str,
    owners: &[String],
) -> Result<BTreeMap<String, String>> {
    let mut args = vec!["ls-tree", "-rz", rev, "--"];
    args.extend(owners.iter().map(String::as_str));
    let tree = git(root, &args)?;
    let mut entries = Vec::new();
    for row in records(&tree)? {
        let (meta, path) = row.split_once('\t').ok_or("Malformed Git tree")?;
        let fields: Vec<_> = meta.split_whitespace().collect();
        if (path.ends_with(".rs") || path.ends_with("/Cargo.toml"))
            && matches!(fields.as_slice(), ["100644" | "100755", "blob", _])
        {
            entries.push((fields[2].to_owned(), path.to_owned()));
        }
    }
    let mut child = Command::new("git")
        .current_dir(root)
        .args(["cat-file", "--batch"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()?;
    let mut input = child.stdin.take().unwrap();
    let data = entries
        .iter()
        .map(|(sha, _)| sha.as_str())
        .collect::<Vec<_>>()
        .join("\n");
    let writer = std::thread::spawn(move || {
        input
            .write_all(data.as_bytes())
            .and_then(|_| input.write_all(b"\n"))
    });
    let mut buf = Vec::new();
    child.stdout.take().unwrap().read_to_end(&mut buf)?;
    writer.join().map_err(|_| "Git writer stopped")??;
    if !child.wait()?.success() {
        return Err("Cannot read candidate blobs".into());
    }
    let mut blobs = BTreeMap::new();
    let mut bytes = buf.as_slice();
    for (sha, path) in entries {
        let (header, rest) = bytes.split_at(
            bytes
                .iter()
                .position(|&b| b == b'\n')
                .ok_or("Missing blob header")?,
        );
        let header = std::str::from_utf8(header)?;
        let size = header
            .strip_prefix(&format!("{sha} blob "))
            .ok_or("Unexpected blob identity")?
            .parse()?;
        let (blob, tail) = rest[1..]
            .split_at_checked(size)
            .ok_or("Incomplete Git blob")?;
        blobs.insert(path, String::from_utf8(blob.to_vec())?);
        bytes = tail
            .strip_prefix(b"\n")
            .ok_or("Incomplete Git blob trailer")?;
    }
    Ok(blobs)
}
