use crate::{
    ControlSize, Icon, Palette, continuous_corner_layer, glyph, superellipse::superellipse_layer,
};
use gpui_kit::{
    base::{Align, POPUP_PRIORITY, Placement, Positioner, Select},
    prelude::*,
    *,
};
use std::rc::Rc;

#[derive(Clone, Copy, PartialEq, Eq)]
enum TriggerWidth {
    WidestOption,
    SelectedValue,
    Fill,
}

struct MenuState {
    focus: FocusHandle,
    scroll: OptionScroll,
    bounds: Bounds<Pixels>,
    highlighted: Option<usize>,
}

enum OptionScroll {
    All(ScrollHandle),
    Virtual(UniformListScrollHandle),
}

type Choose<T> = Rc<dyn Fn(T, &mut Window, &mut App)>;
const FRAME_RADIUS: f32 = 16.;
const TRIGGER_INSET: f32 = 1. + super::CONTROL_HORIZONTAL_PADDING;
const ARROW_SIZE: f32 = 12.;

#[derive(IntoElement)]
pub struct Dropdown<T: Copy + Eq + 'static> {
    id: ElementId,
    label: SharedString,
    options: Rc<[(T, SharedString)]>,
    selected: T,
    colors: Palette,
    disabled: bool,
    icon: Option<(Icon, bool)>,
    trigger_size: Option<ControlSize>,
    value_font_size: Pixels,
    value_font_weight: FontWeight,
    option_font_size: Pixels,
    subdued_value: bool,
    selected_option_color: Rgba,
    trigger_width: TriggerWidth,
    virtual_width_sample: Option<SharedString>,
    choose: Choose<T>,
}

impl<T: Copy + Eq> Dropdown<T> {
    pub fn new(
        id: impl Into<ElementId>,
        label: impl Into<SharedString>,
        options: impl IntoIterator<Item = (T, impl Into<SharedString>)>,
        selected: T,
        colors: Palette,
        choose: impl Fn(T, &mut Window, &mut App) + 'static,
    ) -> Self {
        Self::with_shared_options(
            id,
            label,
            options.into_iter().map(|(v, n)| (v, n.into())).collect(),
            selected,
            colors,
            choose,
        )
    }

    pub fn with_shared_options(
        id: impl Into<ElementId>,
        label: impl Into<SharedString>,
        options: Rc<[(T, SharedString)]>,
        selected: T,
        colors: Palette,
        choose: impl Fn(T, &mut Window, &mut App) + 'static,
    ) -> Self {
        Self {
            id: id.into(),
            label: label.into(),
            options,
            selected,
            colors,
            disabled: false,
            icon: None,
            trigger_size: None,
            value_font_size: px(12.),
            value_font_weight: FontWeight::BOLD,
            option_font_size: px(12.),
            subdued_value: false,
            selected_option_color: colors.secondary,
            trigger_width: TriggerWidth::WidestOption,
            virtual_width_sample: None,
            choose: Rc::new(choose),
        }
    }
    pub fn disabled(mut self, disabled: bool) -> Self {
        self.disabled = disabled;
        self
    }

    pub fn icon(mut self, icon: Icon, active: bool) -> Self {
        self.icon = Some((icon, active));
        self
    }

    pub fn trigger_size(mut self, size: ControlSize) -> Self {
        self.trigger_size = Some(size);
        self
    }

    pub fn fit_trigger_to_value(mut self) -> Self {
        self.trigger_width = TriggerWidth::SelectedValue;
        self
    }

    pub fn fill_width(mut self) -> Self {
        self.trigger_width = TriggerWidth::Fill;
        self
    }

    pub fn virtualized(mut self, widest_label: impl Into<SharedString>) -> Self {
        self.virtual_width_sample = Some(widest_label.into());
        self
    }

    pub fn value_typography(mut self, size: Pixels, weight: FontWeight) -> Self {
        self.value_font_size = size;
        self.value_font_weight = weight;
        self
    }

    pub fn subdued_value(mut self) -> Self {
        self.subdued_value = true;
        self
    }

    pub fn medium_labels(mut self, size: Pixels) -> Self {
        self.option_font_size = size;
        self.value_typography(size, FontWeight::MEDIUM)
    }

