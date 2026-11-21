use super::*;
use gpui_kit::base::Popover;
use quietpro::{Icon, IconControl};
use std::collections::BTreeMap;

const RECORD_CARD_HEIGHT: f32 = 48.;
const RECORD_CARD_GAP: f32 = 8.;
const RECORD_LIST_MAX_HEIGHT: f32 = RECORD_CARD_HEIGHT * 7. + RECORD_CARD_GAP * 6.;
const DETAIL_RECORD_LIST_HEIGHT: f32 = RECORD_CARD_HEIGHT * 5. + RECORD_CARD_GAP * 4.;

pub(super) struct RecordsState {
    pub(super) web: bool,
    expanded: Option<usize>,
    modes: [FocusHandle; 2],
    scroll: UniformListScrollHandle,
}
impl RecordsState {
    pub(super) fn new(cx: &mut Context<History>) -> Self {
        Self {
            web: false,
            expanded: None,
            modes: std::array::from_fn(|_| cx.focus_handle()),
            scroll: UniformListScrollHandle::new(),
        }
    }
    pub(super) fn close_details(&mut self) {
        self.expanded = None;
    }
}

pub(super) struct RecordGroup {
    pub(super) id: usize,
    first_index: usize,
    start: i64,
    end: i64,
    duration: i64,
    count: usize,
    current: bool,
    titles: Vec<(i64, i64, String, Option<String>, i64)>,
}

fn groups(day: &HistoryDay, minimum: i64) -> Vec<RecordGroup> {
    groups_in_range(day, minimum, (day.start, day.end))
}

pub(super) fn groups_in_range(
    day: &HistoryDay,
    minimum: i64,
    range: (i64, i64),
) -> Vec<RecordGroup> {
    let mut groups = BTreeMap::<usize, RecordGroup>::new();
    for (index, record) in day.records.iter().enumerate() {
        let start = record.start.max(range.0);
        let end = record.end.min(range.1);
        if end <= start {
            continue;
        }
        let group = groups
            .entry(record.group_id)
            .or_insert_with(|| RecordGroup {
                id: record.group_id,
                first_index: index,
                start,
                end,
                duration: 0,
                count: 0,
                current: false,
                titles: Vec::new(),
            });
        group.end = group.end.max(end);
        group.duration += end - start;
        group.count += 1;
        group.current |= record.current && record.end <= range.1;
        group
            .titles
            .extend(record.titles.iter().filter_map(|(a, b, title, url)| {
                let a = (*a).max(start);
                let b = (*b).min(end);
                (b > a).then(|| (a, b, title.clone(), url.clone(), b - a))
            }));
    }
    let mut groups: Vec<_> = groups
        .into_values()
        .filter(|g| g.duration >= minimum)
        .collect();
    for group in &mut groups {
        group.titles.sort_by_key(|t| (t.0, t.1));
        let mut merged: Vec<(i64, i64, String, Option<String>, i64)> = Vec::new();
        for title in group.titles.drain(..) {
            if let Some(previous) = merged.last_mut()
                && previous.2 == title.2
                && previous.3 == title.3
            {
                previous.4 += title.4;
                previous.1 = previous.1.max(title.1);
            } else {
                merged.push(title);
            }
        }
        group.titles = merged;
    }
    groups.sort_by_key(|g| (day.records[g.first_index].start, g.id));
    groups
}

