use crate::features::{
    about::About,
    classification::{Classification, ClassificationCache},
    data::{DataCache, DataPage, OpenHistoryDay},
    history::{History, HistoryCache},
    settings::{PreferencesRead, Settings},
    today::{Today, TodaySnapshot},
    tools::Tools,
};

use gpui_kit::{prelude::*, *};
pub(crate) use patina_activity_model::views::preferences::MainSection as Section;
use patina_desktop_protocol::MainTarget;
use patina_i18n::text;
use quietpro::{Icon, IconControl};
use std::rc::Rc;
#[cfg(all(test, feature = "test-support"))]
mod tests;

use quietpro::{SHELL_PADDING, SIDEBAR_WIDTH, outer_frame};

pub(crate) fn page_width(viewport_width: Pixels) -> Pixels {
    viewport_width - px(2. * SHELL_PADDING + SIDEBAR_WIDTH + quietpro::CARD_GAP)
}

enum Page {
    Opening(Section),
    Tools(Entity<Tools>),
    About(Entity<About>),
    Settings(Entity<Settings>),
    Classification(Entity<crate::features::classification::Classification>),
    Today(Entity<Today>),
    History(Entity<History>),
    Data(Entity<crate::features::data::DataPage>),
}
impl Page {
    fn section(&self) -> Section {
        match self {
            Self::Opening(section) => *section,
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
#[derive(Clone)]
pub(crate) struct Feedback(pub String);

pub(crate) struct Saved {
    pub show_toast: bool,
}
mod save_toast;
struct PendingNavigation {
    target: Section,
    dialog_focus: FocusHandle,
    previous_focus: Option<FocusHandle>,
}
pub(crate) struct MainWindow {
    save_toast: Option<save_toast::SaveToast>,
    notice: Option<Entity<crate::windows::notice::ToolNotice>>,
    tool_target: Option<patina_activity_model::ToolTarget>,
    pending: Option<PendingNavigation>,
    page_subscription: Option<Subscription>,
    edit_observer: Option<Subscription>,
    feedback_subscription: Option<Subscription>,
    had_unsaved_changes: bool,
    page: Page,
    about_status: Option<patina_updater::Snapshot>,
    today_snapshot: Option<TodaySnapshot>,
    history_cache: HistoryCache,
    data_cache: DataCache,
    classification_cache: ClassificationCache,
    pressed_settings_read: Option<PreferencesRead>,
    opening_page: Option<(Page, Subscription)>,
    client: Rc<crate::client::Client>,
}

impl MainWindow {
    pub fn refresh_tools(&self, cx: &mut App) {
        match (&self.opening_page, &self.page) {
            (Some((Page::Tools(tools), _)), _) | (_, Page::Tools(tools)) => {
                tools.update(cx, |t, cx| t.background_refresh(cx));
            }
            _ => (),
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
    pub(crate) fn reopen(&mut self, target: MainTarget, win: &mut Window, cx: &mut Context<Self>) {
        if !matches!(self.page, Page::Opening(_)) {
            win.activate_window();
        }
        match target {
            MainTarget::Resume => {}
            MainTarget::Today => {
                self.tool_target = None;
                self.select(Section::Today, win, cx);
            }
            MainTarget::Tool(tool) => {
                self.tool_target = Some(tool);
                if matches!(self.opening_page, Some((Page::Tools(_), _))) {
                    self.cancel_opening_page(cx);
                }
                if self.page.section() == Section::Tools {
                    self.switch(Section::Tools, win, cx);
                } else {
                    self.select(Section::Tools, win, cx);
                }
            }
        }
    }
    fn dirty(&self, cx: &App) -> bool {
        match &self.page {
            Page::Classification(v) => v.read(cx).dirty(cx),
            Page::Settings(v) => v.read(cx).dirty(),
            _ => false,
        }
    }
    pub(crate) fn select(&mut self, section: Section, win: &mut Window, cx: &mut Context<Self>) {
        if section != Section::Settings {
            self.pressed_settings_read = None;
        }
        if let Some((page, _)) = &self.opening_page {
            if section == page.section() {
                return;
            }
            self.cancel_opening_page(cx);
        }
        if self.page.section() == section && !matches!(self.page, Page::Opening(_)) {
            return;
        }
        if self.dirty(cx) {
            self.pressed_settings_read = None;
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
    fn leave_page(&mut self, cx: &mut Context<Self>) {
        self.page_subscription = None;
        self.edit_observer = None;
        self.feedback_subscription = None;
        self.update_edit_toast(false, cx);
        if let Page::About(view) = &self.page {
            self.about_status = view.read(cx).settled_status().cloned();
        }
        if let Page::Today(view) = &self.page {
            self.today_snapshot = view.update(cx, |today, _| today.snapshot.take());
        }
        if let Page::History(view) = &self.page {
            self.history_cache = view.update(cx, |history, _| history.take_cache());
        }
        if let Page::Data(view) = &self.page {
            self.data_cache = view.update(cx, |data, _| data.take_cache());
        }
        if let Page::Classification(view) = &self.page {
            self.classification_cache = view.update(cx, |v, _| v.take_cache());
        }
    }
    fn cancel_opening_page(&mut self, cx: &mut Context<Self>) {
        if let Some((page, _)) = self.opening_page.take() {
            match page {
                Page::History(view) => self.history_cache = view.update(cx, |v, _| v.take_cache()),
                Page::Data(view) => self.data_cache = view.update(cx, |v, _| v.take_cache()),
                Page::Classification(view) => {
                    self.classification_cache = view.update(cx, |v, _| v.take_cache())
                }
                _ => {}
            }
            cx.notify();
        }
    }
    fn open_history(&mut self, date: i64, win: &mut Window, cx: &mut Context<Self>) {
        self.cancel_opening_page(cx);
        let view = cx.new(|cx| {
            History::new(self.client.clone(), date, None, win, cx)
                .with_cache(std::mem::take(&mut self.history_cache))
        });
        self.open_when_ready(view, History::ready_to_present, Page::History, win, cx);
    }
    fn open_when_ready<T: 'static>(
        &mut self,
        view: Entity<T>,
        ready: fn(&T) -> bool,
        page: fn(Entity<T>) -> Page,
        win: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if ready(view.read(cx)) {
            self.present_page(page(view), win, cx);
            return;
        }
        let subscription = cx.observe_in(&view, win, move |this, view, win, cx| {
            if ready(view.read(cx)) {
                this.present_page(page(view), win, cx);
            }
        });
        self.opening_page = Some((page(view), subscription));
        cx.notify();
    }
    fn present_page(&mut self, page: Page, win: &mut Window, cx: &mut Context<Self>) {
        if self.dirty(cx) {
            self.cancel_opening_page(cx);
            return;
        }
        self.opening_page = None;
        self.leave_page(cx);
        if let Page::About(view) = &page {
            self.feedback_subscription =
                Some(cx.subscribe(view, |this, _, event: &Feedback, cx| {
                    this.show_result(event.0.clone(), cx);
                }));
        }
        if let Page::Settings(view) = &page {
            self.edit_observer = Some(cx.observe(view, |this, view, cx| {
                this.update_edit_toast(view.read(cx).dirty(), cx);
            }));
            self.feedback_subscription =
                Some(cx.subscribe(view, |this, _, event: &Feedback, cx| {
                    this.show_result(event.0.clone(), cx);
                }));
            self.page_subscription = Some(cx.subscribe_in(view, win, Self::page_saved));
        }
        if let Page::Classification(view) = &page {
            self.edit_observer = Some(cx.observe(view, |this, view, cx| {
                this.update_edit_toast(view.read(cx).has_unsaved_changes(cx), cx);
            }));
            self.page_subscription = Some(cx.subscribe_in(view, win, Self::page_saved));
        }
        if let Page::Data(view) = &page {
            self.page_subscription =
                Some(
                    cx.subscribe_in(view, win, |this, _, event: &OpenHistoryDay, win, cx| {
                        this.open_history(event.0, win, cx);
                    }),
                );
        }
        let show_window = matches!(self.page, Page::Opening(section) if section != Section::Today);
        self.client
            .remember_navigation(patina_desktop_protocol::MainNavigation {
                section: page.section(),
                ..self.client.navigation.get()
            });
        self.page = page;
        cx.notify();
        if show_window {
            win.activate_window();
        }
    }
    fn page_saved<T>(
        &mut self,
        _: &Entity<T>,
        event: &Saved,
        win: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if event.show_toast {
            self.show_save_toast(cx);
        }
        if let Some(prompt) = self.pending.take() {
            self.switch(prompt.target, win, cx);
        }
    }
    fn switch(&mut self, section: Section, win: &mut Window, cx: &mut Context<Self>) {
        match section {
            Section::Tools => {
                self.cancel_opening_page(cx);
                let view =
                    cx.new(|cx| Tools::new(self.client.clone(), self.tool_target.take(), cx));
                self.present_page(Page::Tools(view), win, cx);
            }
            Section::About => {
                self.cancel_opening_page(cx);
                let view =
                    cx.new(|cx| About::new(self.client.clone(), self.about_status.take(), cx));
                self.open_when_ready(view, About::ready_to_present, Page::About, win, cx);
            }
            Section::Settings => {
                self.cancel_opening_page(cx);
                let read = self
                    .pressed_settings_read
                    .take()
                    .unwrap_or_else(|| Box::pin(self.client.preferences()));
                let view = cx.new(|cx| Settings::new(self.client.clone(), read, win, cx));
                self.open_when_ready(view, Settings::ready_to_present, Page::Settings, win, cx);
            }
            Section::Classification => {
                self.cancel_opening_page(cx);
                let view = cx.new(|cx| {
                    Classification::new(
                        self.client.clone(),
                        std::mem::take(&mut self.classification_cache),
                        win,
                        cx,
                    )
                });
                self.open_when_ready(
                    view,
                    Classification::ready_to_present,
                    Page::Classification,
                    win,
                    cx,
                );
            }
            Section::History => {
                self.open_history(chrono::Local::now().timestamp_millis(), win, cx);
            }
            Section::Today => {
                self.cancel_opening_page(cx);
                let view = cx
                    .new(|cx| Today::new(win, self.client.clone(), self.today_snapshot.take(), cx));
                self.present_page(Page::Today(view), win, cx);
            }
            Section::Data => {
                self.cancel_opening_page(cx);
                let view = cx.new(|cx| {
                    DataPage::new(
                        self.client.clone(),
                        std::mem::take(&mut self.data_cache),
                        win,
                        cx,
                    )
                });
                self.open_when_ready(view, DataPage::ready_to_present, Page::Data, win, cx);
            }
        }
    }
    pub(crate) fn refresh(&self, cx: &mut App) {
        match &self.page {
            Page::Opening(_) => (),
            Page::Today(v) => v.update(cx, |v, cx| v.refresh(true, cx)),
            Page::History(v) => v.update(cx, |v, cx| v.refresh(cx)),
            Page::Data(v) => v.update(cx, |v, cx| v.refresh(cx)),
            Page::About(_) => (),
            Page::Tools(_) => (),
            Page::Settings(_) => (),
            Page::Classification(_) => (),
        }
    }
    #[cfg(all(test, feature = "test-support"))]
    pub(crate) fn open(
        cx: &mut App,
        client: Rc<crate::client::Client>,
    ) -> Result<(AnyWindowHandle, WeakEntity<Self>)> {
        Self::open_at(cx, client, MainTarget::Resume)
    }
    pub(crate) fn open_at(
        cx: &mut App,
        client: Rc<crate::client::Client>,
        target: MainTarget,
    ) -> Result<(AnyWindowHandle, WeakEntity<Self>)> {
        let (section, tool_target) = match target {
            MainTarget::Resume => (client.navigation.get().section, None),
            MainTarget::Today => (Section::Today, None),
            MainTarget::Tool(tool) => (Section::Tools, Some(tool)),
        };
        let options = WindowOptions {
            show: section == Section::Today,
            focus: section == Section::Today,
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
            window.set_window_title("Patina");
            window
                .observe_window_appearance(|_, cx| cx.refresh_windows())
                .detach();
            let close = client.clone();
            window.on_window_should_close(cx, move |window, _| {
                close.close_main(window);
                false
            });
            client.main_opened(window);
            let view = cx.new(|_| Self {
                page: Page::Opening(section),
                about_status: None,
                today_snapshot: None,
                history_cache: HistoryCache::default(),
                data_cache: DataCache::default(),
                opening_page: None,
                classification_cache: Default::default(),
                pressed_settings_read: None,
                pending: None,
                page_subscription: None,
                edit_observer: None,
                feedback_subscription: None,
                had_unsaved_changes: false,
                tool_target,
                notice: None,
                save_toast: None,
                client,
            });
            view.update(cx, |main, cx| main.switch(section, window, cx));
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
                    .font_weight(FontWeight::BOLD)
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
        let labels = self.client.navigation.get().sidebar_labels;
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
                    (Section::Data, "data.title", Icon::ChartSpline),
                    (Section::Classification, "mapping.title", Icon::Sparkles),
                    (Section::Tools, "tools.title", Icon::ToolCase),
                    (Section::Settings, "settings.title", Icon::Settings2),
                    (Section::About, "about.title", Icon::Info),
                ]
                .map(|(section, k, icon)| {
                    let selected = self
                        .opening_page
                        .as_ref()
                        .map_or_else(|| self.page.section(), |(page, _)| page.section())
                        == section;
                    quietpro::navigation_item(k, label(k), icon, labels, selected, colors)
                        .when(
                            section == Section::Settings
                                && !selected
                                && self.page.section() != Section::Settings,
                            |button| {
                                button
                                    .on_mouse_down(
                                        MouseButton::Left,
                                        cx.listener(|this, _, _, cx| {
                                            if !this.dirty(cx) {
                                                this.pressed_settings_read =
                                                    Some(Box::pin(this.client.preferences()));
                                            }
                                        }),
                                    )
                                    .on_hover(cx.listener(|this, over: &bool, _, _| {
                                        if !*over {
                                            this.pressed_settings_read = None;
                                        }
                                    }))
                            },
                        )
                        .on_click(
                            cx.listener(move |this, _, win, cx| this.select(section, win, cx)),
                        )
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
                            this.client.remember_navigation(
                                patina_desktop_protocol::MainNavigation {
                                    sidebar_labels: next,
                                    ..this.client.navigation.get()
                                },
                            );
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
                        Page::Opening(_) => div().into_any_element(),
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
            return shell.child(quietpro::modal_dialog(
                label("app.unsavedConfirmTitle"),
                prompt.dialog_focus.clone(),
                content,
                move |win, cx| {
                    let _ = weak.update(cx, |t, cx| t.keep_editing(win, cx));
                },
                cx,
            ));
        }
        shell
            .children(self.render_save_toast(colors, cx))
            .children(self.notice.clone())
    }
}
