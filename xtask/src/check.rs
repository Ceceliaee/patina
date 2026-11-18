use serde::Deserialize;
use std::{
    error::Error,
    path::{Path, PathBuf},
    process::Command,
};
type Result<T> = std::result::Result<T, Box<dyn Error>>;

fn cargo(root: &Path, args: &[&str]) -> Result<()> {
    let status = Command::new(env!("CARGO"))
        .current_dir(root)
        .args(args)
        .status()?;
    if !status.success() {
        return Err(format!("cargo {} failed ({status})", args.join(" ")).into());
    }
    Ok(())
}

pub fn run(root: &Path, args: &[String]) -> Result<()> {
    match args {
        [] => {
            tools(root)?;
            native(root)?;
            super::audit::run(root, false)
        }
        [scope] if scope == "tools" => tools(root),
        [scope] if scope == "native" => native(root),
        _ => Err("Usage: cargo xtask check [tools|native]".into()),
    }
}

fn tools(root: &Path) -> Result<()> {
    desktop_dependencies(root)?;
    super::docs::run(root, false)?;
    super::i18n::run(root, vec!["check".into()])?;
    cargo(root, &["test", "--locked", "-p", "xtask"])?;
    cargo(
        root,
        &[
            "clippy",
            "--locked",
            "-p",
            "xtask",
            "--all-targets",
            "--",
            "-D",
            "warnings",
        ],
    )?;
    cargo(
        &root.join("examples/remote-status-bridge-worker"),
        &["test", "--locked"],
    )?;
    for project in [
        "examples/remote-status-bridge-worker",
        "plugins/official",
        "plugins/counter",
    ] {
        let project = root.join(project);
        cargo(&project, &["fmt", "--all", "--", "--check"])?;
        cargo(
            &project,
            &[
                "build",
                "--locked",
                "--workspace",
                "--target",
                "wasm32-unknown-unknown",
                "--release",
            ],
        )?;
    }
    Ok(())
}

fn native(root: &Path) -> Result<()> {
    cargo(root, &["fmt", "--all", "--", "--check"])?;
    cargo(root, &["test-headless", "--locked"])?;
    cargo(
        root,
        &[
            "clippy",
            "--locked",
            "--workspace",
            "--all-targets",
            "--all-features",
            "--",
            "-D",
            "warnings",
        ],
    )
}

fn desktop_dependencies(root: &Path) -> Result<()> {
    let metadata = Command::new(env!("CARGO"))
        .current_dir(root)
        .args(["metadata", "--locked", "--no-deps", "--format-version", "1"])
        .output()?;
    if !metadata.status.success() {
        return Err(String::from_utf8_lossy(&metadata.stderr)
            .into_owned()
            .into());
    }
    check_desktop_binaries(&metadata.stdout)?;
    for target in ["x86_64-pc-windows-msvc", "aarch64-pc-windows-msvc"] {
        for package in [
            "patina",
            "patina-ui",
            "patina-recorder",
            "patina-windows-integration",
        ] {
            let output = Command::new(env!("CARGO"))
                .current_dir(root)
                .args([
                    "tree",
                    "--locked",
                    "-p",
                    package,
                    "--target",
                    target,
                    "-e",
                    "normal,build",
                    "--prefix",
                    "none",
                    "--format",
                    "{p}",
                ])
                .output()?;
            if !output.status.success() {
                return Err(format!(
                    "cargo tree {package} {target}: {}",
                    String::from_utf8_lossy(&output.stderr)
                )
                .into());
            }
            let tree = std::str::from_utf8(&output.stdout)?;
            for name in tree
                .lines()
                .filter_map(|line| line.split_whitespace().next())
            {
                if forbidden_dependency(package, name) {
                    return Err(format!("{target}: {package} pulls in {name}").into());
                }
            }
        }
    }
    for lock in super::audit::LOCKS
        .iter()
        .copied()
        .chain(["vendor/accesskit_windows/Cargo.lock"])
    {
        let manifest: toml::Value = toml::from_str(&std::fs::read_to_string(root.join(lock))?)?;
        for package in manifest["package"].as_array().ok_or("invalid Cargo.lock")? {
            let name = package["name"].as_str().ok_or("missing package name")?;
            if name.contains("tauri") {
                return Err(format!("{lock} resolves {name}").into());
            }
        }
    }
    Ok(())
}

