use crate::{Palette, content_card, continuous_frame, heading};
use gpui_kit::{prelude::*, *};

pub struct TimelineSegment {
    pub start: f32,
    pub end: f32,
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

struct SegmentTip(String, Palette);

struct LegendTip(Vec<(String, Rgba)>, Palette);

fn legend_entry(name: String, color: Rgba, colors: Palette) -> Div {
    div()
        .flex()
        .items_center()
        .gap(px(4.))
        .text_size(px(12.))
        .line_height(px(16.))
        .text_color(colors.secondary)
        .child(div().size(px(8.)).flex_none().rounded_full().bg(color))
        .child(div().min_w_0().truncate().child(name))
}

impl Render for LegendTip {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        content_card(self.1.border, self.1.panel)
            .id("timeline-hidden-legends")
            .role(Role::Tooltip)
            .p(px(8.))
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

fn visible_legend_count(widths: &[f32], available: f32, overflow_width: f32) -> usize {
    let mut used = 0.;
    let mut visible = 0;
    for (i, width) in widths.iter().take(7).enumerate() {
        let next = used + if i == 0 { 0. } else { 12. } + width;
        let remaining = if i + 1 < widths.len() {
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

#[cfg(test)]
mod tests {
    use super::visible_legend_count;

    #[test]
    fn legend_overflow_reserves_counter_and_handles_resize() {
        let widths = [60., 80., 100.];
        assert_eq!(visible_legend_count(&widths, 264., 24.), 3);
        assert_eq!(visible_legend_count(&widths, 188., 24.), 2);
        assert_eq!(visible_legend_count(&widths, 95., 24.), 0);
        assert_eq!(visible_legend_count(&[], 0., 24.), 0);
        assert_eq!(visible_legend_count(&[20.; 12], 1000., 24.), 7);
    }
}

impl Render for SegmentTip {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        content_card(self.1.border, self.1.panel)
            .id("timeline-overview-tooltip")
            .role(Role::Tooltip)
            .p(px(8.))
            .text_size(px(12.))
            .text_color(self.1.text)
            .child(self.0.clone())
    }
}

impl RenderOnce for TimelineOverview {
    fn render(self, win: &mut Window, cx: &mut App) -> impl IntoElement {
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
            .map(|(name, _)| measure(name).min(88.) + 12.)
            .collect();
        let overflow_width = measure(&format!("+{}", self.legends.len())) + 8.;
        let width = win.use_keyed_state("timeline-legend-width", cx, |_, _| 0_f32);
        let visible = visible_legend_count(&widths, *width.read(cx), overflow_width);
        let hidden = self.legends[visible..].to_vec();
        let mut legends = div()
            .relative()
            .flex()
            .flex_1()
            .min_w_0()
            .h(px(28.))
            .items_center()
            .justify_end()
            .gap(px(12.))
            .children(self.legends.into_iter().take(visible).zip(widths).map(
                |((name, color), width)| legend_entry(name, color, c).flex_none().w(px(width)),
            ))
            .child(
                canvas(
                    move |bounds, _, cx| {
                        width.update(cx, |width, cx| {
                            let measured = f32::from(bounds.size.width);
                            if (*width - measured).abs() > 0.5 {
                                *width = measured;
                                cx.notify();
                            }
                        });
                    },
                    |_, _, _, _| {},
                )
                .absolute()
                .inset_0()
                .size_full(),
            );
        if !hidden.is_empty() {
            legends = legends.child(
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
            );
        }
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
                let start = s.start.clamp(0., 1.);
                let end = s.end.clamp(0., 1.);
                if end <= start {
                    return None;
                }
                let description = s.description;
                Some(
                    div()
                        .id(("overview-segment", i))
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
                        .when(s.anonymous, |s| s.child(crate::dot_pattern(c.secondary)))
                        .tooltip(move |_, cx| {
                            cx.new(|_| SegmentTip(description.clone(), c)).into()
                        }),
                )
            }));
        let axis = div()
            .flex()
            .justify_between()
            .h(px(20.))
            .flex_none()
            .text_size(px(12.))
            .line_height(px(20.))
            .text_color(c.secondary)
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
