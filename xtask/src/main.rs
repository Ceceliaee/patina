mod audit;
mod check;
mod ci;
#[cfg(windows)]
mod dev;
mod docs;
mod i18n;
mod release;

use std::{env, error::Error, path::Path};

fn main() -> Result<(), Box<dyn Error>> {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap();
    let mut args = env::args().skip(1);
    match args.next().as_deref() {
        #[cfg(windows)]
        None | Some("dev") => dev::run(root, args.collect())?,
        #[cfg(windows)]
        Some(action @ ("--today" | "--mini")) => {
            dev::run(
                root,
                std::iter::once(action.to_owned()).chain(args).collect(),
            )?;
        }
        Some("check") => check::run(root, &args.collect::<Vec<_>>())?,
        Some("ci") => ci::run(root, &args.collect::<Vec<_>>())?,
        Some("i18n") => i18n::run(root, args.collect())?,
        Some("release") => release::run(root, &args.collect::<Vec<_>>())?,
        Some("docs") => {
            let args = args.collect::<Vec<_>>();
            match args
                .iter()
                .map(String::as_str)
                .collect::<Vec<_>>()
                .as_slice()
            {
                ["check"] => docs::run(root, false)?,
                ["check", "--archives"] => docs::run(root, true)?,
                _ => return Err("Usage: cargo xtask docs check [--archives]".into()),
            }
        }
        Some("audit") => {
            let offline = match args.collect::<Vec<_>>().as_slice() {
                [] => false,
                [flag] if flag == "--offline" => true,
                _ => return Err("Usage: cargo xtask audit [--offline]".into()),
            };
            audit::run(root, offline)?;
        }
        Some("--help" | "-h" | "help") => println!(
            "cargo xtask dev [--today|--mini] (Windows)\ncargo xtask check [tools|native]\ncargo xtask docs check [--archives]\ncargo xtask i18n --help\ncargo xtask ci intake|candidate\ncargo xtask audit [--offline]\ncargo xtask release --help"
        ),
        _ => return Err("Unknown task. Run cargo xtask --help.".into()),
    }
    Ok(())
}
