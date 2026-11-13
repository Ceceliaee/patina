#![windows_subsystem = "windows"]

fn main() -> Result<(), Box<dyn std::error::Error>> {
    if let Some(result) = patina_gpui::run_window_process_if_requested() {
        return result;
    }
    if let Some(code) = patina_recorder::run_probe_if_requested() {
        std::process::exit(code);
    }
    let (send, actions) = async_channel::unbounded();
    for arg in std::env::args_os().skip(1) {
        let action = if arg == "--today" {
            patina_gpui::Action::Today
        } else if arg == "--mini" {
            patina_gpui::Action::Mini { focus: true }
        } else {
            return Err("Usage: patina-gpui [--mini] [--today]".into());
        };
        send.try_send(action)?;
    }
    patina_gpui::run(send, actions)
}