fn title_rows(
    titles: &[(i64, i64, String, Option<String>, i64)],
    colors: Palette,
    locale: Locale,
    win: &Window,
) -> Div {
    let viewport = win.viewport_size();
    let width = 428_f32.min(f32::from(viewport.width) - 48.);
    let measure = |value: &str| {
        let run = win.text_style().to_run(value.len());
        f32::from(
            win.text_system()
                .shape_line(value.to_owned().into(), px(12.), &[run], None)
                .width,
        )
    };
    let mut list = div()
        .id("timeline-title-list")
        .overflow_y_scroll()
        .min_h_0()
        .flex_initial()
        .max_h(px(40. * 5. + 8. * 4.))
        .flex()
        .flex_col()
        .gap(px(8.));
    for (index, (start, end, title, url, active)) in titles.iter().enumerate() {
        let time = format!("{} – {}", stamp(*start, "%H:%M"), stamp(*end, "%H:%M"));
        let duration = duration(*active);
        let time_column_width = measure(&duration).max(measure(&time));
        let truncated = measure(title) > width - 34. - 24. - 12. - time_column_width;
        let full_title = url
            .as_ref()
            .map_or_else(|| title.clone(), |url| format!("{title}\n{url}"));
        list = list.child(
            quietpro::continuous_frame(px(12.), colors.border, colors.panel)
                .id(("timeline-title", index))
                .flex()
                .flex_none()
                .h(px(40.))
                .items_center()
                .gap(px(12.))
                .px(px(12.))
                .child(
                    div()
                        .flex_1()
                        .min_w_0()
                        .flex()
                        .flex_col()
                        .child(
                            label(title.clone())
                                .id(("title-text", index))
                                .truncate()
                                .text_size(px(12.))
                                .when(truncated || url.is_some(), |label| {
                                    label.tooltip(move |_, cx| {
                                        cx.new(|_| TitleTip(full_title.clone(), colors)).into()
                                    })
                                }),
                        )
                        .children(url.as_ref().map(|url| {
                            label(url.clone())
                                .truncate()
                                .text_size(px(12.))
                                .text_color(colors.secondary)
                        })),
                )
                .child(
                    div()
                        .flex_none()
                        .flex()
                        .flex_col()
                        .items_end()
                        .line_height(px(16.))
                        .child(label(duration).text_size(px(12.)))
                        .child(label(time).text_size(px(12.)).text_color(colors.secondary)),
                ),
        );
    }
    quietpro::dialog_surface(colors, viewport)
        .w(px(width))
        .gap(px(quietpro::CARD_TITLE_GAP))
        .child(
            label(text(locale, "history.titleDetails"))
                .flex_none()
                .text_size(px(14.))
                .line_height(px(20.))
                .font_weight(FontWeight::BOLD),
        )
        .child(list)
}

struct TitleTip(String, Palette);

impl Render for TitleTip {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        quietpro::tooltip_surface(self.1)
            .id("record-title-tooltip")
            .role(Role::Tooltip)
            .aria_label(self.0.clone())
            .child(self.0.clone())
    }
}

