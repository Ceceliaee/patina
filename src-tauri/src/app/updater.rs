use crate::data::update_store::SqliteUpdateStateStore;
use crate::domain::update::UpdateSnapshot;
use crate::engine::updater::{self, UpdaterRuntimeState};
use tauri::{AppHandle, Runtime};

pub(crate) async fn check_for_updates<R: Runtime>(
    app: &AppHandle<R>,
    state: &UpdaterRuntimeState,
    silent: bool,
) -> Result<UpdateSnapshot, String> {
    let store = SqliteUpdateStateStore::new(app.clone());
    updater::check_for_updates(app, state, &store, silent).await
}

pub(crate) async fn install_downloaded<R: Runtime>(
    app: &AppHandle<R>,
    state: &UpdaterRuntimeState,
) -> Result<UpdateSnapshot, String> {
    let store = SqliteUpdateStateStore::new(app.clone());
    updater::install_downloaded(app, state, &store).await
}

pub(crate) async fn download_pending<R: Runtime>(
    app: &AppHandle<R>,
    state: &UpdaterRuntimeState,
) -> Result<UpdateSnapshot, String> {
    updater::download_pending(app, state).await
}

pub(crate) async fn run_startup_auto_check<R: Runtime>(
    app: AppHandle<R>,
    state: UpdaterRuntimeState,
) {
    let store = SqliteUpdateStateStore::new(app.clone());
    updater::run_startup_auto_check(app, state, store).await;
}
