use crate::archive::{bounded, invalid, plain_path};
use patina_plugin_sdk::Messages;
use std::{collections::BTreeMap, fs, io, path::Path};

pub type Catalogs = BTreeMap<String, Messages>;
const MAX_CATALOG: usize = 128 * 1024;
const MAX_LANGUAGES: usize = 32;

pub(super) fn tag_for_file(name: &str) -> io::Result<&str> {
    let tag = name
        .strip_suffix(".json")
        .ok_or_else(|| invalid("Expected a locale JSON file"))?;
    let mut parts = tag.split('-');
    let base = parts.next().unwrap_or_default();
    if !(2..=8).contains(&base.len())
        || !base.bytes().all(|b| b.is_ascii_alphabetic())
        || tag.len() > 63
        || parts
            .any(|p| p.is_empty() || p.len() > 8 || !p.bytes().all(|b| b.is_ascii_alphanumeric()))
        || crate::directories::folder_name(&tag.to_ascii_lowercase()) != tag.to_ascii_lowercase()
    {
        return Err(invalid("Invalid plugin locale filename"));
    }
    Ok(tag)
}

pub(super) fn insert(catalogs: &mut Catalogs, name: &str, bytes: &[u8]) -> io::Result<()> {
    let tag = tag_for_file(name)?;
    if catalogs.len() >= MAX_LANGUAGES
        || bytes.len() > MAX_CATALOG
        || catalogs.keys().any(|k| k.eq_ignore_ascii_case(tag))
    {
        return Err(invalid("Duplicate or oversized plugin locale"));
    }
    let messages: Messages = serde_json::from_slice(bytes)?;
    catalogs.insert(tag.to_owned(), messages);
    Ok(())
}

fn validate_messages(messages: &Messages) -> io::Result<()> {
    if messages.len() > 1024
        || messages.iter().any(|(key, value)| {
            key.is_empty()
                || key.len() > 128
                || !key
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b"._-".contains(&b))
                || value.trim().is_empty()
                || value.len() > 8192
        })
        || messages
            .get("plugin.name")
            .is_some_and(|s| !crate::package::display_text(s, 100))
    {
        return Err(invalid("Invalid plugin translation"));
    }
    Ok(())
}

pub(super) fn validate(catalogs: &Catalogs) -> io::Result<()> {
    let mut seen = std::collections::BTreeSet::new();
    if catalogs.len() > MAX_LANGUAGES {
        return Err(invalid("Too many plugin locales"));
    }
    for (tag, messages) in catalogs {
        tag_for_file(&format!("{tag}.json"))?;
        if !seen.insert(tag.to_ascii_lowercase())
            || serde_json::to_vec_pretty(messages)?.len() > MAX_CATALOG
        {
            return Err(invalid("Duplicate or oversized plugin locale"));
        }
        validate_messages(messages)?;
    }
    Ok(())
}

pub(super) fn read(dir: &Path, remaining: &mut usize) -> io::Result<Catalogs> {
    let mut catalogs = Catalogs::new();
    let folder = dir.join("locales");
    match plain_path(&folder) {
        Ok(m) if m.is_dir() => {}
        Ok(_) => return Err(invalid("Expected locales directory")),
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(catalogs),
        Err(e) => return Err(e),
    }
    for entry in fs::read_dir(folder)? {
        let entry = entry?;
        let name = entry.file_name();
        let name = name
            .to_str()
            .ok_or_else(|| invalid("Invalid locale filename"))?;
        tag_for_file(name)?;
        let meta = plain_path(&entry.path())?;
        if !meta.is_file() || meta.len() > MAX_CATALOG as u64 {
            return Err(invalid("Invalid locale file"));
        }
        let bytes = bounded(fs::File::open(entry.path())?, remaining)?;
        insert(&mut catalogs, name, &bytes)?;
    }
    Ok(catalogs)
}

pub(super) fn select(catalogs: &Catalogs, locale: &str) -> Messages {
    let lookup = |tag: &str| {
        catalogs
            .iter()
            .find(|(k, _)| k.eq_ignore_ascii_case(tag))
            .map(|(_, v)| v)
    };
    let mut selected = lookup("en-US").cloned().unwrap_or_default();
    for (i, _) in locale
        .match_indices('-')
        .chain(std::iter::once((locale.len(), "")))
    {
        if let Some(messages) = lookup(&locale[..i]) {
            selected.extend(messages.clone());
        }
    }
    selected
}
