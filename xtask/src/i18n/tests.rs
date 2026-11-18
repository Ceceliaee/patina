use super::*;
use std::io::{Cursor, Read};
use zip::{ZipArchive, ZipWriter, write::SimpleFileOptions};

fn repository() -> &'static Path {
    Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap()
}

fn input_root() -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    let locales = dir.path().join("locales");
    fs::create_dir_all(locales.join("en-US")).unwrap();
    let schema = json!({
        "native.count": {"kind":"message","surface":"native","params":[{"name":"n","type":"integer","optional":false}],"pluralArg":"n"},
        "native.names": {"kind":"string-record","surface":"native","params":[]},
        "native.sentence":{"kind":"message","surface":"native","params":[{"name":"x","type":"string","optional":false},{"name":"y","type":"string","optional":false}]}
    });
    let n = json!({"$op":"arg","name":"n"});
    let messages = json!({
        "native.count":{"$type":"message","body":{"$op":"plural","arg":"n","cases":{"one":{"$op":"concat","parts":[n," minute"]},"other":{"$op":"concat","parts":[n," minutes"]}}}},
        "native.names":{"first":"Alpha","second":"Beta"},
        "native.sentence":{"$type":"message","body":{"$op":"concat","parts":[{"$op":"arg","name":"x"}," says ",{"$op":"arg","name":"y"}]}}
    });
    for (file, value) in [
        ("schema.json", schema),
        ("en-US/example.json", messages),
        (
            "en-US/metadata.json",
            json!({"label":"English","source":true,"order":0,"direction":"ltr","production":true,"reviews":{}}),
        ),
    ] {
        fs::write(locales.join(file), value.to_string()).unwrap();
    }
    dir
}

fn run_args(root: &Path, args: &[&str]) -> Result<()> {
    run(root, args.iter().map(|s| s.to_string()).collect())
}

fn filled(kit: &Kit) -> BTreeMap<String, String> {
    kit.units
        .iter()
        .map(|u| {
            (
                u["unitId"].as_str().unwrap().into(),
                u["sourceText"].as_str().unwrap().into(),
            )
        })
        .collect()
}

#[test]
fn cldr_and_placeholders_survive_a_workbook_round_trip() {
    let dir = input_root();
    let c = Catalog::load(dir.path()).unwrap();
    let file = dir.path().join("kit.xlsx");
    let build = || Kit::build(&c, "en-US", "ar", "العربية", "rtl").unwrap();
    let kit = build();
    let mut values = filled(&kit);
    assert_eq!(
        values
            .keys()
            .filter(|key| key.starts_with("native.count::"))
            .count(),
        6
    );
    values.insert("native.sentence::default".into(), "⟦y⟧ ← ⟦x⟧\nتمام".into());
    workbook::write(&file, &kit, Some(&values)).unwrap();
    let read = workbook::read(&file, &kit).unwrap();
    assert_eq!(read, values);
    let model = kit.materialize(&read).unwrap();
    c.validate_messages("ar", &model).unwrap();
    assert_eq!(model["native.sentence"]["body"]["parts"][0]["name"], "y");
    assert_eq!(
        model["native.names"],
        c.langs["en-US"].messages["native.names"]
    );
    for invalid in ["⟦x⟧", "⟦x⟧ ⟦x⟧", "⟦x⟧ ⟦y⟧ ⟦missing⟧", "⟦x⟧ ⟦y⟧ ⟦", " "]
    {
        values.insert("native.sentence::default".into(), invalid.into());
        assert!(build().materialize(&values).is_err(), "{invalid}");
    }
}

