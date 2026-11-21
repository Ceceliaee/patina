use crate::{ControlSize, Icon, Palette, continuous_corner_layer, glyph};
use gpui_kit::{
    App, Axis, ElementId, FocusHandle, FontWeight, KeyDownEvent, Window,
    base::{Radio, RadioGroup, TestSupportExt},
    div,
    prelude::*,
    px, transparent_black,
};
use std::rc::Rc;

const TRACK_RADIUS: f32 = 16.;
const OPTION_RADIUS: f32 = 12.;

const OPTION_PADDING: f32 = 8.;

pub struct SegmentSelection<T> {
    pub displayed: T,
    pub requested: T,
}

impl<T: Copy> From<T> for SegmentSelection<T> {
    fn from(value: T) -> Self {
        Self {
            displayed: value,
            requested: value,
        }
    }
}

/// A controlled, horizontal single-choice group. Only its selected option is a tab stop.
pub fn segmented<T: Copy + Eq + 'static>(
    id: impl Into<ElementId>,
    label: String,
    options: impl IntoIterator<Item = (T, String, Option<Icon>, FocusHandle)>,
    selected: T,
    enabled: bool,
    colors: Palette,
    select: impl Fn(T, &mut Window, &mut App) + 'static,
) -> RadioGroup {
    choice_group(
        (id, label),
        options,
        selected,
        enabled,
        colors,
        Layout::Row,
        select,
    )
}

/// Medium-weight labels use the primary text color on selection or hover.
/// The option's hit area spans the full height of the track.
pub fn segmented_with_medium_labels<T: Copy + Eq + 'static>(
    identity: (impl Into<ElementId>, String),
    options: impl IntoIterator<Item = (T, String, Option<Icon>, FocusHandle)>,
    selected: impl Into<SegmentSelection<T>>,
    enabled: bool,
    colors: Palette,
    option_size: ControlSize,
    select: impl Fn(T, &mut Window, &mut App) + 'static,
) -> RadioGroup {
    choice_group(
        identity,
        options,
        selected,
        enabled,
        colors,
        Layout::MediumLabels(option_size),
        select,
    )
}

/// A page header's view switch, with larger bold labels.
pub fn page_tabs<T: Copy + Eq + 'static>(
    identity: (impl Into<ElementId>, String),
    options: impl IntoIterator<Item = (T, String, Option<Icon>, FocusHandle)>,
    selected: impl Into<SegmentSelection<T>>,
    colors: Palette,
    select: impl Fn(T, &mut Window, &mut App) + 'static,
) -> RadioGroup {
    choice_group(
        identity,
        options,
        selected,
        true,
        colors,
        Layout::PageTabs,
        select,
    )
}

#[derive(Clone, Copy)]
enum Layout {
    Row,
    PageTabs,
    MediumLabels(ControlSize),
    Rail { labels: bool },
}

pub fn section_rail<T: Copy + Eq + 'static>(
    identity: (impl Into<ElementId>, String),
    options: impl IntoIterator<Item = (T, String, Option<Icon>, FocusHandle)>,
    selected: T,
    enabled: bool,
    colors: Palette,
    labels: bool,
    select: impl Fn(T, &mut Window, &mut App) + 'static,
) -> RadioGroup {
    choice_group(
        identity,
        options,
        selected,
        enabled,
        colors,
        Layout::Rail { labels },
        select,
    )
}

