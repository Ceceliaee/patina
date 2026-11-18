use icu_locale::Locale;
use icu_plurals::{PluralCategory, PluralRules};
use serde::Deserialize;
use serde::de::{self, MapAccess, SeqAccess, Visitor};
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use std::{error::Error, fmt, fs, path::Path};

pub type Result<T> = std::result::Result<T, Box<dyn Error>>;
pub type Object = Map<String, Value>;

struct Unique(Value);

impl<'de> Deserialize<'de> for Unique {
    fn deserialize<D: de::Deserializer<'de>>(d: D) -> std::result::Result<Self, D::Error> {
        struct Json;
        impl<'de> Visitor<'de> for Json {
            type Value = Unique;
            fn expecting(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                f.write_str("JSON with unique object keys")
            }
            fn visit_unit<E>(self) -> std::result::Result<Unique, E> {
                Ok(Unique(Value::Null))
            }
            fn visit_bool<E>(self, x: bool) -> std::result::Result<Unique, E> {
                Ok(Unique(x.into()))
            }
            fn visit_u64<E>(self, x: u64) -> std::result::Result<Unique, E> {
                Ok(Unique(x.into()))
            }
            fn visit_i64<E>(self, x: i64) -> std::result::Result<Unique, E> {
                Ok(Unique(x.into()))
            }
            fn visit_f64<E>(self, x: f64) -> std::result::Result<Unique, E> {
                Ok(Unique(x.into()))
            }
            fn visit_str<E>(self, x: &str) -> std::result::Result<Unique, E> {
                Ok(Unique(x.into()))
            }
            fn visit_seq<A: SeqAccess<'de>>(
                self,
                mut a: A,
            ) -> std::result::Result<Unique, A::Error> {
                let mut out = Vec::new();
                while let Some(Unique(v)) = a.next_element()? {
                    out.push(v)
                }
                Ok(Unique(Value::Array(out)))
            }
            fn visit_map<A: MapAccess<'de>>(
                self,
                mut a: A,
            ) -> std::result::Result<Unique, A::Error> {
                let mut out = Map::new();
                while let Some((key, Unique(v))) = a.next_entry::<String, Unique>()? {
                    if out.insert(key.clone(), v).is_some() {
                        return Err(de::Error::custom(format!("duplicate key {key}")));
                    }
                }
                Ok(Unique(Value::Object(out)))
            }
        }
        d.deserialize_any(Json)
    }
}

pub fn json(path: &Path) -> Result<Value> {
    let bytes = fs::read(path)?;
    let Unique(value) =
        serde_json::from_slice(&bytes).map_err(|e| format!("{}: {e}", path.display()))?;
    Ok(value)
}
pub fn object(v: &Value) -> Result<&Object> {
    v.as_object().ok_or("expected object".into())
}
pub fn string(v: &Value) -> Result<&str> {
    v.as_str().ok_or("expected text".into())
}
pub fn array(v: &Value) -> Result<&[Value]> {
    v.as_array()
        .map(Vec::as_slice)
        .ok_or("expected array".into())
}
pub fn hash(value: &Value) -> String {
    let mut ordered = value.clone();
    ordered.sort_all_objects();
    format!("{:x}", Sha256::digest(ordered.to_string().as_bytes()))[..16].to_owned()
}

pub fn canonical(tag: &str) -> Result<Locale> {
    let mut locale: Locale = tag.parse()?;
    icu_locale::LocaleCanonicalizer::new_extended().canonicalize(&mut locale);
    if locale.to_string() != tag {
        return Err(format!("use canonical locale {locale}").into());
    }
    Ok(locale)
}
pub fn categories(tag: &str) -> Result<BTreeSet<&'static str>> {
    Ok(PluralRules::try_new_cardinal(canonical(tag)?.into())?
        .categories()
        .map(|cat| match cat {
            PluralCategory::One => "one",
            PluralCategory::Two => "two",
            PluralCategory::Zero => "zero",
            PluralCategory::Few => "few",
            PluralCategory::Many => "many",
            PluralCategory::Other => "other",
        })
        .collect())
}

