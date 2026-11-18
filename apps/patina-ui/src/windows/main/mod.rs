use crate::{features::history::History, features::today::Today};

use gpui_kit::{prelude::*, *};
use patina_i18n::text;
use quietpro::{Icon, IconControl};
use std::rc::Rc;
#[cfg(all(test, feature = "test-support"))]
mod tests;

use quietpro::{SHELL_PADDING, SIDEBAR_WIDTH, outer_frame};

pub(crate) fn page_width(viewport_width: Pixels) -> Pixels {
    viewport_width - px(2. * SHELL_PADDING + SIDEBAR_WIDTH + quietpro::CARD_GAP)
}

#[derive(Clone, Copy, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
pub(crate) enum Section {
    Tools,
    About,
    Settings,
    Classification,
    Today,
    History,
    Data,
}
enum Page {
    Tools(Entity<crate::features::tools::Tools>),
    About(Entity<crate::features::about::About>),
    Settings(Entity<crate::features::settings::Settings>),
    Classification(Entity<crate::features::classification::Classification>),
    Today(Entity<Today>),
    History(Entity<History>),
    Data(Entity<crate::features::data::DataPage>),
}
impl Page {
    fn section(&self) -> Section {
        match self {
            Self::Tools(_) => Section::Tools,
            Self::Classification(_) => Section::Classification,
            Self::Settings(_) => Section::Settings,
            Self::About(_) => Section::About,
            Self::Today(_) => Section::Today,
            Self::History(_) => Section::History,
            Self::Data(_) => Section::Data,
        }
    }
}
pub(crate) struct Saved;
struct PendingNavigation {
    target: Section,
    dialog_focus: FocusHandle,
    previous_focus: Option<FocusHandle>,
}
pub(crate) struct MainWindow {
    notice: Option<Entity<crate::windows::notice::ToolNotice>>,
    tool_target: Option<patina_activity_model::ToolTarget>,
    pending: Option<PendingNavigation>,
    page_subscription: Option<Subscription>,
    restore_after_update: Option<Task<()>>,
    page: Page,
    labels: bool,
    client: Rc<crate::client::Client>,
}

