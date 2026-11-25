use crate::{CARD_TITLE_GAP, CONTENT_INSET, Palette, continuous_corner_layer};
use gpui_kit::{
    AnyTooltip, App, ClickEvent, Div, EmptyView, FocusHandle, Pixels, SharedString, Size, Window,
    anchored,
    base::{Dialog, DialogPopup},
    canvas, deferred, div, point,
    prelude::*,
    px, rgba,
};
use std::rc::Rc;

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

#[derive(IntoElement)]
pub struct ModalDialog {
    dialog: Dialog,
    layer: usize,
}

impl ModalDialog {
    pub fn layer(mut self, index: usize, topmost: bool) -> Self {
        self.layer = index;
        self.dialog = self.dialog.layer(index, topmost);
        self
    }

    pub fn close_on_backdrop_press(mut self, close: bool) -> Self {
        self.dialog = self.dialog.close_on_backdrop_press(close);
        self
    }

    pub fn close_on_escape(mut self, close: bool) -> Self {
        self.dialog = self.dialog.close_on_escape(close);
        self
    }

    pub fn on_ok(
        mut self,
        confirm: impl Fn(&ClickEvent, &mut Window, &mut App) -> bool + 'static,
    ) -> Self {
        self.dialog = self.dialog.on_ok(confirm);
        self
    }
}

impl RenderOnce for ModalDialog {
    fn render(self, win: &mut Window, cx: &mut App) -> impl IntoElement {
        let viewport = win.viewport_size();
        let empty = win.use_keyed_state(("modal-tooltip", self.layer), cx, |_, _| EmptyView);
        let shield = div().w(viewport.width).h(viewport.height).occlude().child(
            canvas(
                move |_, win, _| {
                    // GPUI resolves tooltip requests front to back. An empty request below the
                    // dialog masks earlier requests even when their hover timer has already fired.
                    win.set_tooltip(AnyTooltip {
                        view: empty.clone().into(),
                        mouse_position: win.mouse_position(),
                        check_visible_and_update: Rc::new(|_, _, _| true),
                    });
                },
                |_, _, _, _| {},
            )
            .absolute()
            .inset_0(),
        );
        // The GPUI dialog host draws at 10 + layer. Its backdrop must receive presses
        // above the shield, including when another dialog is already open underneath.
        div()
            .absolute()
            .child(
                deferred(anchored().position(point(px(0.), px(0.))).child(shield))
                    .with_priority(10 + self.layer),
            )
            .child(self.dialog)
    }
}

/// A dialog without an explicit confirm handler stays open on the dialog-level Enter action.
pub fn modal_dialog(
    title: impl Into<SharedString>,
    focus: FocusHandle,
    content: impl IntoElement,
    dismiss: impl Fn(&mut Window, &mut App) + 'static,
    cx: &mut App,
) -> ModalDialog {
    let dialog = Dialog::new(cx)
        .accessibility_label(title)
        .focus_handle(focus)
        .on_ok(|_, _, _| false)
        .backdrop(dialog_backdrop())
        .popup(DialogPopup::new().child(content))
        .on_open_change(move |open, _, win, cx| {
            if !open {
                dismiss(win, cx);
            }
        });
    ModalDialog { dialog, layer: 0 }
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
