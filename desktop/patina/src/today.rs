use crate::page_controls::anonymous;
use quietpro::{CARD_TITLE_GAP, CONTENT_INSET, content_card, content_card as panel};
mod apps;
mod charts;
use apps::Popup;

use crate::format::duration;

use gpui_kit::{base::Button, prelude::*, *};
use patina_recorder::{AppUsage, DaySummary, format_text, text};
use quietpro::{Icon, IconControl, Palette, caption, glyph};
use std::{
    collections::{HashMap, HashSet},
    rc::Rc,
    sync::Arc,
    time::{Duration, Instant},
};

const OVERVIEW_MIN_WIDTH: f32 = 260.;
const SUMMARY_MIN_HEIGHT: f32 = 250.;

struct AppIcon {
    image: Arc<Image>,
    color: Option<u32>,
}

pub(super) struct Today {
    client: Rc<crate::windows_host::Client>,
    data: Option<DaySummary>,
    read: Option<Task<()>>,
    writing: bool,
    error: Option<&'static str>,
    popup: Option<Popup>,
    hour_focus: [FocusHandle; 24],
    active_hour: Option<usize>,
    hour_scroll: ScrollHandle,
    hour_hide: Option<Task<()>>,
    icons: HashMap<String, AppIcon>,
}

fn value(label: String) -> Stateful<Div> {
    div()
        .id(SharedString::from(label.clone()))
        .role(Role::Label)
        .aria_value(label.clone())
        .child(label)
}

fn title(label: String) -> Stateful<Div> {
    div()
        .id(SharedString::from(label.clone()))
        .role(Role::Heading)
        .aria_label(label.clone())
        .text_size(px(16.))
        .font_weight(FontWeight::SEMIBOLD)
        .child(label)
}

