use super::Result;
use std::collections::{BTreeMap, BTreeSet};
use syn::{Attribute, Expr, Item, Lit, Meta};

fn path(dir: &str, name: &str) -> Option<String> {
    if name.starts_with(['/', '\\']) || name.contains(':') {
        return None;
    }
    let joined = format!("{dir}/{name}").replace('\\', "/");
    let mut clean = Vec::new();
    for part in joined.split('/') {
        match part {
            "." | "" => {}
            ".." => {
                clean.pop()?;
            }
            _ => clean.push(part),
        }
    }
    Some(clean.join("/"))
}
fn explicit_path(attrs: &[Attribute]) -> Option<String> {
    let a = attrs.iter().find(|a| a.path().is_ident("path"))?;
    if let Meta::NameValue(m) = &a.meta
        && let Expr::Lit(e) = &m.value
        && let Lit::Str(s) = &e.lit
    {
        return Some(s.value());
    }
    None
}
struct Graph<'a> {
    files: &'a BTreeMap<String, String>,
    visited: BTreeSet<String>,
    tests: BTreeSet<String>,
}
impl Graph<'_> {
    fn file(&mut self, p: &str, root: bool) -> Result<()> {
        let Some(src) = self.files.get(p) else {
            return Ok(());
        };
        if !self.visited.insert(p.to_owned()) {
            return Ok(());
        }
        let ast = syn::parse_file(src)
            .map_err(|e| format!("Cannot parse candidate Rust source {p}: {e}"))?;
        let (dir, name) = p.rsplit_once('/').ok_or("Invalid source path")?;
        let children = if root || name == "mod.rs" {
            dir.to_owned()
        } else {
            path(dir, name.trim_end_matches(".rs")).unwrap()
        };
        self.items(p, dir, &children, &ast.items)
    }
    fn items(
        &mut self,
        owner: &str,
        explicit_base: &str,
        child_base: &str,
        items: &[Item],
    ) -> Result<()> {
        for item in items {
            match item {
                Item::Fn(f)
                    if f.attrs
                        .iter()
                        .any(|a| a.path().segments.last().is_some_and(|s| s.ident == "test")) =>
                {
                    self.tests.insert(owner.to_owned());
                }
                Item::Mod(m) => {
                    let name = m.ident.to_string();
                    let nested = path(child_base, &name).ok_or("Invalid module path")?;
                    if let Some((_, items)) = &m.content {
                        self.items(owner, &nested, &nested, items)?;
                    } else if m.attrs.iter().any(|a| a.path().is_ident("path")) {
                        if let Some(file) =
                            explicit_path(&m.attrs).and_then(|s| path(explicit_base, &s))
                        {
                            self.file(&file, false)?
                        }
                    } else {
                        self.file(&format!("{nested}.rs"), false)?;
                        self.file(&format!("{nested}/mod.rs"), false)?;
                    }
                }
                _ => {}
            }
        }
        Ok(())
    }
}

pub(super) fn registered(
    files: &BTreeMap<String, String>,
    owners: &[String],
) -> Result<BTreeSet<String>> {
    let mut graph = Graph {
        files,
        visited: BTreeSet::new(),
        tests: BTreeSet::new(),
    };
    for owner in owners {
        let Some(s) = files.get(&format!("{owner}/Cargo.toml")) else {
            continue;
        };
        let m: toml::Value = toml::from_str(s)?;
        let package = m.get("package").ok_or("Missing candidate package")?;
        let has = |key: &str| package.get(key).and_then(toml::Value::as_bool) != Some(false);
        let mut roots = BTreeSet::new();
        if has("autolib") {
            roots.insert(format!("{owner}/src/lib.rs"));
        }
        if has("autobins") {
            roots.insert(format!("{owner}/src/main.rs"));
        }
        if has("autotests") {
            let prefix = format!("{owner}/tests/");
            roots.extend(
                files
                    .keys()
                    .filter(|p| {
                        p.strip_prefix(&prefix).is_some_and(|s| {
                            (s.ends_with(".rs") && !s.contains('/'))
                                || (s.ends_with("/main.rs") && s.matches('/').count() == 1)
                        })
                    })
                    .cloned(),
            );
        }
        for key in ["lib", "bin", "test", "example"] {
            let tables = match m.get(key) {
                Some(toml::Value::Array(a)) => a.iter().collect(),
                Some(v) => vec![v],
                None => continue,
            };
            for t in tables {
                let default = match (key, t.get("name").and_then(toml::Value::as_str)) {
                    ("lib", _) => "src/lib.rs".to_owned(),
                    ("bin", Some(n))
                        if n == package
                            .get("name")
                            .and_then(toml::Value::as_str)
                            .unwrap_or("") =>
                    {
                        "src/main.rs".to_owned()
                    }
                    ("bin", Some(n)) => format!("src/bin/{n}.rs"),
                    ("test", Some(n)) => format!("tests/{n}.rs"),
                    ("example", Some(n)) => format!("examples/{n}.rs"),
                    _ => continue,
                };
                let p = path(
                    owner,
                    t.get("path")
                        .and_then(toml::Value::as_str)
                        .unwrap_or(&default),
                )
                .ok_or("Invalid Cargo target path")?;
                if t.get("test")
                    .and_then(toml::Value::as_bool)
                    .unwrap_or(key != "example")
                {
                    roots.insert(p);
                } else {
                    roots.remove(&p);
                }
            }
        }
        for p in roots {
            graph.file(&p, true)?
        }
    }
    Ok(graph.tests)
}