fn forbidden_dependency(package: &str, name: &str) -> bool {
    let gui = matches!(name, "patina-ui" | "quietpro") || name.starts_with("gpui");
    let storage = name.starts_with("sqlx")
        || matches!(
            name,
            "patina-recorder" | "patina-storage" | "libsqlite3-sys"
        );
    let engine = matches!(name, "patina-tool-host" | "wasmi" | "wasmtime" | "wasmer");
    name.contains("tauri")
        || match package {
            "patina-ui" => storage || engine,
            "patina-recorder" => gui,
            "patina-windows-integration" => gui || storage || engine,
            _ => false,
        }
}

fn check_desktop_binaries(metadata: &[u8]) -> Result<()> {
    #[derive(Deserialize)]
    struct Workspace {
        workspace_root: PathBuf,
        packages: Vec<Package>,
    }
    #[derive(Deserialize)]
    struct Package {
        name: String,
        manifest_path: PathBuf,
        targets: Vec<Target>,
    }
    #[derive(Deserialize)]
    struct Target {
        name: String,
        kind: Vec<String>,
    }
    let workspace: Workspace = serde_json::from_slice(metadata)?;
    let apps = workspace.workspace_root.join("apps");
    let mut binaries = Vec::new();
    for package in &workspace.packages {
        if package.manifest_path.starts_with(&apps) {
            for target in &package.targets {
                if target.kind.iter().any(|kind| kind == "bin") {
                    binaries.push((package.name.as_str(), target.name.as_str()));
                }
            }
        }
    }
    if binaries != [("patina", "patina")] {
        return Err(format!("Expected the patina desktop binary, found {binaries:?}").into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn desktop_inventory_counts_binary_targets_and_excludes_examples_and_tools() {
        let mut workspace = serde_json::json!({"workspace_root": "/repo", "packages": [
            {"name":"patina","manifest_path":"/repo/apps/patina/Cargo.toml","targets":[
                {"name":"patina","kind":["lib"]}, {"name":"patina","kind":["bin"]},
                {"name":"windows-resource-sample","kind":["example"]}]},
            {"name":"patina-ui","manifest_path":"/repo/apps/patina-ui/Cargo.toml","targets":[
                {"name":"patina_ui","kind":["lib"]}]},
            {"name":"xtask","manifest_path":"/repo/xtask/Cargo.toml","targets":[
                {"name":"xtask","kind":["bin"]}]}
        ]});
        assert!(check_desktop_binaries(&serde_json::to_vec(&workspace).unwrap()).is_ok());
        workspace["packages"][1]["targets"][0]["kind"] = serde_json::json!(["bin"]);
        assert!(check_desktop_binaries(&serde_json::to_vec(&workspace).unwrap()).is_err());
    }

    #[test]
    fn role_libraries_keep_their_dependency_boundaries() {
        assert!(!forbidden_dependency("patina", "gpui-kit"));
        assert!(!forbidden_dependency("patina-ui", "gpui-kit"));
        assert!(!forbidden_dependency("patina-recorder", "sqlx-core"));
        for name in ["sqlx-core", "patina-recorder", "wasmtime"] {
            assert!(forbidden_dependency("patina-ui", name));
            assert!(forbidden_dependency("patina-windows-integration", name));
        }
        for name in ["patina-ui", "gpui-kit"] {
            assert!(forbidden_dependency("patina-windows-integration", name));
            assert!(forbidden_dependency("patina-recorder", name));
        }
        assert!(forbidden_dependency("patina", "tauri-runtime"));
    }
}
