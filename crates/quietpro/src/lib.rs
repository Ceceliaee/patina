//! Quiet Pro controls shared by Patina's native views.
use gpui_kit::{Rgba, prelude::*, px};

mod activity_color;
mod continuous_corner;
mod controls;
mod superellipse;
mod theme;
mod typography;

pub use activity_color::activity_display_color;
pub use continuous_corner::{continuous_corner_fill, continuous_corner_layer};
pub use controls::ControlSize;
pub use controls::app_icon::{
    UNFRAMED_APP_ICON_SIZE, app_icon_frame, unframed_app_icon, unframed_app_icon_button,
};
pub use controls::dialog::{
    DIALOG_FRAME_INSET, DIALOG_WINDOW_MARGIN, dialog_actions, dialog_backdrop, dialog_surface,
    modal_dialog,
};
pub use controls::distribution::{DistributionValue, distribution_row};
pub use controls::donut::{DONUT_COMPACT_SIZE, DONUT_SIZE, DonutChart, DonutSlice};
pub use controls::dot_pattern::dot_pattern;
pub use controls::dropdown::Dropdown;
pub use controls::heatmap::{HeatmapCell, heatmap_layout};
pub use controls::icon_control::{ICON_CONTROL_SIZE, IconControl};
pub use controls::metric_group::MetricGroup;
pub use controls::search_input::search_input;
pub use controls::segmented::{
    SegmentSelection, page_tabs, section_rail, segmented, segmented_with_medium_labels,
};
pub use controls::slide_switch::{slide_switch, switch_control};
pub use controls::slider::value_slider;
pub use controls::text_button::{ButtonSizeExt, text_button, text_button_with_icon};
pub use controls::text_input::TextInput;
pub use controls::timeline::{TimelineOverview, TimelineSegment};
pub use controls::toast::toast_surface;
pub use controls::tooltip::{TextTooltip, tooltip_surface, with_text_tooltip};
pub use controls::trend_chart::{TrendChart, TrendSeries};
pub use theme::{Palette, ThemePreset};
pub use typography::init_fonts;

pub use gpui_kit::assets::IconName as Icon;

pub const FILLED_PIN_ICON: &[u8] = include_bytes!("../assets/icons/pin-filled.svg");

gpui_kit::assets::icon_assets!(pub QuietProAssets, [Globe, House, Bell, ToolCase, Tags, TagPlus, ZoomIn, Expand, Settings2, Info, AppWindow, Pencil, Palette, Type, EyeOff, ListX, ListPlus, Captions, CaptionsOff, Pipette, Search, Funnel, Check, Sparkles, ChartSpline, Clock, CalendarClock, Menu, Layers, Maximize2, Minimize2, Minus, Plus, TrendingUp, TrendingDown, Monitor, Pin, SquareArrowOutUpRight, X, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, MousePointerClick, Server, Database, Dices, Eye, RefreshCw, FolderOpen, FolderPen, Trash, RotateCcw, FileText, MessageSquare, Rose]);

pub fn glyph(icon: Icon, color: Rgba) -> gpui_kit::Svg {
    gpui_kit::svg()
        .path(icon.path())
        .flex_none()
        .size(px(14.))
        .text_color(color)
}

pub fn caption(label: impl Into<gpui_kit::SharedString>, colors: Palette) -> gpui_kit::Div {
    gpui_kit::div()
        .text_size(px(12.))
        .text_color(colors.secondary)
        .child(label.into())
}

pub fn badge(label: impl Into<gpui_kit::SharedString>, colors: Palette) -> gpui_kit::Div {
    caption(label, colors)
        .h(px(20.))
        .px(px(8.))
        .flex_none()
        .flex()
        .items_center()
        .justify_center()
        .rounded_full()
        .border_1()
        .border_color(colors.border)
        .bg(colors.canvas)
        .line_height(px(16.))
        .font_weight(REGULAR_TEXT_WEIGHT)
        .whitespace_nowrap()
}

mod layout;
pub use controls::calendar::{
    CalendarDayState, calendar_arrow_frame, calendar_caption, calendar_controls, calendar_day,
    calendar_month_header, calendar_range_cell, calendar_surface, calendar_trigger, calendar_week,
    calendar_weekdays,
};
pub use controls::checkbox::{checkbox, field_row};
pub use controls::choice_card::{
    choice_card, choice_entry, choice_swatches, inline_choice_entry, object_list_item,
};
pub use controls::color_picker::{
    color_picker_surface, color_plane, color_swatch_button, hue_strip,
};
pub use controls::context_menu::{MENU_FRAME_INSET, menu_item, menu_surface, menu_width};
pub use controls::form::{
    divider_color, line_above, settings_row, settings_row_label, settings_rows_card,
    settings_title, vertical_divider,
};
pub use controls::navigation_item::navigation_item;
pub use layout::*;
