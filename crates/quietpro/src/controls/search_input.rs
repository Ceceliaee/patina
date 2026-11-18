use crate::{Icon, Palette, continuous_corner_layer, glyph};
use gpui_kit::{
    base::{
        Button, Input,
        input::{InputEditorStyle, InputState},
    },
    prelude::*,
    *,
};

const CORNER_RADIUS: f32 = 16.;

pub fn search_input(
    id: impl Into<ElementId>,
    input: &Entity<InputState>,
    clear_label: String,
    colors: Palette,
    win: &Window,
    cx: &mut App,
) -> Stateful<Div> {
    let focus = input.focus_handle(cx);
    let focused = focus.is_focused(win);
    let fill = if focused {
        colors.panel.blend(colors.secondary.opacity(0.03))
    } else {
        colors.panel
    };
    input.update(cx, |state, _| {
        state.set_editor_style(InputEditorStyle {
            foreground: colors.text.into(),
            muted_foreground: colors.secondary.into(),
            background: fill.into(),
            caret: colors.text.into(),
            selection: colors.secondary.opacity(0.2).into(),
            ..Default::default()
        });
    });
    let outside_focus = focus.clone();
    let has_text = !input.read(cx).value().is_empty();
    let clear_input = input.clone();
    div()
        .id(id)
        .relative()
        .flex()
        .flex_none()
        .items_center()
        .h(px(32.))
        .pl(px(12.))
        .pr(px(if has_text { 8. } else { 12. }))
        .gap(px(8.))
        .text_color(colors.border)
        .when(!focused, |s| {
            s.hover(move |s| s.text_color(colors.border_strong))
        })
        .on_click(move |_, win, cx| win.focus(&focus, cx))
        .on_mouse_down_out(move |_, win, cx| {
            if outside_focus.is_focused(win) {
                win.blur(cx);
            }
        })
        .child(continuous_corner_layer(px(CORNER_RADIUS), px(0.)))
        .child(
            div()
                .absolute()
                .inset_0()
                .text_color(fill)
                .child(continuous_corner_layer(px(CORNER_RADIUS), px(1.))),
        )
        .child(glyph(Icon::Search, colors.secondary).size(px(16.)))
        .child(
            div()
                .flex_1()
                .min_w_0()
                .h(px(20.))
                .text_color(colors.text)
                .text_size(px(12.))
                .line_height(px(20.))
                .font_weight(FontWeight::NORMAL)
                .child(Input::new(input)),
        )
        .when(has_text, |frame| {
            frame.child(
                Button::new("clear")
                    .accessibility_label(clear_label)
                    .relative()
                    .flex_none()
                    .flex()
                    .items_center()
                    .justify_center()
                    .size(px(24.))
                    .cursor_pointer()
                    .text_color(transparent_black())
                    .hover(move |s| s.text_color(colors.secondary.opacity(0.08)))
                    .focus_visible(move |s| s.text_color(colors.secondary.opacity(0.14)))
                    .child(continuous_corner_layer(px(12.), px(0.)))
                    .child(glyph(Icon::X, colors.secondary).size(px(16.)))
                    .on_click(move |_, win, cx| {
                        clear_input.update(cx, |state, cx| {
                            state.set_value("", win, cx);
                            state.focus(win, cx);
                        });
                    }),
            )
        })
}