impl MainWindow {
    pub fn refresh_tools(&self, cx: &mut App) {
        if let Page::Tools(tools) = &self.page {
            tools.update(cx, |t, cx| t.background_refresh(cx));
        }
    }
    pub fn show_notice(&mut self, win: &Window, cx: &mut Context<Self>) {
        if let Some(n) = &self.notice {
            n.update(cx, |n, cx| n.refresh(cx));
        } else {
            self.notice = Some(cx.new(|cx| {
                crate::windows::notice::ToolNotice::embedded(self.client.clone(), win, cx)
            }));
        }
        cx.notify();
    }
    pub fn refresh_notice(&self, cx: &mut App) {
        if let Some(n) = &self.notice {
            n.update(cx, |n, cx| n.refresh(cx));
        }
    }
    pub(crate) fn navigate(
        &mut self,
        target: Option<patina_activity_model::ToolTarget>,
        win: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.tool_target = target;
        let page = if target.is_some() {
            Section::Tools
        } else {
            Section::Today
        };
        if target.is_some() && self.page.section() == page {
            self.switch(page, win, cx);
        } else {
            self.select(page, win, cx);
        }
    }
    pub(crate) fn select(&mut self, section: Section, win: &mut Window, cx: &mut Context<Self>) {
        if self.page.section() == section {
            return;
        }
        let dirty = match &self.page {
            Page::Classification(v) => v.read(cx).dirty(cx),
            Page::Settings(v) => v.read(cx).dirty(),
            _ => false,
        };
        if dirty {
            if self.pending.is_none() {
                let previous_focus = win.focused(cx);
                let dialog_focus = cx.focus_handle();
                win.focus(&dialog_focus, cx);
                self.pending = Some(PendingNavigation {
                    target: section,
                    dialog_focus,
                    previous_focus,
                });
                cx.notify();
            }
            return;
        }
        self.switch(section, win, cx);
    }
    fn keep_editing(&mut self, win: &mut Window, cx: &mut Context<Self>) {
        if let Some(prompt) = self.pending.take() {
            self.tool_target = None;
            if let Some(previous) = prompt.previous_focus {
                win.focus(&previous, cx);
            }
            cx.notify();
        }
    }
    fn switch(&mut self, section: Section, win: &mut Window, cx: &mut Context<Self>) {
        self.restore_after_update = None;
        self.page_subscription = None;
        self.page = match section {
            Section::Tools => Page::Tools(cx.new(|cx| {
                crate::features::tools::Tools::new(self.client.clone(), self.tool_target.take(), cx)
            })),
            Section::About => Page::About(
                cx.new(|cx| crate::features::about::About::new(self.client.clone(), cx)),
            ),
            Section::Settings => {
                let view = cx.new(|cx| {
                    crate::features::settings::Settings::new(self.client.clone(), win, cx)
                });
                self.page_subscription =
                    Some(cx.subscribe_in(&view, win, |t, _, _: &Saved, win, cx| {
                        if let Some(prompt) = t.pending.take() {
                            t.switch(prompt.target, win, cx);
                        }
                    }));
                Page::Settings(view)
            }
            Section::Classification => {
                let view = cx.new(|cx| {
                    crate::features::classification::Classification::new(
                        self.client.clone(),
                        win,
                        cx,
                    )
                });
                self.page_subscription =
                    Some(cx.subscribe_in(&view, win, |t, _, _: &Saved, win, cx| {
                        if let Some(prompt) = t.pending.take() {
                            t.switch(prompt.target, win, cx);
                        }
                    }));
                Page::Classification(view)
            }
            Section::History => Page::History(cx.new(|cx| {
                History::new(
                    self.client.clone(),
                    chrono::Local::now().timestamp_millis(),
                    None,
                    win,
                    cx,
                )
            })),
            Section::Today => Page::Today(cx.new(|cx| Today::new(win, self.client.clone(), cx))),
            Section::Data => {
                let view =
                    cx.new(|cx| crate::features::data::DataPage::new(self.client.clone(), win, cx));
                self.page_subscription = Some(cx.subscribe_in(
                    &view,
                    win,
                    |this, _, event: &crate::features::data::OpenHistoryDay, win, cx| {
                        this.page_subscription = None;
                        this.page =
                            Page::History(cx.new(|cx| {
                                History::new(this.client.clone(), event.0, None, win, cx)
                            }));
                        #[cfg(debug_assertions)]
                        crate::windows::dev_preview::remember(Section::History);
                        cx.notify();
                    },
                ));
                Page::Data(view)
            }
        };
        #[cfg(debug_assertions)]
        crate::windows::dev_preview::remember(section);
        cx.notify();
    }
    pub(crate) fn refresh(&self, cx: &mut App) {
        match &self.page {
            Page::Today(v) => v.update(cx, |v, cx| v.refresh(true, cx)),
            Page::History(v) => v.update(cx, |v, cx| v.refresh(cx)),
            Page::Data(v) => v.update(cx, |v, cx| v.refresh(cx)),
            Page::About(_) => (),
            Page::Tools(_) => (),
            Page::Settings(_) => (),
            Page::Classification(_) => (),
        }
    }
    pub(crate) fn open(
        cx: &mut App,
        client: Rc<crate::client::Client>,
    ) -> Result<(AnyWindowHandle, WeakEntity<Self>)> {
        let options = WindowOptions {
            window_bounds: Some(WindowBounds::Windowed(Bounds::centered(
                None,
                size(px(1080.), px(720.)),
                cx,
            ))),
            window_min_size: Some(size(px(810.), px(540.))),
            titlebar: None,
            app_id: Some(crate::APP_ID.into()),
            ..Default::default()
        };
        let (handle, view) = gpui_kit::open_window(options, cx, |window, cx| {
            window.set_window_title("Patina UI");
            window
                .observe_window_appearance(|_, cx| cx.refresh_windows())
                .detach();
            let close = client.clone();
            window.on_window_should_close(cx, move |window, _| {
                close.close_main(window);
                false
            });
            client.main_opened(window);
            let today = cx.new(|cx| Today::new(window, client.clone(), cx));
            let view = cx.new(|_| Self {
                page: Page::Today(today),
                pending: None,
                page_subscription: None,
                restore_after_update: None,
                tool_target: None,
                notice: None,
                labels: false,
                client,
            });
            let resume = view.read(cx).client.take_resume_page();
            let weak = view.downgrade();
            let restore = window.spawn(cx, async move |cx| {
                if let Ok(Some(page)) = resume.await
                    && let Ok(section) = serde_json::from_value(serde_json::Value::String(page))
                {
                    let _ = weak.update_in(cx, |main, window, cx| main.switch(section, window, cx));
                }
            });
            view.update(cx, |main, _| main.restore_after_update = Some(restore));
            #[cfg(debug_assertions)]
            if let Some(section) =
                crate::windows::dev_preview::page().filter(|s| *s != Section::Today)
            {
                view.update(cx, |main, cx| main.switch(section, window, cx));
            }
            view
        })?;
        Ok((handle, view.downgrade()))
    }
}