impl History {
    pub(super) fn records_popup(
        &self,
        colors: Palette,
        win: &mut Window,
        cx: &mut Context<Self>,
    ) -> Div {
        let locale = self.client.locale.get();
        let tr = |key| text(locale, key);
        let data = if self.records_view.web {
            self.web_data.as_ref()
        } else {
            self.data.as_ref()
        };
        let minimum = self.minimum.or_else(|| data.map(|day| day.minimum_seconds));
        let groups = data
            .map(|day| groups(day, minimum.unwrap_or(day.minimum_seconds) * 1000))
            .unwrap_or_default();
        let count = groups.len();
        let mut rows = div()
            .id("timeline-record-list")
            .role(Role::Group)
            .aria_label(tr("history.timeline"))
            .flex_initial()
            .min_h_0()
            .max_h(px(RECORD_LIST_MAX_HEIGHT))
            .when(data.is_none(), |rows| rows.h(px(RECORD_LIST_MAX_HEIGHT)))
            .overflow_hidden()
            .flex()
            .flex_col()
            .gap(px(RECORD_CARD_GAP));
        let failed = self.error || (self.records_view.web && self.web_error);
        if groups.is_empty() && (failed || data.is_some()) {
            let key = if failed {
                "destinationDetail.dayError"
            } else {
                "history.emptyDay"
            };
            rows = rows.child(
                div()
                    .flex_1()
                    .flex()
                    .items_center()
                    .justify_center()
                    .child(label(tr(key)).text_color(colors.secondary)),
            );
        }
        if !groups.is_empty() {
            let height = ((RECORD_CARD_HEIGHT + RECORD_CARD_GAP) * groups.len() as f32
                - RECORD_CARD_GAP)
                .min(RECORD_LIST_MAX_HEIGHT);
            rows = rows.h(px(height)).child(self.visible_records(
                "history-group-rows",
                groups,
                self.records_view.web,
                colors,
                cx,
            ));
        }
        let view = cx.weak_entity();
        let tabs = quietpro::segmented_with_medium_labels(
            ("timeline-record-mode", tr("data.destinationMode")),
            std::array::from_fn::<_, 2, _>(|i| {
                (
                    i == 1,
                    tr(if i == 0 {
                        "history.timelineTabApp"
                    } else {
                        "history.timelineTabWeb"
                    }),
                    None,
                    self.records_view.modes[i].clone(),
                )
            })
            .into_iter()
            .take(if self.web_enabled { 2 } else { 1 }),
            self.records_view.web,
            true,
            colors,
            quietpro::ControlSize::Medium,
            move |web, _, cx| {
                let _ = view.update(cx, |this, cx| {
                    this.records_view.web = web;
                    this.records_view.close_details();
                    cx.notify();
                });
            },
        );
        let date = self.date_controls(&self.overlay_date_trigger, colors, win, cx);
        let min = minimum.unwrap_or(300);
        let filter = div()
            .flex()
            .items_center()
            .gap(px(4.))
            .child(
                IconControl::new(
                    "records-less",
                    tr("accessibility.history.decreaseMinDuration"),
                    Icon::Minus,
                )
                .disabled(self.writing_minimum || min == 0)
                .action(
                    colors,
                    cx.listener(move |this, _, _, cx| this.change_minimum(min - 60, cx)),
                ),
            )
            .child(
                label(format!("{} min", min / 60))
                    .text_size(px(12.))
                    .font_weight(FontWeight::MEDIUM),
            )
            .child(
                IconControl::new(
                    "records-more",
                    tr("accessibility.history.increaseMinDuration"),
                    Icon::Plus,
                )
                .disabled(self.writing_minimum || min == 600)
                .action(
                    colors,
                    cx.listener(move |this, _, _, cx| this.change_minimum(min + 60, cx)),
                ),
            );
        let toolbar = div()
            .flex()
            .flex_none()
            .flex_wrap()
            .items_center()
            .justify_between()
            .gap(px(12.))
            .pb(px(12.))
            .border_b_1()
            .border_color(colors.border)
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap(px(12.))
                    .child(tabs)
                    .children(data.map(|_| {
                        label(format_text(
                            locale,
                            "history.sessionCount",
                            &[("count", count.to_string())],
                        ))
                        .text_size(px(12.))
                        .text_color(colors.secondary)
                    })),
            )
            .child(date)
            .children(minimum.map(|_| filter));
        div().child(
            quietpro::dialog_surface(colors, win.viewport_size())
                .id("timeline-records-dialog")
                .accessibility_id("timeline-records-dialog")
                .role(Role::Group)
                .aria_label(tr("history.timeline"))
                .w(px(800.)
                    .min(win.viewport_size().width - px(quietpro::DIALOG_WINDOW_MARGIN * 2.)))
                .child(
                    div()
                        .flex()
                        .flex_none()
                        .items_center()
                        .justify_between()
                        .child(heading(tr("history.timeline")))
                        .child(
                            IconControl::new("close-records", tr("common.close"), Icon::X).action(
                                colors,
                                cx.listener(|this, _, win, cx| this.close_overlay(win, cx)),
                            ),
                        ),
                )
                .child(toolbar)
                .when(self.calendar.is_some(), |s| {
                    s.child(self.calendar_popup(colors, win, cx))
                })
                .when(self.error || self.web_error, |panel| {
                    panel.child(
                        quietpro::text_button("records-retry", tr("common.retry"), colors, true)
                            .on_click(cx.listener(|this, _, _, cx| this.refresh(cx))),
                    )
                })
                .child(rows),
        )
    }

    pub(super) fn detail_records(
        &self,
        groups: Vec<RecordGroup>,
        colors: Palette,
        cx: &mut Context<Self>,
    ) -> Stateful<Div> {
        let mut list = div()
            .id("detail-record-list")
            .accessibility_id("detail-record-list")
            .role(Role::Group)
            .aria_label(text(self.client.locale.get(), "destinationDetail.records"))
            .flex_initial()
            .min_h_0()
            .h(px(DETAIL_RECORD_LIST_HEIGHT))
            .overflow_hidden()
            .flex()
            .flex_col()
            .gap(px(RECORD_CARD_GAP));
        if self.error {
            let tr = |key| text(self.client.locale.get(), key);
            list = list.child(
                div()
                    .flex()
                    .flex_none()
                    .items_center()
                    .gap(px(8.))
                    .child(label(tr("destinationDetail.dayError")))
                    .child(
                        quietpro::text_button("detail-retry", tr("common.retry"), colors, true)
                            .on_click(cx.listener(|this, _, _, cx| this.refresh(cx))),
                    ),
            );
        }
        let Some(day) = &self.data else {
            return list;
        };
        if groups.is_empty() {
            let locale = self.client.locale.get();
            let (left, right) = self.viewport(day);
            let message = if day.records.is_empty() {
                text(locale, "destinationDetail.noActivity")
            } else if !day.records.iter().any(|r| r.end > left && r.start < right) {
                text(locale, "destinationDetail.noActivityInWindow")
            } else {
                format_text(
                    locale,
                    "destinationDetail.noActivityAtMinimum",
                    &[("minutes", (self.minimum.unwrap_or(60) / 60).to_string())],
                )
            };
            list = list.child(label(message).text_color(colors.secondary));
        } else {
            list = list.child(self.visible_records("detail-group-rows", groups, false, colors, cx));
        }
        list
    }

    fn visible_records(
        &self,
        id: &'static str,
        groups: Vec<RecordGroup>,
        web: bool,
        colors: Palette,
        cx: &mut Context<Self>,
    ) -> impl IntoElement + use<> {
        let count = groups.len();
        uniform_list(
            id,
            count,
            cx.processor(move |this, range: std::ops::Range<usize>, win, cx| {
                let day = if web { &this.web_data } else { &this.data };
                let Some(day) = day else { return Vec::new() };
                range
                    .map(|index| {
                        crate::features::page_controls::keyboard_row(
                            this.records_view.scroll.clone(),
                            index,
                            count,
                            cx,
                        )
                        .h(px(RECORD_CARD_HEIGHT + RECORD_CARD_GAP))
                        .pb(px(RECORD_CARD_GAP))
                        .child(this.record_card(
                            &groups[index],
                            day,
                            colors,
                            win,
                            cx,
                        ))
                    })
                    .collect()
            }),
        )
        .track_scroll(&self.records_view.scroll)
        .flex_1()
        .min_h_0()
        .w_full()
    }

    fn record_card(
        &self,
        group: &RecordGroup,
        day: &HistoryDay,
        colors: Palette,
        win: &mut Window,
        cx: &mut Context<Self>,
    ) -> Stateful<Div> {
        let locale = self.client.locale.get();
        let record = &day.records[group.first_index];
        let anonymous = record.key == "activity:anonymous";
        let source_color = self.source_color(day, &record.key, false);
        let color =
            quietpro::activity_display_color(source_color, colors.panel, self.client.dark(win));
        let icon = match self.icons.get(&record.key) {
            _ if anonymous => crate::features::page_controls::anonymous::icon(
                color,
                record.name.clone(),
                quietpro::UNFRAMED_APP_ICON_SIZE,
            )
            .into_any_element(),
            Some(icon) => img(icon.image.clone())
                .size(px(quietpro::UNFRAMED_APP_ICON_SIZE))
                .into_any_element(),
            None => quietpro::glyph(
                if self.web || self.records_view.web {
                    Icon::Globe
                } else {
                    Icon::AppWindow
                },
                colors.secondary,
            )
            .size(px(quietpro::UNFRAMED_APP_ICON_SIZE))
            .into_any_element(),
        };
        let mut identity = div()
            .flex_initial()
            .min_w_0()
            .flex()
            .items_center()
            .gap(px(8.))
            .child(
                label(record.name.clone())
                    .min_w_0()
                    .truncate()
                    .text_size(px(14.))
                    .line_height(px(20.))
                    .font_weight(FontWeight::MEDIUM),
            );
        if !anonymous {
            let mut counts = format_text(
                locale,
                "history.activitySegmentCount",
                &[("count", group.count.to_string())],
            );
            if self.data_has_titles {
                let titles = format_text(
                    locale,
                    "history.titleRowCount",
                    &[("count", group.titles.len().to_string())],
                );
                counts.push_str(" ･ ");
                counts.push_str(&titles);
            }
            identity = identity.child(
                label(counts)
                    .text_size(px(12.))
                    .line_height(px(16.))
                    .text_color(colors.secondary)
                    .flex_none(),
            );
        }
        if group.current {
            identity = identity.child(
                label(text(locale, "destinationDetail.current"))
                    .text_size(px(12.))
                    .text_color(colors.accent)
                    .flex_none(),
            );
        }
        let mut action = div().w(px(28.)).flex_none();
        if !group.titles.is_empty() && !anonymous {
            let id = group.id;
            let open = self.records_view.expanded == Some(id);
            let trigger_focus =
                win.use_keyed_state(("record-details-focus", id), cx, |_, cx| cx.focus_handle());
            let trigger_focus = trigger_focus.read(cx).clone();
            let bounds = win.use_keyed_state(("record-details-bounds", id), cx, |_, _| {
                Bounds::<Pixels>::default()
            });
            let rect = *bounds.read(cx);
            let popup_height = 34. + 20. + 12. + (group.titles.len().min(5) as f32 * 48. - 8.);
            let anchor = if win.viewport_size().height - rect.bottom() < px(popup_height + 8.)
                && rect.top() > win.viewport_size().height - rect.bottom()
            {
                Anchor::BottomLeft
            } else {
                Anchor::TopLeft
            };
            let titles = if open {
                group.titles.clone()
            } else {
                Vec::new()
            };
            let name = format!("{} ･ {}", text(locale, "history.titleDetails"), record.name);
            action = action.child(
                Popover::new(("record-details", id))
                    .open(open)
                    .anchor(anchor)
                    .offset(px(8.))
                    .trigger(
                        IconControl::new(
                            ("record-details-trigger", id),
                            name,
                            if open {
                                Icon::ChevronDown
                            } else {
                                Icon::ChevronRight
                            },
                        )
                        .button(colors)
                        .track_focus(&trigger_focus)
                        .child(
                            canvas(
                                move |rect, _, cx| {
                                    bounds.update(cx, |current, _| *current = rect);
                                },
                                |_, _, _, _| {},
                            )
                            .absolute()
                            .inset_0(),
                        ),
                    )
                    .on_open_change(cx.listener(move |this, open: &bool, _, cx| {
                        this.records_view.expanded = open.then_some(id);
                        cx.notify();
                    }))
                    .content(move |_, win, _| title_rows(&titles, colors, locale, win)),
            );
        }
        quietpro::continuous_frame(px(16.), colors.border, colors.panel)
            .id(("timeline-record", group.id))
            .role(Role::Group)
            .aria_label(format!("{} ･ {}", record.name, duration(group.duration)))
            .flex()
            .flex_none()
            .items_center()
            .gap(px(8.))
            .px(px(12.))
            .py(px(8.))
            .min_h(px(RECORD_CARD_HEIGHT))
            .child(
                div()
                    .size(px(quietpro::UNFRAMED_APP_ICON_SIZE))
                    .flex_none()
                    .child(icon),
            )
            .child(
                div()
                    .flex_1()
                    .min_w_0()
                    .flex()
                    .items_center()
                    .gap(px(8.))
                    .child(identity)
                    .child(action),
            )
            .child(
                div()
                    .flex_none()
                    .flex()
                    .items_center()
                    .gap(px(8.))
                    .child(
                        label(duration(group.duration))
                            .text_size(px(14.))
                            .line_height(px(20.))
                            .font_weight(FontWeight::MEDIUM),
                    )
                    .child(
                        label(format!(
                            "{} – {}",
                            stamp(group.start, "%H:%M"),
                            stamp(group.end, "%H:%M")
                        ))
                        .text_size(px(12.))
                        .line_height(px(16.))
                        .font_weight(FontWeight::MEDIUM)
                        .text_color(colors.secondary),
                    ),
            )
    }

    pub(super) fn change_minimum(&mut self, next: i64, cx: &mut Context<Self>) {
        if self.writing_minimum || !(0..=600).contains(&next) {
            return;
        }
        self.writing_minimum = true;
        let write = self.client.history_minimum(self.target.is_some(), next);
        cx.spawn(async move |view, cx| {
            let result = write.await;
            let _ = view.update(cx, |this, cx| {
                this.writing_minimum = false;
                if result.is_ok() {
                    this.minimum = Some(next);
                    this.records_view.close_details();
                } else {
                    this.error = true;
                }
                cx.notify();
            });
        })
        .detach();
        cx.notify();
    }
}

