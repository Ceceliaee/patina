use crate::{
    LEGEND_DOT_SIZE, LEGEND_LABEL_GAP, Palette, content_card, continuous_frame, heading,
    tooltip_surface,
};
use gpui_kit::{prelude::*, *};

pub struct TimelineSegment {
    pub start_fraction: f32,
    pub end_fraction: f32,
    pub color: Rgba,
    pub description: String,
    pub anonymous: bool,
}

/// Presentation for a full-day overview; time mapping and actions belong to the page.
#[derive(IntoElement)]
pub struct TimelineOverview {
    pub title: String,
    pub legends: Vec<(String, Rgba)>,
    pub segments: Vec<TimelineSegment>,
    pub actions: AnyElement,
    pub notice: Option<String>,
    pub colors: Palette,
}

struct LegendTip(Vec<(String, Rgba)>, Palette);

fn legend_entry(name: String, color: Rgba, colors: Palette) -> Div {
    div()
        .flex()
        .items_center()
        .gap(px(LEGEND_LABEL_GAP))
        .text_size(px(12.))
        .line_height(px(16.))
        .text_color(colors.secondary)
        .child(
            div()
                .size(px(LEGEND_DOT_SIZE))
                .flex_none()
                .rounded_full()
                .bg(color),
        )
        .child(
            div()
                .min_w_0()
                .whitespace_nowrap()
                .text_ellipsis()
                .child(name),
        )
}

impl Render for LegendTip {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        tooltip_surface(self.1)
            .id("timeline-hidden-legends")
            .role(Role::Tooltip)
            .flex()
            .flex_col()
            .gap(px(8.))
            .children(
                self.0
                    .iter()
                    .map(|(name, color)| legend_entry(name.clone(), *color, self.1)),
            )
    }
}

fn visible_legend_count(
    widths: &[f32],
    total: usize,
    available: f32,
    overflow_width: f32,
) -> usize {
    let mut used = 0.;
    let mut visible = 0;
    for (i, width) in widths.iter().enumerate() {
        let next = used + if i == 0 { 0. } else { 12. } + width;
        let remaining = if i + 1 < total {
            12. + overflow_width
        } else {
            0.
        };
        if next + remaining > available {
            break;
        }
        used = next;
        visible += 1;
    }
    visible
}

impl RenderOnce for TimelineOverview {
    fn render(self, win: &mut Window, _: &mut App) -> impl IntoElement {
        let c = self.colors;
        let measure = |text: &str| {
            let run = win.text_style().to_run(text.len());
            f32::from(
                win.text_system()
                    .shape_line(text.to_owned().into(), px(12.), &[run], None)
                    .width,
            )
        };
        let widths: Vec<_> = self
            .legends
            .iter()
            .take(7)
            .map(|(name, _)| measure(name).min(88.) + LEGEND_DOT_SIZE + LEGEND_LABEL_GAP)
            .collect();
        let overflow_width = measure(&format!("+{}", self.legends.len())) + 8.;
        let legends = container_query(move |size, _, _| {
            let mut entries = self.legends;
            let visible =
                visible_legend_count(&widths, entries.len(), size.width.into(), overflow_width);
            let hidden = entries.split_off(visible);
            div()
                .size_full()
                .flex()
                .items_center()
                .justify_end()
                .gap(px(12.))
                .children(
                    entries
                        .into_iter()
                        .zip(widths)
                        .map(|((name, color), width)| {
                            legend_entry(name, color, c).flex_none().w(px(width))
                        }),
                )
                .when(!hidden.is_empty(), |row| {
                    row.child(
                        div()
                            .id("timeline-legend-overflow")
                            .role(Role::Label)
                            .aria_label(
                                hidden
                                    .iter()
                                    .map(|(name, _)| name.as_str())
                                    .collect::<Vec<_>>()
                                    .join(", "),
                            )
                            .flex_none()
                            .text_size(px(12.))
                            .text_color(c.secondary)
                            .child(format!("+{}", hidden.len()))
                            .tooltip(move |_, cx| cx.new(|_| LegendTip(hidden.clone(), c)).into()),
                    )
                })
        })
        .flex_1()
        .min_w_0()
        .h(px(28.));
        let header = div()
            .flex()
            .items_center()
            .gap(px(12.))
            .child(heading(self.title).flex_none())
            .child(legends)
            .child(div().flex().flex_none().child(self.actions));
        let mut body = div()
            .flex()
            .flex_col()
            .gap(px(crate::CARD_TITLE_GAP))
            .child(header);
        let track = continuous_frame(px(8.), c.border, c.canvas)
            .id("history-overview-track")
            .accessibility_id("history-overview-track")
            .role(Role::Group)
            .h(px(48.))
            .w_full()
            .flex_none()
            .rounded(px(8.))
            .overflow_hidden()
            .child(
                div()
                    .absolute()
                    .left_0()
                    .right_0()
                    .top(relative(0.5))
                    .h(px(1.))
                    .bg(c.border),
            )
            .children(self.segments.into_iter().enumerate().filter_map(|(i, s)| {
                let start = s.start_fraction.clamp(0., 1.);
                let end = s.end_fraction.clamp(0., 1.);
                if end <= start {
                    return None;
                }
                let description = s.description;
                Some(crate::with_text_tooltip(
                    div()
                        .id(("overview-segment", i))
                        .accessibility_id(SharedString::from(format!("overview-segment-{i}")))
                        .role(Role::Label)
                        .aria_label(description.clone())
                        .absolute()
                        .top(px(8.))
                        .h(px(32.))
                        .left(relative(start))
                        .w(relative(end - start))
                        .rounded(px(2.))
                        .bg(s.color)
                        .overflow_hidden()
                        .when(s.anonymous, |s| s.child(crate::dot_pattern(c.secondary))),
                    description,
                    c,
                ))
            }));
        let axis = crate::layout::chart_axis_labels(c)
            .justify_between()
            .h(px(20.))
            .flex_none()
            .line_height(px(20.))
            .children(["00:00", "06:00", "12:00", "18:00", "24:00"]);
        body = body.child(div().flex().flex_col().gap(px(8.)).child(track).child(axis));
        if let Some(notice) = self.notice {
            body = body.child(
                div()
                    .text_size(px(12.))
                    .text_color(c.secondary)
                    .child(notice),
            );
        }
        content_card(c.border, c.panel).flex_none().child(body)
    }
}

