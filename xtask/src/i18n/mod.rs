mod catalog;
mod generate;
mod kit;
#[cfg(test)]
mod tests;
mod workbook;

use catalog::{Catalog, Object, Result, canonical, hash, string};
use kit::Kit;
use serde_json::{Value, json};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    io::Write,
    path::{Path, PathBuf},
};
use tempfile::{Builder, NamedTempFile};

fn atomic_file(path: &Path, bytes: &[u8]) -> Result<()> {
    let mut temp = NamedTempFile::new_in(path.parent().ok_or("no output parent")?)?;
    temp.write_all(bytes)?;
    temp.as_file().sync_all()?;
    temp.persist(path)?;
    Ok(())
}

fn write_locale(
    target: &Path,
    bundles: &BTreeMap<String, Vec<String>>,
    messages: &Object,
    meta: &Value,
) -> Result<()> {
    let parent = target.parent().ok_or("missing target parent")?;
    fs::create_dir_all(parent)?;
    if target.try_exists()? {
        return Err(format!("output already exists: {}", target.display()).into());
    }
    let temp = Builder::new().prefix(".i18n-").tempdir_in(parent)?;
    for (bundle, keys) in bundles {
        let mut rows = Vec::new();
        for key in keys {
            rows.push(format!(
                "  {}: {}",
                json!(key),
                messages.get(key).ok_or_else(|| format!("missing {key}"))?
            ));
        }
        atomic_file(
            &temp.path().join(bundle),
            format!("{{\n{}\n}}\n", rows.join(",\n")).as_bytes(),
        )?;
    }
    atomic_file(
        &temp.path().join("metadata.json"),
        format!("{}\n", serde_json::to_string_pretty(meta)?).as_bytes(),
    )?;
    fs::rename(temp.path(), target)?;
    Ok(())
}

fn hardcoded(root: &Path, c: &Catalog) -> Result<()> {
    fn walk(path: &Path, list: &mut Vec<PathBuf>) -> Result<()> {
        for item in fs::read_dir(path)? {
            let item = item?;
            if item.file_type()?.is_dir() {
                walk(&item.path(), list)?
            } else if item.path().extension().is_some_and(|ext| ext == "rs") {
                list.push(item.path())
            }
        }
        Ok(())
    }
    let labels: BTreeSet<_> = c.langs[&c.source]
        .messages
        .iter()
        .filter(|(k, _)| k.starts_with("native."))
        .filter_map(|(_, v)| v.as_str())
        .filter(|s| s.chars().count() >= 2)
        .collect();
    let mut files = Vec::new();
    for path in ["apps/patina/src", "apps/patina-ui/src"] {
        walk(&root.join(path), &mut files)?;
    }
    for path in ["common.rs", "markdown_exporter.rs"] {
        files.push(root.join("crates/activity/src/data/export").join(path));
    }
    use syn::visit::{self, Visit};
    struct Literals(BTreeSet<String>);
    impl<'ast> Visit<'ast> for Literals {
        fn visit_lit_str(&mut self, lit: &'ast syn::LitStr) {
            self.0.insert(lit.value());
        }
        fn visit_item_mod(&mut self, item: &'ast syn::ItemMod) {
            if item.attrs.iter().any(|attr| {
                attr.path().is_ident("cfg")
                    && attr.parse_args::<syn::Ident>().is_ok_and(|id| id == "test")
            }) {
                return;
            }
            visit::visit_item_mod(self, item);
        }
        fn visit_item_fn(&mut self, item: &'ast syn::ItemFn) {
            if !item.attrs.iter().any(|attr| attr.path().is_ident("test")) {
                visit::visit_item_fn(self, item)
            }
        }
        fn visit_macro(&mut self, mac: &'ast syn::Macro) {
            // Most display macros accept an expression list (including nested format calls).
            if let Ok(args) = mac.parse_body_with(
                syn::punctuated::Punctuated::<syn::Expr, syn::Token![,]>::parse_terminated,
            ) {
                for expr in &args {
                    self.visit_expr(expr)
                }
            }
        }
    }
    for file in files {
        let source = fs::read_to_string(&file)?;
        let ast = syn::parse_file(&source).map_err(|e| format!("{}: {e}", file.display()))?;
        let mut found = Literals(BTreeSet::new());
        found.visit_file(&ast);
        for value in found.0 {
            if labels.contains(value.as_str()) {
                return Err(
                    format!("{}: untranslated native literal {value:?}", file.display()).into(),
                );
            }
        }
    }
    Ok(())
}

