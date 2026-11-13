use std::{env, path::PathBuf, process::Command};

fn main() {
    let desktop = PathBuf::from(env::var_os("CARGO_MANIFEST_DIR").unwrap()).join("..");
    let manifest = desktop.join("plugins/official/Cargo.toml");
    println!("cargo:rerun-if-changed=../plugins/official");
    println!("cargo:rerun-if-changed=../plugin-sdk");
    let out = PathBuf::from(env::var_os("OUT_DIR").unwrap());
    let status = Command::new(env::var_os("CARGO").unwrap())
        .arg("build")
        .arg("--locked")
        .arg("--workspace")
        .args([
            "--release",
            "--target",
            "wasm32-unknown-unknown",
            "--manifest-path",
        ])
        .arg(manifest)
        .arg("--target-dir")
        .arg(out.join("guests"))
        .env_remove("CARGO_ENCODED_RUSTFLAGS")
        .env_remove("RUSTFLAGS")
        .status()
        .expect("start Rust plugin build");
    assert!(
        status.success(),
        "Could not build bundled Rust tools. Install the desktop toolchain's wasm32-unknown-unknown target."
    );
}
