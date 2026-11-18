use super::catalog::{
    Catalog, Object, Result, array, categories, json_fingerprint, object, string,
};
use regex::Regex;
use serde_json::{Value, json};
use std::{
    collections::{BTreeMap, BTreeSet},
    sync::LazyLock,
};

static TOKEN: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"⟦([A-Za-z][A-Za-z0-9_]*)⟧").unwrap());

#[derive(Clone)]
enum Tree {
    Text(String),
    Choice {
        branch: String,
        test: Value,
        yes: Box<Tree>,
        no: Box<Tree>,
    },
    Plural {
        branch: String,
        arg: String,
        cases: BTreeMap<String, Tree>,
    },
}
fn concatenate(left: &Tree, right: &Tree) -> Tree {
    match (left, right) {
        (Tree::Text(a), Tree::Text(b)) => Tree::Text(format!("{a}{b}")),
        (
            Tree::Choice {
                branch,
                test,
                yes,
                no,
            },
            b,
        ) => Tree::Choice {
            branch: branch.clone(),
            test: test.clone(),
            yes: Box::new(concatenate(yes, b)),
            no: Box::new(concatenate(no, b)),
        },
        (Tree::Plural { branch, arg, cases }, b) => Tree::Plural {
            branch: branch.clone(),
            arg: arg.clone(),
            cases: cases
                .iter()
                .map(|(n, t)| (n.clone(), concatenate(t, b)))
                .collect(),
        },
        (
            a,
            Tree::Choice {
                branch,
                test,
                yes,
                no,
            },
        ) => Tree::Choice {
            branch: branch.clone(),
            test: test.clone(),
            yes: Box::new(concatenate(a, yes)),
            no: Box::new(concatenate(a, no)),
        },
        (a, Tree::Plural { branch, arg, cases }) => Tree::Plural {
            branch: branch.clone(),
            arg: arg.clone(),
            cases: cases
                .iter()
                .map(|(n, t)| (n.clone(), concatenate(a, t)))
                .collect(),
        },
    }
}
fn compile(
    v: &Value,
    path: &str,
    categories: &BTreeSet<&str>,
    tokens: &mut BTreeMap<String, Value>,
) -> Result<Tree> {
    if let Some(s) = v.as_str() {
        if s.contains(['⟦', '⟧']) {
            return Err(format!("{path}: reserved placeholder brackets in source").into());
        }
        return Ok(Tree::Text(s.into()));
    }
    Ok(match v["$op"].as_str() {
        Some("if") => Tree::Choice {
            branch: format!("if@{path}"),
            test: v["when"].clone(),
            yes: Box::new(compile(
                &v["then"],
                &format!("{path}/then"),
                categories,
                tokens,
            )?),
            no: Box::new(compile(
                &v["else"],
                &format!("{path}/else"),
                categories,
                tokens,
            )?),
        },
        Some("plural") => {
            let arg = string(&v["arg"])?;
            let cases = object(&v["cases"])?;
            let mut out = BTreeMap::new();
            for cat in categories {
                out.insert(
                    cat.to_string(),
                    compile(
                        cases.get(*cat).unwrap_or(&cases["other"]),
                        &format!("{path}/cases/{cat}"),
                        categories,
                        tokens,
                    )?,
                );
            }
            Tree::Plural {
                branch: format!("plural:{arg}@{path}"),
                arg: arg.into(),
                cases: out,
            }
        }
        Some("concat") => {
            let mut tree = Tree::Text(String::new());
            for (i, part) in array(&v["parts"])?.iter().enumerate() {
                tree = concatenate(
                    &tree,
                    &compile(part, &format!("{path}/parts/{i}"), categories, tokens)?,
                );
            }
            tree
        }
        op => {
            if let Some((token, _)) = tokens.iter().find(|(_, expr)| *expr == v) {
                return Ok(Tree::Text(format!("⟦{token}⟧")));
            }
            let token = match op {
                Some("arg") => v["name"].as_str(),
                Some("join") if v["target"]["$op"] == "arg" => v["target"]["name"].as_str(),
                Some("coalesce") if v["left"]["$op"] == "arg" => v["left"]["name"].as_str(),
                _ => op,
            }
            .unwrap_or("value");
            let base: String = token
                .chars()
                .filter(|c| c.is_ascii_alphanumeric() || *c == '_')
                .collect();
            let mut name = base.clone();
            let mut suffix = 2;
            while tokens.contains_key(&name) {
                name = format!("{base}_{suffix}");
                suffix += 1;
            }
            tokens.insert(name.clone(), v.clone());
            Tree::Text(format!("⟦{name}⟧"))
        }
    })
}

