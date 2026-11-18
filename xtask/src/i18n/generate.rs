use super::catalog::{Catalog, Result, array, object, string};
use icu_datetime::{DateTimeFormatter, fieldsets::M, input::Date};
use serde_json::Value;
use std::{collections::BTreeMap, fmt::Write as _, fs, path::Path};

fn variant(tag: &str) -> String {
    tag.split('-')
        .map(|part| {
            let (first, rest) = part.split_at(1);
            format!(
                "{}{}",
                first.to_ascii_uppercase(),
                rest.to_ascii_lowercase()
            )
        })
        .collect()
}

fn native_expr(v: &Value, tag: &str) -> Result<String> {
    if let Some(s) = v.as_str() {
        return Ok(format!("NativeExpr::Literal({s:?})"));
    }
    if v["$type"] == "message" {
        return native_expr(&v["body"], tag);
    }
    match string(&v["$op"])? {
        "arg" => Ok(format!("NativeExpr::Arg({:?})", string(&v["name"])?)),
        "concat" => {
            let parts = array(&v["parts"])?
                .iter()
                .map(|x| native_expr(x, tag))
                .collect::<Result<Vec<_>>>()?;
            Ok(format!("NativeExpr::Concat(&[{}])", parts.join(", ")))
        }
        "plural" => {
            let sorted: BTreeMap<_, _> = object(&v["cases"])?.iter().collect();
            let arms = sorted
                .into_iter()
                .map(|(cat, x)| Ok(format!("({cat:?}, {})", native_expr(x, tag)?)))
                .collect::<Result<Vec<_>>>()?;
            Ok(format!(
                "NativeExpr::Plural {{ arg: {:?}, cases: &[{}] }}",
                string(&v["arg"])?,
                arms.join(", ")
            ))
        }
        "if" if v["when"]["$op"] == "eq" && v["when"]["left"]["$op"] == "arg" => {
            let rhs = &v["when"]["right"];
            let value = if rhs.is_number() {
                rhs.to_string()
            } else {
                string(rhs)?.to_owned()
            };
            Ok(format!(
                "NativeExpr::IfEqual({:?}, {value:?}, &{}, &{})",
                string(&v["when"]["left"]["name"])?,
                native_expr(&v["then"], tag)?,
                native_expr(&v["else"], tag)?
            ))
        }
        "monthName"
            if v["zeroBasedMonth"]["$op"] == "subtract"
                && v["zeroBasedMonth"]["right"] == 1
                && v["zeroBasedMonth"]["left"]["$op"] == "arg" =>
        {
            let arg = string(&v["zeroBasedMonth"]["left"]["name"])?;
            let format = DateTimeFormatter::try_new(
                tag.parse::<icu_locale::Locale>()?.into(),
                if v["style"] == "long" {
                    M::long()
                } else {
                    M::medium()
                },
            )?;
            let mut out = "NativeExpr::Literal(\"\")".to_owned();
            for month in (1..=12).rev() {
                let name = format
                    .format(&Date::try_new_gregorian(2020, month, 1)?)
                    .to_string();
                out = format!(
                    "NativeExpr::IfEqual({arg:?}, \"{month}\", &NativeExpr::Literal({name:?}), &{out})"
                );
            }
            Ok(out)
        }
        op => Err(format!("{tag}: unsupported native expression {op}").into()),
    }
}
fn snake(value: &str) -> String {
    let mut out = String::new();
    let mut prev_lower = false;
    for c in value.chars() {
        if c.is_ascii_alphanumeric() {
            if prev_lower && c.is_ascii_uppercase() {
                out.push('_')
            }
            out.push(c.to_ascii_lowercase());
            prev_lower = c.is_ascii_lowercase() || c.is_ascii_digit();
        } else {
            out.push('_');
            prev_lower = false
        }
    }
    out
}

