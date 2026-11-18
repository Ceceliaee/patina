use crate::{Palette, content_card};
use gpui_kit::{prelude::*, *};
use std::rc::Rc;

const PLOT_MIN_HEIGHT: f32 = 160.;
const AXIS_GAP: f32 = 8.;
const AXIS_FONT_SIZE: f32 = 12.;
const LINE_WIDTH: f32 = 2.;
const DOT_SIZE: f32 = 4.;
const ACTIVE_DOT_SIZE: f32 = 6.;
const DOT_MIN_SPACING: f32 = 24.;
const AREA_OPACITY: f32 = 0.08;
const GRID_DASH: f32 = 4.;
const GRID_GAP: f32 = 4.;

pub struct TrendSeries {
    pub values: Vec<f32>,
    pub color: Rgba,
}

type Activate = Rc<dyn Fn(usize, &mut Window, &mut App)>;

/// Values are already aggregated and converted to the axis unit by the caller.
#[derive(IntoElement)]
pub struct TrendChart {
    pub id: SharedString,
    pub label: SharedString,
    pub labels: Vec<String>,
    pub descriptions: Vec<String>,
    pub series: Vec<TrendSeries>,
    pub colors: Palette,
    pub unit: SharedString,
    pub activate: Option<Activate>,
}

#[derive(Default)]
struct ChartState {
    labels: Vec<String>,
    focus: Vec<FocusHandle>,
    hovered: Option<usize>,
    focused: Option<usize>,
}

fn highlight(state: &Entity<ChartState>, i: usize, over: bool, cx: &mut App) {
    state.update(cx, |s, cx| {
        if over || s.hovered == Some(i) {
            s.hovered = over.then_some(i);
            cx.notify();
        }
    });
}

fn axis_limit(max: f32) -> f32 {
    let raw = (max / 3.).max(1.);
    let magnitude = 10f32.powf(raw.log10().floor());
    3. * magnitude
        * [1., 2., 3., 4., 6., 8., 10.]
            .into_iter()
            .find(|n| *n >= raw / magnitude)
            .unwrap_or(10.)
}

// Harmonic-mean tangents preserve monotonicity between adjacent samples.
fn tangents(values: &[f32]) -> Vec<f32> {
    if values.len() < 2 {
        return vec![0.; values.len()];
    }
    let slopes: Vec<_> = values.windows(2).map(|v| v[1] - v[0]).collect();
    let mut result = vec![0.; values.len()];
    result[0] = slopes[0];
    result[values.len() - 1] = *slopes.last().unwrap();
    for i in 1..values.len() - 1 {
        let (a, b) = (slopes[i - 1], slopes[i]);
        if a * b > 0. {
            result[i] = 2. * a * b / (a + b);
        }
    }
    result
}

fn column(i: usize, count: usize) -> (f32, f32) {
    if count <= 1 {
        return (0., 1.);
    }
    let step = 1. / (count - 1) as f32;
    let left = ((i as f32 - 0.5) * step).max(0.);
    let right = ((i as f32 + 0.5) * step).min(1.);
    (left, right - left)
}

