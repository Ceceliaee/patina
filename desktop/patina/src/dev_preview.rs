use crate::{Action, main_window::Section};
use std::{env, fs, io, io::Read, path::PathBuf, thread};

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

pub(super) fn page() -> Option<Section> {
    serde_json::from_slice(&fs::read(session()?.join("page.json")).ok()?).ok()
}

pub(super) fn remember(page: Section) {
    if let Some(dir) = session()
        && let Err(error) = fs::write(dir.join("page.json"), serde_json::to_vec(&page).unwrap())
    {
        eprintln!("remember preview page: {error}");
    }
}
