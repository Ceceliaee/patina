use super::*;
use gpui_kit::base::slider::{SliderEvent, SliderState, SliderValue};
use quietpro::heading;
use quietpro::{Icon, IconControl, activity_display_color, value_slider};
use std::collections::BTreeMap;

pub(super) struct ZoomState {
    slider: Entity<SliderState>,
    slider_focus: FocusHandle,
    focus: FocusHandle,
}

impl ZoomState {
    pub(super) fn new(hours: f32, cx: &mut Context<History>) -> Self {
        let slider = cx.new(|_| {
            SliderState::new()
                .min(1.)
                .max(24.)
                .step(0.2)
                .default_value(hours)
        });
        cx.subscribe(&slider, |this: &mut History, _, event: &SliderEvent, cx| {
            if let SliderEvent::Change(SliderValue::Single(hours)) = event {
                this.zoom(*hours - this.hours, 0.5, cx);
            }
        })
        .detach();
        Self {
            slider,
            slider_focus: cx.focus_handle(),
            focus: cx.focus_handle(),
        }
    }
}

struct Lane<'a> {
    key: &'a str,
    name: &'a str,
    duration: i64,
    records: Vec<HistoryRecord>,
}

fn lanes(day: &HistoryDay, left: i64, right: i64, categories: bool) -> Vec<Lane<'_>> {
    let mut lanes = BTreeMap::<&str, Lane<'_>>::new();
    for r in &day.records {
        let duration = r.end.min(right) - r.start.max(left);
        if duration <= 0 {
            continue;
        }
        let (key, name) = if categories {
            (r.category.as_str(), r.category.as_str())
        } else {
            (r.key.as_str(), r.name.as_str())
        };
        let lane = lanes.entry(key).or_insert_with(|| Lane {
            key,
            name,
            duration: 0,
            records: Vec::new(),
        });
        lane.duration += duration;
        let mut clipped = r.clone();
        clipped.start = r.start.max(left);
        clipped.end = r.end.min(right);
        clipped.group_duration = duration;
        lane.records.push(clipped);
    }
    let mut lanes: Vec<_> = lanes.into_values().collect();
    for lane in &mut lanes {
        lane.records.sort_by_key(|r| (r.start, r.end));
        let mut merged: Vec<HistoryRecord> = Vec::new();
        for record in lane.records.drain(..) {
            if let Some(previous) = merged.last_mut()
                && record.start >= previous.end
                && record.start - previous.end <= day.timeline_merge_gap_ms.max(0)
            {
                previous.end = record.end;
                previous.group_duration += record.group_duration;
            } else {
                merged.push(record);
            }
        }
        lane.records = merged;
    }
    lanes.sort_by(|a, b| b.duration.cmp(&a.duration).then_with(|| a.key.cmp(b.key)));
    lanes
}

pub(super) fn dominant_records(day: &HistoryDay, categories: bool) -> Vec<HistoryRecord> {
    let mut buckets = BTreeMap::<i64, BTreeMap<String, (i64, HistoryRecord)>>::new();
    let mut bounds = BTreeMap::<i64, (i64, i64)>::new();
    for record in &day.records {
        let mut minute = day.start + (record.start.max(day.start) - day.start) / 60_000 * 60_000;
        while minute < record.end.min(day.end) {
            let start = record.start.max(minute);
            let end = record.end.min(minute + 60_000).min(day.end);
            let active = bounds.entry(minute).or_insert((start, end));
            active.0 = active.0.min(start);
            active.1 = active.1.max(end);
            let key = if categories {
                &record.category
            } else {
                &record.key
            };
            let item = buckets
                .entry(minute)
                .or_default()
                .entry(key.clone())
                .or_insert_with(|| (0, record.clone()));
            item.0 += (end - start).max(0);
            if record.start < item.1.start {
                item.1 = record.clone();
            }
            minute += 60_000;
        }
    }
    let mut result: Vec<HistoryRecord> = Vec::new();
    for (minute, items) in buckets {
        let Some((_, (duration, mut record))) = items.into_iter().min_by(|(ka, a), (kb, b)| {
            b.0.cmp(&a.0)
                .then(a.1.start.cmp(&b.1.start))
                .then(ka.cmp(kb))
        }) else {
            continue;
        };
        record.group_duration = duration;
        let (start, end) = bounds[&minute];
        record.start = if start - minute <= 1000 {
            minute
        } else {
            start
        };
        let boundary = (minute + 60_000).min(day.end);
        record.end = if boundary - end <= 1000 {
            boundary
        } else {
            end
        };
        if let Some(previous) = result.last_mut()
            && (if categories {
                previous.category == record.category
            } else {
                previous.key == record.key
            })
            && (record.key != "activity:anonymous" || record.group_id == previous.group_id)
            && record.start - previous.end <= day.timeline_merge_gap_ms.max(0)
        {
            previous.end = record.end;
            previous.group_duration += record.group_duration;
        } else {
            result.push(record);
        }
    }
    result
}

