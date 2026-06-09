use tauri::{AppHandle, Runtime};
use tauri_plugin_notification::NotificationExt;

pub fn send<R: Runtime>(app: &AppHandle<R>, title: &str, body: &str) -> Result<(), String> {
    #[cfg(windows)]
    if should_use_dev_windows_toast_identity() {
        if let Err(error) = send_windows_toast(app, title, body) {
            eprintln!(
                "[tools] failed to send Windows app-owned notification, falling back: {error}"
            );
        } else {
            return Ok(());
        }
    }

    app.notification()
        .builder()
        .title(title)
        .body(body)
        .show()
        .map_err(|error| error.to_string())
}

#[cfg(windows)]
fn send_windows_toast<R: Runtime>(
    app: &AppHandle<R>,
    title: &str,
    body: &str,
) -> Result<(), String> {
    let config = app.config();
    let app_name = config.product_name.as_deref().unwrap_or("Patina");
    crate::platform::windows::notifications::send(
        config.identifier.as_str(),
        app_name,
        title,
        body,
        None,
    )
}

#[cfg(windows)]
fn should_use_dev_windows_toast_identity() -> bool {
    let Ok(exe_path) = std::env::current_exe() else {
        return false;
    };
    let Some(exe_dir) = exe_path.parent() else {
        return false;
    };
    let Some(profile_dir_name) = exe_dir.file_name().and_then(|name| name.to_str()) else {
        return false;
    };
    if profile_dir_name != "debug" && profile_dir_name != "release" {
        return false;
    }
    exe_dir
        .parent()
        .and_then(|parent| parent.file_name())
        .and_then(|name| name.to_str())
        .map(|name| name == "target")
        .unwrap_or(false)
}
