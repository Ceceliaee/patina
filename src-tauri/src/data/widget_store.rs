use crate::data::repositories::{widget_runtime, widget_state};
use crate::data::sqlite_pool::wait_for_sqlite_pool;
use crate::domain::widget::{WidgetExpansionPreference, WidgetPlacement};
use crate::engine::widget::{
    WidgetExpansionPreferenceStore, WidgetPlacementStore, WidgetStoreFuture,
};
use sqlx::{Pool, Sqlite};
use tauri::{AppHandle, Runtime};

pub async fn load_widget_bootstrap_snapshot<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<widget_runtime::WidgetBootstrapSnapshot, String> {
    let pool = wait_for_sqlite_pool(app).await?;
    widget_runtime::load_widget_bootstrap_snapshot(&pool)
        .await
        .map_err(|error| format!("failed to load widget bootstrap snapshot: {error}"))
}

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

impl WidgetExpansionPreferenceStore for SqliteWidgetPlacementStore {
    fn load_expansion_preference(&self) -> WidgetStoreFuture<'_, WidgetExpansionPreference> {
        Box::pin(async move {
            widget_state::load_widget_expansion_preference(&self.pool)
                .await
                .map_err(|error| error.to_string())
        })
    }

    fn save_expansion_preference(
        &self,
        preference: WidgetExpansionPreference,
    ) -> WidgetStoreFuture<'_, ()> {
        Box::pin(async move {
            widget_state::save_widget_expansion_preference(&self.pool, preference)
                .await
                .map_err(|error| error.to_string())
        })
    }
}
