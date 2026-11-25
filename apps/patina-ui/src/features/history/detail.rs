use super::*;
use gpui_kit::base::TestSupportExt;
use quietpro::{Icon, IconControl};

impl History {
    pub(crate) fn with_target_icon(mut self, icon: Option<(Arc<Image>, Option<u32>)>) -> Self {
        if let (Some((key, _)), Some((image, color))) = (&self.target, icon) {
            self.icons.insert(
                key.clone(),
                HistoryIcon {
                    image,
                    color,
                    source: None,
                },
            );
        }
        self
    }

    pub(crate) fn detail_dialog(
        content: Entity<Self>,
        focus: &FocusHandle,
        close_label: String,
        colors: quietpro::Palette,
        close: impl Fn(&mut Window, &mut App) + 'static,
        window: &Window,
        cx: &mut App,
    ) -> quietpro::ModalDialog {
        let title = content.read(cx).title();
        let close = std::rc::Rc::new(close);
        let button = close.clone();
        let popup = quietpro::dialog_surface(colors, window.viewport_size())
            .id("app-detail-popup")
            .relative()
            .w(
                (window.viewport_size().width - px(quietpro::DIALOG_WINDOW_MARGIN * 2.))
                    .min(px(800.)),
            )
            .on_any_mouse_down(|_, _, cx| cx.stop_propagation())
            .child(content)
            .child(
                div()
                    .absolute()
                    .top(px(quietpro::DIALOG_FRAME_INSET))
                    .right(px(quietpro::DIALOG_FRAME_INSET))
                    .child(
                        quietpro::IconControl::new("close-detail", close_label, quietpro::Icon::X)
                            .action(colors, move |_, win, cx| button(win, cx)),
                    ),
            );
        quietpro::modal_dialog(
            title,
            focus.clone(),
            popup.test_support(),
            move |win, cx| {
                close(win, cx);
            },
            cx,
        )
    }

    pub(super) fn render_detail(
        &self,
        key: &str,
        name: &str,
        colors: Palette,
        win: &mut Window,
        cx: &mut Context<Self>,
    ) -> Div {
        let locale = self.client.locale.get();
        let tr = |key| text(locale, key);
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
        let mut timeline_section = div()
            .flex()
            .flex_col()
            .flex_none()
            .gap(px(CARD_TITLE_GAP))
            .child(
                div()
                    .flex()
                    .items_center()
                    .flex_none()
                    .h(px(32.))
                    .gap(px(12.))
                    .child(
                        div()
                            .flex()
                            .flex_1()
                            .min_w_0()
                            .items_center()
                            .gap(px(12.))
                            .child(icon)
                            .child(heading(name.to_owned()).min_w_0().truncate()),
                    )
                    .mr(px(44.)),
            )
            .child(
                div()
                    .flex()
                    .flex_none()
                    .items_center()
                    .children(
                        self.data
                            .as_ref()
                            .map(|day| self.zoom_controls(day, colors, win, cx)),
                    )
                    .child(div().flex_1())
                    .child(self.date_controls(&self.date_trigger, colors, win, cx)),
            );
        if self.calendar.is_some() {
            timeline_section = timeline_section.child(self.calendar_popup(colors, win, cx));
        }
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
        let mut groups = Vec::new();
        let mut ticks = None;
        if let Some(day) = &self.data {
            let (left, right) = self.viewport(day);
            let minimum = self.minimum.unwrap_or(day.minimum_seconds);
            groups = records::groups_in_range(day, minimum * 1000, (left, right));
            let visible: HashSet<_> = groups.iter().map(|group| group.id).collect();
            let fragments = day
                .records
                .iter()
                .filter(|r| visible.contains(&r.group_id))
                .collect();
            let segments =
                timeline::merged_lane_records(fragments, (left, right), day.timeline_merge_gap_ms);
            for (index, record) in segments.iter().enumerate() {
                let start = record.start;
                let end = record.end;
                let elapsed = duration(record.group_duration);
                let description = format!(
                    "{} ･ {}–{} ･ {elapsed}",
                    record.name,
                    stamp(start, "%H:%M:%S"),
                    stamp(end, "%H:%M:%S")
                );
                let color = quietpro::activity_display_color(
                    self.source_color(day, &record.key, false),
                    colors.canvas,
                    self.client.dark(win),
                );
                track = track.child(quietpro::with_text_tooltip(
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
                        .bg(color),
                    description,
                    colors,
                ));
            }
            track = self.interactive_timeline(track, left, right, cx);
            ticks = Some(
                timeline::ticks(day, left, right, colors)
                    .id("detail-timeline-axis")
                    .role(Role::Group)
                    .aria_label(timeline::time_range_label(day, left, right)),
            );
        }
        let timeline_section = timeline_section.child(
            div()
                .flex()
                .flex_col()
                .flex_none()
                .gap(px(8.))
                .py(px(12.))
                .border_y_1()
                .border_color(colors.border)
                .child(track.test_support())
                .child(
                    div()
                        .flex_none()
                        .h(px(timeline::TICK_HEIGHT))
                        .children(ticks),
                ),
        );
        shell(colors)
            .p_0()
            .min_h_0()
            .flex_initial()
            .child(timeline_section)
            .child(
                div()
                    .flex()
                    .items_center()
                    .flex_none()
                    .min_h(px(quietpro::ICON_CONTROL_SIZE))
                    .justify_between()
                    .gap(px(12.))
                    .child(heading(tr("destinationDetail.records")))
                    .children(
                        self.minimum
                            .map(|minimum| self.detail_minimum(minimum, colors, cx)),
                    ),
            )
            .child(self.detail_records(groups, colors, cx).test_support())
    }

    fn detail_minimum(
        &self,
        minimum: i64,
        colors: Palette,
        cx: &mut Context<Self>,
    ) -> Stateful<Div> {
        let tr = |key| text(self.client.locale.get(), key);
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
                filter = filter.child(
                    label(format!("{} min", minimum / 60))
                        .text_size(px(12.))
                        .font_weight(FontWeight::MEDIUM),
                );
            }
        }
        filter
    }
}
