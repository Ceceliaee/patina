use super::{SUMMARY_MIN_HEIGHT, Today, content_card, panel, title, value};
use crate::features::format::duration;
use gpui_kit::{prelude::*, *};
use patina_activity_model::{DaySummary, Locale, format_text, text};
use quietpro::{
    CARD_TITLE_GAP, HOURLY_AXIS_FONT_SIZE, HOURLY_AXIS_GAP, HOURLY_BAR_TOP_RADIUS,
    HOURLY_BAR_WIDTH, HOURLY_PLOT_MIN_HEIGHT,
};
use quietpro::{Palette, activity_display_color, caption};

pub(super) fn focus(
    data: &DaySummary,
    locale: Locale,
    content_width: f32,
    colors: Palette,
    dark: bool,
) -> Stateful<Div> {
    let limit = if content_width >= 440. { 6 } else { 4 };
    let compact = content_width < 320.;
    let donut_size = if compact {
        quietpro::DONUT_COMPACT_SIZE
    } else {
        quietpro::DONUT_SIZE
    };
    let mut slices: Vec<_> = data
        .categories
        .iter()
        .take(limit)
        .map(|c| {
            (
                c.label.clone(),
                c.duration_ms,
                activity_display_color(c.color, colors.panel, dark),
                c.id == "anonymous",
            )
        })
        .collect();
    let rest: i64 = data
        .categories
        .iter()
        .skip(limit)
        .map(|c| c.duration_ms)
        .sum();
    if rest > 0 {
        slices.push((
            text(locale, "hourlyActivityChart.remainingCategories"),
            rest,
            activity_display_color(u32::from(colors.secondary) >> 8, colors.panel, dark),
            false,
        ));
    }
    let mut legend = div().min_w_0().flex_1().flex().flex_col().gap(px(4.));
    for (label, ms, color, dotted) in &slices {
        legend = legend.child(
            div()
                .flex()
                .min_h(px(24.))
                .items_center()
                .gap(px(8.))
                .child(
                    div()
                        .relative()
                        .overflow_hidden()
                        .flex_none()
                        .size(px(8.))
                        .rounded_full()
                        .bg(*color)
                        .when(*dotted, |s| {
                            s.child(quietpro::dot_pattern(colors.secondary))
                        }),
                )
                .child(value(label.clone()).min_w_0().flex_1().truncate())
                .child(div().flex_none().whitespace_nowrap().child(duration(*ms))),
        );
    }
    if slices.is_empty() {
        legend = legend.child(caption(text(locale, "dashboard.emptyState"), colors));
    }
    let total = data.total_duration_ms;
    let donut = quietpro::DonutChart {
        id: "today-focus-donut".into(),
        compact,
        colors,
        slices: slices
            .iter()
            .map(|(label, ms, color, dotted)| {
                let percent = if total > 0 {
                    *ms as f64 / total as f64 * 100.
                } else {
                    0.
                };
                quietpro::DonutSlice {
                    value: *ms as f64,
                    color: *color,
                    description: format!("{label} · {} · {percent:.0}%", duration(*ms)).into(),
                    dotted: *dotted,
                }
            })
            .collect(),
    };
    let delta = total - data.yesterday_duration_ms;
    let direction = match delta.cmp(&0) {
        std::cmp::Ordering::Greater => "increase",
        std::cmp::Ordering::Less => "decrease",
        _ => "same",
    };
    let label = format_text(
        locale,
        "dashboard.comparedWithYesterday",
        &[
            ("direction", direction.into()),
            ("deltaLabel", duration(delta.abs())),
        ],
    );
    content_card(colors.border, colors.panel)
        .id("today-focus-panel")
        .role(Role::Group)
        .accessibility_id("today-focus-panel")
        .flex_1()
        .min_h(px(SUMMARY_MIN_HEIGHT))
        .child(title(text(locale, "dashboard.focusShare")).mb(px(CARD_TITLE_GAP)))
        .child(
            div()
                .flex_1()
                .min_w_0()
                .flex()
                .items_center()
                .gap(px(16.))
                .text_size(px(12.))
                .child(
                    div()
                        .relative()
                        .flex_none()
                        .size(px(donut_size))
                        .flex()
                        .flex_col()
                        .gap(px(4.))
                        .items_center()
                        .justify_center()
                        .child(donut)
                        .child(
                            value(duration(total))
                                .text_size(px(20.))
                                .font_weight(FontWeight::SEMIBOLD),
                        )
                        .child(caption(text(locale, "dashboard.total"), colors)),
                )
                .child(legend),
        )
        .child(
            div()
                .id("today-comparison")
                .role(Role::Group)
                .accessibility_id(format!("today-comparison-{direction}"))
                .flex_none()
                .flex()
                .items_center()
                .gap(px(4.))
                .pt(px(CARD_TITLE_GAP))
                .justify_end()
                .child(
                    quietpro::glyph(
                        match delta.cmp(&0) {
                            std::cmp::Ordering::Greater => quietpro::Icon::TrendingUp,
                            std::cmp::Ordering::Less => quietpro::Icon::TrendingDown,
                            _ => quietpro::Icon::Minus,
                        },
                        colors.secondary,
                    )
                    .size(px(12.)),
                )
                .child(value(label).text_color(colors.secondary).text_size(px(12.))),
        )
}