#[cfg(test)]
mod tests {
    use super::visible_legend_count;

    #[test]
    fn legend_overflow_reserves_counter_and_handles_resize() {
        let widths = [60., 80., 100.];
        assert_eq!(visible_legend_count(&widths, 3, 264., 24.), 3);
        assert_eq!(visible_legend_count(&widths, 3, 188., 24.), 2);
        assert_eq!(visible_legend_count(&widths, 3, 95., 24.), 0);
        assert_eq!(visible_legend_count(&[], 0, 0., 24.), 0);
        assert_eq!(visible_legend_count(&[20.; 7], 12, 216., 24.), 6);
    }

    #[cfg(feature = "test-support")]
    #[gpui_kit::test]
    fn legend_paints_the_fitting_entries_on_the_first_frame(cx: &mut gpui_kit::TestAppContext) {
        use super::*;
        use gpui_kit::test::TestWindowExt;

        struct Preview(f32);
        impl Render for Preview {
            fn render(&mut self, win: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
                let colors = Palette::from(win.appearance());
                div().w(px(self.0)).when(self.0 > 0., |row| {
                    row.child(TimelineOverview {
                        title: "Timeline".into(),
                        legends: (1..=11)
                            .map(|i| (format!("App {i}"), rgb(0x123456)))
                            .collect(),
                        segments: vec![],
                        actions: div().w(px(84.)).into_any_element(),
                        notice: None,
                        colors,
                    })
                })
            }
        }

        cx.update(gpui_kit::init);
        let (handle, preview) = cx.update(|cx| {
            gpui_kit::open_window(WindowOptions::default(), cx, |_, cx| {
                cx.new(|_| Preview(0.))
            })
            .unwrap()
        });
        cx.update_window(handle, |_, win, cx| {
            for width in [900., 320., 0., 900.] {
                preview.update(cx, |p, cx| {
                    p.0 = width;
                    cx.notify();
                });
                win.render_frame(cx);
                let count = win
                    .painted_quads()
                    .iter()
                    .filter(|q| q.background == rgb(0x123456).into())
                    .count();
                match width {
                    0. => assert_eq!(count, 0),
                    320. => assert!(
                        (1..7).contains(&count),
                        "narrow legend painted {count} entries"
                    ),
                    _ => assert_eq!(count, 7),
                }
            }
        })
        .unwrap();
    }

    #[cfg(feature = "test-support")]
    #[gpui_kit::test]
    fn legend_text_can_paint_descenders_and_stays_within_label_width(
        cx: &mut gpui_kit::TestAppContext,
    ) {
        use super::*;
        use gpui_kit::test::TestWindowExt;

        struct Labels;
        impl Render for Labels {
            fn render(&mut self, window: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
                let colors = Palette::from(window.appearance());
                div().p(px(16.)).flex().flex_col().children(
                    ["Google Chrome", "Google Chrome with a long profile name"].map(|name| {
                        legend_entry(name.into(), colors.accent, colors)
                            .w(px(88. + LEGEND_DOT_SIZE + LEGEND_LABEL_GAP))
                            .underline()
                    }),
                )
            }
        }

        cx.update(|cx| {
            gpui_kit::init(cx);
            crate::init_fonts(cx).unwrap();
        });
        let (handle, _) = cx.update(|cx| {
            gpui_kit::open_window(WindowOptions::default(), cx, |_, cx| cx.new(|_| Labels)).unwrap()
        });
        cx.update_window(handle, |_, window, cx| {
            window.render_frame(cx);
            // Underlines share the shaped text's width and its paint mask.
            let lines = window.painted_underlines();
            assert_eq!(lines.len(), 2);
            for line in lines {
                assert!(line.bounds.size.width <= px(88.).scale(window.scale_factor()));
                assert!(
                    line.content_mask.bounds.bottom()
                        >= line.bounds.bottom() + px(2.).scale(window.scale_factor())
                );
            }
        })
        .unwrap();
    }
}
