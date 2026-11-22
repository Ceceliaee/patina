use crate::features::page_controls::{anonymous, label};
use quietpro::{CARD_TITLE_GAP, CONTENT_INSET, content_card};
mod apps;
mod charts;
#[cfg(all(test, feature = "test-support"))]
pub(crate) mod tests;
use apps::Popup;

use crate::features::format::duration;

use gpui_kit::{
    base::{Button, ElementExt, TestSupportExt},
    prelude::*,
    *,
};
use patina_activity_model::{AppUsage, DaySummary, Locale, format_text, text};
use quietpro::{Icon, IconControl, Palette, glyph, heading};
use std::{
    collections::{HashMap, HashSet},
    rc::Rc,
    sync::Arc,
    time::{Duration, Instant},
};

const OVERVIEW_MIN_WIDTH: f32 = 260.;
const SUMMARY_MIN_HEIGHT: f32 = 250.;

fn regular_caption(text: String, colors: Palette) -> Div {
    quietpro::caption(text, colors).text_color(colors.text)
}

struct AppIcon {
    image: Arc<Image>,
    color: Option<u32>,
}

pub(crate) struct TodaySnapshot {
    summary: DaySummary,
    icons: HashMap<String, AppIcon>,
    locale: Locale,
    revision: u64,
}

impl TodaySnapshot {
    fn reusable(&self, client: &crate::client::Client) -> bool {
        let now = chrono::Local::now();
        self.locale == client.locale.get()
            && self.revision == client.activity_revision.get()
            && now.timestamp_millis() < self.summary.day_end_ms
            && chrono::DateTime::from_timestamp_millis(self.summary.day_end_ms - 1).is_some_and(
                |last| last.with_timezone(&chrono::Local).date_naive() == now.date_naive(),
            )
    }
}

pub(crate) struct Today {
    client: Rc<crate::client::Client>,
    pub(crate) snapshot: Option<TodaySnapshot>,
    read: Option<Task<()>>,
    writing: bool,
    overview_gap: Pixels,
    error: Option<&'static str>,
    popup: Option<Popup>,
}

impl Today {
    pub(crate) fn new(
        window: &mut Window,
        client: Rc<crate::client::Client>,
        snapshot: Option<TodaySnapshot>,
        cx: &mut Context<Self>,
    ) -> Self {
        let mut view = Self {
            snapshot: snapshot.filter(|snapshot| snapshot.reusable(&client)),
            client,
            read: None,
            writing: false,
            overview_gap: px(quietpro::CARD_GAP),
            error: None,
            popup: None,
        };
        cx.observe_window_activation(window, |this: &mut Self, window, cx| {
            if window.is_window_active() {
                this.refresh(true, cx);
            } else {
                this.read = None;
            }
        })
        .detach();
        cx.observe_window_appearance(window, |_, _, cx| cx.notify())
            .detach();
        view.refresh(window.is_window_active(), cx);
        view
    }

    fn label(&self, key: &str) -> String {
        text(self.client.locale.get(), key)
    }

    fn summary(&self) -> Option<&DaySummary> {
        self.snapshot.as_ref().map(|s| &s.summary)
    }

    pub(crate) fn ready_to_present(&self) -> bool {
        self.snapshot.is_some() || self.error.is_some()
    }

