use chrono::{Local, TimeZone};
use gpui_kit::{base::Button, prelude::*, *};

pub(super) const CARD_GAP: f32 = 16.;
pub(super) const APP_CARD_GAP: f32 = 12.;
pub(super) const CONTENT_INSET: f32 = 16.;

pub(super) fn stamp(ms: i64, format: &str) -> String {
    Local
        .timestamp_millis_opt(ms)
        .single()
        .map(|v| v.format(format).to_string())
        .unwrap_or_default()
}
pub(super) fn label(s: String) -> Stateful<Div> {
    div()
        .id(SharedString::from(s.clone()))
        .role(Role::Label)
        .aria_value(s.clone())
        .child(s)
}
pub(super) fn action(
    id: impl Into<ElementId>,
    name: String,
    shown: String,
    enabled: bool,
    cb: impl Fn(&ClickEvent, &mut Window, &mut App) + 'static,
) -> Button {
    Button::new(id)
        .accessibility_label(name)
        .disabled(!enabled)
        .rounded(px(6.))
        .border_1()
        .border_color(rgba(0x80808038))
        .bg(rgba(0x80808006))
        .hover(|s| s.bg(rgba(0x7891ac22)))
        .focus_visible(|s| s.border_color(rgb(0x6787ac)))
        .px(px(9.))
        .py(px(5.))
        .child(shown)
        .on_click(cb)
}

pub(super) fn panel(c: quietpro::Palette) -> Div {
    div()
        .flex()
        .flex_col()
        .min_w_0()
        .rounded(px(12.))
        .border_1()
        .border_color(c.border)
        .bg(c.panel)
        .p(px(20.))
}
pub(super) fn page(c: quietpro::Palette) -> Div {
    div()
        .flex()
        .flex_col()
        .flex_1()
        .min_w_0()
        .min_h_0()
        .py(px(20.))
        .px(px(CONTENT_INSET))
        .gap(px(CARD_GAP))
        .text_color(c.text)
}
pub(super) fn heading(name: String) -> Stateful<Div> {
    div()
        .id(SharedString::from(name.clone()))
        .role(Role::Heading)
        .aria_label(name.clone())
        .text_size(px(16.))
        .font_weight(FontWeight::SEMIBOLD)
        .child(name)
}
pub(super) fn continuous_frame(radius: Pixels, border: Rgba, fill: Rgba) -> Div {
    let layer = |inset, color| {
        div()
            .absolute()
            .inset_0()
            .text_color(color)
            .child(quietpro::continuous_corner_layer(radius, inset))
    };
    div()
        .relative()
        .flex()
        .min_w_0()
        .min_h_0()
        .p(px(1.))
        .child(layer(px(0.), border))
        .child(layer(px(1.), fill))
}

pub(super) fn content_card(border: Rgba, fill: Rgba) -> Div {
    continuous_frame(px(16.), border, fill)
        .flex_col()
        .p(px(CONTENT_INSET) + px(1.))
}
pub(super) fn page_title_row(name: String, icon: quietpro::Icon, c: quietpro::Palette) -> Div {
    continuous_frame(px(16.), c.border, c.panel)
        .flex_row()
        .flex_none()
        .h(px(64.))
        .px(px(16.) + px(1.))
        .items_center()
        .gap(px(8.))
        .child(quietpro::glyph(icon, c.secondary).size(px(20.)))
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
pub(super) fn page_actions() -> Div {
    div().flex().flex_none().items_center().gap(px(8.))
}

pub(super) fn save_status(status: String, colors: quietpro::Palette) -> Stateful<Div> {
    quietpro::caption(status.clone(), colors)
        .id("save-status")
        .role(Role::Status)
        .aria_label(status)
        .whitespace_nowrap()
}
pub(super) fn logo() -> Img {
    static IMAGE: std::sync::LazyLock<std::sync::Arc<Image>> = std::sync::LazyLock::new(|| {
        std::sync::Arc::new(Image::from_bytes(
            ImageFormat::Png,
            include_bytes!("../../../src-tauri/icons/128x128.png").to_vec(),
        ))
    });
    img(IMAGE.clone())
}

pub(super) fn detail_dialog(
    content: Entity<crate::history::History>,
    focus: &FocusHandle,
    close_label: String,
    colors: quietpro::Palette,
    close: impl Fn(&mut Window, &mut App) + 'static,
    cx: &mut App,
) -> gpui_kit::base::Dialog {
    let close = std::rc::Rc::new(close);
    let button = close.clone();
    let popup = panel(colors)
        .id("app-detail-popup")
        .w(px(740.))
        .h(px(515.))
        .p(px(12.))
        .on_any_mouse_down(|_, _, cx| cx.stop_propagation())
        .child(
            div().w_full().flex().justify_end().child(
                quietpro::IconControl::new("close-detail", close_label, quietpro::Icon::X)
                    .action(colors, move |_, win, cx| button(win, cx)),
            ),
        )
        .child(content);
    gpui_kit::base::Dialog::new(cx)
        .focus_handle(focus.clone())
        .on_ok(|_, _, _| false)
        .backdrop(div().size_full().bg(rgba(0x00000055)))
        .popup(gpui_kit::base::DialogPopup::new().child(popup))
        .on_open_change(move |open, _, win, cx| {
            if !open {
                close(win, cx);
            }
        })
}
