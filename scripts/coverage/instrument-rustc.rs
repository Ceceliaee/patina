use std::process::{Command, Stdio};

fn main() {
    let args: Vec<_> = std::env::args_os().skip(1).collect();
    let Some(compiler) = args.first() else { std::process::exit(2) };
    let is_product = args.windows(2).any(|pair| {
        pair[0] == "--crate-name" && (pair[1] == "patina_lib" || pair[1] == "patina")
    });
    let mut command = Command::new(compiler);
    command.args(&args[1..]);
    if is_product {
        command.args(["-C", "instrument-coverage", "--cfg", "patina_coverage"]);
    }
    let status = command.stdin(Stdio::inherit()).stdout(Stdio::inherit())
        .stderr(Stdio::inherit()).status().expect("launch real rustc");
    std::process::exit(status.code().unwrap_or(1));
}
