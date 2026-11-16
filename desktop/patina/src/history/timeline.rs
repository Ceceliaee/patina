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
    records: Vec<&'a HistoryRecord>,
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
        lane.records.push(r);
    }
    let mut lanes: Vec<_> = lanes.into_values().collect();
    lanes.sort_by(|a, b| b.duration.cmp(&a.duration).then_with(|| a.key.cmp(b.key)));
    lanes
}

fn clock_label(time: i64, day_end: i64) -> String {
    if time == day_end {
        "24:00".into()
    } else {
        stamp(time, "%H:%M")
    }
}

fn ticks(day: &HistoryDay, left: i64, right: i64, colors: Palette) -> Div {
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
    left: i64,
    right: i64,
    categories: bool,
    colors: Palette,
    dark: bool,
) -> Div {
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
    for r in records {
        let a = r.start.max(left);
        let b = r.end.min(right);
        if b <= a {
            continue;
        }
        let key = if categories { &r.category } else { &r.key };
        let color = activity_display_color(source_color(key), colors.canvas, dark);
        track = track.child(
            div()
                .absolute()
                .top(px(6.))
                .bottom(px(6.))
                .left(relative((a - left) as f32 / (right - left) as f32))
                .w(relative((b - a) as f32 / (right - left) as f32))
                .min_w(px(1.))
                .rounded(px(2.))
                .bg(color),
        );
    }
    track
}

impl History {
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

    fn zoom_toolbar(
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
                .text_size(px(12.))
                .text_color(colors.secondary),
            )
            .child(
                IconControl::new("zoom-mode", mode_label, Icon::Tags).action(
                    colors,
                    cx.listener(|this, _, _, cx| {
                        this.cycle_timeline(cx);
                    }),
                ),
            )
    }

    fn zoom_lanes(&self, day: &HistoryDay, colors: Palette, dark: bool) -> Stateful<Div> {
        let (left, right) = self.viewport(day);
        let lanes = lanes(day, left, right, self.timeline_categories);
        let mut rows = div()
            .id("zoom-lanes")
            .flex_initial()
            .min_h_0()
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
            let mark = if !self.timeline_categories
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
                    .h(px(56.))
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
                                label(lane.name.into())
                                    .min_w_0()
                                    .truncate()
                                    .text_size(px(12.)),
                            ),
                    )
                    .child(
                        track(
                            lane.records.iter().copied(),
                            |key| self.source_color(day, key, self.timeline_categories),
                            left,
                            right,
                            self.timeline_categories,
                            colors,
                            dark,
                        )
                        .flex_1()
                        .h(px(48.)),
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
        let overview = track(
            day.records.iter(),
            |key| self.source_color(day, key, self.timeline_categories),
            left,
            right,
            self.timeline_categories,
            colors,
            dark,
        )
        .id("zoom-overview")
        .role(Role::Group)
        .accessibility_id("zoom-overview")
        .aria_label(text(locale, "history.horizontalTimeline.ariaLabel"))
        .track_focus(&self.zoom_view.focus.clone().tab_stop(true))
        .focus_visible(|s| s.border_color(colors.secondary))
        .h(px(64.))
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
            .child(
                canvas(move |b, _, _| bounds.set(b), |_, _, _, _| ())
                    .absolute()
                    .inset_0()
                    .size_full(),
            )
            .on_mouse_down(
                MouseButton::Left,
                cx.listener(move |this, e: &MouseDownEvent, win, cx| {
                    if this.overlay.as_ref().is_some_and(|o| o.0 == Overlay::Zoom) {
                        win.focus(&this.zoom_view.focus, cx);
                    }
                    this.drag = Some((e.position.x, left));
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
                if d.x.abs() > d.y.abs() {
                    this.pan(if d.x > px(0.) { -1 } else { 1 }, cx);
                } else {
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
    use super::{HOUR, lanes};
    use patina_recorder::{HistoryDay, HistoryRecord};
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
        };
        let day = HistoryDay {
            start: 0,
            end: 24 * HOUR,
            apps: Vec::new(),
            records: vec![
                record("a", 0, 2 * HOUR),
                record("b", 2 * HOUR, 4 * HOUR),
                record("c", 5 * HOUR, 6 * HOUR),
            ],
            minimum_seconds: 60,
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
        assert_eq!(categories[0].records.len(), 2);
        assert!(lanes(&day, 4 * HOUR, 5 * HOUR, false).is_empty());
    }
}
