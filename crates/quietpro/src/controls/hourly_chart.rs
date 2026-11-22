use crate::{
    HOURLY_AXIS_GAP, HOURLY_BAR_TOP_RADIUS, HOURLY_BAR_WIDTH, Palette, dot_pattern,
    layout::{CHART_TOOLTIP_WIDTH, chart_axis_labels},
    tooltip_surface,
};
use gpui_kit::{prelude::*, *};
use std::{fmt::Write, time::Duration};

pub struct HourlySegment {
    pub label: String,
    pub value: String,
    pub fraction: f32,
    pub color: Rgba,
    pub dotted: bool,
}

pub struct HourlyBar {
    pub label: String,
    pub fraction: f32,
    /// Supply segments from the baseline up. The tooltip lists them from the top down.
    pub segments: Vec<HourlySegment>,
}

#[derive(IntoElement)]
pub struct HourlyChart {
    pub bars: [HourlyBar; 24],
    pub colors: Palette,
    pub total_color: Rgba,
    pub min_plot_height: Pixels,
    pub tooltip_id: &'static str,
}

struct ChartState {
    focus: [FocusHandle; 24],
    hovered: Option<usize>,
    focused: Option<usize>,
    hide: Option<Task<()>>,
    scroll: ScrollHandle,
}

impl ChartState {
    fn new(win: &mut Window, cx: &mut Context<Self>) -> Self {
        let focus = std::array::from_fn(|hour| {
            let focus = cx.focus_handle().tab_stop(true);
            cx.on_focus(&focus, win, move |_, win, cx| {
                cx.defer_in(win, move |state, _, cx| {
                    state.hide = None;
                    state.hovered = None;
                    state.focused = Some(hour);
                    state.scroll.set_offset(Point::default());
                    cx.notify();
                });
            })
            .detach();
            cx.on_blur(&focus, win, move |_, win, cx| {
                cx.defer_in(win, move |state, _, cx| {
                    if state.focused == Some(hour) {
                        state.focused = None;
                        cx.notify();
                    }
                });
            })
            .detach();
            focus
        });
        Self {
            focus,
            hovered: None,
            focused: None,
            hide: None,
            scroll: ScrollHandle::new(),
        }
    }

    fn hover(&mut self, hour: usize, over: bool, cx: &mut Context<Self>) {
        if over {
            self.hide = None;
            if self.hovered != Some(hour) {
                if self.hovered.or(self.focused) != Some(hour) {
                    self.scroll.set_offset(Point::default());
                }
                self.hovered = Some(hour);
                cx.notify();
            }
        } else if self.hovered == Some(hour) {
            // Allow the pointer to cross from a column into its scrollable tooltip.
            self.hide = Some(cx.spawn(async move |view, cx| {
                cx.background_executor()
                    .timer(Duration::from_millis(150))
                    .await;
                let _ = view.update(cx, |state, cx| {
                    if state.hovered == Some(hour) {
                        state.hovered = None;
                        cx.notify();
                    }
                });
            }));
        }
    }

    fn key(&mut self, hour: usize, event: &KeyDownEvent, cx: &mut Context<Self>) {
        if self.hovered.or(self.focused).is_none() {
            return;
        }
        match event.keystroke.key.as_str() {
            "escape" => {
                self.hide = None;
                self.hovered = None;
                self.focused = None;
            }
            key @ ("up" | "down") if self.hovered.or(self.focused) == Some(hour) => {
                let offset = self.scroll.offset();
                let delta = if key == "up" { 32. } else { -32. };
                self.scroll
                    .set_offset(point(offset.x, offset.y + px(delta)));
            }
            _ => return,
        }
        cx.notify();
        cx.stop_propagation();
    }
}