fn walk(
    tree: &Tree,
    variants: &mut Vec<String>,
    f: &mut impl FnMut(&str, &[String]) -> Result<Value>,
) -> Result<Value> {
    match tree {
        Tree::Text(s) => f(s, variants),
        Tree::Choice {
            branch,
            test,
            yes,
            no,
        } => {
            variants.push(format!("{branch}:then"));
            let a = walk(yes, variants, f)?;
            variants.pop();
            variants.push(format!("{branch}:else"));
            let b = walk(no, variants, f)?;
            variants.pop();
            Ok(json!({"$op":"if","when":test,"then":a,"else":b}))
        }
        Tree::Plural { branch, arg, cases } => {
            let mut values = Object::new();
            for (name, tree) in cases {
                variants.push(format!("{branch}:{name}"));
                values.insert(name.clone(), walk(tree, variants, f)?);
                variants.pop();
            }
            Ok(json!({"$op":"plural","arg":arg,"cases":values}))
        }
    }
}

#[derive(Clone)]
enum Segment {
    Field(String),
    Index(usize),
}
impl From<&str> for Segment {
    fn from(x: &str) -> Self {
        Self::Field(x.into())
    }
}
impl From<usize> for Segment {
    fn from(x: usize) -> Self {
        Self::Index(x)
    }
}
fn static_paths(v: &Value, kind: &str) -> Result<Vec<Vec<Segment>>> {
    let mut paths = Vec::new();
    match kind {
        "string" => paths.push(vec![]),
        "string-array" => {
            for i in 0..array(v)?.len() {
                paths.push(vec![i.into()]);
            }
        }
        "string-record" => {
            for k in object(v)?.keys() {
                paths.push(vec![k.as_str().into()]);
            }
        }
        "data" => {
            for (i, step) in array(v)?.iter().enumerate() {
                for field in ["title", "description"] {
                    paths.push(vec![i.into(), field.into()]);
                }
                for (j, detail) in array(&step["details"])?.iter().enumerate() {
                    let mut p = vec![i.into(), "details".into(), j.into()];
                    if detail.is_string() {
                        paths.push(p);
                    } else {
                        let mut text = p.clone();
                        text.push("text".into());
                        paths.push(text);
                        p.push("links".into());
                        for k in 0..array(&detail["links"])?.len() {
                            let mut labels = p.clone();
                            labels.extend([k.into(), "label".into()]);
                            paths.push(labels);
                        }
                    }
                }
            }
        }
        _ => return Err(format!("unsupported kind {kind}").into()),
    }
    Ok(paths)
}
fn static_id(path: &[Segment]) -> String {
    if path.is_empty() {
        return "value".into();
    }
    path.iter()
        .map(|p| match p {
            Segment::Field(s) => format!("[{}]", json!(s)),
            Segment::Index(i) => format!("[{i}]"),
        })
        .collect()
}
fn human(segment: &str) -> String {
    let mut out = String::new();
    let mut prev = false;
    for (i, c) in segment.chars().enumerate() {
        if prev && c.is_ascii_uppercase() {
            out.push(' ')
        }
        out.push(if c == '_' {
            ' '
        } else if i == 0 {
            c.to_ascii_uppercase()
        } else {
            c
        });
        prev = c.is_ascii_digit() || c.is_ascii_lowercase();
    }
    out
}
fn id(key: &str, variants: &[String]) -> String {
    format!(
        "{key}::{}",
        if variants.is_empty() {
            "default".into()
        } else {
            variants.join("|")
        }
    )
}
fn unit(
    key: &str,
    entry: &Value,
    variant: &str,
    path: &str,
    unit_id: &str,
    source: &str,
) -> Result<Value> {
    let surface = string(&entry["surface"])?;
    let location = key.split('.').map(human).collect::<Vec<_>>().join(" › ");
    let mut context = format!(
        "{} · {location}",
        if surface == "native" {
            "Native surface"
        } else {
            "Application interface"
        }
    );
    let mut notes = Vec::new();
    if let Some(desc) = entry["description"].as_str() {
        context += &format!(" — {desc}");
    }
    if let Some(note) = entry["translatorNote"].as_str() {
        notes.push(note)
    }
    if key.starts_with("accessibility.") {
        notes.push("Screen-reader text; translate meaning, not visual layout.")
    }
    if key.starts_with("native.") {
        notes.push("Shown by a native tray, reminder, or export surface.")
    }
    if variant.contains("plural") {
        notes.push("Translate for the stated CLDR plural category.")
    }
    let mut tokens = Vec::new();
    let mut params = Vec::new();
    if path == "message" {
        for mat in TOKEN.find_iter(source) {
            if !tokens.contains(&mat.as_str()) {
                tokens.push(mat.as_str())
            }
        }
        for p in array(&entry["params"])? {
            params.push(format!(
                "{}: {}{}",
                string(&p["name"])?,
                string(&p["type"])?,
                if p["optional"] == true {
                    " (optional)"
                } else {
                    ""
                }
            ));
        }
    }
    Ok(
        json!({"context":context,"developerNote":notes.join(" "),"domain":key.split('.').next(),"key":key,
        "parameters":params.join(", "),"placeholders":tokens.join(", "),"sourceText":source,"surface":surface,"unitId":unit_id,"valuePath":path,"variant":variant}),
    )
}

