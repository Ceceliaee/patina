use super::catalog::{Result, string};
use super::kit::Kit;
use roxmltree::{Document, Node, ParsingOptions};
use std::collections::{BTreeMap, BTreeSet};
use std::{
    fmt::Write as _,
    io::{Cursor, Read, Write},
    path::Path,
};
use zip::{CompressionMethod, ZipArchive, ZipWriter, write::SimpleFileOptions};

const COLUMNS: [(&str, &str); 13] = [
    ("status", "Status"),
    ("unitId", "Unit ID"),
    ("domain", "Area"),
    ("context", "Context"),
    ("surface", "Surface"),
    ("key", "Message key"),
    ("variant", "Variant"),
    ("sourceText", "Reference text"),
    ("translation", "Translation"),
    ("placeholders", "Required placeholders"),
    ("parameters", "Parameters"),
    ("translatorNote", "Translator note / question"),
    ("developerNote", "Developer note"),
];
const SHEETS: [&str; 4] = ["Instructions", "Translations", "Glossary", "_Manifest"];
const MAX_INPUT: u64 = 8 * 1024 * 1024;
const MAX_EXPANDED: u64 = 16 * 1024 * 1024;
const XMLNS: &str = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const DOC_REL: &str = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const REL: &str = "http://schemas.openxmlformats.org/package/2006/relationships";

fn xml(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\r', "&#13;")
}
fn formula(row: usize) -> String {
    format!("IF(OR(LEN(TRIM(I{row}))=0,I{row}=CHAR(160)),\"TODO\",\"TRANSLATED\")")
}
fn cell(text: &str, col: usize, row: usize, style: u8) -> String {
    let col = (b'A' + col as u8) as char;
    format!(
        "<c r=\"{col}{row}\" t=\"inlineStr\" s=\"{style}\"><is><t xml:space=\"preserve\">{}</t></is></c>",
        xml(text)
    )
}

