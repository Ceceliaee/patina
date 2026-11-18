#![windows_subsystem = "windows"]

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let (send, actions) = async_channel::unbounded();
    let mut args = std::env::args_os().skip(1);
    let mut parent = None;
    let mut autostart = false;
    while let Some(arg) = args.next() {
        if arg == "--autostart" {
            autostart = true;
            continue;
        }
        if arg == "--profile-parent" {
            parent = Some(args.next().ok_or("missing profile parent")?.into());
            continue;
        }
        let action = if arg == "--today" {
            patina::Action::Today
        } else if arg == "--mini" {
            patina::Action::Mini { focus: true }
        } else {
            return Err("Usage: patina [--mini] [--today]".into());
        };
        send.try_send(action)?;
    }
    patina::launch(send, actions, parent, true, autostart)
}