fn clock_label(time: i64, day_end: i64) -> String {
    if time == day_end {
        "24:00".into()
    } else {
        stamp(time, "%H:%M")
    }
}

pub(super) fn initial_offset(start: i64, end: i64, hours: f32, focus: i64) -> i64 {
    let half_hour = HOUR / 2;
    let snapped = start + ((focus - start + half_hour / 2) / half_hour) * half_hour;
    let width = ((hours * HOUR as f32).round() as i64).clamp(HOUR, end - start);
    (snapped - width / 2).clamp(start, end - width)
}

pub(super) fn ticks(day: &HistoryDay, left: i64, right: i64, colors: Palette) -> Div {
    let span = right - left;
    let step = if span <= 2 * HOUR {
        HOUR / 2
    } else if span <= 6 * HOUR {
        HOUR
    } else if span <= 12 * HOUR {
        2 * HOUR
    } else {
        4 * HOUR
    };
    let mut axis = div()
        .relative()
        .h(px(20.))
        .w_full()
        .flex_none()
        .text_size(px(11.))
        .text_color(colors.secondary)
        .child(div().absolute().left_0().child(clock_label(left, day.end)))
        .child(
            div()
                .absolute()
                .right_0()
                .child(clock_label(right, day.end)),
        );
    let mut time = day.start + ((left - day.start) / step + 1) * step;
    while time < right {
        let ratio = (time - left) as f32 / span as f32;
        if (0.07..0.93).contains(&ratio) {
            axis = axis.child(
                div()
                    .absolute()
                    .left(relative(ratio))
                    .ml(px(-24.))
                    .w(px(48.))
                    .text_center()
                    .child(clock_label(time, day.end)),
            );
        }
        time += step;
    }
    axis
}

fn track<'a>(
    records: impl Iterator<Item = &'a HistoryRecord>,
    source_color: impl Fn(&str) -> u32,
    range: (i64, i64),
    categories: bool,
    colors: Palette,
    dark: bool,
    segment_inset: f32,
) -> Div {
    let (left, right) = range;
    let mut track = div()
        .relative()
        .min_w_0()
        .overflow_hidden()
        .rounded(px(12.))
        .border_1()
        .border_color(colors.border)
        .bg(colors.canvas)
        .child(
            div()
                .absolute()
                .left_0()
                .right_0()
                .top(relative(0.5))
                .h(px(1.))
                .bg(colors.border.opacity(0.5)),
        );
    for (index, r) in records.enumerate() {
        let a = r.start.max(left);
        let b = r.end.min(right);
        if b <= a {
            continue;
        }
        let key = if categories { &r.category } else { &r.key };
        let color = activity_display_color(source_color(key), colors.canvas, dark);
        let description = format!(
            "{} · {}–{} · {}",
            if categories { &r.category } else { &r.name },
            stamp(a, "%H:%M:%S"),
            stamp(b, "%H:%M:%S"),
            records::elapsed(r.group_duration.min(b - a))
        );
        track = track.child(
            div()
                .id(("zoom-segment", index))
                .tooltip(move |_, cx| {
                    cx.new(|_| super::detail::SegmentTip(description.clone(), colors))
                        .into()
                })
                .absolute()
                .top(px(segment_inset))
                .bottom(px(segment_inset))
                .left(relative((a - left) as f32 / (right - left) as f32))
                .w(relative((b - a) as f32 / (right - left) as f32))
                .min_w(px(1.))
                .rounded(px(2.))
                .bg(color)
                .when(r.key == "activity:anonymous", |s| {
                    s.child(quietpro::dot_pattern(colors.secondary))
                }),
        );
    }
    track
}