    pub fn selected_option_color(mut self, color: Rgba) -> Self {
        self.selected_option_color = color;
        self
    }
}

fn layer(radius: f32, inset: f32, color: Rgba) -> Div {
    div()
        .absolute()
        .inset_0()
        .text_color(color)
        .child(continuous_corner_layer(px(radius), px(inset)))
}

fn highlight(state: &Entity<MenuState>, index: Option<usize>, cx: &mut App) {
    state.update(cx, |s, cx| {
        if s.highlighted != index {
            s.highlighted = index;
            if let Some(index) = index {
                match &s.scroll {
                    OptionScroll::All(list) => list.scroll_to_item(index),
                    OptionScroll::Virtual(list) => {
                        list.scroll_to_item(index, ScrollStrategy::Nearest)
                    }
                }
            }
            cx.notify();
        }
    });
}

impl<T: Copy + Eq> RenderOnce for Dropdown<T> {
    fn render(self, win: &mut Window, cx: &mut App) -> impl IntoElement {
        let virtualized = self.virtual_width_sample.is_some();
        let state_id = if virtualized {
            (self.id.clone(), "virtual-options").into()
        } else {
            self.id.clone()
        };
        let state = win.use_keyed_state(state_id, cx, |win, cx| {
            let focus = cx.focus_handle();
            cx.on_blur(&focus, win, |s: &mut MenuState, _, cx| {
                if s.highlighted.take().is_some() {
                    cx.notify();
                }
            })
            .detach();
            MenuState {
                focus,
                scroll: if virtualized {
                    OptionScroll::Virtual(UniformListScrollHandle::new())
                } else {
                    OptionScroll::All(ScrollHandle::new())
                },
                bounds: Bounds::default(),
                highlighted: None,
            }
        });
        let s = state.read(cx);
        let focus = s.focus.clone();
        let bounds = s.bounds;
        let active = s
            .highlighted
            .filter(|i| !self.disabled && *i < self.options.len());
        let selected = self.options.iter().position(|(v, _)| *v == self.selected);
        let value = selected
            .map(|i| self.options[i].1.clone())
            .unwrap_or_default();
        let c = self.colors;
        let disabled = self.disabled || self.options.is_empty();
        let icon = self.icon;
        let width_for = |name: &SharedString| {
            let mut run = win.text_style().to_run(name.len());
            run.font.weight = self.value_font_weight;
            win.text_system()
                .shape_line(name.clone(), self.value_font_size, &[run], None)
                .width
                .ceil()
                + px(2. * TRIGGER_INSET + super::LABEL_ARROW_GAP + ARROW_SIZE)
        };
        let width = self
            .virtual_width_sample
            .as_ref()
            .map(&width_for)
            .unwrap_or_else(|| {
                self.options
                    .iter()
                    .map(|(_, name)| width_for(name))
                    .max()
                    .unwrap_or_else(|| width_for(&value))
            });
        let open = active.is_some();
        let trigger_height = self
            .trigger_size
            .unwrap_or(if icon.is_some() {
                ControlSize::Medium
            } else {
                ControlSize::Large
            })
            .height();
        let trigger_width: Length = match (icon, self.trigger_width) {
            (Some(_), _) => trigger_height.into(),
            (_, TriggerWidth::SelectedValue) => width_for(&value).into(),
            (_, TriggerWidth::WidestOption) => width.into(),
            (_, TriggerWidth::Fill) => relative(1.).into(),
        };
        let toggle = {
            let state = state.clone();
            move |open: bool, win: &mut Window, cx: &mut App| {
                if open {
                    win.focus(&state.read(cx).focus.clone(), cx);
                }
                highlight(
                    &state,
                    if open {
                        Some(selected.unwrap_or(0))
                    } else {
                        None
                    },
                    cx,
                );
            }
        };
        let measure = state.clone();
        let ink = if disabled { c.disabled_text } else { c.text };
        let face = div()
            .id("trigger")
            .relative()
            .size_full()
            .flex()
            .items_center()
            .when(!disabled, |d| {
                d.cursor_pointer().on_click({
                    let toggle = toggle.clone();
                    move |_, win, cx| {
                        toggle(!open, win, cx);
                        cx.stop_propagation();
                    }
                })
            });
        let face = if let Some((icon, filtered)) = icon {
            face.justify_center()
                .text_color(if open || filtered {
                    c.secondary.opacity(0.08)
                } else {
                    transparent_black().into()
                })
                .when(!disabled, |d| {
                    d.hover(move |d| d.text_color(c.secondary.opacity(0.08)))
                })
                .child(superellipse_layer(false))
                .child(
                    div()
                        .absolute()
                        .inset_0()
                        .text_color(if focus.is_focused(win) && win.last_input_was_keyboard() {
                            c.secondary
                        } else {
                            transparent_black().into()
                        })
                        .child(superellipse_layer(true)),
                )
                .child(glyph(icon, ink).size(px(16.)))
        } else {
            face.group("dropdown-trigger")
                .when(self.trigger_width != TriggerWidth::SelectedValue, |d| {
                    d.justify_between()
                })
                .px(px(TRIGGER_INSET))
                .gap(px(super::LABEL_ARROW_GAP))
                .text_color(
                    if !disabled && focus.is_focused(win) && win.last_input_was_keyboard() {
                        c.secondary
                    } else {
                        c.border
                    },
                )
                .child(continuous_corner_layer(px(FRAME_RADIUS), px(0.)))
                .child(layer(FRAME_RADIUS, 1., c.panel))
                .child(
                    div()
                        .id("value")
                        .text_color(ink)
                        .when(self.subdued_value && !disabled, |d| {
                            d.text_color(c.secondary)
                                .group_hover("dropdown-trigger", move |s| s.text_color(c.text))
                                .group_active("dropdown-trigger", move |s| s.text_color(c.text))
                        })
                        .whitespace_nowrap()
                        .font_weight(self.value_font_weight)
                        .text_size(self.value_font_size)
                        .child(value.clone()),
                )
                .child(
                    glyph(
                        if open {
                            Icon::ChevronUp
                        } else {
                            Icon::ChevronDown
                        },
                        ink,
                    )
                    .size(px(ARROW_SIZE)),
                )
        };
        let face = face.child(
            canvas(
                move |b, _, cx| {
                    measure.update(cx, |s, cx| {
                        if s.bounds != b {
                            s.bounds = b;
                            if s.highlighted.is_some() {
                                cx.notify();
                            }
                        }
                    })
                },
                |_, _, _, _| {},
            )
            .absolute()
            .inset_0()
            .size_full(),
        );
        let options = self.options;
        if disabled {
            return Select::new(self.id)
                .disabled(true)
                .accessibility_label(self.label)
                .accessibility_value(value)
                .w(trigger_width)
                .h(trigger_height)
                .child(face)
                .into_any_element();
        }
        let choose = {
            let state = state.clone();
            let options = options.clone();
            move |i: usize, win: &mut Window, cx: &mut App| {
                highlight(&state, None, cx);
                win.focus(&state.read(cx).focus.clone(), cx);
                (self.choose)(options[i].0, win, cx);
            }
        };
        let mut root = div()
            .id(self.id)
            .role(Role::ComboBox)
            .aria_label(self.label.clone())
            .aria_value(value)
            .aria_expanded(open)
            .track_focus(&focus.tab_stop(true))
            .on_a11y_action(AccessibleAction::Expand, {
                let toggle = toggle.clone();
                move |_, win, cx| toggle(true, win, cx)
            })
            .on_a11y_action(AccessibleAction::Collapse, {
                let toggle = toggle.clone();
                move |_, win, cx| toggle(false, win, cx)
            })
            .on_a11y_action(AccessibleAction::Click, {
                let toggle = toggle.clone();
                move |_, win, cx| toggle(!open, win, cx)
            })
            .relative()
            .flex_none()
            .w(trigger_width)
            .h(trigger_height)
            .on_key_down({
                let state = state.clone();
                let choose = choose.clone();
                let toggle = toggle.clone();
                let count = options.len();
                move |e, win, cx| {
                    if e.keystroke.modifiers.modified() {
                        return;
                    }
                    match (e.keystroke.key.as_str(), active) {
                        ("enter" | "space" | "down" | "up", None) => toggle(true, win, cx),
                        ("enter" | "space", Some(i)) => choose(i, win, cx),
                        ("up", Some(i)) => highlight(&state, Some((i + count - 1) % count), cx),
                        ("down", Some(i)) => highlight(&state, Some((i + 1) % count), cx),
                        ("home", Some(_)) => highlight(&state, Some(0), cx),
                        ("end", Some(_)) => highlight(&state, Some(count - 1), cx),
                        ("escape", Some(_)) => highlight(&state, None, cx),
                        _ => return,
                    }
                    cx.stop_propagation();
                }
            })
            .child(face);
        if let Some(active) = active {
            let menu = div()
                .id("options")
                .role(Role::ListBox)
                .aria_label(self.label)
                .relative()
                .w(if self.trigger_width == TriggerWidth::Fill {
                    width.max(bounds.size.width)
                } else {
                    width
                })
                .flex()
                .flex_col()
                .p(px(5.))
                .occlude()
                .child(layer(FRAME_RADIUS, 0., c.border))
                .child(layer(FRAME_RADIUS, 1., c.panel))
                .on_mouse_down_out({
                    let state = state.clone();
                    move |e, _, cx| {
                        if !state.read(cx).bounds.contains(&e.position) {
                            highlight(&state, None, cx);
                        }
                    }
                });
            let selected_fill = c.panel.blend(c.secondary.opacity(0.055));
            let hover_fill = c.panel.blend(c.secondary.opacity(0.03));
            let selected_ink = self.selected_option_color;
            let option_font_size = self.option_font_size;
            let count = options.len();
            let render_row = move |i: usize| {
                let name = &options[i].1;
                let is_selected = selected == Some(i);
                let pick = choose.clone();
                div()
                    .id(("option", i))
                    .group("dropdown-option")
                    .role(Role::ListBoxOption)
                    .aria_label(name.clone())
                    .aria_selected(is_selected)
                    .when(i == active, |d| d.aria_active_descendant())
                    .relative()
                    .flex_none()
                    .h(px(28.))
                    .px(px(8.))
                    .flex()
                    .items_center()
                    .cursor_pointer()
                    .text_color(if is_selected {
                        selected_fill
                    } else if i == active {
                        hover_fill
                    } else {
                        c.panel
                    })
                    .when(!is_selected, |d| d.hover(move |d| d.text_color(hover_fill)))
                    .child(continuous_corner_layer(px(12.), px(0.)))
                    .child(
                        div()
                            .text_color(if is_selected {
                                selected_ink
                            } else {
                                c.secondary
                            })
                            .group_hover("dropdown-option", move |s| s.text_color(selected_ink))
                            .font_weight(FontWeight::MEDIUM)
                            .text_size(option_font_size)
                            .whitespace_nowrap()
                            .child(name.clone()),
                    )
                    .on_mouse_down(MouseButton::Left, |_, win, _| win.prevent_default())
                    .on_a11y_action(AccessibleAction::Click, {
                        let pick = pick.clone();
                        move |_, win, cx| pick(i, win, cx)
                    })
                    .on_click(move |_, win, cx| {
                        pick(i, win, cx);
                        cx.stop_propagation();
                    })
            };
            let height = px(28. * count.min(7) as f32)
                .min((win.viewport_size().height - px(26.)).max(px(0.)));
            let list = match &state.read(cx).scroll {
                OptionScroll::All(scroll) => div()
                    .id("option-scroll")
                    .flex()
                    .flex_col()
                    .max_h(height)
                    .overflow_y_scroll()
                    .track_scroll(scroll)
                    .children((0..count).map(render_row))
                    .into_any_element(),
                OptionScroll::Virtual(scroll) => {
                    uniform_list("option-scroll", count, move |range, _, _| {
                        range.map(&render_row).collect()
                    })
                    .w_full()
                    .h(height)
                    .track_scroll(scroll)
                    .into_any_element()
                }
            };
            root = root.child(
                deferred(
                    Positioner::side(bounds)
                        .placement(Placement::Bottom)
                        .align(
                            if icon.is_some() || self.trigger_width == TriggerWidth::SelectedValue {
                                Align::End
                            } else {
                                Align::Start
                            },
                        )
                        .offset(px(4.))
                        .margin(px(8.))
                        .occlude()
                        .child(menu.child(list)),
                )
                .with_priority(POPUP_PRIORITY),
            );
        }
        root.into_any_element()
    }
}