fn typed(out: &mut String, key: &str, entry: &Value) -> Result<()> {
    // Keys with dynamic record fields are generated as individual leaf functions.
    let mut args = Vec::new();
    let mut values = Vec::new();
    for p in array(&entry["params"])? {
        let name = string(&p["name"])?;
        let ident = snake(name);
        let kind = string(&p["type"])?;
        let alternatives: Vec<_> = kind.split('|').map(str::trim).collect();
        let optional = p["optional"] == true
            || alternatives
                .iter()
                .any(|t| matches!(*t, "null" | "undefined"));
        let types: Vec<_> = alternatives
            .into_iter()
            .filter(|t| !matches!(*t, "null" | "undefined"))
            .collect();
        let (ty, conversion) = match types.as_slice() {
            ["integer"] => ("i64".into(), "value.to_string()".to_owned()),
            ["number"] => ("f64".into(), "value.to_string()".to_owned()),
            ["boolean"] => ("bool".into(), "value.to_string()".to_owned()),
            ["string"] => ("&str".into(), "value.to_owned()".to_owned()),
            ["string[]"] => ("&[&str]".into(), "value.join(\", \")".to_owned()),
            values if values.iter().all(|value| value.starts_with('"')) => {
                let enum_name = variant(&format!("{}-{name}", snake(key).replace('_', "-")));
                let labels = values
                    .iter()
                    .map(|v| serde_json::from_str::<String>(v))
                    .collect::<std::result::Result<Vec<_>, _>>()?;
                writeln!(
                    out,
                    "#[derive(Clone, Copy, Debug, PartialEq, Eq)]\npub enum {enum_name} {{"
                )?;
                for label in &labels {
                    writeln!(out, "    {},", variant(label))?;
                }
                writeln!(
                    out,
                    "}}\nimpl {enum_name} {{\n    pub fn as_str(self) -> &'static str {{\n        match self {{"
                )?;
                for label in &labels {
                    writeln!(out, "            Self::{} => {label:?},", variant(label))?;
                }
                out.push_str("        }\n    }\n}\n\n");
                (enum_name, "value.as_str().to_owned()".into())
            }
            _ => return Err(format!("{key}.{name}: unsupported parameter type {kind}").into()),
        };
        let ty = if optional {
            format!("Option<{ty}>")
        } else {
            ty
        };
        args.push(format!("{ident}: {ty}"));
        let val = if optional {
            format!("{ident}.map(|value| {conversion}).unwrap_or_default()")
        } else {
            conversion.replacen("value", &ident, 1)
        };
        values.push(format!("({name:?}, {val})"));
    }
    let extra = if args.is_empty() {
        String::new()
    } else {
        format!(", {}", args.join(", "))
    };
    writeln!(
        out,
        "pub fn {}(locale: Locale{extra}) -> String {{ super::format_text(locale, {key:?}, &[{}]) }}",
        snake(key),
        values.join(", ")
    )?;
    Ok(())
}