pub struct Language {
    pub meta: Value,
    pub messages: Object,
    pub bundles: BTreeMap<String, Vec<String>>,
}
pub struct Catalog {
    pub schema: Object,
    pub langs: BTreeMap<String, Language>,
    pub source: String,
}

impl Catalog {
    pub fn load(root: &Path) -> Result<Self> {
        let dir = root.join("locales");
        let schema = object(&json(&dir.join("schema.json"))?)?.clone();
        for (key, entry) in &schema {
            for field in ["description", "translatorNote"] {
                if let Some(value) = entry.get(field)
                    && !value.as_str().is_some_and(|s| !s.trim().is_empty())
                {
                    return Err(format!("{key}: {field} must be non-empty text").into());
                }
            }
        }
        let mut langs = BTreeMap::new();
        let mut source = None;
        let mut order = BTreeSet::new();
        for entry in fs::read_dir(&dir)? {
            let entry = entry?;
            let tag = entry
                .file_name()
                .into_string()
                .map_err(|_| "invalid locale directory name")?;
            if !entry.file_type()?.is_dir() || tag == "fixtures" || tag.starts_with('.') {
                continue;
            }
            canonical(&tag)?;
            let meta = json(&entry.path().join("metadata.json"))?;
            if !order.insert(meta["order"].as_u64().ok_or("missing display order")?) {
                return Err(format!("{tag}: duplicate display order").into());
            }
            if !matches!(meta["direction"].as_str(), Some("ltr" | "rtl"))
                || string(&meta["label"])?.trim().is_empty()
                || meta["production"] != true
            {
                return Err(format!("{tag}: invalid metadata").into());
            }
            if meta["source"].as_bool().ok_or("source must be boolean")?
                && source.replace(tag.clone()).is_some()
            {
                return Err("expected one source locale".into());
            }
            let mut bundles = BTreeMap::new();
            let mut messages = Object::new();
            let mut entries = fs::read_dir(entry.path())?.collect::<std::io::Result<Vec<_>>>()?;
            entries.sort_by_key(|file| file.file_name());
            for file in entries {
                let name = file
                    .file_name()
                    .into_string()
                    .map_err(|_| "invalid filename")?;
                if name == "metadata.json" || !name.ends_with(".json") {
                    continue;
                }
                let value = json(&file.path())?;
                let fields = object(&value)?;
                bundles.insert(name, fields.keys().cloned().collect());
                for (key, value) in fields {
                    if messages.insert(key.clone(), value.clone()).is_some() {
                        return Err(format!("{tag}: duplicate key {key}").into());
                    }
                }
            }
            langs.insert(
                tag,
                Language {
                    meta,
                    messages,
                    bundles,
                },
            );
        }
        Ok(Self {
            schema,
            langs,
            source: source.ok_or("missing source locale")?,
        })
    }

    pub fn validate(&self) -> Result<()> {
        for (tag, lang) in &self.langs {
            self.validate_messages(tag, &lang.messages)?;
            if tag == &self.source {
                continue;
            }
            let reviews = object(&lang.meta["reviews"])?;
            let source = &self.langs[&self.source].messages;
            if reviews.len() != source.len() {
                return Err(format!("{tag}: review key set differs").into());
            }
            for (key, value) in source {
                if reviews.get(key).and_then(Value::as_str) != Some(hash(value).as_str()) {
                    return Err(format!("{tag}: source change requires review: {key}").into());
                }
            }
        }
        Ok(())
    }