fn worksheet(widths: &[u16], rows: &[Vec<String>], translations: bool) -> String {
    let mut out = format!(
        "<worksheet xmlns=\"{XMLNS}\"><sheetViews><sheetView workbookViewId=\"0\"><pane ySplit=\"1\" topLeftCell=\"A2\" activePane=\"bottomLeft\" state=\"frozen\"/></sheetView></sheetViews><cols>"
    );
    for (i, width) in widths.iter().enumerate() {
        let c = i + 1;
        write!(
            out,
            "<col min=\"{c}\" max=\"{c}\" width=\"{width}\" customWidth=\"1\"/>"
        )
        .unwrap();
    }
    out.push_str("</cols><sheetData>");
    for (idx, row) in rows.iter().enumerate() {
        let num = idx + 1;
        write!(out, "<row r=\"{num}\">").unwrap();
        for (c, text) in row.iter().enumerate() {
            if idx > 0 && c == 0 && translations {
                write!(
                    out,
                    "<c r=\"A{num}\" t=\"str\"><f>{}</f><v>TODO</v></c>",
                    xml(&formula(num))
                )
                .unwrap();
            } else {
                let style = if idx == 0 {
                    1
                } else if translations && matches!(c, 8 | 11) {
                    2
                } else {
                    0
                };
                out.push_str(&cell(text, c, num, style));
            }
        }
        out.push_str("</row>");
    }
    out.push_str("</sheetData>");
    if translations {
        write!(out, "<autoFilter ref=\"A1:M{}\"/>", rows.len()).unwrap();
    }
    out.push_str("</worksheet>");
    out
}
fn rows(values: &[&[&str]]) -> Vec<Vec<String>> {
    values
        .iter()
        .map(|row| row.iter().map(|s| (*s).into()).collect())
        .collect()
}
pub fn write(path: &Path, kit: &Kit, initial: Option<&BTreeMap<String, String>>) -> Result<()> {
    let dir = path
        .parent()
        .filter(|dir| !dir.as_os_str().is_empty())
        .unwrap_or(Path::new("."));
    std::fs::create_dir_all(dir)?;
    let mut file = tempfile::NamedTempFile::new_in(dir)?;
    let mut zip = ZipWriter::new(file.as_file_mut());
    let mut add = |path: &str, body: &str| -> Result<()> {
        zip.start_file(
            path,
            SimpleFileOptions::default().compression_method(CompressionMethod::Deflated),
        )?;
        zip.write_all(br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>"#)?;
        zip.write_all(body.as_bytes())?;
        Ok(())
    };
    let mut types = String::from(
        r#"<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>"#,
    );
    let mut book = format!("<workbook xmlns=\"{XMLNS}\" xmlns:r=\"{DOC_REL}\"><sheets>");
    let mut rels = format!(
        "<Relationships xmlns=\"{REL}\"><Relationship Id=\"rId5\" Type=\"{DOC_REL}/styles\" Target=\"styles.xml\"/>"
    );
    for (idx, sheet) in SHEETS.iter().enumerate() {
        let i = idx + 1;
        write!(
            types,
            "<Override PartName=\"/xl/worksheets/sheet{i}.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml\"/>"
        )?;
        let state = if *sheet == "_Manifest" {
            " state=\"veryHidden\""
        } else {
            ""
        };
        write!(
            book,
            "<sheet name=\"{sheet}\" sheetId=\"{i}\" r:id=\"rId{i}\"{state}/>"
        )?;
        write!(
            rels,
            "<Relationship Id=\"rId{i}\" Type=\"{DOC_REL}/worksheet\" Target=\"worksheets/sheet{i}.xml\"/>"
        )?;
    }
    types.push_str("</Types>");
    book.push_str("</sheets><calcPr fullCalcOnLoad=\"1\"/></workbook>");
    rels.push_str("</Relationships>");
    add("[Content_Types].xml", &types)?;
    add("xl/workbook.xml", &book)?;
    add("xl/_rels/workbook.xml.rels", &rels)?;
    add(
        "_rels/.rels",
        &format!(
            "<Relationships xmlns=\"{REL}\"><Relationship Id=\"rId1\" Type=\"{DOC_REL}/officeDocument\" Target=\"xl/workbook.xml\"/></Relationships>"
        ),
    )?;
    add("xl/styles.xml", include_str!("styles.xml"))?;
    let mut instructions = rows(&[
        &["Patina translation kit", "Instructions"],
        &["Target", &kit.metadata["nativeLabel"]],
        &["Target locale", &kit.metadata["targetLocale"]],
        &["Reference", &kit.metadata["sourceLocale"]],
        &[
            "Translations",
            "Edit the yellow Translation and Translator note / question columns. Keep each placeholder including its brackets. Placeholders may be reordered.",
        ],
        &[
            "Plural forms",
            "Translate each CLDR plural category and branch separately.",
        ],
        &[
            "Workbook",
            "Return every row as plain text. Preserve reference columns, worksheet names and message identifiers.",
        ],
    ]);
    instructions.push(vec!["Direction".into(), kit.metadata["direction"].clone()]);
    add(
        "xl/worksheets/sheet1.xml",
        &worksheet(&[28, 96], &instructions, false),
    )?;
    let mut trans = vec![
        COLUMNS
            .iter()
            .map(|(_, h)| h.to_string())
            .collect::<Vec<_>>(),
    ];
    for unit in &kit.units {
        let id = string(&unit["unitId"])?;
        trans.push(
            COLUMNS
                .iter()
                .map(|(field, _)| {
                    if *field == "translation" {
                        initial.and_then(|m| m.get(id)).cloned().unwrap_or_default()
                    } else {
                        unit[*field].as_str().unwrap_or("").to_string()
                    }
                })
                .collect(),
        );
    }
    add(
        "xl/worksheets/sheet2.xml",
        &worksheet(
            &[16, 42, 18, 52, 15, 38, 34, 56, 56, 26, 28, 35, 42],
            &trans,
            true,
        ),
    )?;
    let glossary = rows(&[
        &["Term", "Treatment", "Meaning"],
        &["Patina", "Do not translate", "Product name"],
        &["GitHub", "Do not translate", "Service name"],
        &["WebDAV", "Do not translate", "Protocol"],
        &["CSV", "Do not translate", "File format"],
        &["SQLite", "Do not translate", "Database"],
        &["Parquet", "Do not translate", "File format"],
        &["Markdown", "Do not translate", "File format"],
        &["HEX / RGB / HSL", "Do not translate", "Color notation"],
        &["Token", "Use product context", "Connection secret"],
        &[
            "Tracking",
            "Translate consistently",
            "Recording desktop activity",
        ],
        &[
            "Session",
            "Translate consistently",
            "A continuous activity interval",
        ],
        &[
            "Timeline",
            "Translate consistently",
            "Chronological activity display",
        ],
        &[
            "Mini window",
            "Translate consistently",
            "Compact Patina window",
        ],
    ]);
    add(
        "xl/worksheets/sheet3.xml",
        &worksheet(&[24, 26, 72], &glossary, false),
    )?;
    let mut manifest = rows(&[&["key", "value"]]);
    manifest.extend(kit.metadata.iter().map(|(k, v)| vec![k.clone(), v.clone()]));
    add(
        "xl/worksheets/sheet4.xml",
        &worksheet(&[28, 48], &manifest, false),
    )?;
    zip.finish()?;
    file.persist(path)?;
    Ok(())
}

fn permitted(name: &str) -> bool {
    matches!(
        name,
        "[content_types].xml"
            | "_rels/"
            | "_rels/.rels"
            | "docprops/"
            | "docprops/app.xml"
            | "docprops/core.xml"
            | "xl/"
            | "xl/_rels/"
            | "xl/_rels/workbook.xml.rels"
            | "xl/sharedstrings.xml"
            | "xl/styles.xml"
            | "xl/theme/"
            | "xl/theme/theme1.xml"
            | "xl/workbook.xml"
            | "xl/worksheets/"
            | "xl/worksheets/sheet1.xml"
            | "xl/worksheets/sheet2.xml"
            | "xl/worksheets/sheet3.xml"
            | "xl/worksheets/sheet4.xml"
    )
}
fn parse(xml: &str) -> Result<Document<'_>> {
    Ok(Document::parse_with_options(
        xml,
        ParsingOptions {
            allow_dtd: false,
            nodes_limit: 100_000,
            ..Default::default()
        },
    )?)
}
fn attr<'a, 'input>(n: Node<'a, 'input>, name: &str) -> Result<&'a str> {
    n.attribute(name)
        .ok_or_else(|| format!("missing {}.{name}", n.tag_name().name()).into())
}
fn inspect(name: &str, xml: &str) -> Result<()> {
    let doc = parse(xml)?;
    for n in doc.descendants().filter(Node::is_element) {
        if n.attributes().len() > 64 {
            return Err("too many XML attributes".into());
        }
        let tag = n.tag_name().name();
        if name.ends_with(".rels") && tag == "Relationship" {
            let mode = n.attribute("TargetMode").unwrap_or("Internal");
            let target = attr(n, "Target")?;
            let rel = attr(n, "Type")?.rsplit('/').next().unwrap_or("");
            if !mode.eq_ignore_ascii_case("internal")
                || target.contains(':')
                || target.contains('\\')
                || target.starts_with("//")
                || target.split('/').any(|seg| seg == "..")
                || !matches!(
                    rel,
                    "core-properties"
                        | "extended-properties"
                        | "officeDocument"
                        | "sharedStrings"
                        | "styles"
                        | "theme"
                        | "worksheet"
                )
            {
                return Err("external or unsupported workbook relationship".into());
            }
        }
        if name == "xl/workbook.xml" && tag == "definedNames" {
            return Err("defined names are not supported".into());
        }
        if name == "[content_types].xml" && matches!(tag, "Override" | "Default") {
            let ty = attr(n, "ContentType")?;
            if !matches!(
                ty,
                "application/xml"
                    | "application/vnd.openxmlformats-package.relationships+xml"
                    | "application/vnd.openxmlformats-package.core-properties+xml"
                    | "application/vnd.openxmlformats-officedocument.extended-properties+xml"
                    | "application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"
                    | "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"
                    | "application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"
                    | "application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"
                    | "application/vnd.openxmlformats-officedocument.theme+xml"
                    | "application/vnd.openxmlformats-officedocument.vmlDrawing"
            ) {
                return Err(format!("unsupported content type {ty}").into());
            }
        }
    }
    Ok(())
}