impl RenderOnce for TrendChart {
    fn render(self, win: &mut Window, cx: &mut App) -> impl IntoElement {
        let state = win.use_keyed_state(self.id.clone(), cx, |_, _| ChartState::default());
        if state.read(cx).labels != self.labels {
            state.update(cx, |s, cx| {
                s.labels = self.labels.clone();
                s.hovered = None;
                s.focused = None;
                s.focus = (0..self.labels.len())
                    .map(|i| {
                        let focus = cx.focus_handle().tab_stop(true);
                        cx.on_focus(&focus, win, move |_, win, cx| {
                            cx.defer_in(win, move |s, _, cx| {
                                s.focused = Some(i);
                                cx.notify();
                            });
                        })
                        .detach();
                        cx.on_blur(&focus, win, move |_, win, cx| {
                            cx.defer_in(win, move |s, _, cx| {
                                if s.focused == Some(i) {
                                    s.focused = None;
                                    cx.notify();
                                }
                            });
                        })
                        .detach();
                        focus
                    })
                    .collect();
            });
        }
        let active = state.read(cx).hovered.or(state.read(cx).focused);
        let focuses = state.read(cx).focus.clone();
        let count = self.labels.len();
        let c = self.colors;
        let limit = axis_limit(
            self.series
                .iter()
                .flat_map(|s| &s.values)
                .copied()
                .fold(0., f32::max),
        );
        let tick_labels: Vec<_> = (0..4)
            .rev()
            .map(|i| format!("{:.0} {}", limit * i as f32 / 3., self.unit))
            .collect();
        let gutter = tick_labels
            .iter()
            .map(|label| {
                let run = win.text_style().to_run(label.len());
                f32::from(
                    win.text_system()
                        .shape_line(label.clone().into(), px(AXIS_FONT_SIZE), &[run], None)
                        .width,
                )
            })
            .fold(0., f32::max);
        let gutter = (gutter / 4.).ceil() * 4.;
        let series = self.series;
        let grid_lines = canvas(
            |_, _, _| (),
            move |bounds, _, win, _| {
                let width = f32::from(bounds.size.width);
                let height = f32::from(bounds.size.height);
                let mut path = PathBuilder::stroke(px(1.));
                for row in 0..4 {
                    let y = height * row as f32 / 3.;
                    let mut x = 0.;
                    while x < width {
                        path.move_to(bounds.origin + point(px(x), px(y)));
                        path.line_to(bounds.origin + point(px((x + GRID_DASH).min(width)), px(y)));
                        x += GRID_DASH + GRID_GAP;
                    }
                }
                let step = width / count.saturating_sub(1).max(1) as f32;
                let stride = (64. / step.max(1.)).ceil().max(1.) as usize;
                for i in 0..count {
                    if i % stride != 0 && i != count - 1 {
                        continue;
                    }
                    let x = if count == 1 {
                        width / 2.
                    } else {
                        i as f32 * step
                    };
                    let mut y = 0.;
                    while y < height {
                        path.move_to(bounds.origin + point(px(x), px(y)));
                        path.line_to(bounds.origin + point(px(x), px((y + GRID_DASH).min(height))));
                        y += GRID_DASH + GRID_GAP;
                    }
                }
                if let Ok(path) = path.build() {
                    win.paint_path(path, c.border.opacity(0.65));
                }
            },
        )
        .absolute()
        .inset_0()
        .size_full();
        let plot = canvas(
            |_, _, _| (),
            move |bounds, _, win, _| {
                let width = f32::from(bounds.size.width);
                let height = f32::from(bounds.size.height);
                for series_item in &series {
                    let values = &series_item.values;
                    if values.is_empty() {
                        continue;
                    }
                    let step = width / values.len().saturating_sub(1).max(1) as f32;
                    let pos = |i: usize, v: f32| {
                        bounds.origin
                            + point(
                                px(if values.len() == 1 {
                                    width / 2.
                                } else {
                                    i as f32 * step
                                }),
                                px(height * (1. - v / limit)),
                            )
                    };
                    let slopes = tangents(values);
                    let mut line = PathBuilder::stroke(px(LINE_WIDTH));
                    let mut area = PathBuilder::fill();
                    let first = pos(0, values[0]);
                    line.move_to(first);
                    area.move_to(first);
                    for i in 0..values.len() - 1 {
                        let start = pos(i, values[i]);
                        let end = pos(i + 1, values[i + 1]);
                        let c1 = start + point(px(step / 3.), px(-height * slopes[i] / limit / 3.));
                        let c2 =
                            end + point(px(-step / 3.), px(height * slopes[i + 1] / limit / 3.));
                        line.cubic_bezier_to(end, c1, c2);
                        area.cubic_bezier_to(end, c1, c2);
                    }
                    if values.len() > 1 {
                        let last = pos(values.len() - 1, 0.);
                        area.line_to(last);
                        area.line_to(pos(0, 0.));
                        area.close();
                        if let Ok(path) = area.build() {
                            win.paint_path(path, series_item.color.opacity(AREA_OPACITY));
                        }
                    }
                    if let Ok(path) = line.build() {
                        win.paint_path(path, series_item.color);
                    }
                    for (i, value) in values.iter().enumerate() {
                        if step < DOT_MIN_SPACING && active != Some(i) {
                            continue;
                        }
                        let size = if active == Some(i) {
                            ACTIVE_DOT_SIZE
                        } else {
                            DOT_SIZE
                        };
                        let origin = pos(i, *value) - point(px(size / 2.), px(size / 2.));
                        win.paint_quad(
                            fill(
                                Bounds::new(origin, gpui_kit::size(px(size), px(size))),
                                series_item.color,
                            )
                            .corner_radii(px(size / 2.)),
                        );
                    }
                }
            },
        )
        .absolute()
        .inset_0()
        .size_full();
        let mut grid = div()
            .relative()
            .flex_1()
            .min_w_0()
            .h_full()
            .child(grid_lines);
        if let Some(i) = active {
            let x = if count <= 1 {
                0.5
            } else {
                i as f32 / (count - 1) as f32
            };
            grid = grid.child(
                div()
                    .absolute()
                    .top_0()
                    .bottom_0()
                    .left(relative(x))
                    .ml(px(-1.))
                    .w(px(2.))
                    .bg(c.border),
            );
        }
        grid = grid.child(plot);
        for (i, description) in self.descriptions.iter().enumerate() {
            let (left, width) = column(i, count);
            let hover_state = state.clone();
            let key_state = state.clone();
            let click_action = self.activate.clone();
            let key_action = self.activate.clone();
            grid = grid.child(
                div()
                    .id(SharedString::from(format!(
                        "{}-{}",
                        self.id, self.labels[i]
                    )))
                    .accessibility_id(SharedString::from(format!(
                        "{}-{}",
                        self.id, self.labels[i]
                    )))
                    .role(Role::Label)
                    .aria_label(description.clone())
                    .absolute()
                    .top_0()
                    .bottom_0()
                    .left(relative(left))
                    .w(relative(width))
                    .track_focus(&focuses[i])
                    .focus_visible(move |s| s.border_1().border_color(c.secondary))
                    .on_hover(move |over, _, cx| highlight(&hover_state, i, *over, cx))
                    .when(self.activate.is_some(), |s| s.cursor_pointer())
                    .on_click(move |e, win, cx| {
                        if e.click_count() == 2
                            && let Some(action) = &click_action
                        {
                            action(i, win, cx);
                        }
                    })
                    .on_key_down(move |e: &KeyDownEvent, win, cx| {
                        if e.keystroke.key == "escape" {
                            key_state.update(cx, |s, cx| {
                                s.hovered = None;
                                s.focused = None;
                                cx.notify();
                            });
                            cx.stop_propagation();
                        } else if e.keystroke.key == "enter"
                            && let Some(action) = &key_action
                        {
                            action(i, win, cx);
                            cx.stop_propagation();
                        }
                    }),
            );
        }
        if let Some(description) = active.and_then(|i| self.descriptions.get(i)) {
            let x = if count <= 1 {
                0.5
            } else {
                active.unwrap_or(0) as f32 / (count - 1) as f32
            };
            grid = grid.child(
                content_card(c.border, c.panel)
                    .id("trend-tooltip")
                    .role(Role::Tooltip)
                    .aria_label(description.clone())
                    .absolute()
                    .top(px(8.))
                    .when_else(
                        x < 0.5,
                        |s| s.left(relative(x)).ml(px(8.)),
                        |s| s.right(relative(1. - x)).mr(px(8.)),
                    )
                    .p(px(8.))
                    .max_w(relative(0.45))
                    .text_size(px(12.))
                    .text_color(c.text)
                    .child(description.clone()),
            );
        }
        let tick_count = count.min(4);
        let ticks = div()
            .relative()
            .h(px(16.))
            .ml(px(gutter + AXIS_GAP))
            .text_size(px(AXIS_FONT_SIZE))
            .text_color(c.secondary)
            .children((0..tick_count).map(|tick| {
                let i = if tick_count == 1 {
                    0
                } else {
                    tick * (count - 1) / (tick_count - 1)
                };
                let label = self.labels[i]
                    .get(5..)
                    .unwrap_or(&self.labels[i])
                    .to_owned();
                div()
                    .absolute()
                    .w(px(64.))
                    .when_else(
                        count == 1,
                        |s| s.left(relative(0.5)).ml(px(-32.)).text_center(),
                        |s| {
                            if i == 0 {
                                s.left_0()
                            } else if i == count - 1 {
                                s.right_0().text_right()
                            } else {
                                s.left(relative(i as f32 / (count - 1) as f32))
                                    .ml(px(-32.))
                                    .text_center()
                            }
                        },
                    )
                    .child(label)
            }));
        div()
            .id(self.id.clone())
            .accessibility_id(self.id)
            .role(Role::Group)
            .aria_label(self.label)
            .w_full()
            .flex_1()
            .min_h(px(PLOT_MIN_HEIGHT + AXIS_GAP + 16.))
            .flex()
            .flex_col()
            .gap(px(AXIS_GAP))
            .child(
                div()
                    .flex()
                    .flex_1()
                    .min_h(px(PLOT_MIN_HEIGHT))
                    .gap(px(AXIS_GAP))
                    .child(
                        div()
                            .w(px(gutter))
                            .flex_none()
                            .flex()
                            .flex_col()
                            .justify_between()
                            .text_size(px(AXIS_FONT_SIZE))
                            .text_color(c.secondary)
                            .children(tick_labels.into_iter().map(|label| div().child(label))),
                    )
                    .child(grid),
            )
            .child(ticks)
    }
}

