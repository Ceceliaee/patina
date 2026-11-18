#![windows_subsystem = "windows"]

fn main() {
    let code = patina_windows_integration::windows::native_probe::run_if_requested().unwrap_or(2);
    std::process::exit(code);
}