#[derive(Default)]
struct Args {
    pos: Vec<String>,
    options: BTreeMap<String, String>,
}
impl Args {
    fn parse(input: &[String], valid: &[&str], flags: &[&str], count: usize) -> Result<Self> {
        let mut args = Args::default();
        let mut iter = input.iter();
        while let Some(arg) = iter.next() {
            if !arg.starts_with("--") {
                args.pos.push(arg.clone());
                continue;
            }
            let value = if flags.contains(&arg.as_str()) {
                String::new()
            } else if valid.contains(&arg.as_str()) {
                iter.next()
                    .filter(|v| !v.starts_with("--"))
                    .ok_or_else(|| format!("missing value for {arg}"))?
                    .clone()
            } else {
                return Err(format!("unknown option {arg}").into());
            };
            if args.options.insert(arg.clone(), value).is_some() {
                return Err(format!("duplicate option {arg}").into());
            }
        }
        if args.pos.len() != count {
            return Err(format!("expected {count} positional argument(s)").into());
        }
        Ok(args)
    }
    fn opt(&self, k: &str) -> Option<&str> {
        self.options.get(k).map(String::as_str)
    }
    fn required(&self, k: &str) -> Result<&str> {
        self.opt(k)
            .filter(|v| !v.trim().is_empty())
            .ok_or_else(|| format!("missing {k}").into())
    }
}

fn reject_locale_preview(root: &Path, path: &Path) -> Result<()> {
    // Resolve existing parents as well as lexical components so a symlink cannot register a preview.
    let absolute = std::path::absolute(path)?;
    let mut parts = Vec::new();
    let mut dir = absolute.as_path();
    while !dir.try_exists()? {
        parts.push(dir.file_name().ok_or("invalid preview directory")?);
        dir = dir.parent().ok_or("invalid preview directory")?;
    }
    let mut resolved = dir.canonicalize()?;
    for part in parts.into_iter().rev() {
        resolved.push(part)
    }
    if resolved.starts_with(root.join("locales").canonicalize()?) {
        return Err("use --apply to register a production locale".into());
    }
    Ok(())
}