    pub(crate) fn refresh(&mut self, repeat: bool, cx: &mut Context<Self>) {
        let client = self.client.clone();
        self.read = Some(cx.spawn(async move |view, cx| {
            let mut checked = HashSet::new();
            let mut checked_at = Instant::now();
            loop {
                if view
                    .update(cx, |this, cx| {
                        if this.summary().is_some_and(|d| {
                            d.day_end_ms <= chrono::Local::now().timestamp_millis()
                        }) {
                            this.snapshot = None;
                            this.popup = None;
                            cx.notify();
                        }
                    })
                    .is_err()
                {
                    break;
                }
                let revision = client.activity_revision.get();
                let locale = client.locale.get();
                let result = client.load_today_summary().await;
                let mut images = Vec::new();
                if let Ok(data) = &result {
                    if checked_at.elapsed() >= Duration::from_secs(60) {
                        checked.clear();
                        checked_at = Instant::now();
                    }
                    let missing: Vec<_> = data
                        .apps
                        .iter()
                        .filter(|app| !app.anonymous && checked.insert(app.key.clone()))
                        .map(|app| app.key.clone())
                        .collect();
                    if !missing.is_empty() {
                        match client.icons(missing).await {
                            Ok(icons) => images = icons,
                            Err(error) => eprintln!("read Today icons: {error}"),
                        }
                    }
                }
                let delay = view.update(cx, |this, cx| match result {
                    Ok(data) => {
                        let until_midnight =
                            data.day_end_ms - chrono::Local::now().timestamp_millis();
                        if until_midnight <= 0 {
                            checked.clear();
                            return Some(Duration::ZERO);
                        }
                        let current: HashSet<_> =
                            data.apps.iter().map(|a| a.key.as_str()).collect();
                        let mut icons = this.snapshot.take().map(|s| s.icons).unwrap_or_default();
                        icons.retain(|key, _| current.contains(key.as_str()));
                        for (key, bytes) in images {
                            if !icons
                                .get(&key)
                                .is_some_and(|icon| icon.image.bytes == bytes)
                            {
                                icons.insert(
                                    key,
                                    AppIcon {
                                        color: patina_activity_model::icon_color(&bytes),
                                        image: Arc::new(Image::from_bytes(ImageFormat::Png, bytes)),
                                    },
                                );
                            }
                        }
                        this.error = None;
                        let until_midnight = Duration::from_millis(until_midnight as u64);
                        let delay = if client.paused() {
                            until_midnight
                        } else {
                            until_midnight.min(Duration::from_secs(data.refresh_seconds))
                        };
                        this.snapshot = Some(TodaySnapshot {
                            summary: data,
                            icons,
                            locale,
                            revision,
                        });
                        cx.notify();
                        Some(delay)
                    }
                    Err(e) => {
                        eprintln!("read Today: {e}");
                        if this.summary().is_some_and(|d| {
                            d.day_end_ms <= chrono::Local::now().timestamp_millis()
                        }) {
                            this.snapshot = None;
                        }
                        this.error = Some(if this.snapshot.is_some() {
                            "common.refreshFailed"
                        } else {
                            "common.readFailed"
                        });
                        cx.notify();
                        None
                    }
                });
                let Ok(Some(delay)) = delay else {
                    break;
                };
                if !repeat && !delay.is_zero() {
                    break;
                }
                cx.background_executor().timer(delay).await;
            }
        }));
    }

    fn save(
        &mut self,
        write: impl Future<Output = Result<(), patina_desktop_protocol::RequestError>> + 'static,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.writing = true;
        self.read = None;
        cx.notify();
        cx.spawn_in(window, async move |view, cx| {
            let result = write.await;
            let _ = view.update_in(cx, |this, win, cx| {
                this.writing = false;
                match result {
                    Ok(()) => this.refresh(win.is_window_active(), cx),
                    Err(e) => {
                        eprintln!("save Today setting: {e}");
                        this.error = Some("mapping.quickSaveFailed");
                    }
                }
                cx.notify();
            });
        })
        .detach();
    }
}