impl RenderOnce for HourlyChart {
    fn render(self, win: &mut Window, cx: &mut App) -> impl IntoElement {
        let state = win.use_keyed_state(self.tooltip_id, cx, ChartState::new);
        let c = self.colors;
        let mut plot = div()
            .relative()
            .flex()
            .items_end()
            .flex_1()
            .w_full()
            .min_h(self.min_plot_height)
            .border_b_1()
            .border_color(c.track);
        let mut tooltip = None;
        let active = state.read(cx).hovered.or(state.read(cx).focused);
        for (hour, bar) in self.bars.into_iter().enumerate() {
            let mut description = bar.label.clone();
            for segment in bar.segments.iter().rev() {
                let _ = write!(description, "\n{} {}", segment.label, segment.value);
            }
            if bar.fraction > 0. && active == Some(hour) {
                let hover = state.clone();
                tooltip = Some(
                    tooltip_surface(c)
                        .id(self.tooltip_id)
                        .accessibility_id(self.tooltip_id)
                        .role(Role::Tooltip)
                        .aria_label(description.clone())
                        .absolute()
                        .bottom(px(4.))
                        .when_else(hour < 12, |s| s.right_0(), |s| s.left_0())
                        .w(CHART_TOOLTIP_WIDTH)
                        .max_w_full()
                        .max_h(px(180.))
                        .overflow_y_scroll()
                        .track_scroll(&state.read(cx).scroll)
                        .on_hover(move |over, _, cx| {
                            hover.update(cx, |s, cx| s.hover(hour, *over, cx))
                        })
                        .child(bar.label)
                        .children(bar.segments.iter().rev().map(|s| {
                            div()
                                .flex()
                                .items_center()
                                .gap(px(4.))
                                .mt(px(4.))
                                .child(div().flex_none().size(px(6.)).rounded_full().bg(s.color))
                                .child(div().flex_1().min_w_0().child(s.label.clone()))
                                .child(s.value.clone())
                        })),
                );
            }
            let top = bar.segments.len().saturating_sub(1);
            let column = div()
                .w(px(HOURLY_BAR_WIDTH))
                .h(relative(bar.fraction.clamp(0., 1.)))
                .flex()
                .flex_col_reverse()
                .overflow_hidden()
                .rounded_t(px(HOURLY_BAR_TOP_RADIUS))
                .bg(self.total_color)
                .children(bar.segments.into_iter().enumerate().map(|(i, s)| {
                    div()
                        .relative()
                        .overflow_hidden()
                        .w_full()
                        .h(relative(s.fraction))
                        .when(i == top, |d| d.rounded_t(px(HOURLY_BAR_TOP_RADIUS)))
                        .bg(s.color)
                        .when(s.dotted, |d| d.child(dot_pattern(c.secondary)))
                }));
            plot = plot.child(
                div()
                    .id(("hour", hour))
                    .role(Role::Label)
                    .aria_value(description)
                    .flex_1()
                    .h_full()
                    .flex()
                    .items_end()
                    .justify_center()
                    .when(bar.fraction > 0., |d| {
                        let hover = state.clone();
                        let keys = state.clone();
                        d.track_focus(&state.read(cx).focus[hour])
                            .hover(move |s| s.bg(c.hover))
                            .focus_visible(move |s| s.border_1().border_color(c.secondary))
                            .on_hover(move |over, _, cx| {
                                hover.update(cx, |s, cx| s.hover(hour, *over, cx))
                            })
                            .on_key_down(move |event, _, cx| {
                                keys.update(cx, |s, cx| s.key(hour, event, cx))
                            })
                    })
                    .child(column),
            );
        }
        div()
            .flex_1()
            .min_h_0()
            .flex()
            .flex_col()
            .child(plot.children(tooltip))
            .child(
                chart_axis_labels(c)
                    .w_full()
                    .flex_none()
                    .mt(px(HOURLY_AXIS_GAP))
                    .children(
                        ["00:00", "06:00", "12:00", "18:00"]
                            .map(|h| div().w(relative(0.25)).child(h)),
                    ),
            )
    }
}
