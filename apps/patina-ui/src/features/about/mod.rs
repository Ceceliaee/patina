use crate::{
    client::Client,
    features::page_controls::{label, logo},
};
use gpui_kit::{base::TestSupportExt, prelude::*, *};
use patina_activity_model::{format_text, text};
use patina_updater::{Phase, Request, Snapshot};
use quietpro::{ButtonSizeExt, ControlSize, Icon, text_button, text_button_with_icon};
use quietpro::{content_card, heading, page, page_title_row};
use std::{rc::Rc, sync::Arc};
const REPOSITORY: &str = "https://github.com/Ceceliaee/patina";
const GITHUB_STAR_LABEL: &str = "GitHub Star";
const RELEASES: &str = "https://github.com/Ceceliaee/patina/releases";
const FEEDBACK: &str = "https://github.com/Ceceliaee/patina/issues/new/choose";
const SUPPORT: &str = "https://ko-fi.com/ceceliaee";
mod dialogs;

#[derive(Clone, Copy)]
enum DialogKind {
    Feedback,
    Support,
    Update,
}
pub(crate) struct About {
    client: Rc<Client>,
    dialog: Option<DialogKind>,
    focus: FocusHandle,
    content_focus: FocusHandle,
    return_focus: Option<FocusHandle>,
    image: Option<Arc<Image>>,
    status: Option<Snapshot>,
    update_task: Option<Task<()>>,
    confirm_install: bool,
    install_error: bool,
    opening: bool,
    link_error: Option<&'static str>,
    badge: Option<Arc<Image>>,
}
impl EventEmitter<crate::windows::main::Feedback> for About {}

