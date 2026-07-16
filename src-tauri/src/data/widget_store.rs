use crate::data::repositories::widget_state;
use crate::data::sqlite_pool::wait_for_sqlite_pool;
use crate::domain::widget::WidgetPlacement;
use crate::engine::widget::{WidgetPlacementStore, WidgetStoreFuture};
use sqlx::{Pool, Sqlite};
use tauri::{AppHandle, Runtime};

pub struct SqliteWidgetPlacementStore {
    pool: Pool<Sqlite>,
}

impl SqliteWidgetPlacementStore {
    pub async fn from_app<R: Runtime>(app: &AppHandle<R>) -> Result<Self, String> {
        Ok(Self {
            pool: wait_for_sqlite_pool(app).await?,
        })
    }
}

impl WidgetPlacementStore for SqliteWidgetPlacementStore {
    fn load_placement(&self) -> WidgetStoreFuture<'_, WidgetPlacement> {
        Box::pin(async move {
            widget_state::load_widget_placement(&self.pool)
                .await
                .map_err(|error| error.to_string())
        })
    }

    fn save_placement(&self, placement: WidgetPlacement) -> WidgetStoreFuture<'_, ()> {
        Box::pin(async move {
            widget_state::save_widget_placement(&self.pool, placement)
                .await
                .map_err(|error| error.to_string())
        })
    }
}