    pub fn validate_messages(&self, tag: &str, messages: &Object) -> Result<()> {
        if messages.len() != self.schema.len() {
            return Err(format!("{tag}: message key set differs").into());
        }
        let categories = categories(tag)?;
        for (key, entry) in &self.schema {
            let value = messages
                .get(key)
                .ok_or_else(|| format!("{tag}: missing {key}"))?;
            validate_value(entry, value, &categories).map_err(|e| format!("{tag}:{key}: {e}"))?;
        }
        Ok(())
    }
}
fn fields(v: &Value, required: &[&str], optional: &[&str]) -> Result<()> {
    let obj = object(v)?;
    if required.iter().any(|f| !obj.contains_key(*f))
        || obj
            .keys()
            .any(|f| !required.contains(&f.as_str()) && !optional.contains(&f.as_str()))
    {
        return Err(format!("expected fields {required:?} and optional {optional:?}").into());
    }
    Ok(())
}
fn help_steps(v: &Value) -> Result<()> {
    for step in array(v)? {
        fields(
            step,
            &["title", "description", "details"],
            &["showStoreBadges"],
        )?;
        string(&step["title"])?;
        string(&step["description"])?;
        if let Some(b) = step.get("showStoreBadges")
            && !b.is_boolean()
        {
            return Err("invalid badge flag".into());
        }
        for detail in array(&step["details"])? {
            if detail.is_string() {
                continue;
            }
            fields(detail, &["text", "links"], &[])?;
            string(&detail["text"])?;
            for link in array(&detail["links"])? {
                fields(link, &["label", "href"], &[])?;
                string(&link["label"])?;
                string(&link["href"])?;
            }
        }
    }
    Ok(())
}
fn validate_value(schema: &Value, v: &Value, categories: &BTreeSet<&str>) -> Result<()> {
    match string(&schema["kind"])? {
        "string" => {
            string(v)?;
        }
        "string-array" => {
            for x in array(v)? {
                string(x)?;
            }
        }
        "string-record" => {
            for x in object(v)?.values() {
                string(x)?;
            }
        }
        "data" if schema["validator"] == "webActivityHelpSteps" => help_steps(v)?,
        "message" => {
            fields(v, &["$type", "body"], &[])?;
            if v["$type"] != "message" {
                return Err("expected message descriptor".into());
            }
            let params = array(&schema["params"])?
                .iter()
                .map(|p| Ok((string(&p["name"])?, string(&p["type"])?)))
                .collect::<Result<BTreeMap<_, _>>>()?;
            let mut plurals = BTreeSet::new();
            expression(&v["body"], &params, categories, &mut plurals)?;
            if let Some(args) = schema.get("pluralArgs") {
                let expected = array(args)?
                    .iter()
                    .map(string)
                    .collect::<Result<BTreeSet<_>>>()?;
                if plurals != expected {
                    return Err(format!("wrong plural arguments {plurals:?}").into());
                }
            }
            if let Some(arg) = schema.get("pluralArg")
                && !plurals.contains(string(arg)?)
            {
                return Err("missing plural argument".into());
            }
        }
        kind => return Err(format!("unsupported kind {kind}").into()),
    }
    Ok(())
}
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Debug)]
enum Kind {
    Text,
    Num,
    Bool,
    Null,
    Array,
    Unknown,
}
type Kinds = BTreeSet<Kind>;
fn expression<'a>(
    v: &'a Value,
    params: &BTreeMap<&str, &str>,
    categories: &BTreeSet<&str>,
    plurals: &mut BTreeSet<&'a str>,
) -> Result<Kinds> {
    use Kind::*;
    let kind = match v {
        Value::String(_) => Text,
        Value::Bool(_) => Bool,
        Value::Number(_) => Num,
        Value::Null => Null,
        Value::Array(items) => {
            for item in items {
                expression(item, params, categories, plurals)?;
            }
            Array
        }
        Value::Object(_) => {
            let op = string(&v["$op"])?;
            let req = match op {
                "arg" => vec!["name"],
                "plural" => vec!["arg", "cases"],
                "concat" => vec!["parts"],
                "if" => vec!["when", "then", "else"],
                "eq" | "notEq" | "coalesce" | "subtract" => vec!["left", "right"],
                "element" => vec!["target", "index"],
                "join" => vec!["target", "separator"],
                "monthName" => vec!["year", "zeroBasedMonth"],
                _ => return Err(format!("unknown operation {op}").into()),
            };
            let mut required = vec!["$op"];
            required.extend(req);
            fields(
                v,
                &required,
                if op == "monthName" { &["style"] } else { &[] },
            )?;
            let mut child = |node: &'a Value, allowed: &[Kind]| -> Result<Kinds> {
                let types = expression(node, params, categories, plurals)?;
                if !allowed.is_empty() && !types.iter().all(|k| allowed.contains(k)) {
                    return Err(format!("{op}: incompatible {types:?}").into());
                }
                Ok(types)
            };
            match op {
                "arg" => {
                    let ty = params
                        .get(string(&v["name"])?)
                        .ok_or("undeclared parameter")?;
                    let kind = if ty.contains("string[]") {
                        Array
                    } else if matches!(*ty, "number" | "integer") {
                        Num
                    } else if *ty == "boolean" {
                        Bool
                    } else {
                        Text
                    };
                    let mut out = Kinds::from([kind]);
                    if ty.contains("null") || ty.contains("undefined") {
                        out.insert(Null);
                    }
                    return Ok(out);
                }
                "plural" => {
                    let arg = string(&v["arg"])?;
                    if params.get(arg) != Some(&"integer") {
                        return Err("plural requires an integer argument".into());
                    }
                    plurals.insert(arg);
                    let cases = object(&v["cases"])?;
                    if cases.keys().map(String::as_str).collect::<BTreeSet<_>>() != *categories {
                        return Err(format!("CLDR cases must be {categories:?}").into());
                    }
                    let mut out = Kinds::new();
                    for case in cases.values() {
                        out.extend(expression(case, params, categories, plurals)?)
                    }
                    return Ok(out);
                }
                "concat" => {
                    for part in array(&v["parts"])? {
                        child(part, &[Text, Num, Bool, Null, Unknown])?;
                    }
                    Text
                }
                "if" => {
                    child(&v["when"], &[Bool])?;
                    let mut out = child(&v["then"], &[])?;
                    out.extend(child(&v["else"], &[])?);
                    return Ok(out);
                }
                "coalesce" => {
                    let mut out = child(&v["left"], &[])?;
                    out.remove(&Null);
                    out.extend(child(&v["right"], &[])?);
                    return Ok(out);
                }
                "eq" | "notEq" => {
                    child(&v["left"], &[])?;
                    child(&v["right"], &[])?;
                    Bool
                }
                "subtract" => {
                    child(&v["left"], &[Num])?;
                    child(&v["right"], &[Num])?;
                    Num
                }
                "element" => {
                    child(&v["target"], &[Array])?;
                    child(&v["index"], &[Num])?;
                    Unknown
                }
                "join" => {
                    child(&v["target"], &[Array])?;
                    child(&v["separator"], &[Text])?;
                    Text
                }
                "monthName" => {
                    child(&v["year"], &[Num])?;
                    child(&v["zeroBasedMonth"], &[Num])?;
                    if let Some(style) = v.get("style")
                        && !matches!(style.as_str(), Some("short" | "long"))
                    {
                        return Err("invalid month style".into());
                    }
                    if v["zeroBasedMonth"].is_number()
                        && !v["zeroBasedMonth"]
                            .as_i64()
                            .is_some_and(|m| (0..12).contains(&m))
                    {
                        return Err("invalid month number".into());
                    }
                    if v["year"]
                        .as_f64()
                        .is_some_and(|n| !(-271821.0..=275760.0).contains(&n))
                    {
                        return Err("year outside supported range".into());
                    }
                    Text
                }
                _ => unreachable!(),
            }
        }
    };
    Ok(Kinds::from([kind]))
}
