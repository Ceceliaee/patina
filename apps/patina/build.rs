use std::{env, path::PathBuf};
#[path = "../../packaging/windows/executable.rs"]
mod executable;

fn main() {
    executable::main();
    if env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc") {
        println!("cargo:rustc-link-arg-bin=patina=delayimp.lib");
        for dll in [
            "d3d11.dll",
            "d3dcompiler_47.dll",
            "dcomp.dll",
            "dwrite.dll",
            "dwmapi.dll",
            "dxgi.dll",
            "icuuc.dll",
            "uiautomationcore.dll",
            "winmm.dll",
        ] {
            println!("cargo:rustc-link-arg-bin=patina=/DELAYLOAD:{dll}");
        }
    }
    let desktop = PathBuf::from(env::var_os("CARGO_MANIFEST_DIR").unwrap()).join("../..");
    println!("cargo:rerun-if-changed=../../plugins/bundled");

    let out = PathBuf::from(env::var_os("OUT_DIR").unwrap());
    for plugin in ["focus", "reminders"] {
        let dir = desktop.join("plugins/bundled").join(plugin).join("locales");
        let mut entries = Vec::new();
        for entry in std::fs::read_dir(dir).expect("plugin locales") {
            let path = entry.expect("locale file").path();
            let tag = path
                .file_stem()
                .and_then(|s| s.to_str())
                .expect("locale tag");
            assert_eq!(path.extension().unwrap(), "json");
            entries.push(format!("({tag:?}, include_str!({path:?}))"));
        }
        entries.sort();
        std::fs::write(
            out.join(format!("{plugin}-locales.rs")),
            format!("&[{}]", entries.join(",")),
        )
        .unwrap();
    }
}
