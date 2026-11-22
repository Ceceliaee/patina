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
    fixed_mask: bool,
    placeholder_text_size: Option<Pixels>,
    value_weight: FontWeight,
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
            fixed_mask: false,
            placeholder_text_size: None,
            value_weight: FontWeight::NORMAL,
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

    pub fn fixed_mask(mut self) -> Self {
        self.fixed_mask = true;
        self
    }

    pub fn suffix(mut self, action: impl IntoElement) -> Self {
        self.actions.push(action.into_any_element());
        self
    }

    pub fn value_weight(mut self, weight: FontWeight) -> Self {
        self.value_weight = weight;
        self
    }

    pub fn placeholder_text_size(mut self, size: Pixels) -> Self {
        self.placeholder_text_size = Some(size);
        self
    }

    fn editor(&self, focused: bool, cx: &App) -> AnyElement {
        let input = Input::new(&self.input);
        let state = self.input.read(cx);
        if !self.fixed_mask || !state.presentation().is_masked() || state.text().len() == 0 {
            return input.into_any_element();
        }

        let c = self.colors;
        let selected = focused && !state.selected_range().is_empty();
        let color = if self.disabled {
            c.disabled_text
        } else {
            c.secondary
        };
        let dots = div()
            .flex()
            .items_center()
            .h(px(16.))
            .gap(px(4.))
            .when(selected, |s| s.bg(c.secondary.opacity(0.2)))
            .children((0..6).map(|_| div().flex_none().size(px(4.)).rounded_full().bg(color)));
        div()
            .relative()
            .size_full()
            .overflow_hidden()
            .flex()
            .items_center()
            .child(dots)
            .when(focused && !self.disabled && !selected, |s| {
                s.child(div().ml(px(1.)).w(px(1.)).h(px(16.)).bg(c.text))
            })
            // Keep the native editor on top for pointer, keyboard, IME and accessibility.
            .child(
                div()
                    .absolute()
                    .inset_0()
                    .size_full()
                    .opacity(0.)
                    .child(input),
            )
            .into_any_element()
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
        let empty = self.input.read(cx).text().len() == 0;
        let text_size = self
            .placeholder_text_size
            .filter(|_| empty)
            .unwrap_or(px(14.));
        let editor = self.editor(focused, cx);
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
                    .text_size(text_size)
                    .line_height(px(20.))
                    .font_weight(if empty {
                        FontWeight::NORMAL
                    } else {
                        self.value_weight
                    })
                    .child(editor),
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