impl Render for MainWindow {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let colors = self.client.palette(window);
        let label = |key| text(self.client.locale.get(), key);
        let client = self.client.clone();
        let zoom = if window.is_maximized() {
            ("accessibility.titleBar.restore", Icon::Minimize2)
        } else {
            ("accessibility.titleBar.maximize", Icon::Maximize2)
        };
        let titlebar = div()
            .h(px(36.))
            .flex_none()
            .flex()
            .items_center()
            .px(px(12.))
            .gap(px(8.))
            .border_b_1()
            .border_color(colors.border)
            .child(
                div()
                    .h_full()
                    .flex_1()
                    .flex()
                    .items_center()
                    .window_control_area(WindowControlArea::Drag)
                    .gap(px(8.))
                    .child(crate::features::page_controls::logo().size(px(18.)))
                    .child("Patina"),
            )
            .children(self.client.shortcut_buttons(false))
            .child(
                quietpro::icon_actions()
                    .child(
                        IconControl::new("mini", label("miniWindow.open"), Icon::AppWindow).action(
                            colors,
                            move |_, _, _| {
                                client.open(patina_desktop_protocol::Target::Mini { focus: true });
                            },
                        ),
                    )
                    .child(
                        IconControl::new(
                            "minimize",
                            label("accessibility.titleBar.minimize"),
                            Icon::Minus,
                        )
                        .action(colors, |_, win, _| win.minimize_window()),
                    )
                    .child(
                        IconControl::new("zoom", label(zoom.0), zoom.1)
                            .action(colors, |_, win, _| win.zoom_window()),
                    )
                    .child(
                        IconControl::new("close", label("accessibility.titleBar.close"), Icon::X)
                            .action(colors, {
                                let client = self.client.clone();
                                move |_, win, _| client.close_main(win)
                            }),
                    ),
            );
        let labels = self.labels;
        let rail = quietpro::navigation_rail()
            .on_key_down(|event, window, cx| {
                let key = &event.keystroke;
                if key.key == "tab"
                    && !key.modifiers.control
                    && !key.modifiers.alt
                    && !key.modifiers.platform
                {
                    if key.modifiers.shift {
                        window.focus_prev(cx);
                    } else {
                        window.focus_next(cx);
                    }
                    cx.stop_propagation();
                }
            })
            .child(
                div()
                    .h(px(56.))
                    .flex()
                    .items_start()
                    .justify_center()
                    .pt(px(8.))
                    .child(crate::features::page_controls::logo().size(px(28.))),
            )
            .children(
                [
                    (Section::Today, "dashboard.title", Icon::Monitor),
                    (Section::History, "history.title", Icon::Clock),
                    (Section::Data, "data.title", Icon::ChartColumn),
                    (Section::Classification, "mapping.title", Icon::Sparkles),
                    (Section::Tools, "tools.title", Icon::ToolCase),
                    (Section::Settings, "settings.title", Icon::Settings2),
                    (Section::About, "about.title", Icon::Info),
                ]
                .map(|(section, k, icon)| {
                    quietpro::navigation_item(
                        k,
                        label(k),
                        icon,
                        labels,
                        section == self.page.section(),
                        colors,
                    )
                    .on_click(cx.listener(move |this, _, win, cx| this.select(section, win, cx)))
                }),
            )
            .child(div().flex_1())
            .child(
                IconControl::new(
                    "nav-labels",
                    label("accessibility.sidebar.navigationLabels"),
                    Icon::Menu,
                )
                .toggle(colors, labels, {
                    let view = cx.weak_entity();
                    move |next, _, _, cx| {
                        let _ = view.update(cx, |this, cx| {
                            this.labels = next;
                            cx.notify();
                        });
                    }
                }),
            );
        let shell = div()
            .size_full()
            .flex()
            .flex_col()
            .bg(colors.chrome)
            .text_color(colors.text)
            .font_family("Segoe UI")
            .text_size(px(14.))
            .child(titlebar)
            .child(
                quietpro::shell_content()
                    .child(
                        outer_frame(colors)
                            .w(px(SIDEBAR_WIDTH))
                            .flex_none()
                            .child(rail),
                    )
                    .child(outer_frame(colors).flex_1().child(match &self.page {
                        Page::Today(v) => v.clone().into_any_element(),
                        Page::History(v) => v.clone().into_any_element(),
                        Page::Data(v) => v.clone().into_any_element(),
                        Page::About(v) => v.clone().into_any_element(),
                        Page::Settings(v) => v.clone().into_any_element(),
                        Page::Classification(v) => v.clone().into_any_element(),
                        Page::Tools(v) => v.clone().into_any_element(),
                    })),
            );
        if let Some(prompt) = &self.pending {
            let weak = cx.weak_entity();
            use quietpro::heading;
            let actions = quietpro::dialog_actions()
                .child(
                    quietpro::text_button("keep-editing", label("common.cancel"), colors, true)
                        .on_click(cx.listener(|t, _, win, cx| t.keep_editing(win, cx))),
                )
                .child(
                    quietpro::text_button("save-before-switch", label("common.save"), colors, true)
                        .on_click(cx.listener(|t, _, _, cx| match &t.page {
                            Page::Settings(v) => v.update(cx, |v, cx| v.save(cx)),
                            Page::Classification(v) => v.update(cx, |v, cx| v.save(cx)),
                            _ => (),
                        })),
                );
            let content = quietpro::dialog_surface(colors, window.viewport_size())
                .max_w((window.viewport_size().width - px(48.)).min(px(480.)))
                .child(heading(label("app.unsavedConfirmTitle")))
                .child(label("app.unsavedConfirmBody"))
                .child(actions);
            return shell.child(
                gpui_kit::base::Dialog::new(cx)
                    .focus_handle(prompt.dialog_focus.clone())
                    .accessibility_label(label("app.unsavedConfirmTitle"))
                    .on_ok(|_, _, _| false)
                    .backdrop(quietpro::dialog_backdrop())
                    .popup(gpui_kit::base::DialogPopup::new().child(content))
                    .on_open_change(move |open, _, win, cx| {
                        if !open {
                            let _ = weak.update(cx, |t, cx| t.keep_editing(win, cx));
                        }
                    }),
            );
        }
        shell.children(self.notice.clone())
    }
}
