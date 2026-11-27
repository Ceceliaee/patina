#![windows_subsystem = "windows"]

#[cfg(target_env = "msvc")]
mod delay_load;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    unsafe {
        windows::Win32::UI::Shell::SetCurrentProcessExplicitAppUserModelID(
            &windows::core::HSTRING::from(patina::APP_ID),
        )?;
    }
    if let Some(result) = patina::run_child_if_requested() {
        return result;
    }
    let (send, actions) = async_channel::unbounded();
    let mut args = std::env::args_os().skip(1);
    let mut parent = None;
    let mut autostart = false;
    while let Some(arg) = args.next() {
        if arg == "--handoff-tauri-login" {
            let [parent, previous] = args
                .collect::<Vec<_>>()
                .try_into()
                .map_err(|_| "invalid login handoff arguments")?;
            return patina::handoff_tauri_login(
                (!parent.is_empty()).then(|| std::path::Path::new(&parent)),
                previous.to_str().ok_or("invalid previous login identity")?,
            );
        }
        if arg == "--upgrade-tauri-profile" {
            let [profile_parent, roaming, key, login] = args
                .collect::<Vec<_>>()
                .try_into()
                .map_err(|_| "Invalid profile upgrade arguments")?;
            return patina::adopt_tauri_profile(
                (!profile_parent.is_empty()).then(|| std::path::Path::new(&profile_parent)),
                std::path::Path::new(&roaming),
                &key,
                login == "1",
            );
        }
        if arg == "--autostart" {
            autostart = true;
            continue;
        }
        if arg == "--profile-parent" || arg == "-a" {
            autostart |= arg == "-a";
            parent = Some(args.next().ok_or("missing profile parent")?.into());
            continue;
        }
        let action = if arg == "--main" {
            patina::Action::Main
        } else if arg == "--today" {
            patina::Action::Today
        } else if arg == "--mini" {
            patina::Action::Mini { focus: true }
        } else {
            return Err("Usage: patina [--main | --today | --mini]".into());
        };
        send.try_send(action)?;
    }
    patina::launch(send, actions, parent, true, autostart)
}