pub fn run(root: &Path, c: &Catalog, write: bool) -> Result<()> {
    c.validate()?;
    let header = "// Generated by cargo xtask i18n generate.\n\n";
    let mut text = format!(
        "{header}use super::NativeExpr;\n\n#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]\npub enum Locale {{\n"
    );
    let mut tags: Vec<_> = c.langs.keys().collect();
    tags.sort_by_key(|tag| c.langs[*tag].meta["order"].as_u64());
    for tag in &tags {
        if *tag == &c.source {
            text.push_str("    #[default]\n")
        }
        writeln!(text, "    {},", variant(tag))?;
    }
    writeln!(
        text,
        "}}\n\npub const SOURCE_LOCALE: Locale = Locale::{};",
        variant(&c.source)
    )?;
    text.push_str("\nimpl Locale {\n    pub fn from_tag(raw: Option<&str>) -> Self {\n        match raw.map(str::trim) {\n");
    for tag in &tags {
        writeln!(
            text,
            "            Some(value) if value.eq_ignore_ascii_case({tag:?}) => Self::{},",
            variant(tag)
        )?;
    }
    writeln!(
        text,
        "            Some(value) if !value.is_empty() => {{\n                eprintln!(\"[i18n] unsupported locale {{value:?}}; falling back to {}\");\n                SOURCE_LOCALE\n            }}\n            _ => SOURCE_LOCALE,\n        }}\n    }}",
        c.source
    )?;
    text.push_str("\n    pub fn tag(self) -> &'static str {\n        match self {\n");
    for tag in &tags {
        writeln!(text, "            Self::{} => {tag:?},", variant(tag))?;
    }
    text.push_str("        }\n    }\n");
    let variants = tags
        .iter()
        .map(|tag| format!("Self::{}", variant(tag)))
        .collect::<Vec<_>>()
        .join(", ");
    writeln!(
        text,
        "\n    pub const ALL: &'static [Self] = &[{variants}];"
    )?;
    for field in ["label", "direction"] {
        writeln!(
            text,
            "\n    pub fn {field}(self) -> &'static str {{\n        match self {{"
        )?;
        for tag in &tags {
            writeln!(
                text,
                "            Self::{} => {:?},",
                variant(tag),
                string(&c.langs[*tag].meta[field])?
            )?;
        }
        text.push_str("        }\n    }\n");
    }
    text.push_str("}\n");
    let fixture = super::catalog::json(&root.join("locales/fixtures/ru-RU/plurals.json"))?;
    text.push_str("\n#[cfg(test)]\npub(super) const RUSSIAN_CARDINAL_CASES: &[(i64, &str)] = &[\n");
    for case in array(&fixture["fixture.cases"])? {
        let (num, category) = string(case)?
            .split_once(':')
            .ok_or("invalid cardinal fixture")?;
        writeln!(text, "    ({}_i64, {category:?}),", num.parse::<i64>()?)?;
    }
    writeln!(
        text,
        "];\n\n#[cfg(test)]\n#[rustfmt::skip]\npub(super) const RUSSIAN_CARDINAL_MESSAGE: NativeExpr = {};",
        native_expr(&fixture["fixture.cardinal"], "ru-RU")?
    )?;
    text.push_str("\n#[rustfmt::skip]\npub(super) fn lookup(locale: Locale, key: &str) -> Option<NativeExpr> {\n    match (locale, key) {\n");
    let mut data = format!(
        "{header}use crate::Locale;\n\n#[rustfmt::skip]\npub(super) fn lookup_data(locale: Locale, key: &str) -> Option<&'static str> {{\n    match (locale, key) {{\n"
    );
    let mut api = format!("{header}use super::Locale;\n\n");
    let entries: BTreeMap<_, _> = c
        .schema
        .iter()
        .filter(|(_, v)| v["surface"] == "native" || v["alsoNative"] == true)
        .collect();
    for tag in tags {
        let messages = &c.langs[tag].messages;
        let locale = variant(tag);
        for (key, entry) in &entries {
            let value = &messages[*key];
            if matches!(entry["kind"].as_str(), Some("data" | "string-array")) {
                writeln!(
                    data,
                    "        (Locale::{locale}, {key:?}) => Some({:?}),",
                    value.to_string()
                )?;
                continue;
            }
            let items = if entry["kind"] == "string-record" {
                object(value)?
                    .iter()
                    .map(|(field, msg)| (format!("{key}.{field}"), msg))
                    .collect()
            } else {
                vec![((*key).clone(), value)]
            };
            for (key, msg) in items {
                writeln!(
                    text,
                    "        (Locale::{locale}, {key:?}) => Some({}),",
                    native_expr(msg, tag).map_err(|e| format!("{tag}:{key}: {e}"))?
                )?;
                if tag == &c.source {
                    typed(&mut api, &key, entry)?
                }
            }
        }
    }
    let ending = "        _ => None,\n    }\n}\n";
    text.push_str(ending);
    data.push_str(ending);
    for (name, output) in [
        ("generated.rs", text),
        ("generated_data.rs", data),
        ("messages.rs", api),
    ] {
        let path = root.join("crates/i18n/src").join(name);
        if write {
            super::atomic_file(&path, output.as_bytes())?;
        } else if fs::read(&path)? != output.as_bytes() {
            return Err(format!("stale {}; run cargo xtask i18n generate", path.display()).into());
        }
    }
    Ok(())
}