fn unpack(path: &Path) -> Result<BTreeMap<String, String>> {
    let mut bytes = Vec::new();
    std::fs::File::open(path)?
        .take(MAX_INPUT + 1)
        .read_to_end(&mut bytes)?;
    if bytes.len() as u64 > MAX_INPUT {
        return Err("workbook exceeds input limit".into());
    }
    let tail = bytes.len().checked_sub(22).ok_or("invalid workbook ZIP")?;
    let end = &bytes[tail..];
    if &end[..4] != b"PK\x05\x06" || end[4..8] != [0; 4] || end[20..] != [0; 2] {
        return Err("unsupported ZIP layout".into());
    }
    let entries = u16::from_le_bytes(end[10..12].try_into()?);
    if entries > 5000 || end[8..10] != end[10..12] {
        return Err("too many ZIP parts".into());
    }
    let mut archive = ZipArchive::new(Cursor::new(&bytes))?;
    if archive.len() != usize::from(entries) || archive.has_overlapping_files()? {
        return Err("duplicate or overlapping ZIP parts".into());
    }
    let mut remaining = MAX_EXPANDED;
    let mut output = BTreeMap::new();
    let mut names = BTreeSet::new();
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i)?;
        let name = entry.name()?.to_ascii_lowercase();
        if !permitted(&name)
            || !names.insert(name.clone())
            || entry.encrypted()
            || entry.is_symlink()
            || !matches!(
                entry.compression(),
                CompressionMethod::Stored | CompressionMethod::Deflated
            )
        {
            return Err(format!("unsupported ZIP part {name}").into());
        }
        if entry.size() > remaining
            || entry.size() > entry.compressed_size().max(1).saturating_mul(200)
        {
            return Err("workbook expansion limit exceeded".into());
        }
        let mut value = Vec::new();
        (&mut entry).take(remaining + 1).read_to_end(&mut value)?;
        if value.len() as u64 != entry.size() || value.len() as u64 > remaining {
            return Err("declared and expanded sizes disagree".into());
        }
        remaining -= value.len() as u64;
        if entry.is_dir() {
            if !value.is_empty() {
                return Err("ZIP directory contains data".into());
            }
            continue;
        }
        let xml = String::from_utf8(value)?;
        inspect(&name, &xml)?;
        output.insert(name, xml);
    }
    Ok(output)
}