fn rewrite_part(file: &Path, name: &str, edit: impl FnOnce(&mut String)) {
    let mut archive = ZipArchive::new(Cursor::new(fs::read(file).unwrap())).unwrap();
    let mut out = ZipWriter::new(Cursor::new(Vec::new()));
    let mut edit = Some(edit);
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).unwrap();
        let part = entry.name().unwrap().into_owned();
        let mut contents = String::new();
        entry.read_to_string(&mut contents).unwrap();
        if part == name {
            edit.take().unwrap()(&mut contents);
        }
        out.start_file(
            part,
            SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated),
        )
        .unwrap();
        out.write_all(contents.as_bytes()).unwrap();
    }
    assert!(edit.is_none());
    fs::write(file, out.finish().unwrap().into_inner()).unwrap();
}

#[test]
fn workbook_rejects_invalid_rows_active_content_and_stale_sources() {
    let dir = input_root();
    let c = Catalog::load(dir.path()).unwrap();
    let kit = Kit::build(&c, "en-US", "fr", "Français", "ltr").unwrap();
    let original = dir.path().join("original.xlsx");
    let file = dir.path().join("copy.xlsx");
    workbook::write(&original, &kit, Some(&filled(&kit))).unwrap();
    let translations = "xl/worksheets/sheet2.xml";
    let cases: [(&str, &str, &str); 8] = [
        (translations, "Alpha", "Changed"),
        (
            translations,
            "<is><t xml:space=\"preserve\">Alpha</t></is>",
            "<is><r><t>Alpha</t></r></is>",
        ),
        (
            translations,
            "<c r=\"I2\"",
            "<c r=\"I2\"><f>1+1</f></c><c r=\"N2\"",
        ),
        (
            translations,
            "</sheetData>",
            "<row r=\"100\"><c r=\"B100\" t=\"str\"><v>extra</v></c></row></sheetData>",
        ),
        (
            "xl/_rels/workbook.xml.rels",
            "Target=\"styles.xml\"",
            "Target=\"styles.xml\" TargetMode=\"External\"",
        ),
        (
            "xl/workbook.xml",
            "</sheets>",
            "</sheets><x:definedNames xmlns:x=\"urn:test\"/>",
        ),
        ("xl/worksheets/sheet4.xml", "Français", "Other"),
        (
            "xl/worksheets/sheet4.xml",
            &kit.metadata["sourceFingerprint"],
            "stale",
        ),
    ];
    for (name, from, to) in cases {
        fs::copy(&original, &file).unwrap();
        rewrite_part(&file, name, |s| {
            assert!(s.contains(from));
            *s = s.replacen(from, to, 1);
        });
        assert!(
            workbook::read(&file, &kit).is_err(),
            "accepted changed {from}"
        );
    }
    fs::copy(&original, &file).unwrap();
    rewrite_part(&file, translations, |s| {
        let start = s.find("<row r=\"2\">").unwrap();
        let end = start + s[start..].find("</row>").unwrap() + 6;
        s.replace_range(start..end, "");
    });
    assert!(workbook::read(&file, &kit).is_err());
    fs::copy(&original, &file).unwrap();
    rewrite_part(&file, "xl/styles.xml", |s| {
        s.push_str(&" ".repeat(1_000_000))
    });
    assert!(workbook::read(&file, &kit).is_err());
    let mut bytes = fs::read(&original).unwrap();
    let directory = bytes.windows(4).position(|b| b == b"PK\x01\x02").unwrap();
    bytes[directory + 24..directory + 28].copy_from_slice(&1_u32.to_le_bytes());
    fs::write(&file, bytes).unwrap();
    assert!(workbook::read(&file, &kit).is_err());
}

