use super::*;
use quietpro::{Icon, IconControl};

pub(super) struct SegmentTip(pub(super) String, pub(super) Palette);
impl Render for SegmentTip {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        content_card(self.1.border, self.1.panel)
            .id("detail-segment-tooltip")
            .role(Role::Tooltip)
            .aria_label(self.0.clone())
            .p(px(8.))
            .text_size(px(12.))
            .child(self.0.clone())
    }
}

impl History {
    pub(super) fn render_detail(
        &self,
        day: &HistoryDay,
        colors: Palette,
        win: &mut Window,
        cx: &mut Context<Self>,
    ) -> Div {
        let locale = self.client.locale.get();
        let tr = |key| text(locale, key);
        let (key, name) = self.target.as_ref().unwrap();
        let icon = self.icons.get(key).map_or_else(
            || {
                quietpro::glyph(
                    if self.web {
                        Icon::Globe
                    } else {
                        Icon::AppWindow
                    },
                    colors.secondary,
                )
                .size(px(20.))
                .into_any_element()
            },
            |icon| img(icon.image.clone()).size(px(20.)).into_any_element(),
        );
        let mut page = shell(colors).p_0().min_h_0().flex_initial().child(
            div()
                .flex()
                .items_center()
                .flex_none()
                .h(px(32.))
                .pr(px(44.))
                .gap(px(12.))
                .child(icon)
                .child(heading(name.clone()).flex_1().min_w_0().truncate())
                .child(self.date_controls(colors, win, cx)),
        );
        if self.calendar.is_some() {
            page = page.child(self.calendar_popup(colors, win, cx));
        }
        if self.error {
            page = page.child(
                div()
                    .flex()
                    .items_center()
                    .gap(px(8.))
                    .child(label(tr("destinationDetail.dayError")))
                    .child(
                        quietpro::text_button("detail-retry", tr("common.retry"), colors, true)
                            .on_click(cx.listener(|this, _, _, cx| this.refresh(cx))),
                    ),
            );
        }
        let minimum = self.minimum.unwrap_or(60);
        let (left, right) = self.viewport(day);
        let groups = records::groups_in_range(day, minimum * 1000, (left, right));
        let visible: HashSet<_> = groups.iter().map(|group| group.id).collect();
        let mut track = div()
            .id("detail-timeline-track")
            .accessibility_id("detail-timeline-track")
            .role(Role::Group)
            .aria_label(tr("history.horizontalTimeline.ariaLabel"))
            .relative()
            .h(px(48.))
            .w_full()
            .flex_none()
            .rounded(px(12.))
            .border_1()
            .border_color(colors.border)
            .bg(colors.canvas)
            .focus_visible(move |s| s.border_color(colors.secondary));
        for (index, record) in day.records.iter().enumerate() {
            if !visible.contains(&record.group_id) || record.end <= left || record.start >= right {
                continue;
            }
            let start = record.start.max(left);
            let end = record.end.min(right);
            let elapsed = if end - start < 60_000 {
                format!("{}s", (end - start) / 1000)
            } else {
                duration(end - start)
            };
            let description = format!(
                "{} · {}–{} · {elapsed}",
                record.name,
                stamp(start, "%H:%M:%S"),
                stamp(end, "%H:%M:%S")
            );
            let color = quietpro::activity_display_color(
                self.source_color(day, &record.key, false),
                colors.canvas,
                self.client.dark(win),
            );
            track = track.child(
                div()
                    .id(("detail-segment", index))
                    .role(Role::Label)
                    .aria_label(description.clone())
                    .absolute()
                    .top(px(8.))
                    .bottom(px(8.))
                    .left(relative((start - left) as f32 / (right - left) as f32))
                    .w(relative((end - start) as f32 / (right - left) as f32))
                    .min_w(px(1.))
                    .rounded(px(2.))
                    .bg(color)
                    .tooltip(move |_, cx| {
                        cx.new(|_| SegmentTip(description.clone(), colors)).into()
                    }),
            );
        }
        let track = self.interactive_timeline(track, left, right, cx);
        let mut filter = div()
            .id("detail-minimum-duration")
            .role(Role::Group)
            .aria_label(tr("destinationDetail.minimumDuration"))
            .flex()
            .items_center()
            .gap(px(4.));
        for (direction, id, label_key, icon) in [
            (
                -1,
                "detail-min-less",
                "accessibility.history.decreaseMinDuration",
                Icon::Minus,
            ),
            (
                1,
                "detail-min-more",
                "accessibility.history.increaseMinDuration",
                Icon::Plus,
            ),
        ] {
            filter = filter.child(
                IconControl::new(id, tr(label_key), icon)
                    .disabled(
                        self.writing_minimum || !(0..=600).contains(&(minimum + direction * 60)),
                    )
                    .action(
                        colors,
                        cx.listener(move |this, _, _, cx| {
                            this.change_minimum(minimum + direction * 60, cx)
                        }),
                    ),
            );
            if direction < 0 {
                filter = filter.child(label(format!("{} min", minimum / 60)).text_size(px(12.)));
            }
        }
        let total: i64 = day
            .records
            .iter()
            .map(|record| record.end - record.start)
            .sum();
        page.child(self.zoom_toolbar(day, colors, win, cx))
            .child(
                div()
                    .flex()
                    .flex_col()
                    .flex_none()
                    .gap(px(8.))
                    .py(px(12.))
                    .border_y_1()
                    .border_color(colors.border)
                    .child(track)
                    .child(timeline::ticks(day, left, right, colors)),
            )
            .child(
                div()
                    .flex()
                    .items_center()
                    .flex_none()
                    .gap(px(12.))
                    .child(heading(tr("destinationDetail.records")))
                    .child(
                        label(format!(
                            "{} · {}",
                            tr("history.activeDuration"),
                            duration(total)
                        ))
                        .text_size(px(12.))
                        .text_color(colors.secondary)
                        .flex_1(),
                    )
                    .child(filter),
            )
            .child(self.detail_records(day, &groups, colors, win, cx))
    }
}