impl History {
    pub(super) fn reset_zoom_position(&mut self) {
        use chrono::TimeZone;
        if let Some(day) = self.timeline_data() {
            let now = Local::now();
            let date = Local
                .timestamp_millis_opt(day.start)
                .single()
                .unwrap()
                .date_naive();
            let focus = date
                .and_time(now.time())
                .and_local_timezone(Local)
                .earliest()
                .map_or(day.start, |value| value.timestamp_millis());
            self.offset = Some(initial_offset(day.start, day.end, self.hours, focus));
        }
    }

    pub(super) fn prepare_zoom(&mut self, cx: &mut Context<Self>) {
        let Some(day) = self.timeline_data() else {
            return;
        };
        let hours = self.hours;
        let max = (day.end - day.start) as f32 / HOUR as f32;
        self.zoom_view.slider.update(cx, |s, cx| {
            *s = SliderState::new()
                .min(1.)
                .max(max)
                .step(0.2)
                .default_value(hours);
            cx.notify();
        });
    }

    pub(super) fn zoom_toolbar(
        &self,
        day: &HistoryDay,
        colors: Palette,
        win: &mut Window,
        cx: &mut Context<Self>,
    ) -> Div {
        let locale = self.client.locale.get();
        let tr = |key| text(locale, key);
        let (left, right) = self.viewport(day);
        if (self.zoom_view.slider.read(cx).value().end() - self.hours).abs() > 0.001 {
            self.zoom_view
                .slider
                .update(cx, |s, cx| s.set_value(self.hours, win, cx));
        }
        let mode_label = self.timeline_mode_label();
        div()
            .flex()
            .flex_none()
            .items_center()
            .gap(px(8.))
            .child(
                IconControl::new(
                    "zoom-less",
                    tr("history.timelineDecreaseHours"),
                    Icon::Minus,
                )
                .disabled(self.hours <= 1.)
                .action(
                    colors,
                    cx.listener(|this, _, _, cx| this.zoom(-1., 0.5, cx)),
                ),
            )
            .child(
                div()
                    .id("zoom-slider-keys")
                    .on_mouse_down(
                        MouseButton::Left,
                        cx.listener(|this, _, win, cx| win.focus(&this.zoom_view.slider_focus, cx)),
                    )
                    .on_key_down(cx.listener(|this, event: &KeyDownEvent, _, cx| {
                        let delta = match event.keystroke.key.as_str() {
                            "left" | "down" => -0.2,
                            "right" | "up" => 0.2,
                            "home" => 1. - this.hours,
                            "end" => {
                                this.data
                                    .as_ref()
                                    .map_or(24., |d| (d.end - d.start) as f32 / HOUR as f32)
                                    - this.hours
                            }
                            _ => return,
                        };
                        this.zoom(delta, 0.5, cx);
                        cx.stop_propagation();
                    }))
                    .child(
                        value_slider(
                            &self.zoom_view.slider,
                            tr("history.timelineWindowHours"),
                            true,
                            colors,
                            cx,
                        )
                        .track_focus(&self.zoom_view.slider_focus.clone().tab_stop(true))
                        .w(px(128.)),
                    ),
            )
            .child(
                label(format_text(
                    locale,
                    "history.timelineHoursValue",
                    &[("hours", format!("{:.1}", self.hours))],
                ))
                .w(px(64.))
                .text_center()
                .text_size(px(12.))
                .font_weight(FontWeight::SEMIBOLD),
            )
            .child(
                IconControl::new("zoom-more", tr("history.timelineIncreaseHours"), Icon::Plus)
                    .disabled(right - left >= day.end - day.start)
                    .action(colors, cx.listener(|this, _, _, cx| this.zoom(1., 0.5, cx))),
            )
            .child(
                label(format!(
                    "{} – {}",
                    clock_label(left, day.end),
                    clock_label(right, day.end)
                ))
                .flex_1()
                .text_center()
                .when(self.target.is_some(), |label| label.text_right())
                .text_size(px(12.))
                .text_color(colors.secondary),
            )
            .when(self.target.is_none(), |bar| {
                bar.child(
                    IconControl::new("zoom-mode", mode_label, Icon::Tags).action(
                        colors,
                        cx.listener(|this, _, _, cx| {
                            this.cycle_timeline(cx);
                        }),
                    ),
                )
            })
    }

