use crate::{Palette, content_card, continuous_frame};
use gpui_kit::{
    base::{Align, Button, POPUP_PRIORITY, Placement, Positioner},
    prelude::*,
    *,
};

pub const HEATMAP_CELL_SIZE: f32 = 12.;
pub const HEATMAP_CELL_GAP: f32 = 4.;

fn heatmap_column() -> Div {
    div()
        .flex()
        .flex_col()
        .flex_none()
        .gap(px(HEATMAP_CELL_GAP))
}

struct CellState {
    focus: FocusHandle,
    bounds: Bounds<Pixels>,
    hovered: bool,
    focused: bool,
}

/// An activity sample, not a general-purpose icon button.
#[derive(IntoElement)]
pub struct HeatmapCell {
    pub state_key: SharedString,
    pub tab_stop: bool,
    pub focus: FocusHandle,
    pub focus_changed: std::rc::Rc<dyn Fn(&mut App)>,
    pub navigate: Navigate,
    pub id: SharedString,
    pub label: String,
    pub description: String,
    pub intensity: f32,
    pub size: f32,
    pub enabled: bool,
    pub future: bool,
    pub colors: Palette,
    pub activate: Option<Activate>,
}

type Activate = std::rc::Rc<dyn Fn(&mut Window, &mut App)>;
type Navigate = std::rc::Rc<dyn Fn(&KeyDownEvent, &mut Window, &mut App) -> bool>;

impl RenderOnce for HeatmapCell {
    fn render(self, win: &mut Window, cx: &mut App) -> impl IntoElement {
        let supplied_focus = self.focus.clone();
        let focus_changed = self.focus_changed;
        let state = win.use_keyed_state(self.state_key.clone(), cx, |win, cx| {
            let focus = supplied_focus;
            cx.on_focus(&focus, win, move |_, win, cx| {
                let focus_changed = focus_changed.clone();
                cx.defer_in(win, move |s: &mut CellState, _, cx| {
                    s.focused = true;
                    focus_changed(cx);
                    cx.notify();
                });
            })
            .detach();
            cx.on_blur(&focus, win, |_, win, cx| {
                cx.defer_in(win, |s: &mut CellState, _, cx| {
                    s.focused = false;
                    cx.notify();
                });
            })
            .detach();
            CellState {
                focus,
                bounds: Bounds::default(),
                hovered: false,
                focused: false,
            }
        });
        let c = self.colors;
        let active = self.enabled && (state.read(cx).hovered || state.read(cx).focused);
        let fill = if self.future {
            c.panel.blend(c.canvas.opacity(0.35))
        } else if self.intensity > 0. {
            c.panel.blend(c.accent.opacity(self.intensity))
        } else {
            c.canvas
        };
        let border = if self.future {
            c.panel.blend(c.border.opacity(0.4))
        } else if active {
            c.border.blend(c.secondary.opacity(0.2))
        } else if self.intensity == 0. {
            c.border
        } else {
            fill
        };
        let focus = state.read(cx).focus.clone();
        let measure = state.clone();
        let hover = state.clone();
        let keys = state.clone();
        let activate = self.activate;
        let navigate = self.navigate;
        let mut cell = Button::new(self.id.clone())
            .accessibility_id(self.id)
            .accessibility_label(self.label)
            .aria_description(self.description.clone())
            .disabled(!self.enabled)
            .track_focus(&focus)
            .tab_stop(self.tab_stop)
            .relative()
            .size(px(self.size))
            .flex_none()
            .p_0()
            .text_color(transparent_black())
            .when(self.enabled, |s| s.cursor_pointer())
            .child(continuous_frame(px(4.), border, fill).size_full())
            .child(
                canvas(
                    move |bounds, _, cx| {
                        measure.update(cx, |s, _| s.bounds = bounds);
                    },
                    |_, _, _, _| {},
                )
                .absolute()
                .inset_0()
                .size_full(),
            )
            .on_hover(move |over, _, cx| {
                hover.update(cx, |s, cx| {
                    s.hovered = *over;
                    cx.notify();
                });
            })
            .on_key_down(move |e, win, cx| {
                if navigate(e, win, cx) {
                    cx.stop_propagation();
                }
                if e.keystroke.key == "escape" {
                    keys.update(cx, |s, cx| {
                        s.hovered = false;
                        s.focused = false;
                        cx.notify();
                    });
                    cx.stop_propagation();
                }
            })
            .on_click(move |e, win, cx| {
                if (e.is_keyboard() || e.click_count() == 2)
                    && let Some(action) = &activate
                {
                    action(win, cx);
                }
            });
        if active {
            cell = cell.child(
                deferred(
                    Positioner::side(state.read(cx).bounds)
                        .placement(Placement::Top)
                        .align(Align::Start)
                        .offset(px(8.))
                        .margin(px(8.))
                        .child(
                            content_card(c.border, c.panel)
                                .id("heatmap-tooltip")
                                .role(Role::Tooltip)
                                .aria_label(self.description.clone())
                                .p(px(8.))
                                .text_size(px(12.))
                                .text_color(c.text)
                                .child(self.description),
                        ),
                )
                .with_priority(POPUP_PRIORITY),
            );
        }
        cell
    }
}

