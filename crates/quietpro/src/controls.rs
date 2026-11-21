pub(super) mod app_icon;
pub(super) mod calendar;
pub(super) mod checkbox;
pub(super) mod choice_card;
pub(super) mod color_picker;
pub(super) mod context_menu;
pub(super) mod dialog;
pub(super) mod distribution;
pub(super) mod donut;
pub(super) mod dot_pattern;
pub(super) mod dropdown;
pub(super) mod form;
pub(super) mod heatmap;
pub(super) mod icon_control;
pub(super) mod metric_group;
pub(super) mod navigation_item;
pub(super) mod search_input;
pub(super) mod segmented;
pub(super) mod slide_switch;
pub(super) mod slider;
pub(super) mod text_button;
pub(super) mod text_input;
pub(super) mod timeline;
pub(super) mod toast;
pub(super) mod tooltip;
pub(super) mod trend_chart;

const CONTROL_HORIZONTAL_PADDING: f32 = 12.;
const LABEL_ARROW_GAP: f32 = 8.;

#[derive(Clone, Copy)]
pub enum ControlSize {
    Small,
    Medium,
    Large,
}

impl ControlSize {
    pub fn height(self) -> gpui_kit::Pixels {
        gpui_kit::px(match self {
            Self::Small => 24.,
            Self::Medium => 28.,
            Self::Large => 32.,
        })
    }
}