#[cfg(test)]
mod tests {
    use super::{axis_limit, column, tangents};

    #[test]
    fn curves_stay_between_samples() {
        for values in [
            vec![0., 12., 0., 3.],
            vec![2., 2., 8., 8.],
            vec![9., 3., 2., 0.],
        ] {
            let slopes = tangents(&values);
            for i in 0..values.len() - 1 {
                for step in 0..=100 {
                    let t = step as f32 / 100.;
                    let a = 1. - t;
                    let y = a.powi(3) * values[i]
                        + 3. * a.powi(2) * t * (values[i] + slopes[i] / 3.)
                        + 3. * a * t.powi(2) * (values[i + 1] - slopes[i + 1] / 3.)
                        + t.powi(3) * values[i + 1];
                    assert!(
                        y >= values[i].min(values[i + 1]) - 0.0001
                            && y <= values[i].max(values[i + 1]) + 0.0001
                    );
                }
            }
        }
    }

    #[test]
    fn edge_hit_regions_are_half_width_and_cover_plot() {
        assert_eq!(column(0, 1), (0., 1.));
        assert_eq!(column(0, 3), (0., 0.25));
        assert_eq!(column(1, 3), (0.25, 0.5));
        assert_eq!(column(2, 3), (0.75, 0.25));
        assert_eq!(axis_limit(0.), 3.);
        assert!(axis_limit(23.) >= 23.);
    }
}