    fn zoom_lanes(&self, day: &HistoryDay, colors: Palette, dark: bool) -> Stateful<Div> {
        let (left, right) = self.viewport(day);
        let lanes = lanes(day, left, right, self.timeline_categories);
        let mut rows = div()
            .id("zoom-lanes")
            .flex_initial()
            .min_h_0()
            .max_h(px(40. * 5.))
            .overflow_y_scroll()
            .flex()
            .flex_col();
        if lanes.is_empty() {
            return rows.items_center().justify_center().child(
                label(text(
                    self.client.locale.get(),
                    "history.emptyTimelineWindow",
                ))
                .text_color(colors.secondary)
                .text_size(px(12.)),
            );
        }
        for (index, lane) in lanes.iter().enumerate() {
            let color = activity_display_color(
                self.source_color(day, lane.key, self.timeline_categories),
                colors.canvas,
                dark,
            );
            let mark = if !self.timeline_categories && lane.key == "activity:anonymous" {
                crate::features::page_controls::anonymous::icon(color, lane.name.into(), 16.)
                    .into_any_element()
            } else if !self.timeline_categories
                && let Some(icon) = self.icons.get(lane.key)
            {
                img(icon.image.clone()).size(px(16.)).into_any_element()
            } else {
                div()
                    .size(px(8.))
                    .rounded_full()
                    .bg(color)
                    .into_any_element()
            };
            let elapsed = if lane.duration < 60_000 {
                format!("{}s", lane.duration / 1000)
            } else {
                duration(lane.duration)
            };
            rows = rows.child(
                div()
                    .id(("zoom-lane", index))
                    .role(Role::Group)
                    .aria_label(format!("{} · {elapsed}", lane.name))
                    .flex()
                    .flex_none()
                    .items_center()
                    .h(px(40.))
                    .gap(px(12.))
                    .border_b_1()
                    .border_color(colors.border)
                    .child(
                        div()
                            .w(relative(0.16))
                            .min_w(px(100.))
                            .flex_none()
                            .flex()
                            .items_center()
                            .gap(px(8.))
                            .child(div().flex_none().child(mark))
                            .child(
                                div()
                                    .when_else(
                                        !self.timeline_categories
                                            && lane.key == "activity:anonymous",
                                        |s| {
                                            s.child(
                                                crate::features::page_controls::anonymous::name(
                                                    colors.text,
                                                ),
                                            )
                                        },
                                        |s| s.child(lane.name.to_owned()),
                                    )
                                    .min_w_0()
                                    .truncate()
                                    .text_size(px(12.)),
                            ),
                    )
                    .child(
                        track(
                            lane.records.iter(),
                            |key| self.source_color(day, key, self.timeline_categories),
                            (left, right),
                            self.timeline_categories,
                            colors,
                            dark,
                            6.,
                        )
                        .flex_1()
                        .h(px(32.)),
                    )
                    .child(
                        label(elapsed)
                            .w(px(56.))
                            .flex_none()
                            .text_right()
                            .text_size(px(12.))
                            .text_color(colors.secondary),
                    ),
            );
        }
        rows
    }

