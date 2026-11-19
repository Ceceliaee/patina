use super::{Change, ui};
use regex::Regex;
use std::collections::BTreeMap;
use url::Url;

const GOVERNANCE: [&str; 5] = [
    "AGENTS.md",
    "CONTRIBUTING.md",
    "docs/quality.md",
    "docs/documentation.md",
    ".github/pull_request_template.md",
];
fn is_documentation_path(path: &str) -> bool {
    GOVERNANCE.contains(&path)
        || matches!(path, "README.md" | "README.zh-CN.md" | "CHANGELOG.md")
        || (path.starts_with("docs/")
            && path.ends_with(".md")
            && path
                .split('/')
                .all(|s| !s.starts_with('.') && !s.is_empty() && !s.contains('\\')))
}
fn sections(body: &str) -> BTreeMap<String, String> {
    let comments = Regex::new(r"(?s)<!--.*?(?:-->|$)").unwrap();
    let body = comments.replace_all(body, "");
    let mut parts = BTreeMap::<String, String>::new();
    let mut key = String::new();
    for line in body.lines() {
        if let Some(h) = line.trim_end().strip_prefix("## ") {
            key = h.trim().to_ascii_lowercase();
        } else {
            let section = parts.entry(key.clone()).or_default();
            section.push_str(line);
            section.push('\n');
        }
    }
    parts
}
fn checked(section: &str) -> impl Iterator<Item = &str> {
    section.lines().filter_map(|l| {
        let t = l.trim().strip_prefix('-')?.trim_start();
        t.strip_prefix("[x]")
            .or_else(|| t.strip_prefix("[X]"))
            .map(str::trim)
    })
}
fn field<'a>(section: &'a str, key: &str) -> Option<&'a str> {
    section
        .lines()
        .filter_map(|l| l.trim().strip_prefix('-')?.trim().split_once(':'))
        .find(|(l, v)| l.eq_ignore_ascii_case(key) && !v.trim().is_empty())
        .map(|(_, v)| v.trim())
}
fn screenshots(s: &str) -> bool {
    Regex::new(r#"https://[^\s"'<>]+"#)
        .unwrap()
        .find_iter(s)
        .any(|m| {
            let Ok(u) = Url::parse(m.as_str().trim_end_matches([')', '>', '.', ',', ';'])) else {
                return false;
            };
            match u.host_str() {
                None | Some("raw.githubusercontent.com") => false,
                Some("github.com") => u
                    .path()
                    .strip_prefix("/user-attachments/assets/")
                    .is_some_and(|v| !v.is_empty()),
                Some(_) => [".png", ".jpg", ".jpeg", ".webp"]
                    .iter()
                    .any(|ext| u.path().to_ascii_lowercase().ends_with(ext)),
            }
        })
}
fn test_command(s: &str, files: &[Change]) -> bool {
    let mut tokens = s.split_whitespace();
    if tokens.next() != Some("cargo") {
        return false;
    }
    match tokens.next() {
        Some("test") => !tokens.any(|arg| matches!(arg, "--list" | "--no-run" | "--help" | "-h")),
        Some("xtask") => match tokens.collect::<Vec<_>>().as_slice() {
            ["check", "native"] => true,
            ["check", "tools"] => files.iter().all(|f| {
                is_documentation_path(&f.path)
                    || f.path.starts_with("xtask/")
                    || f.path.starts_with("locales/")
                    || f.path.starts_with("examples/")
                    || f.path.starts_with("plugins/")
            }),
            _ => false,
        },
        _ => false,
    }
}
pub(super) fn assess(body: &str, files: &[Change], errors: &mut Vec<String>) {
    let parts = sections(body);
    let get = |k: &str| parts.get(k).map(String::as_str).unwrap_or("").trim();
    for heading in [
        "purpose",
        "accepted scope",
        "changes",
        "scope boundary",
        "owner check",
        "risk review",
        "ui review",
        "validation",
        "contributor checklist",
    ] {
        if get(heading).is_empty() {
            errors.push(format!("missing-pr-section: {heading}"))
        }
    }
    if !Regex::new(r"(?i)(?:#\d+\b|https://\S+)")
        .unwrap()
        .is_match(get("accepted scope"))
    {
        errors.push("missing-accepted-scope: link the agreed issue or approval".into())
    }
    for section in ["changes", "purpose"] {
        if !get(section)
            .lines()
            .any(|l| !matches!(l.trim(), "" | "-" | "Refs #" | "Refs#"))
        {
            errors.push(format!("incomplete-pr-sections: describe {section}"))
        }
    }
    for (section, labels) in [
        ("scope boundary", &["In scope", "Out of scope"][..]),
        (
            "owner check",
            &["GPUI owner", "Rust owner", "Why this placement fits"][..],
        ),
        (
            "risk review",
            &[
                "Tracking correctness",
                "Local data safety",
                "Privacy or security",
                "Compatibility and migration",
                "Failure and recovery behavior",
            ][..],
        ),
    ] {
        for key in labels {
            if field(get(section), key).is_none() {
                errors.push(format!(
                    "incomplete-pr-sections: fill in {key} under {section}"
                ))
            }
        }
    }
    let checklist = get("contributor checklist");
    if checked(checklist).next().is_none()
        || checklist.lines().any(|l| {
            l.trim()
                .strip_prefix('-')
                .is_some_and(|v| v.trim_start().starts_with("[ ]"))
        })
    {
        errors.push("unchecked-contributor-checklist: complete the contributor checklist".into())
    }
    let commands: Vec<_> = checked(get("validation"))
        .filter_map(|l| {
            l.strip_prefix('\x60')?
                .split_once('\x60')
                .map(|(cmd, _)| cmd)
        })
        .collect();
    if !commands.contains(&"cargo xtask check") {
        let docs_only = !files.is_empty()
            && files.iter().all(|f| {
                !f.binary
                    && matches!(f.status, b'A' | b'D' | b'M')
                    && is_documentation_path(&f.path)
            });
        if docs_only {
            if !commands.contains(&"cargo xtask docs check") {
                errors.push("incomplete-pr-sections: confirm cargo xtask docs check".into())
            }
            if files.iter().any(|f| GOVERNANCE.contains(&f.path.as_str()))
                && !commands.iter().any(|c| {
                    matches!(
                        *c,
                        "cargo test -p xtask docs::"
                            | "cargo test --locked -p xtask docs::"
                            | "cargo xtask check tools"
                            | "cargo test -p xtask"
                            | "cargo test --locked -p xtask"
                    )
                })
            {
                errors.push("incomplete-pr-sections: confirm documentation governance tests".into())
            }
        } else if files.is_empty() || !commands.iter().any(|s| test_command(s, files)) {
            errors.push("incomplete-pr-sections: confirm the focused test command".into())
        }
    }
    if files.iter().any(|f| ui(&f.path)) {
        let section = get("ui review");
        let checked: Vec<_> = checked(section).collect();
        let repeat=field(section,"Repeatable test or existing owner test").is_some_and(|s|{
            Regex::new(r"(?i)(?:\bcargo (?:test|xtask check)\b|(?:apps|crates)/\S+/tests/\S+\.rs|(?:existing owner|structural|browser) test\s*[:=-]\s*\S)").unwrap().is_match(s)
        });
        if !checked.contains(&"UI follows Quiet Pro")
            || !checked.contains(&"Screenshots attached externally")
            || field(section, "Affected states").is_none()
            || field(section, "Keyboard and focus").is_none()
            || !repeat
            || !screenshots(get("screenshots"))
        {
            errors.push("missing-ui-evidence: provide external screenshots, Quiet Pro review, keyboard and focus states, and a repeatable owner test".into())
        }
    }
}
