use crate::{
    page_controls::{content_card, heading, label, logo, page, page_title_row, panel},
    windows_host::Client,
};
use gpui_kit::{prelude::*, *};
use patina_recorder::text;
use quietpro::{Icon, text_button};
use std::{rc::Rc, sync::Arc};
const REPOSITORY: &str = "https://github.com/Ceceliaee/patina";
const RELEASES: &str = "https://github.com/Ceceliaee/patina/releases";
const FEEDBACK: &str = "https://github.com/Ceceliaee/patina/issues/new/choose";
const SUPPORT: &str = "https://ko-fi.com/ceceliaee";
const MANIFEST: &str = "https://github.com/Ceceliaee/patina/releases/latest/download/latest.json";

#[derive(Clone, Copy)]
enum DialogKind {
    Feedback,
    Support,
}
enum Update {
    Idle,
    Checking,
    Published(String),
    Error,
}
pub(super) struct About {
    client: Rc<Client>,
    dialog: Option<DialogKind>,
    focus: FocusHandle,
    return_focus: Option<FocusHandle>,
    image: Option<Arc<Image>>,
    status: Update,
}
fn latest_version() -> Result<String, String> {
    use windows::{Foundation::Uri, Web::Http::HttpClient, core::HSTRING};
    let client = HttpClient::new().map_err(|e| e.to_string())?;
    let uri = Uri::CreateUri(&HSTRING::from(MANIFEST)).map_err(|e| e.to_string())?;
    let body = client
        .GetStringAsync(&uri)
        .and_then(|f| f.join())
        .map_err(|e| e.to_string())?;
    #[derive(serde::Deserialize)]
    struct Manifest {
        version: String,
    }
    let release: Manifest = serde_json::from_str(&body.to_string()).map_err(|e| e.to_string())?;
    if release.version.trim().is_empty() {
        return Err("missing release version".into());
    }
    Ok(release.version)
}
impl About {
    pub(super) fn new(client: Rc<Client>, cx: &mut Context<Self>) -> Self {
        Self {
            client,
            dialog: None,
            focus: cx.focus_handle(),
            return_focus: None,
            image: None,
            status: Update::Idle,
        }
    }
    fn show(&mut self, kind: DialogKind, win: &mut Window, cx: &mut Context<Self>) {
        self.return_focus = win.focused(cx);
        win.focus(&self.focus, cx);
        self.dialog = Some(kind);
        let dark =
            self.client.palette(win).panel == quietpro::Palette::from(WindowAppearance::Dark).panel;
        let (format, bytes): (ImageFormat, &[u8]) = match (kind, dark) {
            (DialogKind::Feedback, true) => (
                ImageFormat::Jpeg,
                include_bytes!("../../../src/features/about/assets/qq-channel-dark.jpg"),
            ),
            (DialogKind::Feedback, false) => (
                ImageFormat::Jpeg,
                include_bytes!("../../../src/features/about/assets/qq-channel-light.jpg"),
            ),
            (DialogKind::Support, true) => (
                ImageFormat::Png,
                include_bytes!("../../../src/features/about/assets/wechat-reward-dark.png"),
            ),
            (DialogKind::Support, false) => (
                ImageFormat::Png,
                include_bytes!("../../../src/features/about/assets/wechat-reward-light.png"),
            ),
        };
        self.image = Some(Arc::new(Image::from_bytes(format, bytes.to_vec())));
        cx.notify();
    }
    fn dismiss(&mut self, win: &mut Window, cx: &mut Context<Self>) {
        self.dialog = None;
        self.image = None;
        if let Some(f) = self.return_focus.take() {
            win.focus(&f, cx);
        }
        cx.notify();
    }
    fn check(&mut self, cx: &mut Context<Self>) {
        if matches!(self.status, Update::Checking) {
            return;
        }
        self.status = Update::Checking;
        cx.notify();
        let read = cx.background_executor().spawn(async { latest_version() });
        cx.spawn(async move |view, cx| {
            let result = read.await;
            let _ = view.update(cx, |t, cx| {
                t.status = match result {
                    Ok(v) => Update::Published(v),
                    Err(_) => Update::Error,
                };
                cx.notify();
            });
        })
        .detach();
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
                text_button("repository", "GitHub Star", c, true)
                    .on_click(|_, _, cx| cx.open_url(REPOSITORY)),
            )
            .child(
                text_button("releases", tr("update.releaseNotes"), c, true)
                    .on_click(|_, _, cx| cx.open_url(RELEASES)),
            )
            .child(
                text_button("feedback", tr("update.feedback"), c, true)
                    .on_click(cx.listener(|t, _, w, cx| t.show(DialogKind::Feedback, w, cx))),
            )
            .child(
                text_button("support", tr("update.support"), c, true)
                    .on_click(cx.listener(|t, _, w, cx| t.show(DialogKind::Support, w, cx))),
            );
        let status = match &self.status {
            Update::Idle => tr("update.notChecked"),
            Update::Checking => tr("update.checking"),
            Update::Published(v) => format!("Patina v{v}"),
            Update::Error => tr("update.checkFailed"),
        };
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
                    .child(label(format!("GPUI v{}", env!("CARGO_PKG_VERSION")))),
            )
            .child(label(tr("about.description")))
            .child(links)
            .child(
                content_card(c.border, c.canvas)
                    .w_full()
                    .h(px(80.))
                    .flex_row()
                    .items_center()
                    .gap(px(12.))
                    .child(
                        div()
                            .flex_1()
                            .child(heading(tr("update.appUpdate")))
                            .child(label(status)),
                    )
                    .child(
                        text_button(
                            "check-updates",
                            tr("update.checkUpdates"),
                            c,
                            !matches!(self.status, Update::Checking),
                        )
                        .on_click(cx.listener(|t, _, _, cx| t.check(cx))),
                    )
                    .when(matches!(self.status, Update::Published(_)), |s| {
                        s.child(
                            text_button("downloads", tr("update.manualDownload"), c, true)
                                .on_click(|_, _, cx| cx.open_url(RELEASES)),
                        )
                    }),
            );
        let mut shell = page(c)
            .child(page_title_row(tr("about.title"), Icon::Info, c))
            .child(card);
        if let Some(kind) = self.dialog {
            let (title, qr, button, url) = match kind {
                DialogKind::Feedback => (
                    "about.feedbackDialog.title",
                    "about.feedbackDialog.qqTitle",
                    "about.feedbackDialog.githubAction",
                    FEEDBACK,
                ),
                DialogKind::Support => (
                    "update.support",
                    "about.supportDialog.wechatTitle",
                    "about.supportDialog.openKofi",
                    SUPPORT,
                ),
            };
            let view = cx.weak_entity();
            let mut content = panel(c)
                .w(px(460.))
                .items_center()
                .gap(px(12.))
                .child(heading(tr(title)))
                .child(label(tr(qr)));
            if let Some(image) = &self.image {
                content = content.child(
                    img(image.clone())
                        .size(px(220.))
                        .object_fit(ObjectFit::Contain),
                );
            }
            content = content
                .child(
                    text_button("external", tr(button), c, true)
                        .on_click(move |_, _, cx| cx.open_url(url)),
                )
                .child(
                    text_button("close-about", tr("common.close"), c, true)
                        .on_click(cx.listener(|t, _, w, cx| t.dismiss(w, cx))),
                );
            shell = shell.child(
                gpui_kit::base::Dialog::new(cx)
                    .focus_handle(self.focus.clone())
                    .accessibility_label(tr(title))
                    .backdrop(div().size_full().bg(rgba(0x00000055)))
                    .popup(gpui_kit::base::DialogPopup::new().child(content))
                    .on_open_change(move |open, _, w, cx| {
                        if !open {
                            let _ = view.update(cx, |t, cx| t.dismiss(w, cx));
                        }
                    }),
            );
        }
        shell
    }
}