    pub(super) fn zoom_popup(
        &self,
        day: &HistoryDay,
        colors: Palette,
        win: &mut Window,
        cx: &mut Context<Self>,
    ) -> Div {
        let locale = self.client.locale.get();
        let dark = self.client.dark(win);
        let (left, right) = self.viewport(day);
        let overview_records = dominant_records(day, self.timeline_categories);
        let overview = track(
            overview_records.iter(),
            |key| self.source_color(day, key, self.timeline_categories),
            (left, right),
            self.timeline_categories,
            colors,
            dark,
            8.,
        )
        .id("zoom-overview")
        .role(Role::Group)
        .accessibility_id("zoom-overview")
        .aria_label(text(locale, "history.horizontalTimeline.ariaLabel"))
        .track_focus(&self.zoom_view.focus.clone().tab_stop(true))
        .focus_visible(|s| s.border_color(colors.secondary))
        .h(px(48.))
        .w_full()
        .flex_none()
        .on_key_down(cx.listener(|this, e: &KeyDownEvent, _, cx| {
            match e.keystroke.key.as_str() {
                "left" => this.pan(-1, cx),
                "right" => this.pan(1, cx),
                "home" | "end" => {
                    if let Some(day) = &this.data {
                        let (left, right) = this.viewport(day);
                        this.offset = Some(if e.keystroke.key == "home" {
                            day.start
                        } else {
                            day.end - (right - left)
                        });
                        cx.notify();
                    }
                }
                _ => return,
            }
            cx.stop_propagation();
        }));
        let overview = self.interactive_timeline(overview, left, right, cx);
        quietpro::dialog_surface(colors, win.viewport_size())
            .w((win.viewport_size().width - px(48.)).min(px(1000.)))
            .on_any_mouse_down(|_, _, cx| cx.stop_propagation())
            .child(
                div()
                    .flex()
                    .flex_none()
                    .items_center()
                    .child(heading(text(locale, "history.timelineZoom")).flex_1())
                    .child(
                        IconControl::new("close-zoom", text(locale, "common.close"), Icon::X)
                            .action(
                                colors,
                                cx.listener(|this, _, win, cx| this.close_overlay(win, cx)),
                            ),
                    ),
            )
            .child(self.zoom_toolbar(day, colors, win, cx))
            .child(
                div()
                    .flex()
                    .flex_col()
                    .flex_none()
                    .gap(px(8.))
                    .py(px(16.))
                    .border_y_1()
                    .border_color(colors.border)
                    .child(overview)
                    .child(ticks(day, left, right, colors)),
            )
            .child(
                heading(text(
                    locale,
                    if self.timeline_categories {
                        "history.timelineCategoryLanes"
                    } else if self.web || self.timeline_web {
                        "history.timelineWebLanes"
                    } else {
                        "history.timelineAppLanes"
                    },
                ))
                .text_size(px(12.)),
            )
            .child(self.zoom_lanes(day, colors, dark))
    }
}