#[test]
fn registration_is_atomic_and_reviews_expire_after_source_changes() {
    let root = input_root();
    let dir = root.path();
    let catalog = Catalog::load(dir).unwrap();
    let kit = Kit::build(&catalog, "en-US", "fr", "Français", "ltr").unwrap();
    let path = dir.join("filled.xlsx");
    workbook::write(&path, &kit, Some(&filled(&kit))).unwrap();
    let input = path.to_str().unwrap();
    let args = [
        "import-kit",
        input,
        "--target",
        "fr",
        "--label",
        "Français",
        "--direction",
        "ltr",
        "--from",
        "en-US",
        "--apply",
    ];
    let mut wrong = args;
    wrong[3] = "de";
    assert!(run_args(dir, &wrong).is_err());
    assert!(!dir.join("locales/de").exists());
    run_args(dir, &args).unwrap();
    assert!(run_args(dir, &args).is_err());
    let c = Catalog::load(dir).unwrap();
    assert_eq!(c.langs["fr"].meta["reviews"]["native.count"], "PENDING");
    assert!(c.validate().is_err());
    run_args(dir, &["review", "fr", "--all"]).unwrap();
    Catalog::load(dir).unwrap().validate().unwrap();
    let target = dir.join("locales/en-US/example.json");
    let mut source = catalog::json(&target).unwrap();
    source["native.names"]["first"] = "Revised".into();
    fs::write(target, source.to_string()).unwrap();
    assert!(Catalog::load(dir).unwrap().validate().is_err());
    run_args(dir, &["review", "fr", "--key", "native.names"]).unwrap();
    Catalog::load(dir).unwrap().validate().unwrap();
    let bundles = BTreeMap::from([
        ("a.json".into(), vec!["native.count".into()]),
        ("b.json".into(), vec!["missing".into()]),
    ]);
    assert!(
        write_locale(
            &dir.join("locales/de"),
            &bundles,
            &c.langs["fr"].messages,
            &c.langs["fr"].meta
        )
        .is_err()
    );
    assert_eq!(fs::read_dir(dir.join("locales")).unwrap().count(), 3);
    run_args(dir, &["new", "de", "Deutsch", "--dry-run"]).unwrap();
    assert!(!dir.join("locales/de").exists());
}

#[test]
fn catalog_rejects_invalid_json_keys_structures_and_argument_types() {
    assert!(catalog::canonical("iw").is_err());
    assert!(catalog::canonical("en-us").is_err());
    let root = input_root();
    let c = Catalog::load(root.path()).unwrap();
    let key = "native.sentence";
    let mut v = c.langs["en-US"].messages.clone();
    for body in [
        json!({"$op":"arg","name":"missing"}),
        json!({"$op":"join","target":[],"separator":2}),
        json!({"$op":"if","when":"truthy","then":"x","else":"y"}),
        json!({"$op":"concat","parts":false}),
        json!({"$op":"eq","left":"a","right":"b","extra":1}),
        json!({"$op":"element","target":"scalar","index":0}),
        json!({"$op":"monthName","year":1e20,"zeroBasedMonth":0}),
        json!({"$op":"monthName","year":2026,"zeroBasedMonth":12}),
        json!({"$op":"monthName","year":"2026","zeroBasedMonth":0}),
        json!({"$op":"monthName","year":2026,"zeroBasedMonth":0,"style":"wide"}),
        json!({"$op":"subtract","left":"1","right":1}),
        json!({"$op":"coalesce","left":"x"}),
        json!({"$op":"notEq","left":1}),
    ] {
        v[key]["body"] = body;
        assert!(c.validate_messages("en-US", &v).is_err());
    }
    assert!(
        c.validate_messages("ar", &c.langs["en-US"].messages)
            .is_err()
    );
    let mut missing = c.langs["en-US"].messages.clone();
    missing.shift_remove(key);
    assert!(c.validate_messages("en-US", &missing).is_err());
    missing.insert("unexpected".into(), "".into());
    assert!(c.validate_messages("en-US", &missing).is_err());
    let path = root.path().join("invalid.json");
    for invalid in [
        r#"{"k":1,"k":2}"#,
        "{...source}",
        r#"{"key": () => "value"}"#,
    ] {
        fs::write(&path, invalid).unwrap();
        assert!(catalog::json(&path).is_err());
    }
    let production = Catalog::load(repository()).unwrap();
    let mut bad = production.langs[&production.source].messages.clone();
    bad.insert("settings.webActivityHelpSteps".into(), json!([null]));
    assert!(
        production
            .validate_messages(&production.source, &bad)
            .is_err()
    );
}
