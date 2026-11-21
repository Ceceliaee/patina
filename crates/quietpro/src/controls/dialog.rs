use crate::{CARD_TITLE_GAP, CONTENT_INSET, Palette, continuous_corner_layer};
use gpui_kit::{
    App, Div, FocusHandle, Pixels, SharedString, Size, Window,
    base::{Dialog, DialogPopup},
    div,
    prelude::*,
    px, rgba,
};

const RADIUS: f32 = 16.;
pub const DIALOG_FRAME_INSET: f32 = CONTENT_INSET + 1.;
pub const DIALOG_WINDOW_MARGIN: f32 = 24.;
const MIN_WIDTH: f32 = 280.;

/// Content-sized dialog surface. The caller owns body scrolling and task actions.
pub fn dialog_surface(colors: Palette, viewport: Size<Pixels>) -> Div {
    let available_width = (viewport.width - px(DIALOG_WINDOW_MARGIN * 2.)).max(px(0.));
    let layer = |inset, color| {
        div()
            .absolute()
            .inset_0()
            .text_color(color)
            .child(continuous_corner_layer(px(RADIUS), px(inset)))
    };
    div()
        .relative()
        .flex()
        .flex_col()
        .min_w(px(MIN_WIDTH).min(available_width))
        .max_w(available_width)
        .min_h_0()
        .max_h((viewport.height - px(DIALOG_WINDOW_MARGIN * 2.)).max(px(0.)))
        .p(px(DIALOG_FRAME_INSET))
        .gap(px(CARD_TITLE_GAP))
        .child(layer(0., colors.border))
        .child(layer(1., colors.panel))
}

pub fn dialog_backdrop() -> Div {
    div().size_full().bg(rgba(0x00000033))
}

/// A dialog without an explicit confirm handler stays open on the dialog-level Enter action.
pub fn modal_dialog(
    title: impl Into<SharedString>,
    focus: FocusHandle,
    content: impl IntoElement,
    dismiss: impl Fn(&mut Window, &mut App) + 'static,
    cx: &mut App,
) -> Dialog {
    Dialog::new(cx)
        .accessibility_label(title)
        .focus_handle(focus)
        .on_ok(|_, _, _| false)
        .backdrop(dialog_backdrop())
        .popup(DialogPopup::new().child(content))
        .on_open_change(move |open, _, win, cx| {
            if !open {
                dismiss(win, cx);
            }
        })
}

pub fn dialog_actions() -> Div {
    div()
        .flex()
        .flex_none()
        .flex_wrap()
        .justify_end()
        .items_center()
        .gap(px(8.))
}
