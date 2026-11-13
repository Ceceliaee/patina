use super::{Today, content_card, panel, title, value};
use crate::format::duration;
use gpui_kit::{
    base::plot::shape::{Arc, ArcData},
    prelude::*,
    *,
};
use patina_recorder::{DaySummary, Locale, format_text, text};
use quietpro::{Palette, caption};

pub(super) fn focus(data: &DaySummary, locale: Locale, wide: bool, colors: Palette) -> Div {
    let limit = if wide { 6 } else { 4 };
    let mut slices: Vec<_> = data
        .categories
        .iter()
        .take(limit)
        .map(|c| (c.label.clone(), c.duration, rgb(c.color)))
        .collect();
    let rest: i64 = data.categories.iter().skip(limit).map(|c| c.duration).sum();
    if rest > 0 {
        slices.push((text(locale, "categories.other"), rest, colors.secondary));
    }
    let mut legend = div().min_w_0().flex_1().flex().flex_col().gap(px(5.));
    for (label, ms, color) in &slices {
        legend = legend.child(
            div()
                .flex()
                .items_center()
                .gap(px(6.))
                .child(div().size(px(6.)).rounded_full().bg(*color))
                .child(value(label.clone()).min_w_0().flex_1().truncate())
                .child(duration(*ms)),
        );
    }
    if slices.is_empty() {
        legend = legend.child(caption(text(locale, "dashboard.emptyState"), colors));
    }
    let total = data.total;
    let donut = canvas(
        |_, _, _| (),
        move |bounds, _, window, _| {
            let radius = f32::from(bounds.size.width.min(bounds.size.height)) * 0.49;
            let arc = Arc::new().outer_radius(radius).inner_radius(radius * 0.71);
            let tau = std::f32::consts::TAU;
            arc.paint(
                &ArcData::new(&(), 0, 1., 0., tau),
                colors.track,
                &bounds,
                window,
            );
            let mut angle = 0.;
            for (_, value, color) in &slices {
                let next = angle + tau * *value as f32 / total as f32;
                arc.paint(
                    &ArcData::new(&(), 0, 1., angle, (next - tau / 90.).max(angle)),
                    *color,
                    &bounds,
                    window,
                );
                angle = next;
            }
        },
    )
    .absolute()
    .inset_0()
    .size_full();
    let delta = total - data.yesterday;
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
        .min_h(px(250.))
        .child(title(text(locale, "dashboard.focusShare")))
        .child(
            div()
                .flex_1()
                .flex()
                .items_center()
                .gap(px(12.))
                .text_size(px(12.))
                .child(
                    div()
                        .relative()
                        .w(relative(0.48))
                        .h(px(if wide { 185. } else { 150. }))
                        .flex()
                        .flex_col()
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
                .flex()
                .justify_end()
                .child(value(label).text_color(colors.secondary).text_size(px(12.))),
        )
}

impl Today {
    pub(super) fn show_hour(&mut self, hour: usize, visible: bool, cx: &mut Context<Self>) {
        if visible || self.active_hour == Some(hour) {
            let next = visible.then_some(hour);
            if self.active_hour != next {
                self.active_hour = next;
                cx.notify();
            }
        }
    }

    pub(super) fn hourly(
        &self,
        data: &DaySummary,
        wide: bool,
        colors: Palette,
        cx: &mut Context<Self>,
    ) -> Div {
        let grouped = data.category_mode;
        let locale = self.client.locale.get();
        let mut tooltip = None;
        let mut bars = div()
            .relative()
            .flex_1()
            .min_h(px(130.))
            .flex()
            .items_end()
            .border_b_1()
            .border_color(colors.track);
        for hour in 0..24 {
            let mut segments: Vec<_> = data
                .categories
                .iter()
                .map(|c| (c.hours[hour], c.label.clone(), rgb(c.color)))
                .filter(|(ms, _, _)| *ms > 0)
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
            for (index, (ms, _, _)) in segments.iter_mut().enumerate() {
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
                        colors.secondary,
                    ),
                );
            }
            let mut tip = format!(
                "{hour:02}:00 · {} {minutes}m",
                text(locale, "hourlyActivityChart.activeMinutes")
            );
            if grouped {
                for (m, label, _) in segments.iter().rev() {
                    tip.push_str(&format!("\n{label} {m}m"));
                }
            }
            let mut bar = div()
                .h(relative(minutes.min(60) as f32 / 60.))
                .w(px(8.))
                .flex()
                .flex_col_reverse()
                .overflow_hidden()
                .rounded_t(px(3.));
            if grouped {
                for (m, _, color) in segments {
                    bar = bar.child(
                        div()
                            .w_full()
                            .h(relative(m as f32 / minutes as f32))
                            .bg(color),
                    );
                }
            } else {
                bar = bar.bg(colors.accent);
            }
            if minutes > 0 && self.active_hour == Some(hour) {
                tooltip = Some(
                    panel(colors)
                        .id("hour-tooltip")
                        .role(Role::Tooltip)
                        .aria_label(tip.clone())
                        .absolute()
                        .bottom(px(4.))
                        .when_else(hour < 12, |s| s.right_0(), |s| s.left_0())
                        .p(px(8.))
                        .text_size(px(12.))
                        .text_color(colors.text)
                        .child(tip.clone()),
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
                    .hover(move |s| s.bg(colors.hover))
                    .when(minutes > 0, |s| {
                        s.track_focus(&self.hour_focus[hour])
                            .focus_visible(move |s| s.border_1().border_color(colors.accent))
                            .on_hover(
                                cx.listener(move |this, over, _, cx| {
                                    this.show_hour(hour, *over, cx)
                                }),
                            )
                            .on_key_down(cx.listener(|this, e: &KeyDownEvent, _, cx| {
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
            .pt(px(16.))
            .child(bars.children(tooltip))
            .child(
                div()
                    .flex()
                    .justify_between()
                    .mt(px(6.))
                    .text_size(px(10.))
                    .text_color(colors.secondary)
                    .children(
                        [0, 6, 12, 18]
                            .map(|hour| div().w(relative(0.25)).child(format!("{hour:02}:00"))),
                    ),
            )
    }
}