impl About {
    pub(crate) fn new(
        client: Rc<Client>,
        status: Option<Snapshot>,
        cx: &mut Context<Self>,
    ) -> Self {
        let mut view = Self {
            client,
            dialog: None,
            focus: cx.focus_handle(),
            content_focus: cx.focus_handle(),
            return_focus: None,
            image: None,
            status,
            update_task: None,
            confirm_install: false,
            install_error: false,
            opening: false,
            link_error: None,
            badge: None,
        };
        view.update_request(Request::Status, cx);
        view
    }
    pub(crate) fn ready_to_present(&self) -> bool {
        self.status.is_some()
    }
    pub(crate) fn settled_status(&self) -> Option<&Snapshot> {
        self.status.as_ref().filter(|snapshot| {
            !self.install_error
                && matches!(
                    snapshot.phase,
                    Phase::Idle | Phase::Current | Phase::Available | Phase::Ready
                )
        })
    }
    fn show(&mut self, kind: DialogKind, win: &mut Window, cx: &mut Context<Self>) {
        self.return_focus = win.focused(cx);
        win.focus(&self.content_focus, cx);
        self.dialog = Some(kind);
        self.link_error = None;
        if matches!(kind, DialogKind::Update) {
            cx.notify();
            return;
        }
        let dark = self.client.dark(win);
        let (format, bytes): (ImageFormat, &[u8]) = match (kind, dark) {
            (DialogKind::Feedback, true) => (
                ImageFormat::Jpeg,
                include_bytes!("../../../assets/about/qq-channel-dark.jpg"),
            ),
            (DialogKind::Feedback, false) => (
                ImageFormat::Jpeg,
                include_bytes!("../../../assets/about/qq-channel-light.jpg"),
            ),
            (DialogKind::Support, true) => (
                ImageFormat::Png,
                include_bytes!("../../../assets/about/wechat-reward-dark.png"),
            ),
            (DialogKind::Support, false) => (
                ImageFormat::Png,
                include_bytes!("../../../assets/about/wechat-reward-light.png"),
            ),
            (DialogKind::Update, _) => unreachable!(),
        };
        self.image = Some(Arc::new(Image::from_bytes(format, bytes.to_vec())));
        let (format, bytes): (ImageFormat, &[u8]) = match kind {
            DialogKind::Feedback => (
                ImageFormat::Svg,
                if dark {
                    include_bytes!("../../../assets/about/github-issues-button-white.svg")
                } else {
                    include_bytes!("../../../assets/about/github-issues-button-black.svg")
                },
            ),
            _ => (
                ImageFormat::Png,
                include_bytes!("../../../assets/about/kofi-button.png"),
            ),
        };
        self.badge = Some(Arc::new(Image::from_bytes(format, bytes.to_vec())));
        cx.notify();
    }
    fn dismiss(&mut self, win: &mut Window, cx: &mut Context<Self>) {
        if self.opening
            || self
                .status
                .as_ref()
                .is_some_and(|s| s.phase == Phase::Installing)
        {
            return;
        }
        self.dialog = None;
        self.image = None;
        self.badge = None;
        if let Some(f) = self.return_focus.take() {
            win.focus(&f, cx);
        }
        cx.notify();
    }
    fn update_request(&mut self, request: Request, cx: &mut Context<Self>) {
        let client = self.client.clone();
        self.install_error = false;
        if let Some(status) = &mut self.status {
            match request {
                Request::Check => {
                    status.phase = Phase::Checking;
                    status.release = None;
                    status.received_bytes = 0;
                }
                Request::Download => status.phase = Phase::Downloading,
                Request::Status => {}
            }
        }
        let read = client.update(request);
        self.update_task = Some(cx.spawn(async move |view, cx| {
            let mut result = read.await;
            loop {
                let busy = result
                    .as_ref()
                    .is_ok_and(|s| matches!(s.phase, Phase::Checking | Phase::Downloading));
                if view
                    .update(cx, |t, cx| {
                        match result {
                            Ok(snapshot) => t.status = Some(snapshot),
                            Err(_)
                                if matches!(request, Request::Status)
                                    && t.settled_status().is_some() =>
                            {
                                return;
                            }
                            Err(error) => {
                                let status = t.status.get_or_insert_with(|| {
                                    Snapshot::idle(env!("CARGO_PKG_VERSION"))
                                });
                                status.phase = Phase::Failed;
                                status.error = Some(error.to_string());
                            }
                        }
                        cx.notify();
                    })
                    .is_err()
                {
                    break;
                }
                if !busy {
                    break;
                }
                cx.background_executor()
                    .timer(std::time::Duration::from_millis(300))
                    .await;
                result = client.update(Request::Status).await;
            }
        }));
        cx.notify();
    }
    fn ask_install(&mut self, win: &mut Window, cx: &mut Context<Self>) {
        self.return_focus = win.focused(cx);
        win.focus(&self.content_focus, cx);
        self.confirm_install = true;
        cx.notify();
    }
    fn cancel_install(&mut self, win: &mut Window, cx: &mut Context<Self>) {
        self.confirm_install = false;
        if let Some(focus) = self.return_focus.take() {
            win.focus(&focus, cx);
        }
        cx.notify();
    }
    fn install(&mut self, win: &mut Window, cx: &mut Context<Self>) {
        self.cancel_install(win, cx);
        let Some(status) = &mut self.status else {
            return;
        };
        status.phase = Phase::Installing;
        let client = self.client.clone();
        self.update_task = Some(cx.spawn(async move |view, cx| {
            let result = async {
                client.save_resume_page("About".into()).await?;
                client.install_update().await
            }
            .await;
            if let Err(error) = result {
                let _ = client.save_resume_page(String::new()).await;
                let _ = view.update(cx, |t, cx| {
                    if let Some(status) = &mut t.status {
                        status.phase = Phase::Ready;
                        status.error = Some(error.to_string());
                    }
                    t.install_error = true;
                    cx.notify();
                });
            }
        }));
    }
}
impl Render for About {
    fn render(&mut self, win: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let c = self.client.palette(win);
        let Some(snapshot) = &self.status else {
            return page(c);
        };
        let tr = |k| text(self.client.locale.get(), k);
        let link_button = |id: &'static str, caption: String, icon, highlight: Option<_>| {
            text_button_with_icon(id, caption, c, true, icon, highlight)
                .control_size(ControlSize::Large)
                .text_size(px(14.))
                .font_weight(FontWeight::MEDIUM)
        };
        let secondary_label = |value, weight| {
            label(value)
                .text_size(px(14.))
                .font_weight(weight)
                .text_color(c.secondary)
        };
        let links = div()
            .flex()
            .flex_wrap()
            .gap(px(8.))
            .justify_center()
            .child(
                link_button(
                    "repository",
                    GITHUB_STAR_LABEL.into(),
                    svg()
                        .data(include_bytes!("../../../assets/about/github.svg"))
                        .text_color(c.secondary),
                    Some((
                        "GitHub ".len()..GITHUB_STAR_LABEL.len(),
                        HighlightStyle {
                            color: Some(rgb(0xeac54f).into()),
                            ..Default::default()
                        },
                    )),
                )
                .on_click(cx.listener(|s, _, w, cx| {
                    s.external(
                        REPOSITORY.into(),
                        "toast.repositoryOpenFailed",
                        false,
                        w,
                        cx,
                    )
                })),
            )
            .child(
                link_button(
                    "releases",
                    tr("update.releaseNotes"),
                    quietpro::glyph(Icon::FileText, c.secondary),
                    None,
                )
                .on_click(cx.listener(|s, _, w, cx| {
                    s.external(
                        RELEASES.into(),
                        "toast.releaseNotesOpenFailed",
                        false,
                        w,
                        cx,
                    )
                })),
            )
            .child(
                link_button(
                    "feedback",
                    tr("update.feedback"),
                    quietpro::glyph(Icon::MessageSquare, c.secondary),
                    None,
                )
                .on_click(cx.listener(|t, _, w, cx| t.show(DialogKind::Feedback, w, cx))),
            )
            .child(
                link_button(
                    "support",
                    tr("update.support"),
                    quietpro::glyph(Icon::Rose, c.danger),
                    None,
                )
                .on_click(cx.listener(|t, _, w, cx| t.show(DialogKind::Support, w, cx))),
            );
        let status = if self.install_error {
            tr("update.installFailed")
        } else {
            match snapshot.phase {
                Phase::Idle => tr("update.notChecked"),
                Phase::Checking => tr("update.checking"),
                Phase::Current => tr("update.upToDate"),
                Phase::Available => format_text(
                    self.client.locale.get(),
                    "update.foundVersion",
                    &[(
                        "version",
                        snapshot
                            .release
                            .as_ref()
                            .map(|r| r.version.clone())
                            .unwrap_or_default(),
                    )],
                ),
                Phase::Downloading => tr("update.downloading"),
                Phase::Ready => tr("update.dialogDownloaded"),
                Phase::Installing => tr("update.installing"),
                Phase::Failed => tr(if snapshot.release.is_some() {
                    "update.downloadFailed"
                } else {
                    "update.checkFailed"
                }),
            }
        };
        let busy = matches!(
            snapshot.phase,
            Phase::Checking | Phase::Downloading | Phase::Installing
        );
        let card = content_card(c.border, c.panel)
            .flex_1()
            .items_center()
            .gap(px(quietpro::SECTION_GROUP_GAP))
            .child(
                div()
                    .flex()
                    .flex_col()
                    .items_center()
                    .gap(px(8.))
                    .child(logo().size(px(58.)))
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap(px(8.))
                            .child(heading("Patina".into()))
                            .child(secondary_label(
                                format!("v{}", env!("CARGO_PKG_VERSION")),
                                FontWeight::MEDIUM,
                            )),
                    )
                    .child(secondary_label(
                        tr("about.description"),
                        quietpro::REGULAR_TEXT_WEIGHT,
                    )),
            )
            .child(links)
            .child(
                content_card(c.border, c.canvas)
                    .id("about-update-card")
                    .role(Role::Group)
                    .aria_label(tr("update.appUpdate"))
                    .accessibility_id("about-update-card")
                    .w_full()
                    .min_h(px(64.))
                    .py(px(8.))
                    .flex_row()
                    .items_center()
                    .gap(px(12.))
                    .child(
                        div()
                            .flex_1()
                            .min_w_0()
                            .flex()
                            .flex_col()
                            .child(
                                div()
                                    .flex()
                                    .items_center()
                                    .gap(px(8.))
                                    .child(heading(tr("update.appUpdate")).flex_none())
                                    .child(label(status).min_w_0().truncate()),
                            )
                            .when(
                                matches!(snapshot.phase, Phase::Checking | Phase::Downloading)
                                    && !matches!(self.dialog, Some(DialogKind::Update)),
                                |d| d.child(self.progress(snapshot, c)),
                            ),
                    )
                    .child(
                        text_button("check-updates", tr("update.checkUpdates"), c, !busy)
                            .font_weight(FontWeight::MEDIUM)
                            .on_click(cx.listener(|t, _, w, cx| {
                                t.show(DialogKind::Update, w, cx);
                                t.update_request(Request::Check, cx);
                            })),
                    )
                    .when(
                        !busy && snapshot.release.is_some() && snapshot.phase != Phase::Ready,
                        |s| {
                            s.child(
                                text_button("download-update", tr("update.downloadNow"), c, true)
                                    .on_click(
                                        cx.listener(|t, _, w, cx| {
                                            t.show(DialogKind::Update, w, cx)
                                        }),
                                    ),
                            )
                        },
                    )
                    .when(snapshot.phase == Phase::Ready, |s| {
                        s.child(
                            text_button("install-update", tr("update.restartInstall"), c, true)
                                .on_click(cx.listener(|t, _, w, cx| t.ask_install(w, cx))),
                        )
                    })
                    .when(snapshot.phase == Phase::Failed || self.install_error, |s| {
                        s.child(
                            text_button("downloads", tr("update.manualDownload"), c, true)
                                .on_click(
                                    cx.listener(|s, _, w, cx| s.show(DialogKind::Update, w, cx)),
                                ),
                        )
                    })
                    .test_support(),
            );
        let mut shell = page(c)
            .child(page_title_row(tr("about.title"), Icon::Info, c))
            .child(card)
            .when_some(
                self.link_error.filter(|_| self.dialog.is_none()),
                |s, key| s.child(label(tr(key)).text_color(c.danger)),
            );
        if self.confirm_install {
            let view = cx.weak_entity();
            let content = quietpro::dialog_surface(c, win.viewport_size())
                .track_focus(&self.content_focus)
                .on_key_down(cx.listener(|s, event: &KeyDownEvent, w, cx| {
                    if event.keystroke.key == "escape" {
                        s.cancel_install(w, cx);
                        cx.stop_propagation();
                    }
                }))
                .child(heading(tr("update.dialogDownloaded")))
                .child(label(tr("update.dialogDownloadedDetail")))
                .child(
                    quietpro::dialog_actions()
                        .child(
                            text_button("cancel-install", tr("common.cancel"), c, true)
                                .on_click(cx.listener(|t, _, w, cx| t.cancel_install(w, cx))),
                        )
                        .child(
                            text_button("confirm-install", tr("update.restartInstall"), c, true)
                                .on_click(cx.listener(|t, _, w, cx| t.install(w, cx))),
                        ),
                );
            shell = shell.child(
                quietpro::modal_dialog(
                    tr("update.dialogDownloaded"),
                    self.focus.clone(),
                    content,
                    move |w, cx| {
                        let _ = view.update(cx, |t, cx| t.cancel_install(w, cx));
                    },
                    cx,
                )
                .close_on_escape(false),
            );
        }
        if let Some(kind) = self.dialog {
            shell = shell.child(self.detail_dialog(kind, snapshot, win, cx));
        }
        shell
    }
}
