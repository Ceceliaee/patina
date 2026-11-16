use crate::{Icon, Palette, continuous_corner_layer, glyph};
use gpui_kit::{
    App, Axis, ElementId, FocusHandle, FontWeight, KeyDownEvent, Window,
    base::{Radio, RadioGroup},
    div,
    prelude::*,
    px, transparent_black,
};
use std::rc::Rc;

const TRACK_RADIUS: f32 = 16.;
const OPTION_RADIUS: f32 = 12.;

const OPTION_PADDING: f32 = 8.;

/// A controlled, horizontal single-choice group. Only its selected option is a tab stop.
pub fn segmented<T: Copy + Eq + 'static, const N: usize>(
    id: impl Into<ElementId>,
    label: String,
    options: [(T, String, Option<Icon>, FocusHandle); N],
    selected: T,
    enabled: bool,
    colors: Palette,
    select: impl Fn(T, &mut Window, &mut App) + 'static,
) -> RadioGroup {
    let surface = |radius, inset, color| {
        div()
            .absolute()
            .inset_0()
            .text_color(color)
            .child(continuous_corner_layer(px(radius), px(inset)))
    };
    let track_fill = colors.chrome.blend(colors.canvas.opacity(0.6));
    let option_hover = track_fill.blend(colors.track.opacity(0.35));
    let mut group = RadioGroup::new(id)
        .aria_label(label)
        .axis(Axis::Horizontal)
        .relative()
        .flex()
        .flex_none()
        .items_center()
        .p(px(4.))
        .child(surface(TRACK_RADIUS, 0., colors.border))
        .child(surface(TRACK_RADIUS, 1., track_fill));
    let select = Rc::new(select);
    let options = Rc::new(options);
    for (index, (value, label, icon, focus)) in options.iter().enumerate() {
        let value = *value;
        let checked = value == selected;
        let keyboard_options = options.clone();
        let keyboard_select = select.clone();
        let click_select = select.clone();
        let fill = if checked {
            colors.panel
        } else {
            transparent_black().into()
        };
        let ink = if !enabled {
            colors.disabled_text
        } else if checked {
            colors.text
        } else {
            colors.secondary
        };
        let content = match icon {
            Some(icon) => glyph(*icon, ink).size(px(16.)).into_any_element(),
            None => div()
                .text_color(ink)
                .text_size(px(12.))
                .line_height(px(18.))
                .font_weight(FontWeight::SEMIBOLD)
                .child(label.clone())
                .into_any_element(),
        };
        let radio = Radio::new(("segment", index))
            .accessibility_label(label.clone())
            .set_position(index + 1, N)
            .checked(checked)
            .disabled(!enabled)
            .track_focus(focus)
            .tab_stop(checked)
            .relative()
            .flex()
            .flex_none()
            .items_center()
            .justify_center()
            .h(px(24.))
            .px(px(OPTION_PADDING))
            .whitespace_nowrap()
            .group("segment")
            .text_color(fill)
            .when(enabled, |s| {
                s.cursor_pointer()
                    .focus_visible(move |s| s.text_color(colors.secondary))
            })
            .child(continuous_corner_layer(px(OPTION_RADIUS), px(0.)))
            .child(
                div()
                    .id("fill")
                    .absolute()
                    .inset_0()
                    .text_color(fill)
                    .when(enabled && !checked, |s| {
                        s.group_hover("segment", move |s| s.text_color(option_hover))
                    })
                    .child(continuous_corner_layer(px(OPTION_RADIUS), px(1.))),
            )
            .child(content)
            .on_change(move |_, _, win, cx| click_select(value, win, cx))
            .when(enabled, |radio| {
                radio.on_key_down(move |event: &KeyDownEvent, win, cx| {
                    if event.keystroke.modifiers.modified() {
                        return;
                    }
                    let next = match event.keystroke.key.as_str() {
                        "left" => (index + N - 1) % N,
                        "right" => (index + 1) % N,
                        _ => return,
                    };
                    let (next_value, _, _, handle) = &keyboard_options[next];
                    win.focus(handle, cx);
                    keyboard_select(*next_value, win, cx);
                    cx.stop_propagation();
                })
            });
        group = group.child(radio);
    }
    group
}