impl Render for Today {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let colors = self.client.palette(window);
        let dark = self.client.dark(window);
        let locale = self.client.locale.get();
        let mut page = quietpro::page(colors).child(quietpro::page_title_row(
            self.label("dashboard.title"),
            Icon::Monitor,
            colors,
        ));
        if let Some(error) = self.error {
            page = page.child(div().flex().gap(px(12.)).child(self.label(error)).child(
                quietpro::text_button("retry", self.label("common.retry"), colors, true).on_click(
                    cx.listener(|this, _, win, cx| this.refresh(win.is_window_active(), cx)),
                ),
            ));
        }
        let data = self.summary();
        let page_width = crate::windows::main::page_width(window.viewport_size().width);
        let horizontal_insets = 2. * (CONTENT_INSET + 1.);
        let width = ((f32::from(page_width) - horizontal_insets - quietpro::CARD_GAP) * 0.45)
            .max(OVERVIEW_MIN_WIDTH)
            - horizontal_insets;
        let toggle = data.map(|_| {
            let mode = self.client.navigation.get().hourly_by_category;
            IconControl::new(
                "chart-mode",
                self.label(if mode {
                    "dashboard.showTotalHourlyActivity"
                } else {
                    "dashboard.showHourlyActivityByCategory"
                }),
                Icon::Layers,
            )
            .with_tooltip()
            .toggle(colors, mode, {
                let view = cx.weak_entity();
                move |next, _, _, cx| {
                    let _ = view.update(cx, |this, cx| {
                        this.client.set_hourly_by_category(next);
                        cx.notify();
                    });
                }
            })
        });
        let activity = content_card(colors.border, colors.panel)
            .id("today-activity-panel")
            .role(Role::Group)
            .accessibility_id("today-activity-panel")
            .gap(px(CARD_TITLE_GAP))
            .child(
                div()
                    .flex()
                    .min_h(px(quietpro::ICON_CONTROL_SIZE))
                    .items_center()
                    .justify_between()
                    .child(heading(self.label("dashboard.hourlyActivity")))
                    .children(toggle),
            )
            .when_some(data, |panel, data| {
                panel.child(self.hourly(data, width >= 400., colors, dark))
            });
        let overview_cards = div()
            .h_full()
            .min_h(px(2. * SUMMARY_MIN_HEIGHT + quietpro::CARD_GAP))
            .grid()
            .grid_rows(2)
            .gap_y(self.overview_gap)
            .on_prepaint(cx.processor(|this, bounds: Bounds<Pixels>, win, _| {
                let scale = win.scale_factor();
                let height = (f32::from(bounds.size.height) * scale).round() as i32;
                let base_gap = (quietpro::CARD_GAP * scale).round() as i32;
                // Round both cards up together when an odd device pixel remains.
                let gap = px((base_gap - (height - base_gap).rem_euclid(2)) as f32 / scale);
                if this.overview_gap != gap {
                    this.overview_gap = gap;
                    win.request_animation_frame();
                }
            }))
            .child(charts::focus(data, locale, width, colors, dark).test_support())
            .child(activity.test_support());
        let left = div()
            .id("overview")
            .flex_none()
            .w(px(width + horizontal_insets))
            .min_h_0()
            .overflow_y_scroll()
            .child(overview_cards);
        let count = data.map(|data| {
            let count = format_text(
                locale,
                "dashboard.topAppsBadge",
                &[("count", data.apps.len().to_string())],
            );
            quietpro::caption(count.clone(), colors)
                .font_weight(FontWeight::MEDIUM)
                .id("ranking-count")
                .role(Role::Label)
                .accessibility_id("today-ranking-count")
                .aria_value(count)
        });
        let rows = data.map(|data| {
            div()
                .id("apps")
                .flex_1()
                .min_h_0()
                .overflow_y_scroll()
                .flex()
                .flex_col()
                .gap(px(quietpro::APP_CARD_GAP))
                .children(
                    data.apps
                        .iter()
                        .map(|app| self.row(app, data.total_duration_ms, colors, window, cx)),
                )
                .when(data.apps.is_empty(), |s| {
                    s.items_center()
                        .justify_center()
                        .child(regular_caption(self.label("dashboard.emptyState"), colors))
                })
        });
        let ranking = content_card(colors.border, colors.panel)
            .id("today-ranking-panel")
            .role(Role::Group)
            .accessibility_id("today-ranking-panel")
            .flex_1()
            .min_w_0()
            .gap(px(CARD_TITLE_GAP))
            .child(
                div()
                    .flex()
                    .justify_between()
                    .items_center()
                    .child(heading(self.label("dashboard.topApps")))
                    .children(count),
            )
            .children(rows);
        page = page.child(
            div()
                .flex_1()
                .min_h_0()
                .flex()
                .gap(px(quietpro::CARD_GAP))
                .child(left)
                .child(ranking.test_support()),
        );
        if let (Some(popup), Some(data)) = (&self.popup, data)
            && let Some(app) = data.apps.iter().find(|a| a.key == popup.key)
        {
            page = page.child(self.dialog(popup, app, data, colors, window, cx));
        }
        page.image_cache(retain_all("today-icons"))
    }
}
