use super::*;

pub(super) async fn rebuild<R: Runtime + 'static>(
    app: &AppHandle<R>,
    generation: u64,
    reason: &str,
) -> Result<(), String> {
    if !remove(app, generation, reason).await? {
        return Ok(());
    }
    if !app.state::<AppExitState>().is_exit_requested()
        && app
            .state::<MainWindowLifecycleState>()
            .snapshot()
            .generation
            == generation
    {
        ensure_main_window_once(app)?;
    }
    Ok(())
}

pub(super) async fn remove<R: Runtime + 'static>(
    app: &AppHandle<R>,
    generation: u64,
    reason: &str,
) -> Result<bool, String> {
    let lifecycle = app.state::<MainWindowLifecycleState>();
    if app.state::<AppExitState>().is_exit_requested()
        || lifecycle.snapshot().generation != generation
        || !lifecycle.begin_unavailable_window_recovery()
    {
        return Ok(false);
    }
    let result = match app.get_webview_window(MAIN_WINDOW_LABEL) {
        Some(window) => crate::app::webview_recovery::destroy_and_wait(&window).await,
        None => Ok(()),
    };
    lifecycle.finish_unavailable_window_recovery();
    log_main_window_event(
        "native-window-recovery",
        lifecycle.snapshot(),
        reason,
        if result.is_ok() {
            "destroyed-stale-window"
        } else {
            "termination-unconfirmed"
        },
    );
    result.map(|()| true)
}