impl Today {
    pub(super) fn new(
        window: &mut Window,
        client: Rc<crate::windows_host::Client>,
        cx: &mut Context<Self>,
    ) -> Self {
        let hour_focus = std::array::from_fn(|hour| {
            let focus = cx.focus_handle().tab_stop(true);
            // GPUI dispatches focus changes during drawing. Invalidate after that frame.
            cx.on_focus(&focus, window, move |_, win, cx| {
                cx.defer_in(win, move |this, _, cx| this.show_hour(hour, true, cx));
            })
            .detach();
            cx.on_blur(&focus, window, move |_, win, cx| {
                cx.defer_in(win, move |this, _, cx| this.show_hour(hour, false, cx));
            })
            .detach();
            focus
        });
        let mut view = Self {
            client,
            data: None,
            read: None,
            writing: false,
            error: None,
            popup: None,
            hour_focus,
            active_hour: None,
            hour_scroll: ScrollHandle::new(),
            hour_hide: None,
            icons: Default::default(),
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

    pub(super) fn refresh(&mut self, repeat: bool, cx: &mut Context<Self>) {
        let client = self.client.clone();
        self.read = Some(cx.spawn(async move |view, cx| {
            let mut checked = HashSet::new();
            let mut checked_at = Instant::now();
            loop {
                let result = client.today().await;
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
                        let current: HashSet<_> =
                            data.apps.iter().map(|a| a.key.as_str()).collect();
                        this.icons.retain(|key, _| current.contains(key.as_str()));
                        for (key, bytes) in images {
                            if !this
                                .icons
                                .get(&key)
                                .is_some_and(|icon| icon.image.bytes == bytes)
                            {
                                this.icons.insert(
                                    key,
                                    AppIcon {
                                        color: patina_recorder::icon_color(&bytes),
                                        image: Arc::new(Image::from_bytes(ImageFormat::Png, bytes)),
                                    },
                                );
                            }
                        }
                        this.error = None;
                        let delay = if client.paused() {
                            ((data.day_end - chrono::Local::now().timestamp_millis()).max(1000)
                                as u64)
                                .div_ceil(1000)
                        } else {
                            data.refresh_seconds
                        };
                        this.data = Some(data);
                        cx.notify();
                        Some(delay)
                    }
                    Err(e) => {
                        eprintln!("read Today: {e}");
                        if this
                            .data
                            .as_ref()
                            .is_some_and(|d| d.day_end <= chrono::Local::now().timestamp_millis())
                        {
                            this.data = None;
                            this.icons.clear();
                        }
                        this.error = Some(if this.data.is_some() {
                            "common.refreshFailed"
                        } else {
                            "common.readFailed"
                        });
                        cx.notify();
                        None
                    }
                });
                let Ok(Some(seconds)) = delay else {
                    break;
                };
                if !repeat {
                    break;
                }
                cx.background_executor()
                    .timer(Duration::from_secs(seconds))
                    .await;
            }
        }));
    }

    fn save(
        &mut self,
        write: impl Future<Output = Result<(), String>> + 'static,
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
        if let Some(data) = &self.data {
            let page_width = crate::main_window::page_width(window.viewport_size().width);
            let horizontal_insets = 2. * (CONTENT_INSET + 1.);
            let width = ((f32::from(page_width) - horizontal_insets - quietpro::CARD_GAP) * 0.45)
                .max(OVERVIEW_MIN_WIDTH)
                - horizontal_insets;
            let mode = data.category_mode;
            let toggle = IconControl::new(
                "chart-mode",
                self.label(if mode {
                    "dashboard.showTotalHourlyActivity"
                } else {
                    "dashboard.showHourlyActivityByCategory"
                }),
                Icon::Layers,
            )
            .disabled(self.writing)
            .toggle(colors, mode, {
                let view = cx.weak_entity();
                move |next, _, win, cx| {
                    let _ = view.update(cx, |this, cx| {
                        if !this.writing {
                            this.save(this.client.set_chart_mode(next), win, cx);
                        }
                    });
                }
            });
            let activity = content_card(colors.border, colors.panel)
                .id("today-activity-panel")
                .role(Role::Group)
                .accessibility_id("today-activity-panel")
                .flex_1()
                .min_h(px(SUMMARY_MIN_HEIGHT))
                .gap(px(CARD_TITLE_GAP))
                .child(
                    div()
                        .flex()
                        .items_center()
                        .justify_between()
                        .child(title(self.label("dashboard.hourlyActivity")))
                        .child(toggle),
                )
                .child(self.hourly(data, width >= 400., colors, dark, cx));
            let left = div()
                .id("overview")
                .flex_none()
                .w(px(width + horizontal_insets))
                .min_h_0()
                .overflow_y_scroll()
                .flex()
                .flex_col()
                .gap(px(quietpro::CARD_GAP))
                .child(charts::focus(data, locale, width, colors, dark))
                .child(activity);
            let count = format_text(
                locale,
                "dashboard.topAppsBadge",
                &[("count", data.apps.len().to_string())],
            );
            let rows = div()
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
                        .map(|app| self.row(app, data.total, colors, window, cx)),
                )
                .when(data.apps.is_empty(), |s| {
                    s.items_center()
                        .justify_center()
                        .child(caption(self.label("dashboard.emptyState"), colors))
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
                        .child(title(self.label("dashboard.topApps")))
                        .child(value(count).text_color(colors.secondary).text_size(px(12.))),
                )
                .child(rows);
            page = page.child(
                div()
                    .flex_1()
                    .min_h_0()
                    .flex()
                    .gap(px(quietpro::CARD_GAP))
                    .child(left)
                    .child(ranking),
            );
            if let Some(popup) = &self.popup
                && let Some(app) = data.apps.iter().find(|a| a.key == popup.key)
            {
                page = page.child(self.dialog(popup, app, data, colors, window, cx));
            }
        } else if self.error.is_none() {
            page = page.child(caption(self.label("common.loading"), colors));
        }
        page.image_cache(retain_all("today-icons"))
    }
}
