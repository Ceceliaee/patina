mod candidate;
mod intake;

use std::{error::Error, path::Path};
type Result<T> = std::result::Result<T, Box<dyn Error>>;

pub fn run(root: &Path, args: &[String]) -> Result<()> {
    match args.split_first() {
        Some((action, rest)) if action == "candidate" && rest.is_empty() => candidate::run(root),
        Some((action, rest)) if action == "intake" => intake::run(root, rest),
        _ => Err("Usage: cargo xtask ci candidate | intake [options]".into()),
    }
}