pub fn run(root: &Path, args: Vec<String>) -> Result<()> {
    let (cmd, input) = args
        .split_first()
        .ok_or("expected i18n check, generate, new, review, export-kit or import-kit")?;
    if matches!(cmd.as_str(), "--help" | "-h") && input.is_empty() {
        println!(
            "cargo xtask i18n check | generate\ncargo xtask i18n review LOCALE --all|--key KEY\ncargo xtask i18n new LOCALE LABEL [--from LOCALE] [--direction ltr|rtl] [--dry-run]\ncargo xtask i18n export-kit LOCALE LABEL [--from LOCALE] [--direction ltr|rtl] [--output FILE]\ncargo xtask i18n import-kit FILE --target LOCALE --label LABEL --from LOCALE --direction ltr|rtl [--apply | --output DIR]"
        );
        return Ok(());
    }
    // A persistent file with an OS-owned lock also releases cleanly after a crashed process.
    let _guard = if matches!(cmd.as_str(), "new" | "review" | "import-kit" | "generate") {
        let dir = root.join(".tmp");
        fs::create_dir_all(&dir)?;
        let f = fs::OpenOptions::new()
            .create(true)
            .truncate(false)
            .read(true)
            .write(true)
            .open(dir.join("i18n-write.lock"))?;
        f.lock()?;
        Some(f)
    } else {
        None
    };
    let c = Catalog::load(root)?;
    match cmd.as_str() {
        "check" | "generate" => {
            Args::parse(input, &[], &[], 0)?;
            generate::run(root, &c, cmd == "generate")?;
            if cmd == "check" {
                hardcoded(root, &c)?
            }
            println!(
                "Validated {} locales and {} message keys.",
                c.langs.len(),
                c.schema.len()
            );
        }
        "review" => {
            let a = Args::parse(input, &["--key"], &["--all"], 1)?;
            let tag = &a.pos[0];
            let lang = c.langs.get(tag).ok_or("unregistered locale")?;
            if tag == &c.source || a.opt("--all").is_some() == a.opt("--key").is_some() {
                return Err("review a translated locale with --all or --key <key>".into());
            }
            c.validate_messages(tag, &lang.messages)?;
            let source = &c.langs[&c.source].messages;
            let mut meta = lang.meta.clone();
            if let Some(key) = a.opt("--key") {
                meta["reviews"][key] = hash(source.get(key).ok_or("unknown message key")?).into();
            } else {
                meta["reviews"] = Value::Object(
                    source
                        .iter()
                        .map(|(key, value)| (key.clone(), hash(value).into()))
                        .collect(),
                );
            }
            atomic_file(
                &root.join("locales").join(tag).join("metadata.json"),
                format!("{}\n", serde_json::to_string_pretty(&meta)?).as_bytes(),
            )?;
        }
        "new" | "export-kit" | "import-kit" => {
            let import = cmd == "import-kit";
            let export = cmd == "export-kit";
            let a = match cmd.as_str() {
                "new" => Args::parse(input, &["--from", "--direction"], &["--dry-run"], 2)?,
                "export-kit" => Args::parse(input, &["--from", "--direction", "--output"], &[], 2)?,
                _ => Args::parse(
                    input,
                    &["--from", "--direction", "--target", "--label", "--output"],
                    &["--apply"],
                    1,
                )?,
            };
            let (tag, label, from, direction) = if import {
                (
                    a.required("--target")?,
                    a.required("--label")?,
                    a.required("--from")?,
                    a.required("--direction")?,
                )
            } else {
                (
                    a.pos[0].as_str(),
                    a.pos[1].as_str(),
                    a.opt("--from").unwrap_or(&c.source),
                    a.opt("--direction").unwrap_or("ltr"),
                )
            };
            let label = label.trim();
            canonical(tag)?;
            if label.is_empty() || !matches!(direction, "rtl" | "ltr") {
                return Err("expected a native language label and direction ltr or rtl".into());
            }
            let apply = cmd == "new" || a.opt("--apply").is_some();
            if apply && (c.langs.contains_key(tag) || a.opt("--output").is_some()) {
                return Err(
                    "registration requires a new locale and uses its production directory".into(),
                );
            }
            let kit = Kit::build(&c, from, tag, label, direction)?;
            if export {
                let output = a.opt("--output").map(PathBuf::from).unwrap_or_else(|| {
                    root.join("artifacts/i18n")
                        .join(format!("patina-{tag}-from-{from}-translation-kit.xlsx"))
                });
                workbook::write(&output, &kit, None)?;
                println!(
                    "Exported {} translation units to {}.",
                    kit.units.len(),
                    output.display()
                );
                return Ok(());
            }
            let values = if import {
                workbook::read(Path::new(&a.pos[0]), &kit)?
            } else {
                kit.units
                    .iter()
                    .map(|u| {
                        Ok((
                            string(&u["unitId"])?.to_owned(),
                            string(&u["sourceText"])?.to_owned(),
                        ))
                    })
                    .collect::<Result<_>>()?
            };
            let messages = kit.materialize(&values)?;
            c.validate_messages(tag, &messages)?;
            let output = if apply {
                root.join("locales").join(tag)
            } else {
                let path = a
                    .opt("--output")
                    .map(PathBuf::from)
                    .unwrap_or_else(|| root.join("artifacts/i18n/imported").join(tag));
                reject_locale_preview(root, &path)?;
                path
            };
            if a.opt("--dry-run").is_none() {
                let reviews: Object = c
                    .schema
                    .keys()
                    .map(|key| (key.clone(), Value::from("PENDING")))
                    .collect();
                let order = c
                    .langs
                    .values()
                    .filter_map(|l| l.meta["order"].as_u64())
                    .max()
                    .unwrap_or(0)
                    .checked_add(1)
                    .ok_or("locale order overflow")?;
                let meta = json!({"order":order,"label":label,"source":false,"direction":direction,"production":true,"reviews":reviews});
                write_locale(&output, &c.langs[from].bundles, &messages, &meta)?;
            }
            println!("Validated {} units for {}.", values.len(), output.display());
        }
        _ => return Err(format!("unknown i18n command {cmd}").into()),
    }
    Ok(())
}
