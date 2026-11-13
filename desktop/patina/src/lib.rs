mod app_windows;
mod bundled_tools;
mod data_page;
#[cfg(debug_assertions)]
mod dev_preview;
mod dock;
mod format;
mod history;
mod main_window;
mod mini;
mod page_controls;
mod today;
mod tool_events;
mod tool_notice;
mod tool_service;
mod tools;
mod tray;
mod window_process;
mod windows_host;
pub use windows_host::run_if_requested as run_window_process_if_requested;

use gpui_kit::{QuitMode, WindowingRequest};
use patina_recorder::Recorder;
use std::{env, fs, io, os::windows::fs::OpenOptionsExt, path::PathBuf};
use std::{
    rc::Rc,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
};
pub use tray::Action;

pub const APP_ID: &str = "Patina.GPUI.Experimental";

fn lock_profile() -> io::Result<(fs::File, PathBuf)> {
    let parent = env::var_os("PATINA_GPUI_PROFILE_PARENT")
        .or_else(|| env::var_os("LOCALAPPDATA"))
        .ok_or_else(|| io::Error::other("missing GPUI profile parent"))?;
    let parent = PathBuf::from(parent);
    if !parent.is_absolute() || !parent.is_dir() {
        return Err(io::Error::other(
            "GPUI profile parent must be an existing absolute directory",
        ));
    }
    let root = parent.join(APP_ID);
    fs::create_dir_all(&root)?;
    let lock = fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .write(true)
        .share_mode(0)
        .open(root.join("instance.lock"))?;
    Ok((lock, root))
}

pub fn run(
    send: async_channel::Sender<Action>,
    actions: async_channel::Receiver<Action>,
) -> Result<(), Box<dyn std::error::Error>> {
    let (_profile_lock, root) = lock_profile()?;
    #[cfg(debug_assertions)]
    dev_preview::exit_with_launcher(&send)?;
    dock::enable_monitor_dpi()?;
    let windows_open = Arc::new(AtomicBool::new(false));
    let usage_active = Arc::new(AtomicBool::new(false));
    let recorder = Rc::new(Recorder::start(&root.join("patina.db"), {
        let send = send.clone();
        let windows_open = windows_open.clone();
        let usage_active = usage_active.clone();
        move || {
            if usage_active.load(Ordering::Acquire) {
                let _ = send.try_send(Action::WakeTools);
            }
            if windows_open.load(Ordering::Acquire) {
                let _ = send.try_send(Action::Refresh);
            }
        }
    })?);
    let application = gpui_kit::application()
        .with_windowing(WindowingRequest::Headless)
        .with_quit_mode(QuitMode::Explicit);
    let _tray = tray::Tray::new(send.clone(), recorder.clone())?;
    let shutdown = recorder.clone();
    let (tools, worker) = tool_service::ToolService::start(
        root.join("tools"),
        recorder.tools(),
        recorder.locale.get().tag().into(),
        send,
        usage_active,
    )?;
    application.run(move |cx| {
        window_process::serve(cx, actions, recorder, windows_open, tools);
    });
    let tools_stopped = worker.stop();
    shutdown.shutdown()?;
    tools_stopped?;
    Ok(())
}

mod classification;

mod settings;

mod about;