impl History {
    pub(super) fn interactive_timeline(
        &self,
        strip: Stateful<Div>,
        left: i64,
        right: i64,
        cx: &mut Context<Self>,
    ) -> Stateful<Div> {
        let bounds = self.plot_bounds.clone();
        strip
            .when(self.target.is_some(), |strip| {
                strip
                    .track_focus(&self.zoom_view.focus.clone().tab_stop(true))
                    .on_key_down(cx.listener(|this, e: &KeyDownEvent, _, cx| {
                        let Some(day) = &this.data else { return };
                        let (left, right) = this.viewport(day);
                        let offset = match e.keystroke.key.as_str() {
                            "left" => left - (right - left) / 10,
                            "right" => left + (right - left) / 10,
                            "home" => day.start,
                            "end" => day.end - (right - left),
                            _ => return,
                        };
                        this.offset = Some(offset.clamp(day.start, day.end - (right - left)));
                        this.records_view.close_details();
                        cx.stop_propagation();
                        cx.notify();
                    }))
            })
            .child(
                canvas(move |b, _, _| bounds.set(b), |_, _, _, _| ())
                    .absolute()
                    .inset_0()
                    .size_full(),
            )
            .on_mouse_down(
                MouseButton::Left,
                cx.listener(move |this, e: &MouseDownEvent, win, cx| {
                    if this.target.is_some()
                        || this.overlay.as_ref().is_some_and(|o| o.0 == Overlay::Zoom)
                    {
                        win.focus(&this.zoom_view.focus, cx);
                    }
                    this.drag = Some((e.position.x, left));
                    this.records_view.close_details();
                }),
            )
            .on_mouse_up(
                MouseButton::Left,
                cx.listener(|this, _, _, _| this.drag = None),
            )
            .on_mouse_up_out(
                MouseButton::Left,
                cx.listener(|this, _, _, _| this.drag = None),
            )
            .on_mouse_move(cx.listener(move |this, e: &MouseMoveEvent, _, cx| {
                if let Some((x, start)) = this.drag
                    && e.pressed_button == Some(MouseButton::Left)
                {
                    let width = f32::from(this.plot_bounds.get().size.width).max(1.);
                    this.offset = Some(
                        start
                            - (f32::from(e.position.x - x) / width * (right - left) as f32) as i64,
                    );
                    cx.notify();
                }
            }))
            .on_scroll(cx.listener(|this, e: &ScrollEvent, _, cx| {
                let d = e.delta.pixel_delta(px(16.));
                if e.modifiers.shift || d.x.abs() > d.y.abs() {
                    if let Some(day) = this.timeline_data() {
                        let (left, right) = this.viewport(day);
                        let distance = if e.modifiers.shift && d.y != px(0.) {
                            d.y
                        } else {
                            d.x
                        };
                        let width = f32::from(this.plot_bounds.get().size.width).max(1.);
                        this.offset = Some(
                            (left - (f32::from(distance) / width * (right - left) as f32) as i64)
                                .clamp(day.start, day.end - (right - left)),
                        );
                        this.records_view.close_details();
                        cx.notify();
                    }
                } else if d.y != px(0.) {
                    let b = this.plot_bounds.get();
                    let ratio = (f32::from(e.position.x - b.origin.x)
                        / f32::from(b.size.width).max(1.))
                    .clamp(0., 1.);
                    this.zoom(if d.y > px(0.) { -0.2 } else { 0.2 }, ratio, cx);
                }
                cx.stop_propagation();
            }))
    }
}

#[cfg(test)]
mod tests {
    use super::{HOUR, dominant_records, initial_offset, lanes};
    use patina_activity_model::{HistoryDay, HistoryRecord};
    use std::collections::BTreeMap;

