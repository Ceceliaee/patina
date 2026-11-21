use gpui_kit::{prelude::*, *};

pub const CARD_GAP: f32 = 16.;
pub const CARD_TITLE_GAP: f32 = 12.;
pub const APP_CARD_GAP: f32 = 12.;
pub const CONTENT_INSET: f32 = 16.;
pub const LEGEND_DOT_SIZE: f32 = 8.;
pub const LEGEND_LABEL_GAP: f32 = 8.;
pub const REGULAR_TEXT_WEIGHT: FontWeight = FontWeight::NORMAL;
pub const SETTINGS_ROW_HEIGHT: f32 = 48.;
pub const SUBHEADING_GAP: f32 = 8.;
pub const SECTION_GROUP_GAP: f32 = 12.;
pub const SIDEBAR_WIDTH: f32 = 108.;
pub const SHELL_PADDING: f32 = 24.;
pub const HOURLY_PLOT_MIN_HEIGHT: f32 = 128.;
pub const HOURLY_BAR_WIDTH: f32 = 8.;
pub const HOURLY_BAR_TOP_RADIUS: f32 = 4.;
pub const HOURLY_AXIS_GAP: f32 = 8.;
pub const HOURLY_AXIS_FONT_SIZE: f32 = 12.;
const AXIS_LABEL_WEIGHT: FontWeight = FontWeight::MEDIUM;

pub(crate) fn chart_axis_labels(c: crate::Palette) -> Div {
    div()
        .flex()
        .text_size(px(HOURLY_AXIS_FONT_SIZE))
        .font_weight(AXIS_LABEL_WEIGHT)
        .text_color(c.secondary)
}

pub(crate) fn axis_label_width(label: &str, win: &Window) -> f32 {
    let mut run = win.text_style().to_run(label.len());
    run.font.weight = AXIS_LABEL_WEIGHT;
    f32::from(
        win.text_system()
            .shape_line(
                label.to_owned().into(),
                px(HOURLY_AXIS_FONT_SIZE),
                &[run],
                None,
            )
            .width,
    )
}

pub fn outer_frame(colors: crate::Palette) -> Div {
    continuous_frame(px(16.), colors.border, colors.canvas).flex_col()
}

pub fn navigation_rail() -> Div {
    div()
        .flex_1()
        .flex()
        .flex_col()
        .items_center()
        .gap(px(8.))
        .px(px(8.))
        .py(px(24.))
}

pub fn shell_content() -> Div {
    div()
        .flex_1()
        .min_h_0()
        .flex()
        .gap(px(CARD_GAP))
        .p(px(SHELL_PADDING))
        .pt(px(16.))
}

pub fn page(c: crate::Palette) -> Div {
    div()
        .flex()
        .flex_col()
        .flex_1()
        .min_w_0()
        .min_h_0()
        .p(px(CONTENT_INSET))
        .gap(px(CARD_GAP))
        .text_color(c.text)
}
pub fn heading(name: String) -> Stateful<Div> {
    div()
        .id(SharedString::from(name.clone()))
        .role(Role::Heading)
        .aria_label(name.clone())
        .text_size(px(16.))
        .font_weight(FontWeight::BOLD)
        .child(name)
}

pub fn group_heading(name: String) -> Stateful<Div> {
    heading(name)
        .aria_level(3)
        .text_size(px(14.))
        .line_height(px(20.))
}
pub fn continuous_frame(radius: Pixels, border: Rgba, fill: Rgba) -> Div {
    div().relative().flex().min_w_0().min_h_0().p(px(1.)).child(
        gpui_kit::canvas(
            |_, _, _| (),
            move |bounds, (), window, _| {
                crate::continuous_corner::paint_frame(bounds, radius, border, fill, window);
            },
        )
        .absolute()
        .inset_0(),
    )
}

pub fn content_card(border: Rgba, fill: Rgba) -> Div {
    continuous_frame(px(16.), border, fill)
        .flex_col()
        .p(px(CONTENT_INSET) + px(1.))
}
pub fn page_title_row(name: String, icon: crate::Icon, c: crate::Palette) -> Div {
    continuous_frame(px(16.), c.border, c.panel)
        .flex_row()
        .flex_none()
        .h(px(64.))
        .px(px(CONTENT_INSET + 1.))
        .items_center()
        .gap(px(8.))
        .child(crate::glyph(icon, c.secondary).size(px(20.)))
        .child(
            heading(name)
                .accessibility_id("page-title")
                .aria_level(1)
                .flex_1()
                .min_w_0()
                .truncate()
                .text_size(px(18.))
                .line_height(px(24.)),
        )
}
pub fn page_actions() -> Div {
    div().flex().flex_none().items_center().gap(px(8.))
}

/// Adjacent icon controls share an edge without overlapping their hit areas.
pub fn icon_actions() -> Div {
    div().flex().flex_none().items_center().gap(px(0.))
}