#[cfg(test)]
mod tests {
    use super::{groups, groups_in_range};
    use patina_activity_model::{HistoryDay, HistoryRecord};
    use std::collections::BTreeMap;

    #[test]
    fn groups_sum_effective_fragments_without_filling_gaps() {
        let record = |group_id, start, end| HistoryRecord {
            group_id,
            key: "studio.exe".into(),
            name: "Studio".into(),
            category: "Work".into(),
            start,
            end,
            group_duration: 180_000,
            titles: vec![(start, end, "Draft".into(), None)],
            current: false,
        };
        let mut day = HistoryDay {
            start: 0,
            end: 86_400_000,
            apps: Vec::new(),
            minimum_seconds: 0,
            timeline_merge_gap_ms: 180_000,
            colors: BTreeMap::new(),
            custom_colors: BTreeMap::new(),
            favicons: BTreeMap::new(),
            hours: [0; 24],
            category_hours: BTreeMap::new(),
            categories: Vec::new(),
            records: vec![
                record(0, 0, 120_000),
                record(1, 120_000, 180_000),
                record(0, 180_000, 240_000),
                record(2, 1_000_000, 1_180_000),
            ],
        };
        let visible = groups(&day, 120_000);
        assert_eq!(visible.len(), 2);
        assert_eq!(
            (
                day.records[visible[0].first_index].start,
                visible[0].end,
                visible[0].duration
            ),
            (0, 240_000, 180_000)
        );
        assert_eq!((visible[0].count, visible[0].titles.len()), (2, 1));
        assert_eq!(visible[1].id, 2);
        assert_eq!(groups(&day, 0).len(), 3);
        assert!(groups(&day, 181_000).is_empty());
        let clipped = groups_in_range(&day, 60_000, (60_000, 210_000));
        assert_eq!(clipped.len(), 2);
        assert_eq!(
            (clipped[0].start, clipped[0].end, clipped[0].duration),
            (60_000, 210_000, 90_000)
        );
        assert_eq!(
            clipped[0].titles,
            vec![(60_000, 210_000, "Draft".into(), None, 90_000)]
        );
        assert!(groups_in_range(&day, 100_000, (60_000, 210_000)).is_empty());
        day.records[0].titles[0].3 = Some("https://example.test/a".into());
        day.records[2].titles[0].3 = Some("https://example.test/b".into());
        assert_eq!(
            groups(&day, 0)[0].titles.len(),
            2,
            "same title with different URLs stays distinct"
        );
        day.records[2].titles[0].3 = Some("https://example.test/a".into());
        let merged = groups(&day, 0);
        assert_eq!(merged[0].titles.len(), 1);
        assert_eq!(
            merged[0].titles[0].4, 180_000,
            "merged title excludes the idle gap"
        );
    }
}
