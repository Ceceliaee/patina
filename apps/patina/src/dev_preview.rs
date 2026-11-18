use crate::Action;
use std::{env, io, io::Read, path::PathBuf, thread};

fn session() -> Option<PathBuf> {
    env::var_os("PATINA_GPUI_DEV_SESSION").map(PathBuf::from)
}

pub(super) fn exit_with_launcher(sender: &async_channel::Sender<Action>) -> io::Result<()> {
    if session().is_some() {
        let sender = sender.clone();
        thread::Builder::new()
            .name("dev-launcher".into())
            .spawn(move || {
                let _ = io::stdin().read(&mut [0]);
                let _ = sender.try_send(Action::Exit);
            })?;
    }
    Ok(())
}
