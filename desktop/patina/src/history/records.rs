use super::*;
use chrono::{Days, TimeZone};
use gpui_kit::base::Popover;
use quietpro::{Icon, IconControl};
use std::collections::BTreeMap;

pub(super) struct RecordsState {
    web: bool,
    expanded: Option<usize>,
    modes: [FocusHandle; 2],
}
impl RecordsState {
    pub(super) fn new(cx: &mut Context<History>) -> Self {
        Self {
            web: false,
            expanded: None,
            modes: std::array::from_fn(|_| cx.focus_handle()),
        }
    }
    pub(super) fn close_details(&mut self) {
        self.expanded = None;
    }
}

struct RecordGroup<'a> {
    id: usize,
    first: &'a HistoryRecord,
    end: i64,
    duration: i64,
    count: usize,
    titles: Vec<(i64, i64, String)>,
}

fn groups(day: &HistoryDay, minimum: i64) -> Vec<RecordGroup<'_>> {
    let mut groups = BTreeMap::<usize, RecordGroup<'_>>::new();
    for record in &day.records {
        let group = groups
            .entry(record.group_id)
            .or_insert_with(|| RecordGroup {
                id: record.group_id,
                first: record,
                end: record.end,
                duration: 0,
                count: 0,
                titles: Vec::new(),
            });
        group.end = group.end.max(record.end);
        group.duration += (record.end - record.start).max(0);
        group.count += 1;
        group.titles.extend(record.titles.iter().cloned());
    }
    let mut groups: Vec<_> = groups
        .into_values()
        .filter(|g| g.duration >= minimum)
        .collect();
    for group in &mut groups {
        group.titles.sort_by_key(|t| t.0);
    }
    groups.sort_by_key(|g| (g.first.start, g.id));
    groups
}

fn elapsed(ms: i64) -> String {
    if ms < 60_000 {
        format!("{}s", ms.max(0) / 1000)
    } else {
        duration(ms)
    }
}

