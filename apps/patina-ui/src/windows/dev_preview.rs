use crate::windows::main::Section;
use std::{env, fs, path::PathBuf};

fn session() -> Option<PathBuf> {
    env::var_os("PATINA_GPUI_DEV_SESSION").map(PathBuf::from)
}

pub(crate) fn page() -> Option<Section> {
    serde_json::from_slice(&fs::read(session()?.join("page.json")).ok()?).ok()
}

pub(crate) fn remember(page: Section) {
    if let Some(dir) = session()
        && let Err(error) = fs::write(dir.join("page.json"), serde_json::to_vec(&page).unwrap())
    {
        eprintln!("remember preview page: {error}");
    }
}
