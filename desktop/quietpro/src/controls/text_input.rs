use crate::{Palette, continuous_corner_layer};
use gpui_kit::{
    base::{
        Input,
        input::{InputEditorStyle, InputState},
    },
    prelude::*,
    *,
};

const HEIGHT: f32 = 32.;
const CORNER_RADIUS: f32 = 16.;

#[derive(IntoElement)]
pub struct TextInput {
    id: ElementId,
    input: Entity<InputState>,
    colors: Palette,
    disabled: bool,
    invalid: bool,
    actions: Vec<AnyElement>,
}

impl TextInput {
    pub fn new(id: impl Into<ElementId>, input: &Entity<InputState>, colors: Palette) -> Self {
        Self {
            id: id.into(),
            input: input.clone(),
            colors,
            disabled: false,
            invalid: false,
            actions: Vec::new(),
        }
    }

    pub fn disabled(mut self, disabled: bool) -> Self {
        self.disabled = disabled;
        self
    }

    pub fn invalid(mut self, invalid: bool) -> Self {
        self.invalid = invalid;
        self
    }

    pub fn suffix(mut self, action: impl IntoElement) -> Self {
        self.actions.push(action.into_any_element());
        self
    }
}

impl RenderOnce for TextInput {
    fn render(self, win: &mut Window, cx: &mut App) -> impl IntoElement {
        let c = self.colors;
        let focus = self.input.focus_handle(cx);
        let focused = focus.is_focused(win);
        let fill = if focused {
            c.panel.blend(c.secondary.opacity(0.03))
        } else {
            c.panel
        };
        let foreground = if self.disabled {
            c.disabled_text
        } else {
            c.text
        };
        self.input.update(cx, |state, cx| {
            state.set_disabled(self.disabled, cx);
            state.set_editor_style(InputEditorStyle {
                foreground: foreground.into(),
                muted_foreground: c.secondary.into(),
                background: fill.into(),
                caret: c.text.into(),
                selection: c.secondary.opacity(0.2).into(),
                ..Default::default()
            });
        });
        let outside_focus = focus.clone();
        let has_actions = !self.actions.is_empty();
        div()
            .id(self.id)
            .relative()
            .flex()
            .flex_1()
            .min_w_0()
            .items_center()
            .h(px(HEIGHT))
            .pl(px(12.))
            .pr(px(if has_actions { 4. } else { 12. }))
            .gap(px(8.))
            .text_color(if self.invalid { c.danger } else { c.border })
            .when(!self.disabled && !self.invalid && !focused, |s| {
                s.hover(move |s| s.text_color(c.border_strong))
            })
            .when(!self.disabled, |s| {
                s.on_click(move |_, win, cx| win.focus(&focus, cx))
            })
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
            .child(
                div()
                    .flex_1()
                    .min_w_0()
                    .h(px(20.))
                    .text_color(foreground)
                    .text_size(px(14.))
                    .line_height(px(20.))
                    .font_weight(FontWeight::NORMAL)
                    .child(Input::new(&self.input)),
            )
            .when(has_actions, |s| {
                s.child(
                    crate::icon_actions()
                        .id("actions")
                        .on_click(|_, _, cx| cx.stop_propagation())
                        .children(self.actions),
                )
            })
    }
}