fn title_rows(
    titles: &[(i64, i64, String)],
    colors: Palette,
    locale: Locale,
    viewport: Size<Pixels>,
) -> Div {
    let mut list = div()
        .id("timeline-title-list")
        .overflow_y_scroll()
        .min_h_0()
        .flex_1()
        .flex()
        .flex_col()
        .gap(px(6.));
    for (index, (start, end, title)) in titles.iter().enumerate() {
        list = list.child(
            div()
                .id(("timeline-title", index))
                .flex()
                .items_start()
                .gap(px(12.))
                .py(px(6.))
                .border_b_1()
                .border_color(colors.border)
                .child(label(title.clone()).flex_1().min_w_0().text_size(px(12.)))
                .child(
                    div()
                        .flex_none()
                        .flex()
                        .flex_col()
                        .items_end()
                        .gap(px(2.))
                        .child(label(elapsed(end - start)).text_size(px(12.)))
                        .child(
                            label(format!(
                                "{} – {}",
                                stamp(*start, "%H:%M:%S"),
                                stamp(*end, "%H:%M:%S")
                            ))
                            .text_size(px(10.))
                            .text_color(colors.secondary),
                        ),
                ),
        );
    }
    quietpro::dialog_surface(colors, viewport)
        .w(px(426.).min(viewport.width - px(24.)))
        .max_h(px(260.).min(viewport.height - px(24.)))
        .gap(px(8.))
        .child(label(text(locale, "history.titleDetails")).font_weight(FontWeight::SEMIBOLD))
        .child(list)
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
        let groups = data
            .map(|day| groups(day, self.minimum.unwrap_or(300) * 1000))
            .unwrap_or_default();
        let mut rows = div()
            .id("timeline-record-list")
            .role(Role::Group)
            .aria_label(tr("history.timeline"))
            .flex_1()
            .min_h_0()
            .overflow_y_scroll()
            .flex()
            .flex_col()
            .gap(px(8.));
        if data.is_none() || groups.is_empty() {
            let key = if self.error || (self.records_view.web && self.web_error) {
                "destinationDetail.dayError"
            } else if data.is_none() {
                "common.loading"
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
        for group in &groups {
            rows = rows.child(self.record_card(group, data.unwrap(), colors, win, cx));
        }
        let view = cx.weak_entity();
        let tabs = quietpro::segmented(
            "timeline-record-mode",
            tr("data.destinationMode"),
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
            }),
            self.records_view.web,
            true,
            colors,
            move |web, _, cx| {
                let _ = view.update(cx, |this, cx| {
                    this.records_view.web = web;
                    this.records_view.close_details();
                    cx.notify();
                });
            },
        );
        let current = Local
            .timestamp_millis_opt(self.date)
            .single()
            .unwrap()
            .date_naive();
        let today = Local::now().date_naive();
        let date = div()
            .flex()
            .items_center()
            .gap(px(4.))
            .child(
                IconControl::new(
                    "records-prev-day",
                    tr("destinationDetail.previousDay"),
                    Icon::ChevronLeft,
                )
                .action(
                    colors,
                    cx.listener(move |this, _, _, cx| {
                        if let Some(date) = (current - Days::new(1))
                            .and_hms_opt(0, 0, 0)
                            .and_then(|d| d.and_local_timezone(Local).earliest())
                        {
                            this.change_day(date.timestamp_millis(), cx);
                        }
                    }),
                ),
            )
            .child(
                label(if current == today {
                    tr("date.today")
                } else {
                    current.to_string()
                })
                .text_size(px(12.))
                .text_color(colors.secondary),
            )
            .child(
                IconControl::new(
                    "records-next-day",
                    tr("destinationDetail.nextDay"),
                    Icon::ChevronRight,
                )
                .disabled(current >= today)
                .action(
                    colors,
                    cx.listener(move |this, _, _, cx| {
                        if let Some(date) = (current + Days::new(1))
                            .and_hms_opt(0, 0, 0)
                            .and_then(|d| d.and_local_timezone(Local).earliest())
                        {
                            this.change_day(date.timestamp_millis(), cx);
                        }
                    }),
                ),
            );
        let min = self.minimum.unwrap_or(300);
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
            .child(label(format!("{} min", min / 60)).text_size(px(12.)))
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
            .pb(px(10.))
            .border_b_1()
            .border_color(colors.border)
            .child(
                div().flex().items_center().gap(px(10.)).child(tabs).child(
                    label(format_text(
                        locale,
                        "history.sessionCount",
                        &[("count", groups.len().to_string())],
                    ))
                    .text_size(px(12.))
                    .text_color(colors.secondary),
                ),
            )
            .child(date)
            .child(filter);
        div().child(
            quietpro::dialog_surface(colors, win.viewport_size())
                .id("timeline-records-dialog")
                .accessibility_id("timeline-records-dialog")
                .role(Role::Group)
                .aria_label(tr("history.timeline"))
                .w(px(760.).min(win.viewport_size().width - px(48.)))
                .h(px(560.).min(win.viewport_size().height - px(48.)))
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
                .when(self.error || self.web_error, |panel| {
                    panel.child(
                        quietpro::text_button("records-retry", tr("common.retry"), colors, true)
                            .on_click(cx.listener(|this, _, _, cx| this.refresh(cx))),
                    )
                })
                .child(rows),
        )
    }

    fn record_card(
        &self,
        group: &RecordGroup<'_>,
        day: &HistoryDay,
        colors: Palette,
        win: &mut Window,
        cx: &mut Context<Self>,
    ) -> Stateful<Div> {
        let locale = self.client.locale.get();
        let record = group.first;
        let anonymous = record.key == "activity:anonymous";
        let color = quietpro::activity_display_color(
            self.source_color(day, &record.key, false),
            colors.panel,
            self.client.dark(win),
        );
        let icon = match self.icons.get(&record.key) {
            Some(icon) => img(icon.image.clone()).size(px(18.)).into_any_element(),
            None => quietpro::glyph(
                if anonymous {
                    Icon::EyeOff
                } else if self.records_view.web {
                    Icon::Globe
                } else {
                    Icon::AppWindow
                },
                colors.secondary,
            )
            .size(px(18.))
            .into_any_element(),
        };
        let mut identity = div()
            .flex_1()
            .min_w_0()
            .flex()
            .items_center()
            .gap(px(6.))
            .child(
                label(record.name.clone())
                    .min_w_0()
                    .truncate()
                    .font_weight(FontWeight::MEDIUM),
            );
        if !anonymous {
            identity = identity.child(
                label(format!(
                    "{} · {}",
                    format_text(
                        locale,
                        "history.activitySegmentCount",
                        &[("count", group.count.to_string())]
                    ),
                    format_text(
                        locale,
                        "history.titleRowCount",
                        &[("count", group.titles.len().to_string())]
                    )
                ))
                .text_size(px(10.))
                .text_color(colors.secondary)
                .flex_none(),
            );
        }
        if !group.titles.is_empty() && !anonymous {
            let id = group.id;
            let open = self.records_view.expanded == Some(id);
            let bounds = win.use_keyed_state(("record-details-bounds", id), cx, |_, _| {
                Bounds::<Pixels>::default()
            });
            let rect = *bounds.read(cx);
            let anchor = if win.viewport_size().height - rect.bottom() < px(268.)
                && rect.top() > win.viewport_size().height - rect.bottom()
            {
                Anchor::BottomLeft
            } else {
                Anchor::TopLeft
            };
            let titles = group.titles.clone();
            let name = format!("{} · {}", text(locale, "history.titleDetails"), record.name);
            identity = identity.child(
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
                    .content(move |_, win, _| {
                        title_rows(&titles, colors, locale, win.viewport_size())
                    }),
            );
        }
        div()
            .id(("timeline-record", group.id))
            .role(Role::Group)
            .aria_label(format!("{} · {}", record.name, elapsed(group.duration)))
            .flex()
            .flex_none()
            .items_center()
            .gap(px(12.))
            .p(px(12.))
            .min_h(px(64.))
            .border_1()
            .border_color(colors.border)
            .rounded(px(12.))
            .bg(colors.canvas)
            .child(
                div()
                    .w(px(4.))
                    .h(px(36.))
                    .flex_none()
                    .rounded_full()
                    .bg(color),
            )
            .child(
                div()
                    .size(px(32.))
                    .flex_none()
                    .flex()
                    .items_center()
                    .justify_center()
                    .rounded(px(8.))
                    .border_1()
                    .border_color(colors.border)
                    .bg(colors.panel)
                    .child(icon),
            )
            .child(identity)
            .child(
                div()
                    .flex_none()
                    .flex()
                    .flex_col()
                    .items_end()
                    .gap(px(2.))
                    .child(label(elapsed(group.duration)).text_size(px(12.)))
                    .child(
                        label(format!(
                            "{} – {}",
                            stamp(record.start, "%H:%M:%S"),
                            stamp(group.end, "%H:%M:%S")
                        ))
                        .text_size(px(10.))
                        .text_color(colors.secondary),
                    ),
            )
    }

    pub(super) fn change_minimum(&mut self, next: i64, cx: &mut Context<Self>) {
        if self.writing_minimum || !(0..=600).contains(&next) {
            return;
        }
        self.writing_minimum = true;
        let write = self
            .client
            .request::<()>(crate::window_process::Query::HistoryMinimum(
                self.target.is_some(),
                next,
            ));
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
    use super::groups;
    use patina_recorder::{HistoryDay, HistoryRecord};
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
            titles: vec![(start, end, "Draft".into())],
        };
        let day = HistoryDay {
            start: 0,
            end: 86_400_000,
            apps: Vec::new(),
            minimum_seconds: 0,
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
            (visible[0].first.start, visible[0].end, visible[0].duration),
            (0, 240_000, 180_000)
        );
        assert_eq!((visible[0].count, visible[0].titles.len()), (2, 2));
        assert_eq!(visible[1].id, 2);
        assert_eq!(groups(&day, 0).len(), 3);
        assert!(groups(&day, 181_000).is_empty());
    }
}