impl Today {
    pub(super) fn show_hour(&mut self, hour: usize, visible: bool, cx: &mut Context<Self>) {
        self.hour_hide = None;
        if visible {
            if self.active_hour != Some(hour) {
                self.hour_scroll.set_offset(point(px(0.), px(0.)));
                self.active_hour = Some(hour);
                cx.notify();
            }
        } else if self.active_hour == Some(hour) {
            self.hour_hide = Some(cx.spawn(async move |view, cx| {
                cx.background_executor()
                    .timer(std::time::Duration::from_millis(150))
                    .await;
                let _ = view.update(cx, |this, cx| {
                    if this.active_hour == Some(hour) {
                        this.active_hour = None;
                        cx.notify();
                    }
                });
            }));
        }
    }

    pub(super) fn hourly(
        &self,
        data: &DaySummary,
        wide: bool,
        colors: Palette,
        dark: bool,
        cx: &mut Context<Self>,
    ) -> Div {
        let grouped = data.chart_by_category;
        let locale = self.client.locale.get();
        let category_colors: Vec<_> = data
            .categories
            .iter()
            .map(|category| {
                (
                    category,
                    activity_display_color(category.color, colors.panel, dark),
                )
            })
            .collect();
        let remaining_color =
            activity_display_color(u32::from(colors.secondary) >> 8, colors.panel, dark);
        let total_color = activity_display_color(u32::from(colors.accent) >> 8, colors.panel, dark);
        let mut tooltip = None;
        let mut bars = div()
            .relative()
            .flex_1()
            .min_h(px(HOURLY_PLOT_MIN_HEIGHT))
            .flex()
            .items_end()
            .border_b_1()
            .border_color(colors.track);
        for hour in 0..24 {
            let mut segments: Vec<_> = category_colors
                .iter()
                .map(|(c, color)| {
                    (
                        c.hourly_duration_ms[hour],
                        c.label.clone(),
                        *color,
                        c.id == "anonymous",
                    )
                })
                .filter(|(ms, _, _, _)| *ms > 0)
                .collect();
            segments.sort_by_key(|s| s.0);
            let ms: i64 = segments.iter().map(|s| s.0).sum();
            let minutes = if ms < 60_000 {
                0
            } else {
                (ms + 30_000) / 60_000
            };
            let mut remaining = minutes;
            let count = segments.len();
            for (index, (ms, _, _, _)) in segments.iter_mut().enumerate() {
                *ms = if index + 1 == count {
                    remaining
                } else {
                    ((*ms + 30_000) / 60_000).min(remaining)
                };
                remaining -= *ms;
            }
            segments.retain(|s| s.0 > 0);
            let limit = if wide { 6 } else { 4 };
            if segments.len() > limit {
                let rest = segments.drain(..segments.len() - limit).map(|s| s.0).sum();
                segments.insert(
                    0,
                    (
                        rest,
                        text(locale, "hourlyActivityChart.remainingCategories"),
                        remaining_color,
                        false,
                    ),
                );
            }
            let mut tip = format!(
                "{hour:02}:00 · {} {minutes}m",
                text(locale, "hourlyActivityChart.activeMinutes")
            );
            if grouped {
                for (m, label, _, _) in segments.iter().rev() {
                    tip.push_str(&format!("\n{label} {m}m"));
                }
            }
            let tip_segments = segments.clone();
            let mut bar = div()
                .h(relative(minutes.min(60) as f32 / 60.))
                .w(px(HOURLY_BAR_WIDTH))
                .flex()
                .flex_col_reverse()
                .overflow_hidden()
                .rounded_t(px(HOURLY_BAR_TOP_RADIUS));
            if grouped {
                let top_segment = segments.len().saturating_sub(1);
                for (index, (m, _, color, dotted)) in segments.into_iter().enumerate() {
                    bar = bar.child(
                        div()
                            .relative()
                            .overflow_hidden()
                            .w_full()
                            .h(relative(m as f32 / minutes as f32))
                            .when(index == top_segment, |s| {
                                s.rounded_t(px(HOURLY_BAR_TOP_RADIUS))
                            })
                            .bg(color)
                            .when(dotted, |s| s.child(quietpro::dot_pattern(colors.secondary))),
                    );
                }
            } else {
                bar = bar.bg(total_color);
            }
            if minutes > 0 && self.active_hour == Some(hour) {
                tooltip = Some(
                    panel(colors.border, colors.panel)
                        .id("hour-tooltip")
                        .on_hover(
                            cx.listener(move |this, over, _, cx| this.show_hour(hour, *over, cx)),
                        )
                        .role(Role::Tooltip)
                        .aria_label(tip.clone())
                        .absolute()
                        .bottom(px(4.))
                        .when_else(hour < 12, |s| s.right_0(), |s| s.left_0())
                        .p(px(8.))
                        .text_size(px(12.))
                        .text_color(colors.text)
                        .w(px(220.))
                        .max_h(px(180.))
                        .overflow_y_scroll()
                        .track_scroll(&self.hour_scroll)
                        .child(format!(
                            "{hour:02}:00 · {} {minutes}m",
                            text(locale, "hourlyActivityChart.activeMinutes")
                        ))
                        .children(tip_segments.iter().rev().filter(|_| grouped).map(
                            |(m, name, color, _)| {
                                div()
                                    .flex()
                                    .items_center()
                                    .gap(px(6.))
                                    .mt(px(4.))
                                    .child(div().size(px(6.)).rounded_full().bg(*color))
                                    .child(div().flex_1().min_w_0().child(name.clone()))
                                    .child(format!("{m}m"))
                            },
                        )),
                );
            }
            bars = bars.child(
                div()
                    .id(("hour", hour))
                    .role(Role::Label)
                    .aria_value(tip.clone())
                    .flex_1()
                    .h_full()
                    .flex()
                    .items_end()
                    .justify_center()
                    .when(minutes > 0, |s| {
                        s.hover(move |s| s.bg(colors.hover))
                            .track_focus(&self.hour_focus[hour])
                            .focus_visible(move |s| s.border_1().border_color(colors.secondary))
                            .on_hover(
                                cx.listener(move |this, over, _, cx| {
                                    this.show_hour(hour, *over, cx)
                                }),
                            )
                            .on_key_down(cx.listener(|this, e: &KeyDownEvent, _, cx| {
                                if matches!(e.keystroke.key.as_str(), "up" | "down") {
                                    let offset = this.hour_scroll.offset();
                                    let delta = if e.keystroke.key == "up" { 32. } else { -32. };
                                    this.hour_scroll
                                        .set_offset(point(offset.x, offset.y + px(delta)));
                                    cx.notify();
                                    cx.stop_propagation();
                                }
                                if e.keystroke.key == "escape" && this.active_hour.take().is_some()
                                {
                                    cx.notify();
                                    cx.stop_propagation();
                                }
                            }))
                    })
                    .child(bar),
            );
        }
        div()
            .flex_1()
            .min_h_0()
            .flex()
            .flex_col()
            .child(bars.children(tooltip))
            .child(
                div()
                    .flex()
                    .justify_between()
                    .mt(px(HOURLY_AXIS_GAP))
                    .text_size(px(HOURLY_AXIS_FONT_SIZE))
                    .text_color(colors.secondary)
                    .children(
                        [0, 6, 12, 18]
                            .map(|hour| div().w(relative(0.25)).child(format!("{hour:02}:00"))),
                    ),
            )
    }
}