pub struct Kit {
    pub metadata: BTreeMap<String, String>,
    pub units: Vec<Value>,
    compiled: BTreeMap<String, (Tree, BTreeMap<String, Value>)>,
    paths: BTreeMap<String, Vec<Vec<Segment>>>,
    messages: Object,
}
impl Kit {
    pub fn build(
        c: &Catalog,
        src: &str,
        target: &str,
        label: &str,
        direction: &str,
    ) -> Result<Self> {
        let lang = c.langs.get(src).ok_or("unregistered reference locale")?;
        c.validate_messages(src, &lang.messages)?;
        let categories = categories(target)?;
        let mut units = Vec::new();
        let mut compiled = BTreeMap::new();
        let mut all_paths = BTreeMap::new();
        for (key, entry) in &c.schema {
            let val = &lang.messages[key];
            if entry["kind"] == "message" {
                let mut tokens = BTreeMap::new();
                let tree = compile(&val["body"], "body", &categories, &mut tokens)?;
                walk(&tree, &mut vec![], &mut |s, variants| {
                    if !s.is_empty() {
                        let variant = if variants.is_empty() {
                            "default".into()
                        } else {
                            variants.join(" · ")
                        };
                        units.push(unit(
                            key,
                            entry,
                            &variant,
                            "message",
                            &id(key, variants),
                            s,
                        )?);
                    }
                    Ok(Value::Null)
                })?;
                compiled.insert(key.clone(), (tree, tokens));
            } else {
                let mut paths = Vec::new();
                for path in static_paths(val, string(&entry["kind"])?)? {
                    let mut cursor = val;
                    for p in &path {
                        cursor = match p {
                            Segment::Field(s) => &cursor[s],
                            Segment::Index(i) => &cursor[*i],
                        };
                    }
                    let s = string(cursor)?;
                    if s.is_empty() {
                        continue;
                    }
                    let name = static_id(&path);
                    units.push(unit(
                        key,
                        entry,
                        &name,
                        &name,
                        &format!("{key}::{name}"),
                        s,
                    )?);
                    paths.push(path);
                }
                all_paths.insert(key.clone(), paths);
            }
        }
        let data = [
            ("direction", direction.to_owned()),
            ("formatVersion", "1".to_owned()),
            ("immutableFingerprint", json_fingerprint(&json!(units))),
            ("nativeLabel", label.to_owned()),
            ("schemaFingerprint", json_fingerprint(&json!(c.schema))),
            ("sourceFingerprint", json_fingerprint(&json!(lang.messages))),
            ("sourceLocale", src.to_owned()),
            ("targetLocale", target.to_owned()),
            ("unitCount", units.len().to_string()),
        ];
        Ok(Self {
            metadata: data.into_iter().map(|(s, v)| (s.into(), v)).collect(),
            units,
            compiled,
            paths: all_paths,
            messages: lang.messages.clone(),
        })
    }
    pub fn materialize(self, values: &BTreeMap<String, String>) -> Result<Object> {
        if values.len() != self.units.len() {
            return Err("translation unit count differs".into());
        }
        let mut out = self.messages;
        for (key, (tree, tokens)) in self.compiled {
            let body = walk(&tree, &mut vec![], &mut |source, variants| {
                if source.is_empty() {
                    return Ok(Value::String(String::new()));
                }
                let name = id(&key, variants);
                let text = values
                    .get(&name)
                    .filter(|s| !s.trim().is_empty())
                    .ok_or_else(|| format!("missing translation {name}"))?;
                pattern(source, text, &tokens).map_err(|e| format!("{name}: {e}").into())
            })?;
            out.insert(key, json!({"$type":"message","body":body}));
        }
        for (key, paths) in self.paths {
            for path in paths {
                let mut cursor = out.get_mut(&key).unwrap();
                for p in &path {
                    cursor = match p {
                        Segment::Field(s) => &mut cursor[s],
                        Segment::Index(i) => &mut cursor[*i],
                    };
                }
                let name = format!("{key}::{}", static_id(&path));
                *cursor = Value::String(
                    values
                        .get(&name)
                        .filter(|s| !s.trim().is_empty())
                        .ok_or_else(|| format!("missing translation {name}"))?
                        .clone(),
                );
            }
        }
        Ok(out)
    }
}

fn pattern(source: &str, text: &str, tokens: &BTreeMap<String, Value>) -> Result<Value> {
    fn names(s: &str) -> Vec<&str> {
        let mut v: Vec<_> = TOKEN.find_iter(s).map(|m| m.as_str()).collect();
        v.sort_unstable();
        v
    }
    if names(text) != names(source) {
        return Err("placeholder mismatch".into());
    }
    let mut parts = Vec::new();
    let mut start = 0;
    for capture in TOKEN.captures_iter(text) {
        let m = capture.get(0).unwrap();
        if start < m.start() {
            parts.push(Value::String(text[start..m.start()].into()));
        }
        parts.push(
            tokens
                .get(&capture[1])
                .ok_or("unknown placeholder")?
                .clone(),
        );
        start = m.end();
    }
    if start < text.len() {
        parts.push(text[start..].into())
    }
    if parts
        .iter()
        .any(|p| p.as_str().is_some_and(|s| s.contains(['⟦', '⟧'])))
    {
        return Err("invalid placeholder brackets".into());
    }
    if parts.len() == 1 && parts[0].is_string() {
        Ok(parts.remove(0))
    } else {
        Ok(json!({"$op":"concat","parts":parts}))
    }
}