fn child<'a, 'b>(node: Node<'a, 'b>, tag: &str) -> Option<Node<'a, 'b>> {
    node.children().find(|n| n.has_tag_name((XMLNS, tag)))
}
fn plain(n: Node<'_, '_>) -> Result<String> {
    let mut parts = n.children().filter(Node::is_element);
    let first = parts.next();
    if parts.next().is_some() || first.is_some_and(|n| !n.has_tag_name((XMLNS, "t"))) {
        return Err("only plain text is supported in workbook cells".into());
    }
    Ok(first.and_then(|n| n.text()).unwrap_or("").to_owned())
}
type Table = BTreeMap<usize, BTreeMap<usize, String>>;
fn table(xml: &str, name: &str, shared: &[String]) -> Result<Table> {
    let doc = parse(xml)?;
    let mut table = Table::new();
    let mut formula_count = 0;
    let data = child(doc.root_element(), "sheetData").ok_or("missing worksheet data")?;
    for row in data.children().filter(Node::is_element) {
        let r: usize = attr(row, "r")?.parse()?;
        let mut cells = BTreeMap::new();
        for c in row.children().filter(Node::is_element) {
            if !c.has_tag_name((XMLNS, "c")) {
                return Err("unexpected worksheet row content".into());
            }
            let address = attr(c, "r")?;
            let n = address
                .find(|c: char| c.is_ascii_digit())
                .ok_or("invalid cell address")?;
            let (letters, number) = address.split_at(n);
            if letters.is_empty()
                || letters.len() > 3
                || !letters.bytes().all(|b| b.is_ascii_uppercase())
                || number.parse::<usize>()? != r
            {
                return Err("invalid cell address".into());
            }
            let col = letters
                .bytes()
                .fold(0usize, |s, b| s * 26 + usize::from(b - b'A' + 1));
            let raw = child(c, "v").and_then(|n| n.text()).unwrap_or("");
            let val = if let Some(f) = child(c, "f") {
                if name != "Translations"
                    || col != 1
                    || r < 2
                    || f.text() != Some(formula(r).as_str())
                    || f.attributes().len() != 0
                {
                    return Err(format!("unexpected formula in {name}!{address}").into());
                }
                formula_count += 1;
                String::new()
            } else {
                match c.attribute("t").unwrap_or("n") {
                    "s" => shared
                        .get(raw.parse::<usize>()?)
                        .ok_or("bad shared string index")?
                        .to_owned(),
                    "inlineStr" => plain(child(c, "is").ok_or("missing inline string")?)?,
                    "n" | "str" | "b" => raw.to_owned(),
                    _ => return Err(format!("unsupported type in {name}!{address}").into()),
                }
            };
            if cells
                .insert(col, if val == "\u{a0}" { String::new() } else { val })
                .is_some()
            {
                return Err("duplicate cell address".into());
            }
        }
        if !cells.is_empty() && table.insert(r, cells).is_some() {
            return Err("duplicate worksheet row".into());
        }
    }
    if doc
        .descendants()
        .filter(|n| n.is_element() && n.tag_name().name() == "f")
        .count()
        != formula_count
    {
        return Err("unrecognized formula".into());
    }
    Ok(table)
}

