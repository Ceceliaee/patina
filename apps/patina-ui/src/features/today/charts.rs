use super::{Today, content_card, regular_caption};
use crate::features::{format::duration, page_controls::label};
use gpui_kit::{prelude::*, *};
use patina_activity_model::{DaySummary, Locale, format_text, text};
use quietpro::{
    CARD_TITLE_GAP, HOURLY_PLOT_MIN_HEIGHT, HourlyBar, HourlyChart, HourlySegment, heading,
};
use quietpro::{Palette, activity_display_color};

pub(super) fn focus(
    data: Option<&DaySummary>,
    locale: Locale,
    content_width: f32,
    colors: Palette,
    dark: bool,
) -> Stateful<Div> {
    let panel = content_card(colors.border, colors.panel)
        .id("today-focus-panel")
        .role(Role::Group)
        .accessibility_id("today-focus-panel")
        .child(heading(text(locale, "dashboard.focusShare")).mb(px(CARD_TITLE_GAP)));
    let Some(data) = data else {
        return panel;
    };
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
    for (name, ms, color, dotted) in &slices {
        legend = legend.child(
            div()
                .flex()
                .min_h(px(24.))
                .items_center()
                .gap(px(quietpro::LEGEND_LABEL_GAP))
                .font_weight(FontWeight::MEDIUM)
                .child(
                    div()
                        .relative()
                        .overflow_hidden()
                        .flex_none()
                        .size(px(quietpro::LEGEND_DOT_SIZE))
                        .rounded_full()
                        .bg(*color)
                        .when(*dotted, |s| {
                            s.child(quietpro::dot_pattern(colors.secondary))
                        }),
                )
                .child(label(name.clone()).min_w_0().flex_1().truncate())
                .child(
                    div()
                        .flex_none()
                        .whitespace_nowrap()
                        .text_color(colors.secondary)
                        .child(duration(*ms)),
                ),
        );
    }
    if slices.is_empty() {
        legend = legend.child(regular_caption(
            text(locale, "dashboard.emptyState"),
            colors,
        ));
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
                    description: format!("{label} ･ {} ･ {percent:.0}%", duration(*ms)).into(),
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
    let comparison = format_text(
        locale,
        "dashboard.comparedWithYesterday",
        &[
            ("direction", direction.into()),
            ("deltaLabel", duration(delta.abs())),
        ],
    );
    panel
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
                            label(duration(total))
                                .text_size(px(20.))
                                .font_weight(FontWeight::BOLD),
                        )
                        .child(
                            quietpro::caption(text(locale, "dashboard.total"), colors)
                                .text_size(px(14.))
                                .font_weight(FontWeight::MEDIUM),
                        ),
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
                .child(
                    label(comparison)
                        .text_size(px(12.))
                        .font_weight(FontWeight::MEDIUM)
                        .text_color(colors.secondary),
                ),
        )
}

fn hourly_duration(ms: i64) -> String {
    if ms < 60_000 {
        duration(ms)
    } else {
        format!("{}m", (ms + 30_000) / 60_000)
    }
}

impl Today {
    pub(super) fn hourly(
        &self,
        data: &DaySummary,
        wide: bool,
        colors: Palette,
        dark: bool,
    ) -> HourlyChart {
        let grouped = self.client.navigation.get().hourly_by_category;
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
        let bars = std::array::from_fn(|hour| {
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
            HourlyBar {
                label: format!(
                    "{hour:02}:00 ･ {} {}",
                    text(locale, "hourlyActivityChart.activeMinutes"),
                    hourly_duration(ms)
                ),
                fraction: ms as f32 / 3_600_000.,
                segments: if grouped {
                    segments
                        .into_iter()
                        .map(|(part_ms, label, color, dotted)| HourlySegment {
                            label,
                            value: hourly_duration(part_ms),
                            fraction: part_ms as f32 / ms as f32,
                            color,
                            dotted,
                        })
                        .collect()
                } else {
                    Vec::new()
                },
            }
        });
        HourlyChart {
            bars,
            colors,
            total_color,
            min_plot_height: px(HOURLY_PLOT_MIN_HEIGHT),
            tooltip_id: "hour-tooltip",
        }
    }
}
