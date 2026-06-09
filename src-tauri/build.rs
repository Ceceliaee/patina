fn main() {
    println!("cargo:rerun-if-env-changed=TAURI_CONFIG");
    println!("cargo:rustc-check-cfg=cfg(patina_local_build)");
    if std::env::var("TAURI_CONFIG")
        .map(|config| config.contains("com.timetracker.local") || config.contains("Patina Local"))
        .unwrap_or(false)
    {
        println!("cargo:rustc-cfg=patina_local_build");
    }

    tauri_build::build()
}