pub fn read(path: &Path, kit: &Kit) -> Result<BTreeMap<String, String>> {
    let parts = unpack(path)?;
    let part = |name: &str| -> Result<&str> {
        parts
            .get(name)
            .map(String::as_str)
            .ok_or_else(|| format!("missing XLSX part {name}").into())
    };
    let root_rels = parse(part("_rels/.rels")?)?;
    let roots: Vec<_> = root_rels
        .descendants()
        .filter(|n| {
            n.has_tag_name((REL, "Relationship"))
                && n.attribute("Type")
                    == Some(concat!(
                        "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
                        "/officeDocument"
                    ))
        })
        .collect();
    if roots.len() != 1
        || !matches!(
            roots[0].attribute("Target"),
            Some("xl/workbook.xml" | "/xl/workbook.xml")
        )
    {
        return Err("unresolved workbook root relationship".into());
    }
    part("[content_types].xml")?;
    let workbook = parse(part("xl/workbook.xml")?)?;
    let relations = parse(part("xl/_rels/workbook.xml.rels")?)?;
    let mut shared = Vec::new();
    if let Some(s) = parts.get("xl/sharedstrings.xml") {
        for item in parse(s)?.root_element().children().filter(Node::is_element) {
            shared.push(plain(item)?);
        }
    }
    let mut sheets = BTreeMap::new();
    let mut seen = BTreeSet::new();
    for sheet in workbook
        .descendants()
        .filter(|n| n.has_tag_name((XMLNS, "sheet")))
    {
        let name = attr(sheet, "name")?;
        let id = sheet
            .attribute((DOC_REL, "id"))
            .ok_or("missing sheet relationship")?;
        let mut matches = relations
            .descendants()
            .filter(|n| n.has_tag_name((REL, "Relationship")) && n.attribute("Id") == Some(id));
        let relation = matches.next().ok_or("unresolved sheet relationship")?;
        if matches.next().is_some() || attr(relation, "Type")? != format!("{DOC_REL}/worksheet") {
            return Err("ambiguous sheet relationship".into());
        }
        let target = attr(relation, "Target")?;
        let sheet_path = if target.starts_with('/') {
            target.trim_start_matches('/').to_owned()
        } else {
            format!("xl/{target}")
        }
        .to_ascii_lowercase();
        if !sheet_path.starts_with("xl/worksheets/")
            || !seen.insert(sheet_path.clone())
            || !SHEETS.contains(&name)
        {
            return Err("unexpected worksheet".into());
        }
        if sheets
            .insert(name, table(part(&sheet_path)?, name, &shared)?)
            .is_some()
        {
            return Err("duplicate sheet".into());
        }
    }
    if sheets.len() != 4 {
        return Err("missing translation workbook sheets".into());
    }
    let mut metadata = BTreeMap::new();
    for (r, cells) in &sheets["_Manifest"] {
        if *r == 1 {
            continue;
        }
        let key = cells.get(&1).ok_or("missing metadata key")?;
        if metadata
            .insert(
                key.clone(),
                cells.get(&2).ok_or("missing metadata value")?.clone(),
            )
            .is_some()
        {
            return Err("duplicate metadata".into());
        }
    }
    if metadata != kit.metadata {
        return Err(
            "workbook metadata differs from requested locale or current review fingerprints".into(),
        );
    }
    let tab = &sheets["Translations"];
    let headers = tab.get(&1).ok_or("missing translation headers")?;
    let mut columns = BTreeMap::new();
    for (field, header) in COLUMNS {
        let cols: Vec<_> = headers
            .iter()
            .filter(|(_, v)| v.as_str() == header)
            .map(|(i, _)| *i)
            .collect();
        if cols.len() != 1 {
            return Err(format!("invalid translation header {header}").into());
        }
        columns.insert(field, cols[0]);
    }
    let units: BTreeMap<_, _> = kit
        .units
        .iter()
        .map(|u| (u["unitId"].as_str().unwrap(), u))
        .collect();
    let mut translations = BTreeMap::new();
    for (r, cells) in tab {
        if *r == 1 {
            continue;
        }
        let get = |field: &str| cells.get(&columns[field]).map(String::as_str).unwrap_or("");
        let id = get("unitId");
        let unit = units
            .get(id)
            .ok_or_else(|| format!("unknown translation unit {id}"))?;
        for (field, _) in COLUMNS {
            if matches!(field, "translation" | "translatorNote" | "status") {
                continue;
            }
            if get(field) != unit[field].as_str().unwrap_or("") {
                return Err(format!("{id}: changed immutable column {field}").into());
            }
        }
        if translations
            .insert(id.to_owned(), get("translation").into())
            .is_some()
        {
            return Err(format!("duplicate unit {id}").into());
        }
    }
    if translations.len() != units.len() {
        return Err("translation row count differs".into());
    }
    Ok(translations)
}