    #[test]
    fn lanes_clip_visible_time_and_group_categories() {
        let record = |key: &str, start, end| HistoryRecord {
            key: key.into(),
            name: key.into(),
            category: "Work".into(),
            start,
            end,
            group_duration: end - start,
            group_id: 0,
            titles: Vec::new(),
            current: false,
        };
        let mut day = HistoryDay {
            start: 0,
            end: 24 * HOUR,
            apps: Vec::new(),
            records: vec![
                record("a", 0, 2 * HOUR),
                record("b", 2 * HOUR, 4 * HOUR),
                record("c", 5 * HOUR, 6 * HOUR),
            ],
            minimum_seconds: 60,
            timeline_merge_gap_ms: 180_000,
            colors: BTreeMap::new(),
            custom_colors: BTreeMap::new(),
            favicons: BTreeMap::new(),
            hours: [0; 24],
            categories: Vec::new(),
            category_hours: BTreeMap::new(),
        };
        let apps = lanes(&day, HOUR, 3 * HOUR, false);
        assert_eq!(
            apps.iter().map(|l| (l.key, l.duration)).collect::<Vec<_>>(),
            vec![("a", HOUR), ("b", HOUR)]
        );
        let categories = lanes(&day, HOUR, 3 * HOUR, true);
        assert_eq!(categories.len(), 1);
        assert_eq!(categories[0].duration, 2 * HOUR);
        assert_eq!(categories[0].records.len(), 1);
        assert!(lanes(&day, 4 * HOUR, 5 * HOUR, false).is_empty());
        day.records = vec![
            record("a", 0, 60_000),
            record("b", 60_000, 120_000),
            record("a", 120_000, 180_000),
            record("a", 400_000, 460_000),
        ];
        let merged = lanes(&day, 30_000, 430_000, false);
        assert_eq!(merged[0].key, "a");
        assert_eq!(merged[0].duration, 120_000);
        assert_eq!(merged[0].records.len(), 2);
        assert_eq!(
            (merged[0].records[0].start, merged[0].records[0].end),
            (30_000, 180_000)
        );
        assert_eq!(merged[0].records[1].end, 430_000);
    }

    #[test]
    fn overview_uses_dominant_minutes_without_extending_partial_activity() {
        let record = |key: &str, start, end| HistoryRecord {
            key: key.into(),
            name: key.into(),
            category: "Work".into(),
            start,
            end,
            group_duration: end - start,
            group_id: 0,
            titles: Vec::new(),
            current: false,
        };
        let mut day = HistoryDay {
            start: 0,
            end: 24 * HOUR,
            apps: Vec::new(),
            minimum_seconds: 0,
            timeline_merge_gap_ms: 0,
            colors: BTreeMap::new(),
            custom_colors: BTreeMap::new(),
            favicons: BTreeMap::new(),
            hours: [0; 24],
            categories: Vec::new(),
            category_hours: BTreeMap::new(),
            records: vec![
                record("a", 10_000, 40_000),
                record("b", 40_000, 60_000),
                record("a", 60_000, 80_000),
            ],
        };
        let result = dominant_records(&day, false);
        assert_eq!(result.len(), 1);
        assert_eq!(
            (&*result[0].key, result[0].start, result[0].end),
            ("a", 10_000, 80_000)
        );
        day.records = vec![
            record("b", 30_000, 60_000),
            record("a", 0, 30_000),
            record("c", 120_000, 150_000),
        ];
        let result = dominant_records(&day, false);
        assert_eq!(
            result
                .iter()
                .map(|r| (&*r.key, r.start, r.end))
                .collect::<Vec<_>>(),
            vec![("a", 0, 60_000), ("c", 120_000, 150_000)]
        );
        day.timeline_merge_gap_ms = 180_000;
        assert_eq!(dominant_records(&day, true).len(), 1);
        day.records = vec![
            record("activity:anonymous", 0, 60_000),
            record("activity:anonymous", 60_000, 120_000),
        ];
        day.records[1].group_id = 1;
        assert_eq!(dominant_records(&day, false).len(), 2);
    }

    #[test]
    fn zoom_opens_at_reference_time_snapped_to_half_hour() {
        assert_eq!(
            initial_offset(0, 24 * HOUR, 8., 17 * HOUR + 12 * 60_000),
            13 * HOUR
        );
        assert_eq!(
            initial_offset(0, 24 * HOUR, 4., 17 * HOUR + 20 * 60_000),
            15 * HOUR + HOUR / 2
        );
        assert_eq!(initial_offset(0, 24 * HOUR, 8., HOUR), 0);
        assert_eq!(initial_offset(0, 24 * HOUR, 8., 23 * HOUR), 16 * HOUR);
    }
}