/// Month and weekday captions are localized by the feature owning the dates.
pub fn heatmap_layout(
    id: impl Into<ElementId>,
    months: Vec<String>,
    weekdays: [String; 7],
    columns: Vec<Vec<Option<HeatmapCell>>>,
    c: Palette,
) -> impl IntoElement {
    HeatmapLayout {
        id: id.into(),
        months,
        weekdays,
        columns,
        colors: c,
    }
}

#[derive(IntoElement)]
struct HeatmapLayout {
    id: ElementId,
    months: Vec<String>,
    weekdays: [String; 7],
    columns: Vec<Vec<Option<HeatmapCell>>>,
    colors: Palette,
}

impl RenderOnce for HeatmapLayout {
    fn render(self, win: &mut Window, cx: &mut App) -> impl IntoElement {
        let Self {
            id,
            months,
            weekdays,
            columns,
            colors: c,
        } = self;
        let weekday_width = weekdays
            .iter()
            .step_by(2)
            .map(|label| {
                let run = win.text_style().to_run(label.len());
                f32::from(
                    win.text_system()
                        .shape_line(label.clone().into(), px(12.), &[run], None)
                        .width,
                )
            })
            .fold(0_f32, f32::max)
            .ceil();
        let state = win.use_keyed_state(id.clone(), cx, |_, _| 0_f32);
        let measure = state.clone();
        let count = columns.len();
        let (cell_size, step, width) = grid_geometry(*state.read(cx), count);
        let labels = div().relative().h(px(16.)).w(px(width)).children(
            months
                .into_iter()
                .enumerate()
                .filter(|(_, label)| !label.is_empty())
                .map(|(i, label)| div().absolute().left(px(i as f32 * step)).child(label)),
        );
        div()
            .relative()
            .w_full()
            .min_w_0()
            .flex_none()
            .flex()
            .gap(px(8.))
            .child(
                canvas(
                    move |bounds, _, cx| {
                        measure.update(cx, |s, cx| {
                            let available =
                                (f32::from(bounds.size.width) - weekday_width - 8. - 4.).max(0.);
                            if (*s - available).abs() > 0.5 {
                                *s = available;
                                cx.notify();
                            }
                        });
                    },
                    |_, _, _, _| {},
                )
                .absolute()
                .inset_0()
                .size_full(),
            )
            .text_size(px(12.))
            .text_color(c.secondary)
            .child(
                div()
                    .flex()
                    .flex_col()
                    .gap(px(4.))
                    .w(px(weekday_width))
                    .flex_none()
                    .pt(px(24.))
                    .children(weekdays.into_iter().enumerate().map(|(i, label)| {
                        div()
                            .h(px(cell_size))
                            .line_height(px(cell_size))
                            .flex_none()
                            .child(if i % 2 == 0 { label } else { String::new() })
                    })),
            )
            .child(
                div().id(id).min_w_0().flex_1().pr(px(4.)).child(
                    div()
                        .flex()
                        .flex_col()
                        .gap(px(8.))
                        .flex_none()
                        .w(px(width))
                        .child(labels)
                        .child(
                            div()
                                .relative()
                                .h(px(7. * cell_size + 6. * HEATMAP_CELL_GAP + 1.))
                                .children(columns.into_iter().enumerate().map(
                                    |(index, column)| {
                                        heatmap_column()
                                            .absolute()
                                            .left(px(index as f32 * step))
                                            .children(column.into_iter().map(|cell| {
                                                match cell {
                                                    Some(mut cell) => {
                                                        cell.size = cell_size;
                                                        cell.into_any_element()
                                                    }
                                                    None => div()
                                                        .size(px(cell_size))
                                                        .flex_none()
                                                        .into_any_element(),
                                                }
                                            }))
                                    },
                                )),
                        ),
                ),
            )
    }
}

// Fit the entire year, including narrow detail panels, without horizontal scrolling.
fn grid_geometry(available: f32, count: usize) -> (f32, f32, f32) {
    let count = count.max(1) as f32;
    let available = available.max(0.);
    let gap = HEATMAP_CELL_GAP.min(available / (2. * count - 1.));
    let size = ((available - (count - 1.) * gap) / count).clamp(0., HEATMAP_CELL_SIZE);
    let width = available;
    let step = if count > 1. {
        (width - size) / (count - 1.)
    } else {
        size
    };
    (size, step, width)
}

#[cfg(test)]
mod tests {
    use super::grid_geometry;

    #[test]
    fn year_grid_fills_available_width_without_a_size_jump() {
        for columns in [53, 54] {
            for available in [160., 320., 500., 720., 800., 840., 880., 960., 1200.] {
                let (size, step, width) = grid_geometry(available, columns);
                assert!((width - available).abs() < 0.01);
                assert!((0. ..=12.).contains(&size));
                assert!(step >= size);
                if available >= 428. {
                    assert!(step - size >= 3.99);
                }
                assert!(((columns - 1) as f32 * step + size - width).abs() < 0.01);
            }
        }
        let (before, _, _) = grid_geometry(843., 53);
        let (after, _, _) = grid_geometry(844., 53);
        assert!((after - before).abs() < 0.1);
        let (size, _, width) = grid_geometry(500., 53);
        assert!(size < 8.);
        assert_eq!(width, 500.);
    }
}
