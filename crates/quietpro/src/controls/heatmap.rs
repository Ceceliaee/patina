use crate::{
    Palette,
    layout::{axis_label_width, chart_axis_labels},
};
use gpui_kit::{
    base::{Align, Button, POPUP_PRIORITY, Placement, Positioner},
    prelude::*,
    *,
};

pub const HEATMAP_CELL_SIZE: f32 = 12.;
pub const HEATMAP_CELL_GAP: f32 = 4.;
mod paint;

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
            .size_full()
            .flex_none()
            .p_0()
            .text_color(transparent_black())
            .when(self.enabled, |s| s.cursor_pointer())
            .child(
                canvas(
                    move |bounds, _, cx| {
                        measure.update(cx, |s, _| s.bounds = bounds);
                    },
                    move |bounds, (), window, cx| {
                        paint::cell(bounds, border, fill, window, cx);
                    },
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
                        .align(Align::Center)
                        .offset(px(8.))
                        .margin(px(8.))
                        .child(
                            crate::tooltip_surface(c)
                                .id("heatmap-tooltip")
                                .role(Role::Tooltip)
                                .aria_label(self.description.clone())
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
    fn render(self, win: &mut Window, _: &mut App) -> impl IntoElement {
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
            .map(|label| axis_label_width(label, win))
            .fold(0_f32, f32::max)
            .ceil();
        let slot = || {
            div()
                .relative()
                .flex_1()
                .min_w_0()
                .max_w(px(HEATMAP_CELL_SIZE))
        };
        let track = || {
            div()
                .flex()
                .flex_1()
                .min_w_0()
                .justify_between()
                .items_start()
                .gap(px(HEATMAP_CELL_GAP))
                .pr(px(4.))
        };
        let row = || div().flex().w_full().gap(px(8.)).items_center();
        let weekday = || div().relative().w(px(weekday_width)).flex_none();
        let month_row = row()
            .child(weekday())
            .child(track().children(months.into_iter().map(|month| {
                slot().h(px(16.)).child(
                    div()
                        .absolute()
                        .left_0()
                        .top_0()
                        .whitespace_nowrap()
                        .child(month),
                )
            })));
        let mut columns: Vec<_> = columns.into_iter().map(Vec::into_iter).collect();
        let mut grid = div().flex().flex_col().gap(px(HEATMAP_CELL_GAP));
        for (index, label) in weekdays.into_iter().enumerate() {
            let day_label = weekday().when(index % 2 == 0, |axis| {
                axis.child(
                    div()
                        .absolute()
                        .left_0()
                        .top(px(-8.))
                        .line_height(px(16.))
                        .whitespace_nowrap()
                        .child(label),
                )
            });
            let cells = columns.iter_mut().map(|week| {
                slot().aspect_square().children(
                    week.next()
                        .flatten()
                        .map(|cell| div().absolute().inset_0().child(cell)),
                )
            });
            grid = grid.child(row().child(day_label).child(track().children(cells)));
        }
        chart_axis_labels(c)
            .id(id)
            .w_full()
            .min_w_0()
            .flex_col()
            .gap(px(8.))
            .child(month_row)
            .child(grid)
    }
}
