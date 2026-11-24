use super::*;
fn fixture(wat_source: &str) -> Package {
    Package {
        manifest: Manifest {
            presentation: None,
            id: "example.limits".into(),
            name: "Limits".into(),
            version: "1".into(),
            api: 1,
            entry: "panel".into(),
            capabilities: vec![Capability::Panel],
        },
        wasm: wat::parse_str(wat_source).unwrap(),
        locales: Default::default(),
        publisher: String::new(),
        signature: String::new(),
    }
}

#[test]
fn computation_is_interrupted_before_returning_a_panel() {
    let p=fixture("(module (func (export \"panel\") (result i32) (local i32)
        (loop local.get 0 i32.const 1 i32.add local.tee 0 i32.const 10000000 i32.lt_u br_if 0) i32.const 0))");
    let mut guest = compile(&p).unwrap();
    let error = guest.call::<_, &[u8]>("panel", &[][..]).unwrap_err();
    let message = format!("{error:#}").to_lowercase();
    assert!(
        message.contains("fuel") || message.contains("interrupt") || message.contains("timeout"),
        "{message}"
    );
}

#[test]
fn guest_has_no_application_database_import() {
    let p = fixture(
        "(module (import \"patina\" \"database\" (func)) (func (export \"panel\") (result i32) i32.const 0))",
    );
    assert!(compile(&p).is_err());
}

#[test]
#[ignore = "paired timing of the two compiled bundled guests"]
fn cold_compilation_and_repeated_panel_calls() {
    use std::time::Instant;
    let guests = PathBuf::from(
        std::env::var_os("PATINA_MEASURE_GUEST_DIR").expect("compiled guest directory"),
    );
    for (guest, manifest) in [
        (
            "patina_reminders.wasm",
            include_str!("../../../plugins/bundled/reminders/manifest.json"),
        ),
        (
            "patina_focus.wasm",
            include_str!("../../../plugins/bundled/focus/manifest.json"),
        ),
    ] {
        let package = Package {
            manifest: serde_json::from_str(manifest).unwrap(),
            wasm: fs::read(guests.join(guest)).unwrap(),
            locales: Default::default(),
            publisher: String::new(),
            signature: String::new(),
        };
        let mut expected = None;
        for single_pass in [false, true, true, false] {
            let started = Instant::now();
            let wasm = if single_pass {
                let manifest =
                    extism::Manifest::new([Wasm::data(package.validated_wasm().unwrap())])
                        .with_memory_max(256)
                        .with_timeout(Duration::from_millis(250));
                let mut config = wasmtime::Config::new();
                config.cranelift_opt_level(wasmtime::OptLevel::None);
                config.cranelift_regalloc_algorithm(wasmtime::RegallocAlgorithm::SinglePass);
                PluginBuilder::new(manifest)
                    .with_wasmtime_config(config)
                    .with_cache_disabled()
                    .with_wasi(false)
                    .with_fuel_limit(5_000_000)
                    .build()
                    .unwrap()
            } else {
                compile(&package).unwrap()
            };
            let mut plugin = LoadedPlugin {
                wasm,
                locales: package.locales.clone(),
            };
            let compile_ms = started.elapsed().as_secs_f64() * 1000.;
            let mut micros = Vec::new();
            for _ in 0..128 {
                let started = Instant::now();
                let panel = invoke(
                    &mut plugin,
                    &package.manifest,
                    Value::Null,
                    Event::Open,
                    "en-US",
                    1000,
                    None,
                )
                .unwrap();
                micros.push(started.elapsed().as_micros());
                let panel = serde_json::to_vec(&panel).unwrap();
                assert_eq!(&panel, expected.get_or_insert_with(|| panel.clone()));
            }
            micros.sort_unstable();
            eprintln!(
                "{guest} singlePass={single_pass} compile={compile_ms:.1}ms panel us med={} p95={} max={}",
                micros[63], micros[121], micros[127]
            );
        }
    }
}
