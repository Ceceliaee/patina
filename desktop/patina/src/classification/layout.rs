use super::*;

#[derive(Default)]
pub(super) struct LinkLayout {
    visible: Vec<String>,
    slots: Option<Vec<String>>,
    active: Option<String>,
    view: String,
    restore: Option<(String, Pixels)>,
    focus_target: bool,
    pub pointer_down: bool,
}

impl LinkLayout {
    pub fn regroup(&mut self, source: &str, target: String, scroll: &ScrollHandle) {
        if let Some(index) = self.visible.iter().position(|key| key == source) {
            self.restore = Some((target, scroll.offset().y + row_top(index)));
        }
        self.slots = None;
        self.active = None;
        self.focus_target = true;
    }

    pub fn arrange(
        &mut self,
        keys: Vec<String>,
        active: Option<&str>,
        view: String,
        scroll: &ScrollHandle,
    ) -> (Vec<String>, Option<String>) {
        let view_changed = self.view != view;
        if view_changed {
            *self = Self {
                view,
                ..Self::default()
            };
        }
        if view_changed {
            self.visible = keys.clone();
        }
        let active = active.filter(|key| keys.iter().any(|k| k == key));
        if active.is_some() && self.active.as_deref() != active {
            self.slots = Some(self.slots.take().unwrap_or_else(|| self.visible.clone()));
            self.active = active.map(str::to_owned);
        }
        let mut focus = None;
        if active.is_none() && (!self.pointer_down || self.focus_target) {
            if self.restore.is_none()
                && let Some(previous) = self.active.take()
            {
                let index = self
                    .visible
                    .iter()
                    .position(|key| key == &previous)
                    .unwrap_or(0);
                let anchor = self
                    .visible
                    .iter()
                    .enumerate()
                    .filter(|(_, key)| keys.contains(key))
                    .min_by_key(|(i, _)| i.abs_diff(index));
                if let Some((i, key)) = anchor {
                    self.restore = Some((key.clone(), scroll.offset().y + row_top(i)));
                }
            }
            self.slots = None;
            if let Some((target, top)) = self.restore.take()
                && let Some(index) = keys.iter().position(|key| key == &target)
            {
                scroll.set_offset(point(px(0.), (top - row_top(index)).min(px(0.))));
                if self.focus_target {
                    focus = Some(target);
                }
            }
        }
        if active.is_none() && !self.pointer_down {
            self.focus_target = false;
        }
        self.visible = self.slots.clone().unwrap_or(keys);
        (self.visible.clone(), focus)
    }
}

fn row_top(index: usize) -> Pixels {
    px((index / 2) as f32 * (92. + APP_CARD_GAP))
}