fn choice_group<T: Copy + Eq + 'static>(
    (id, label): (impl Into<ElementId>, String),
    options: impl IntoIterator<Item = (T, String, Option<Icon>, FocusHandle)>,
    selected: impl Into<SegmentSelection<T>>,
    enabled: bool,
    colors: Palette,
    layout: Layout,
    select: impl Fn(T, &mut Window, &mut App) + 'static,
) -> RadioGroup {
    let selection = selected.into();
    let selected = selection.displayed;
    let vertical = matches!(layout, Layout::Rail { .. });
    let labels = matches!(layout, Layout::Rail { labels: true });
    let (item_height, group_padding_y) = match layout {
        Layout::Row | Layout::PageTabs => (ControlSize::Small.height(), 4.),
        Layout::MediumLabels(size) => (size.height(), 0.),
        Layout::Rail { .. } => (px(40.), 4.),
    };
    let surface = |radius, inset, color| {
        div()
            .absolute()
            .inset_0()
            .text_color(color)
            .child(continuous_corner_layer(px(radius), px(inset)))
    };
    let track_fill = colors.chrome.blend(colors.canvas.opacity(0.6));
    let option_hover = track_fill.blend(colors.track.opacity(0.35));
    let medium_labels = matches!(layout, Layout::MediumLabels(_));
    let face_inset_y = px(if medium_labels { 2. } else { 0. });
    let mut group = RadioGroup::new(id)
        .aria_label(label)
        .text_size(px(if matches!(layout, Layout::PageTabs) {
            14.
        } else {
            12.
        }))
        .font_weight(if medium_labels {
            FontWeight::MEDIUM
        } else {
            FontWeight::BOLD
        })
        .axis(if vertical {
            Axis::Vertical
        } else {
            Axis::Horizontal
        })
        .relative()
        .flex()
        .flex_none()
        .when(vertical, |this| this.flex_col().gap(px(4.)))
        .items_center()
        .px(px(4.))
        .py(px(group_padding_y))
        .child(surface(TRACK_RADIUS, 0., colors.border))
        .child(surface(TRACK_RADIUS, 1., track_fill));
    let select = Rc::new(select);
    let options = Rc::new(options.into_iter().collect::<Vec<_>>());
    let count = options.len();
    let tab_index = options
        .iter()
        .position(|(value, ..)| *value == selected)
        .unwrap_or(0);
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
        let caption = div()
            .text_color(ink)
            .when(
                enabled && matches!(layout, Layout::PageTabs | Layout::MediumLabels(_)),
                |s| s.group_hover("segment", move |s| s.text_color(colors.text)),
            )
            .line_height(px(18.))
            .max_w_full()
            .truncate()
            .child(label.clone());
        let content = match icon {
            Some(icon) => div()
                .flex()
                .flex_col()
                .items_center()
                .gap(px(4.))
                .child(glyph(*icon, ink).size(px(if vertical && !labels { 20. } else { 16. })))
                .when(labels, |this| this.child(caption))
                .into_any_element(),
            None => caption.into_any_element(),
        };
        let radio = Radio::new(("segment", index))
            .accessibility_label(label.clone())
            .set_position(index + 1, count)
            .checked(checked)
            .disabled(!enabled)
            .track_focus(focus)
            .tab_stop(index == tab_index)
            .relative()
            .flex()
            .flex_none()
            .items_center()
            .justify_center()
            .h(item_height)
            .when(vertical, |s| s.w(px(if labels { 88. } else { 40. })))
            .px(px(OPTION_PADDING))
            .whitespace_nowrap()
            .group("segment")
            .text_color(if medium_labels {
                transparent_black().into()
            } else {
                fill
            })
            .when(enabled, |s| {
                s.cursor_pointer()
                    .focus_visible(move |s| s.text_color(colors.secondary))
            })
            .child(
                div()
                    .absolute()
                    .left_0()
                    .right_0()
                    .top(face_inset_y)
                    .bottom(face_inset_y)
                    .child(continuous_corner_layer(px(OPTION_RADIUS), px(0.)))
                    .child(
                        div()
                            .id("fill")
                            .absolute()
                            .inset(px(1.))
                            .text_color(fill)
                            .when(enabled && !checked, |s| {
                                s.group_hover("segment", move |s| s.text_color(option_hover))
                            })
                            .child(continuous_corner_layer(px(OPTION_RADIUS - 1.), px(0.)))
                            .test_support(),
                    ),
            )
            .child(content)
            .when(
                enabled && checked && value != selection.requested,
                |radio| {
                    let select = select.clone();
                    radio.on_click(move |_, win, cx| select(value, win, cx))
                },
            )
            .on_change(move |_, _, win, cx| click_select(value, win, cx))
            .when(enabled, |radio| {
                radio.on_key_down(move |event: &KeyDownEvent, win, cx| {
                    if event.keystroke.modifiers.modified() {
                        return;
                    }
                    let next = match event.keystroke.key.as_str() {
                        "left" if !vertical => (index + count - 1) % count,
                        "right" if !vertical => (index + 1) % count,
                        "up" if vertical => (index + count - 1) % count,
                        "down" if vertical => (index + 1) % count,
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
