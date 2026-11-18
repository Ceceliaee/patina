use regex::Regex;
use std::{
    collections::{BTreeSet, HashMap, HashSet},
    error::Error,
    fs,
    path::Path,
    process::Command,
};

const ENTRY: &[&str] = &[
    "AGENTS.md",
    "README.md",
    "README.zh-CN.md",
    "CONTRIBUTING.md",
    ".github/pull_request_template.md",
];

fn top_document(file: &str) -> bool {
    file.strip_prefix("docs/")
        .is_some_and(|name| !name.contains('/') && name.ends_with(".md"))
}

fn selected(file: &str, archives: bool) -> bool {
    if archives {
        return file.starts_with("docs/archive/");
    }
    ENTRY.contains(&file)
        || file == "CHANGELOG.md"
        || file.starts_with("docs/") && !file.starts_with("docs/archive/")
        || (file.starts_with("examples/")
            || file.starts_with("plugins/")
            || file.starts_with("vendor/gpui-platform/"))
            && file.ends_with("/README.md")
}

struct Markup {
    anchors: String,
    links: String,
}

// Keep byte offsets stable so diagnostics always refer to the original source.
fn markup(source: &str) -> Markup {
    let bytes = source.as_bytes();
    let mut anchors = bytes.to_owned();
    let mut links = bytes.to_owned();
    let mut i = 0;
    let mut inline = 0;
    let mut fence = None;
    let mut comment = false;
    while i < bytes.len() {
        if i == 0 || bytes[i - 1] == b'\n' {
            let end = source[i..].find('\n').map_or(bytes.len(), |n| i + n);
            let line = source[i..end].trim_end();
            let trimmed = line.trim_start_matches(' ');
            let first = trimmed.as_bytes().first().copied().unwrap_or(0);
            let count = trimmed.bytes().take_while(|&b| b == first).count();
            let marker =
                matches!(first, b'`' | b'~') && count >= 3 && line.len() - trimmed.len() <= 3;
            if fence.is_some() || marker && !comment && inline == 0 {
                if let Some((ch, len)) = fence {
                    if marker && first == ch && count >= len && count == trimmed.len() {
                        fence = None;
                    }
                } else {
                    fence = Some((first, count));
                }
                anchors[i..end].fill(b' ');
                links[i..end].fill(b' ');
                i = end.saturating_add(1);
                continue;
            }
        }
        if comment || inline == 0 && bytes[i..].starts_with(b"<!--") {
            let count = if comment && bytes[i..].starts_with(b"-->") {
                comment = false;
                3
            } else if !comment {
                comment = true;
                4
            } else {
                1
            };
            if bytes[i] != b'\n' {
                anchors[i..i + count].fill(b' ');
                links[i..i + count].fill(b' ');
            }
            i += count;
        } else if bytes[i] == b'`' {
            let len = bytes[i..].iter().take_while(|&&b| b == b'`').count();
            if inline == len {
                inline = 0;
            } else if inline == 0
                && bytes[i + len..]
                    .split(|&b| b != b'`')
                    .any(|s| s.len() == len)
            {
                inline = len;
            }
            links[i..i + len].fill(b' ');
            i += len;
        } else {
            if inline > 0 && bytes[i] != b'\n' {
                links[i] = b' ';
            }
            i += 1;
        }
    }
    Markup {
        anchors: String::from_utf8(anchors).unwrap(),
        links: String::from_utf8(links).unwrap(),
    }
}

