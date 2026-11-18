use crate::{
    client::Client,
    features::page_controls::{label, logo},
};
use gpui_kit::{prelude::*, *};
use patina_activity_model::{format_text, text};
use patina_updater::{Phase, Request, Snapshot};
use quietpro::{Icon, text_button};
use quietpro::{content_card, heading, page, page_title_row};
use std::{rc::Rc, sync::Arc};
const REPOSITORY: &str = "https://github.com/Ceceliaee/patina";
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
    status: Snapshot,
    update_task: Option<Task<()>>,
    confirm_install: bool,
    install_error: bool,
    opening: bool,
    link_error: Option<&'static str>,
    badge: Option<Arc<Image>>,
}
impl About {
    pub(crate) fn new(client: Rc<Client>, cx: &mut Context<Self>) -> Self {
        let mut view = Self {
            client,
            dialog: None,
            focus: cx.focus_handle(),
            content_focus: cx.focus_handle(),
            return_focus: None,
            image: None,
            status: Snapshot::idle(env!("CARGO_PKG_VERSION")),
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
        if self.opening || self.status.phase == Phase::Installing {
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
        if matches!(request, Request::Check) {
            self.status.phase = Phase::Checking;
            self.status.release = None;
            self.status.received_bytes = 0;
        }
        if matches!(request, Request::Download) {
            self.status.phase = Phase::Downloading;
        }
        self.update_task = Some(cx.spawn(async move |view, cx| {
            let mut request = request;
            loop {
                let result = client.update(request).await;
                let busy = result
                    .as_ref()
                    .is_ok_and(|s| matches!(s.phase, Phase::Checking | Phase::Downloading));
                if view
                    .update(cx, |t, cx| {
                        match result {
                            Ok(snapshot) => t.status = snapshot,
                            Err(error) => {
                                t.status.phase = Phase::Failed;
                                t.status.error = Some(error.to_string());
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
                request = Request::Status;
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
        self.status.phase = Phase::Installing;
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
                    t.status.phase = Phase::Ready;
                    t.status.error = Some(error.to_string());
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
        let tr = |k| text(self.client.locale.get(), k);
        let links = div()
            .flex()
            .flex_wrap()
            .gap(px(8.))
            .justify_center()
            .child(
                text_button("repository", "GitHub Star", c, true).on_click(cx.listener(
                    |s, _, w, cx| {
                        s.external(
                            REPOSITORY.into(),
                            "toast.repositoryOpenFailed",
                            false,
                            w,
                            cx,
                        )
                    },
                )),
            )
            .child(
                text_button("releases", tr("update.releaseNotes"), c, true).on_click(cx.listener(
                    |s, _, w, cx| {
                        s.external(
                            RELEASES.into(),
                            "toast.releaseNotesOpenFailed",
                            false,
                            w,
                            cx,
                        )
                    },
                )),
            )
            .child(
                text_button("feedback", tr("update.feedback"), c, true)
                    .on_click(cx.listener(|t, _, w, cx| t.show(DialogKind::Feedback, w, cx))),
            )
            .child(
                text_button("support", tr("update.support"), c, true)
                    .on_click(cx.listener(|t, _, w, cx| t.show(DialogKind::Support, w, cx))),
            );
        let status = if self.install_error {
            tr("update.installFailed")
        } else {
            match self.status.phase {
                Phase::Idle => tr("update.notChecked"),
                Phase::Checking => tr("update.checking"),
                Phase::Current => tr("update.upToDate"),
                Phase::Available => format_text(
                    self.client.locale.get(),
                    "update.foundVersion",
                    &[(
                        "version",
                        self.status
                            .release
                            .as_ref()
                            .map(|r| r.version.clone())
                            .unwrap_or_default(),
                    )],
                ),
                Phase::Downloading => format!(
                    "{} {:.1} / {:.1} MiB",
                    tr("update.downloading"),
                    self.status.received_bytes as f64 / 1048576.,
                    self.status.release.as_ref().map_or(0, |r| r.size) as f64 / 1048576.
                ),
                Phase::Ready => tr("update.dialogDownloaded"),
                Phase::Installing => tr("update.installing"),
                Phase::Failed => tr(if self.status.release.is_some() {
                    "update.downloadFailed"
                } else {
                    "update.checkFailed"
                }),
            }
        };
        let busy = matches!(
            self.status.phase,
            Phase::Checking | Phase::Downloading | Phase::Installing
        );
        let card = content_card(c.border, c.panel)
            .flex_1()
            .items_center()
            .gap(px(12.))
            .pt(px(36.))
            .child(logo().size(px(58.)))
            .child(
                div()
                    .flex()
                    .gap(px(8.))
                    .items_center()
                    .child(heading("Patina".into()))
                    .child(label(format!("v{}", env!("CARGO_PKG_VERSION")))),
            )
            .child(label(tr("about.description")))
            .child(links)
            .child(
                content_card(c.border, c.canvas)
                    .w_full()
                    .min_h(px(80.))
                    .flex_row()
                    .items_center()
                    .gap(px(12.))
                    .child(
                        div()
                            .flex_1()
                            .child(heading(tr("update.appUpdate")))
                            .child(label(status))
                            .when(
                                matches!(self.status.phase, Phase::Checking | Phase::Downloading),
                                |d| d.child(self.progress(c)),
                            ),
                    )
                    .child(
                        text_button("check-updates", tr("update.checkUpdates"), c, !busy).on_click(
                            cx.listener(|t, _, w, cx| {
                                t.show(DialogKind::Update, w, cx);
                                t.update_request(Request::Check, cx);
                            }),
                        ),
                    )
                    .when(
                        !busy && self.status.release.is_some() && self.status.phase != Phase::Ready,
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
                    .when(self.status.phase == Phase::Ready, |s| {
                        s.child(
                            text_button("install-update", tr("update.restartInstall"), c, true)
                                .on_click(cx.listener(|t, _, w, cx| t.ask_install(w, cx))),
                        )
                    })
                    .when(
                        self.status.phase == Phase::Failed || self.install_error,
                        |s| {
                            s.child(
                                text_button("downloads", tr("update.manualDownload"), c, true)
                                    .on_click(
                                        cx.listener(|s, _, w, cx| {
                                            s.show(DialogKind::Update, w, cx)
                                        }),
                                    ),
                            )
                        },
                    ),
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
                gpui_kit::base::Dialog::new(cx)
                    .close_on_escape(false)
                    .focus_handle(self.focus.clone())
                    .accessibility_label(tr("update.dialogDownloaded"))
                    .backdrop(quietpro::dialog_backdrop())
                    .popup(gpui_kit::base::DialogPopup::new().child(content))
                    .on_open_change(move |open, _, w, cx| {
                        if !open {
                            let _ = view.update(cx, |t, cx| t.cancel_install(w, cx));
                        }
                    }),
            );
        }
        if let Some(kind) = self.dialog {
            shell = shell.child(self.detail_dialog(kind, win, cx));
        }
        shell
    }
}
