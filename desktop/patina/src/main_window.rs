mod sidebar;

use crate::{history::History, today::Today};

use gpui_kit::{prelude::*, *};
use patina_recorder::text;
use quietpro::{Icon, IconControl};
use std::rc::Rc;

const SIDEBAR_WIDTH: f32 = 96.;
const CONTENT_PADDING: f32 = 24.;
const FRAME_RADIUS: f32 = 16.;

fn outer_frame(colors: quietpro::Palette) -> Div {
    crate::page_controls::continuous_frame(px(FRAME_RADIUS), colors.border, colors.canvas)
        .flex_col()
}

pub(super) fn page_width(viewport_width: Pixels) -> Pixels {
    viewport_width - px(2. * CONTENT_PADDING + SIDEBAR_WIDTH + crate::page_controls::CARD_GAP)
}

#[derive(Clone, Copy, PartialEq, Eq)]
#[cfg_attr(debug_assertions, derive(serde::Deserialize, serde::Serialize))]
pub(super) enum Section {
    Tools,
    About,
    Settings,
    Classification,
    Today,
    History,
    Data,
}
enum Page {
    Tools(Entity<crate::tools::Tools>),
    About(Entity<crate::about::About>),
    Settings(Entity<crate::settings::Settings>),
    Classification(Entity<crate::classification::Classification>),
    Today(Entity<Today>),
    History(Entity<History>),
    Data(Entity<crate::data_page::DataPage>),
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
pub(super) struct Saved;
pub(super) struct MainWindow {
    notice: Option<Entity<crate::tool_notice::ToolNotice>>,
    tool_target: Option<patina_recorder::ToolTarget>,
    pending: Option<(Section, FocusHandle)>,
    page: Page,
    labels: bool,
    client: Rc<crate::windows_host::Client>,
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
            self.notice =
                Some(cx.new(|cx| {
                    crate::tool_notice::ToolNotice::embedded(self.client.clone(), win, cx)
                }));
        }
        cx.notify();
    }
    pub fn refresh_notice(&self, cx: &mut App) {
        if let Some(n) = &self.notice {
            n.update(cx, |n, cx| n.refresh(cx));
        }
    }
    pub(super) fn navigate(
        &mut self,
        target: Option<patina_recorder::ToolTarget>,
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
    pub(super) fn select(&mut self, section: Section, win: &mut Window, cx: &mut Context<Self>) {
        if self.page.section() == section {
            return;
        }
        let dirty = match &self.page {
            Page::Classification(v) => v.read(cx).dirty(),
            Page::Settings(v) => v.read(cx).dirty(),
            _ => false,
        };
        if dirty {
            if self.pending.is_none() {
                let f = cx.focus_handle();
                win.focus(&f, cx);
                self.pending = Some((section, f));
                cx.notify();
            }
            return;
        }
        self.switch(section, win, cx);
    }
    fn switch(&mut self, section: Section, win: &mut Window, cx: &mut Context<Self>) {
        self.page = match section {
            Section::Tools => Page::Tools(cx.new(|cx| {
                crate::tools::Tools::new(self.client.clone(), self.tool_target.take(), cx)
            })),
            Section::About => {
                Page::About(cx.new(|cx| crate::about::About::new(self.client.clone(), cx)))
            }
            Section::Settings => {
                let view =
                    cx.new(|cx| crate::settings::Settings::new(self.client.clone(), win, cx));
                cx.subscribe_in(&view, win, |t, _, _: &Saved, win, cx| {
                    if let Some((section, _)) = t.pending.take() {
                        t.switch(section, win, cx);
                    }
                })
                .detach();
                Page::Settings(view)
            }
            Section::Classification => {
                let view = cx.new(|cx| {
                    crate::classification::Classification::new(self.client.clone(), win, cx)
                });
                cx.subscribe_in(&view, win, |t, _, _: &Saved, win, cx| {
                    if let Some((section, _)) = t.pending.take() {
                        t.switch(section, win, cx);
                    }
                })
                .detach();
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
            Section::Data => Page::Data(
                cx.new(|cx| crate::data_page::DataPage::new(self.client.clone(), win, cx)),
            ),
        };
        #[cfg(debug_assertions)]
        crate::dev_preview::remember(section);
        cx.notify();
    }
    pub(super) fn refresh(&self, cx: &mut App) {
        match &self.page {
            Page::Today(v) => v.update(cx, |v, cx| v.refresh(true, cx)),
            Page::History(v) => v.update(cx, |v, cx| v.refresh(cx)),
            Page::Data(_) => (),
            Page::About(_) => (),
            Page::Tools(_) => (),
            Page::Settings(_) => (),
            Page::Classification(_) => (),
        }
    }
    pub(super) fn open(
        cx: &mut App,
        client: Rc<crate::windows_host::Client>,
    ) -> Result<(AnyWindowHandle, WeakEntity<Self>)> {
        let options = WindowOptions {
            window_bounds: Some(WindowBounds::Windowed(Bounds::centered(
                None,
                size(px(1100.), px(736.)),
                cx,
            ))),
            window_min_size: Some(size(px(900.), px(636.))),
            titlebar: None,
            app_id: Some(crate::APP_ID.into()),
            ..Default::default()
        };
        let (handle, view) = gpui_kit::open_window(options, cx, |window, cx| {
            window.set_window_title("Patina");
            crate::app_windows::handle_close(window, cx);
            let today = cx.new(|cx| Today::new(window, client.clone(), cx));
            let view = cx.new(|_| Self {
                page: Page::Today(today),
                pending: None,
                tool_target: None,
                notice: None,
                labels: false,
                client,
            });
            #[cfg(debug_assertions)]
            if let Some(section) = crate::dev_preview::page().filter(|s| *s != Section::Today) {
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
                    .child(crate::page_controls::logo().size(px(18.)))
                    .child("Patina"),
            )
            .children(self.client.shortcut_buttons(false))
            .child(
                IconControl::new("mini", label("miniWindow.open"), Icon::AppWindow).action(
                    colors,
                    move |_, _, _| {
                        client.open(crate::window_process::Target::Mini { focus: true });
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
                    .action(colors, |_, win, _| win.remove_window()),
            );
        let labels = self.labels;
        let rail = div()
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
            .flex_1()
            .flex()
            .flex_col()
            .items_center()
            .gap(px(8.))
            .px(px(8.))
            .py(px(24.))
            .child(
                div()
                    .h(px(54.))
                    .flex()
                    .items_start()
                    .justify_center()
                    .pt(px(6.))
                    .child(crate::page_controls::logo().size(px(28.))),
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
                    sidebar::navigation_item(
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
                div()
                    .flex_1()
                    .min_h_0()
                    .flex()
                    .gap(px(crate::page_controls::CARD_GAP))
                    .p(px(CONTENT_PADDING))
                    .pt(px(16.))
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
        if let Some((_, focus)) = &self.pending {
            let weak = cx.weak_entity();
            use crate::page_controls::{action, heading, panel};
            let content = panel(colors)
                .w(px(410.))
                .gap(px(12.))
                .child(heading(label("app.unsavedConfirmTitle")))
                .child(label("app.unsavedConfirmBody"))
                .child(action(
                    "keep-editing",
                    label("common.cancel"),
                    label("common.cancel"),
                    true,
                    cx.listener(|t, _, _, cx| {
                        t.pending = None;
                        t.tool_target = None;
                        cx.notify();
                    }),
                ))
                .child(action(
                    "save-before-switch",
                    label("common.save"),
                    label("common.save"),
                    true,
                    cx.listener(|t, _, _, cx| match &t.page {
                        Page::Settings(v) => v.update(cx, |v, cx| v.save(cx)),
                        Page::Classification(v) => v.update(cx, |v, cx| v.save(cx)),
                        _ => (),
                    }),
                ));
            return shell.child(
                gpui_kit::base::Dialog::new(cx)
                    .focus_handle(focus.clone())
                    .accessibility_label(label("app.unsavedConfirmTitle"))
                    .on_ok(|_, _, _| false)
                    .backdrop(div().size_full().bg(rgba(0x00000055)))
                    .popup(gpui_kit::base::DialogPopup::new().child(content))
                    .on_open_change(move |open, _, _, cx| {
                        if !open {
                            let _ = weak.update(cx, |t, cx| {
                                t.pending = None;
                                t.tool_target = None;
                                cx.notify();
                            });
                        }
                    }),
            );
        }
        shell.children(self.notice.clone())
    }
}