struct Syntax {
    headings: Regex,
    tags: Regex,
    id: Regex,
    slug: Regex,
    markdown: Regex,
    attributes: Regex,
    external: Regex,
    prohibited: Regex,
    version: Regex,
}
impl Syntax {
    fn new() -> Self {
        let re = |p| Regex::new(p).unwrap();
        Self {
            headings: re(r"(?m)^#{1,6}[ \t]+([^\n]+)"),
            tags: re(r"(?is)<[a-z][^>]*>"),
            id: re(r#"(?i)<a\s+[^>]*?\bid\s*=\s*["']([^"']+)["']"#),
            slug: re(r"[^\pL\pN\pM _-]"),
            markdown: re(
                r#"!?\[[^\]]*\]\(\s*(?:<([^>\n]+)>|([^\s)]+))(?:\s+["'][^)\n]*["'])?\s*\)"#,
            ),
            attributes: re(r#"(?i)\b(srcset|src|href)\s*=\s*["']([^"']+)["']"#),
            external: re(r"(?i)^(?:[a-z][a-z0-9+.-]*:|//)"),
            prohibited: re(
                r"(?i)浏览器控制插件|GitHub 连接器插件|browser control plugin|GitHub connector plugin",
            ),
            version: re(
                r"(?i)(?:当前(?:代码)?版本(?:为|：|:)|代码版本为|current(?:\s+code)?\s+version(?:\s+is|:))\s*`?v?\d+\.\d+\.\d+",
            ),
        }
    }

    fn anchors(&self, source: &str) -> HashSet<String> {
        let mut out: HashSet<_> = self
            .id
            .captures_iter(source)
            .map(|m| m[1].to_lowercase())
            .collect();
        let mut seen = HashMap::new();
        for m in self.headings.captures_iter(source) {
            let title = self
                .tags
                .replace_all(m[1].trim_end_matches(['#', '\r', ' ']), "")
                .to_lowercase();
            let slug = self
                .slug
                .replace_all(&title, "")
                .split_whitespace()
                .collect::<Vec<_>>()
                .join("-");
            if slug.is_empty() {
                continue;
            }
            let count = seen.entry(slug.clone()).or_insert(0);
            out.insert(if *count == 0 {
                slug
            } else {
                format!("{slug}-{count}")
            });
            *count += 1;
        }
        out
    }

    fn links<'a>(&self, text: &'a str) -> Vec<(usize, &'a str)> {
        let mut out: Vec<_> = self
            .markdown
            .captures_iter(text)
            .map(|m| {
                (
                    m.get(0).unwrap().start(),
                    m.get(1).or_else(|| m.get(2)).unwrap().as_str(),
                )
            })
            .collect();
        for tag in self.tags.find_iter(text) {
            for m in self.attributes.captures_iter(tag.as_str()) {
                let raw = m.get(2).unwrap().as_str();
                if m[1].eq_ignore_ascii_case("srcset") && !raw.starts_with("data:") {
                    out.extend(
                        raw.split(',')
                            .filter_map(|entry| entry.split_whitespace().next())
                            .map(|s| (tag.start(), s)),
                    );
                } else {
                    out.push((tag.start(), raw));
                }
            }
        }
        out
    }
}

fn decoded(value: &str) -> Result<String, Box<dyn Error>> {
    let mut output = Vec::with_capacity(value.len());
    let mut input = value.bytes();
    while let Some(byte) = input.next() {
        output.push(if byte == b'%' {
            let a = input
                .next()
                .and_then(|c| char::from(c).to_digit(16))
                .ok_or("Invalid URL encoding")?;
            let b = input
                .next()
                .and_then(|c| char::from(c).to_digit(16))
                .ok_or("Invalid URL encoding")?;
            (16 * a + b) as u8
        } else {
            byte
        });
    }
    Ok(String::from_utf8(output)?)
}

fn validate(root: &Path, files: &BTreeSet<String>, archives: bool) -> Result<(), Box<dyn Error>> {
    let root = fs::canonicalize(root)?;
    let grammar = Syntax::new();
    let mut cache = HashMap::new();
    let mut errors = vec![];
    if files.iter().filter(|p| top_document(p)).count() > 10 {
        errors.push("Top-level docs limit is 10".to_owned());
    }
    for file in files.iter().filter(|p| selected(p, archives)) {
        let path = root.join(file);
        let source = fs::read_to_string(&path)?;
        let visible = markup(&source);
        let policy = ENTRY.contains(&file.as_str()) || top_document(file);
        if policy && grammar.prohibited.is_match(&source) {
            errors.push(format!("{file}: local plugin in repository policy"));
        }
        if file == "docs/versioning-and-release-policy.md" && grammar.version.is_match(&source) {
            errors.push(format!(
                "{file}: current code version belongs in Cargo.toml"
            ));
        }
        for (offset, raw) in grammar.links(&visible.links) {
            let line = 1 + source[..offset].bytes().filter(|b| *b == b'\n').count();
            let mut check = || -> Result<(), Box<dyn Error>> {
                let (file_part, fragment) = raw.split_once('#').unwrap_or((raw, ""));
                let relative = file_part.split('?').next().unwrap_or("");
                if grammar.external.is_match(relative) {
                    return Ok(());
                }
                let rel = decoded(relative)?;
                let fragment = decoded(fragment)?.to_lowercase();
                if policy && rel.replace('\\', "/").contains(".agents/skills") {
                    return Err("links ignored local Agent Skills".into());
                }
                let target = if rel.is_empty() {
                    path.clone()
                } else {
                    path.parent().unwrap().join(rel)
                };
                let target = target.canonicalize().map_err(|_| "missing target")?;
                if !target.starts_with(&root) {
                    return Err("target outside repository".into());
                }
                if !fragment.is_empty() {
                    if !cache.contains_key(&target) {
                        let text = fs::read_to_string(&target)?;
                        cache.insert(target.clone(), grammar.anchors(&markup(&text).anchors));
                    }
                    if !cache[&target].contains(&fragment) {
                        return Err("missing fragment".into());
                    }
                }
                Ok(())
            };
            if let Err(e) = check() {
                errors.push(format!("{file}:{line}: {e}: {raw}"));
            }
        }
    }
    if !errors.is_empty() {
        return Err(errors.join("\n").into());
    }
    Ok(())
}

pub fn run(root: &Path, archives: bool) -> Result<(), Box<dyn Error>> {
    let inv = Command::new("git")
        .current_dir(root)
        .args([
            "ls-files",
            "--cached",
            "--others",
            "--exclude-standard",
            "-z",
            "--",
            "*.md",
        ])
        .output()?;
    if !inv.status.success() {
        return Err("git ls-files failed".into());
    }
    let mut files: BTreeSet<String> = std::str::from_utf8(&inv.stdout)?
        .split('\0')
        .filter(|p| !p.is_empty() && root.join(p).is_file())
        .map(str::to_owned)
        .collect();
    files.extend(ENTRY.iter().map(|p| p.to_string()));
    validate(root, &files, archives)?;
    println!(
        "Documentation checks passed ({} documents).",
        files.iter().filter(|p| selected(p, archives)).count()
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn links_headings_and_fenced_examples() {
        let g = Syntax::new();
        let text = "# 中文 标题\n# Repeated\n# Repeated\n<a id=\"manual\"></a>\n~~~md\n# Hidden\n[bad](ignored)\n~~~\nUse `<!--`, <!-- [bad](comment) --> ``[bad](code)``.\n[real](<image%20file> \"title\")\n<img srcset='one.png 1x, two.png 2x'>\n";
        let parsed = markup(text);
        let anchors = g.anchors(&parsed.anchors);
        for a in ["中文-标题", "repeated-1", "manual"] {
            assert!(anchors.contains(a));
        }
        assert!(!anchors.contains("hidden"));
        assert_eq!(
            g.links(&parsed.links)
                .iter()
                .map(|(_, s)| *s)
                .collect::<Vec<_>>(),
            ["image%20file", "one.png", "two.png"]
        );
        assert_eq!(decoded("a%20b").unwrap(), "a b");
        assert!(decoded("%fg").is_err());
    }
    #[test]
    fn validates_missing_outside_and_duplicate_anchors() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("repo");
        fs::create_dir(&root).unwrap();
        fs::write(temp.path().join("outside"), "private").unwrap();
        fs::write(
            root.join("README.md"),
            "# Known\n[good](#known)\n[missing](missing)\n[out](../outside)\n[bad](#other)",
        )
        .unwrap();
        let result = validate(&root, &BTreeSet::from(["README.md".into()]), false)
            .unwrap_err()
            .to_string();
        for e in ["missing target", "outside repository", "missing fragment"] {
            assert!(result.contains(e), "{result}");
        }
        assert!(selected("docs/working/new.md", false));
        assert!(!selected("docs/archive/old.md", false));
    }
}
