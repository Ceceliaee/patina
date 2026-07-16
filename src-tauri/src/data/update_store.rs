use crate::data::repositories::update_state;
use crate::data::sqlite_pool::wait_for_sqlite_pool;
use crate::engine::updater::{UpdateStateStore, UpdateStoreFuture};
use tauri::{AppHandle, Runtime};

pub struct SqliteUpdateStateStore<R: Runtime> {
    app: AppHandle<R>,
}

impl<R: Runtime> SqliteUpdateStateStore<R> {
    pub fn new(app: AppHandle<R>) -> Self {
        Self { app }
    }
}

impl<R: Runtime> UpdateStateStore for SqliteUpdateStateStore<R> {
    fn load_last_auto_check_day(&self) -> UpdateStoreFuture<'_, Option<String>> {
        Box::pin(async move {
            let pool = wait_for_sqlite_pool(&self.app).await?;
            update_state::load_last_auto_check_day(&pool)
                .await
                .map_err(|error| error.to_string())
        })
    }

    fn save_last_auto_check_day<'a>(&'a self, day: &'a str) -> UpdateStoreFuture<'a, ()> {
        Box::pin(async move {
            let pool = wait_for_sqlite_pool(&self.app).await?;
            update_state::save_last_auto_check_day(&pool, day)
                .await
                .map_err(|error| error.to_string())
        })
    }

    fn request_post_install_reopen(&self) -> UpdateStoreFuture<'_, ()> {
        Box::pin(async move {
            let pool = wait_for_sqlite_pool(&self.app).await?;
            update_state::request_post_install_reopen_main_window(&pool)
                .await
                .map_err(|error| error.to_string())
        })
    }

    fn clear_post_install_reopen(&self) -> UpdateStoreFuture<'_, ()> {
        Box::pin(async move {
            let pool = wait_for_sqlite_pool(&self.app).await?;
            update_state::clear_post_install_reopen_main_window(&pool)
                .await
                .map_err(|error| error.to_string())
        })
    }
}
