use std::env;

pub fn main() {
    let rc = "../../packaging/windows/executable.rc";
    let icons = "assets/icons";
    let fonts = "../../crates/quietpro/assets/fonts";
    println!("cargo:rerun-if-changed=../../packaging/windows/executable.rs");
    println!("cargo:rerun-if-changed={rc}");
    println!("cargo:rerun-if-changed={icons}/icon.ico");
    println!("cargo:rerun-if-changed={fonts}/Font-Licenses.txt");
    if env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("windows") {
        return;
    }
    let version = env::var("CARGO_PKG_VERSION").unwrap();
    let definitions = [
        format!("MAJOR={}", env::var("CARGO_PKG_VERSION_MAJOR").unwrap()),
        format!("MINOR={}", env::var("CARGO_PKG_VERSION_MINOR").unwrap()),
        format!("PATCH={}", env::var("CARGO_PKG_VERSION_PATCH").unwrap()),
        format!("VERSION_TEXT={version}"),
    ];
    embed_resource::compile_for(
        rc,
        ["patina"],
        embed_resource::ParamsMacrosAndIncludeDirs(definitions, [icons, fonts]),
    )
    .manifest_required()
    .expect("embed the Patina executable icon and version information");
}
