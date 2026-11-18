use std::{error::Error, path::Path, process::Command};
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
    for target in ["x86_64-pc-windows-msvc", "aarch64-pc-windows-msvc"] {
        for app in ["patina", "patina-ui", "patina-probe"] {
            let output = Command::new(env!("CARGO"))
                .current_dir(root)
                .args([
                    "tree",
                    "--locked",
                    "-p",
                    app,
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
                    "cargo tree {app} {target}: {}",
                    String::from_utf8_lossy(&output.stderr)
                )
                .into());
            }
            let tree = std::str::from_utf8(&output.stdout)?;
            for name in tree
                .lines()
                .filter_map(|line| line.split_whitespace().next())
            {
                let gui = name == "quietpro" || name.starts_with("gpui");
                let storage = name.starts_with("sqlx")
                    || matches!(
                        name,
                        "patina-recorder" | "patina-storage" | "libsqlite3-sys"
                    );
                let engine = matches!(name, "patina-tool-host" | "wasmi" | "wasmtime" | "wasmer");
                if name.contains("tauri")
                    || (app != "patina-ui" && gui)
                    || (app != "patina" && (storage || engine))
                {
                    return Err(format!("{target}: {app} pulls in {name}").into());
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
