use crate::domain::widget::WidgetPlacement;
use std::future::Future;
use std::pin::Pin;

pub type WidgetStoreFuture<'a, T> = Pin<Box<dyn Future<Output = Result<T, String>> + Send + 'a>>;

pub trait WidgetPlacementStore: Send + Sync {
    fn load_placement(&self) -> WidgetStoreFuture<'_, WidgetPlacement>;
    fn save_placement(&self, placement: WidgetPlacement) -> WidgetStoreFuture<'_, ()>;
}

pub async fn load_widget_placement(
    store: &impl WidgetPlacementStore,
) -> Result<WidgetPlacement, String> {
    store
        .load_placement()
        .await
        .map_err(|error| format!("failed to load widget placement: {error}"))
}

pub async fn save_widget_placement(
    store: &impl WidgetPlacementStore,
    placement: WidgetPlacement,
) -> Result<(), String> {
    store
        .save_placement(placement)
        .await
        .map_err(|error| format!("failed to save widget placement: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::widget::WidgetSide;
    use std::sync::Mutex;

    struct MemoryWidgetStore {
        placement: Mutex<WidgetPlacement>,
    }

    impl WidgetPlacementStore for MemoryWidgetStore {
        fn load_placement(&self) -> WidgetStoreFuture<'_, WidgetPlacement> {
            Box::pin(async move { Ok(*self.placement.lock().unwrap()) })
        }

        fn save_placement(&self, placement: WidgetPlacement) -> WidgetStoreFuture<'_, ()> {
            Box::pin(async move {
                *self.placement.lock().unwrap() = placement;
                Ok(())
            })
        }
    }

    #[test]
    fn widget_engine_uses_store_contract_without_storage_details() {
        tauri::async_runtime::block_on(async {
            let initial = WidgetPlacement::new(WidgetSide::Left, 0.2);
            let next = WidgetPlacement::new(WidgetSide::Right, 0.8);
            let store = MemoryWidgetStore {
                placement: Mutex::new(initial),
            };

            assert_eq!(load_widget_placement(&store).await.unwrap(), initial);
            save_widget_placement(&store, next).await.unwrap();
            assert_eq!(load_widget_placement(&store).await.unwrap(), next);
        });
    }
}
