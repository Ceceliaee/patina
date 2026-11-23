use super::*;
use std::sync::LazyLock;

static SUPPORT_MARKS: LazyLock<(Arc<Image>, Arc<Image>)> = LazyLock::new(|| {
    let png = |bytes: &[u8]| Arc::new(Image::from_bytes(ImageFormat::Png, bytes.to_vec()));
    (
        png(include_bytes!(
            "../../../assets/about/wechat-reward-mark.png"
        )),
        png(include_bytes!("../../../assets/about/kofi-mark.png")),
    )
});

fn card_heading(title: String, mark: impl IntoElement) -> Div {
    div()
        .flex()
        .items_center()
        .gap(px(8.))
        .child(
            div()
                .flex_none()
                .size(px(quietpro::UNFRAMED_APP_ICON_SIZE))
                .child(mark),
        )
        .child(quietpro::group_heading(title))
}

impl About {
    pub(super) fn external(
        &mut self,
        url: String,
        failure: &'static str,
        close: bool,
        win: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if self.opening {
            return;
        }
        self.opening = true;
        self.link_error = None;
        let from_feedback = matches!(self.dialog, Some(DialogKind::Feedback));
        let request = self.client.open_external(url);
        cx.spawn_in(win, async move |view, cx| {
            let result = request.await;
            let _ = view.update_in(cx, |s, win, cx| {
                s.opening = false;
                match result {
                    Err(_) if from_feedback => {
                        cx.emit(crate::windows::main::Feedback(text(
                            s.client.locale.get(),
                            failure,
                        )));
                    }
                    Err(_) => s.link_error = Some(failure),
                    Ok(()) if close => s.dismiss(win, cx),
                    Ok(()) => {}
                }
                cx.notify();
            });
        })
        .detach();
        cx.notify();
    }
    pub(super) fn progress(&self, status: &Snapshot, c: quietpro::Palette) -> Div {
        let tr = |key| text(self.client.locale.get(), key);
        let size = status.release.as_ref().map_or(0, |r| r.size);
        let percent = if size > 0 {
            (status.received_bytes as f64 / size as f64).clamp(0., 1.) as f32
        } else {
            0.
        };
        div()
            .flex()
            .flex_col()
            .gap(px(4.))
            .w_full()
            .child(label(if size == 0 {
                tr("update.progressPending")
            } else {
                format!(
                    "{:.0}% ･ {:.1} / {:.1} MiB",
                    percent * 100.,
                    status.received_bytes as f64 / 1048576.,
                    size as f64 / 1048576.
                )
            }))
            .child(
                div()
                    .id("update-progress")
                    .role(Role::ProgressIndicator)
                    .aria_label(tr("update.downloading"))
                    .aria_value(format!("{:.0}%", percent * 100.))
                    .h(px(6.))
                    .w_full()
                    .bg(c.track)
                    .rounded_full()
                    .child(
                        div()
                            .h_full()
                            .w(relative(percent))
                            .bg(c.secondary)
                            .rounded_full(),
                    )
                    .test_support(),
            )
    }
    pub(super) fn detail_dialog(
        &self,
        kind: DialogKind,
        status: &Snapshot,
        win: &mut Window,
        cx: &mut Context<Self>,
    ) -> gpui_kit::base::Dialog {
        let c = self.client.palette(win);
        let tr = |key| text(self.client.locale.get(), key);
        let title = tr(match kind {
            DialogKind::Feedback => "about.feedbackDialog.title",
            DialogKind::Support => "update.support",
            DialogKind::Update if self.install_error => "update.installFailedDialog",
            DialogKind::Update => match status.phase {
                Phase::Failed if status.release.is_some() => "update.downloadFailedDialog",
                Phase::Failed => "update.checkFailedDialog",
                Phase::Ready => "update.dialogDownloaded",
                Phase::Downloading => "update.dialogDownloading",
                _ => "update.dialogAvailable",
            },
        });
        let support = matches!(kind, DialogKind::Support);
        let mut content = match kind {
            DialogKind::Update => update_dialog_surface(c, win),
            DialogKind::Feedback | DialogKind::Support => {
                quietpro::dialog_surface(c, win.viewport_size()).w(px(400.))
            }
        }
        .child(
            if matches!(kind, DialogKind::Support | DialogKind::Feedback) {
                div()
                    .flex()
                    .flex_none()
                    .items_start()
                    .gap(px(8.))
                    .child(heading(title.clone()).min_w_0().flex_1())
                    .child(
                        quietpro::IconControl::new("close-about", tr("common.close"), Icon::X)
                            .disabled(self.opening)
                            .action(c, cx.listener(|s, _, w, cx| s.dismiss(w, cx))),
                    )
                    .into_any_element()
            } else {
                heading(title.clone()).flex_none().into_any_element()
            },
        )
        .track_focus(&self.content_focus)
        .on_key_down(cx.listener(|s, event: &KeyDownEvent, w, cx| {
            if event.keystroke.key == "escape" {
                s.dismiss(w, cx);
                cx.stop_propagation();
            }
        }));
        if matches!(kind, DialogKind::Update) {
            let mut body = div().flex().flex_col().gap(px(quietpro::CARD_TITLE_GAP));
            if let Some(release) = &status.release {
                body = body.child(label(format!(
                    "v{} → v{}",
                    status.installed_version, release.version
                )));
            }
            let detail = match status.phase {
                _ if self.install_error => "update.installErrorDetail",
                Phase::Ready => "update.dialogDownloadedDetail",
                Phase::Downloading => "update.dialogDownloadingDetail",
                Phase::Failed if status.release.is_some() => "update.downloadErrorDetail",
                Phase::Failed => "update.checkErrorDetail",
                _ => "update.dialogAvailableDetail",
            };
            body = body.child(label(tr(detail)));
            if status.phase == Phase::Downloading {
                body = body.child(self.progress(status, c));
            }
            if let Some(release) = &status.release
                && !release.notes.is_empty()
            {
                body = body.child(
                    div()
                        .id("update-release-notes")
                        .child(heading(tr("update.releaseNotes")))
                        .child(label(release.notes.clone()))
                        .test_support(),
                );
            }
            if let Some(error) = self.link_error {
                body = body.child(label(tr(error)).text_color(c.danger));
            }
            content = content.child(
                div()
                    .id("update-dialog-body")
                    .min_h_0()
                    .overflow_y_scroll()
                    .child(body)
                    .test_support(),
            );
            let busy = matches!(
                status.phase,
                Phase::Checking | Phase::Downloading | Phase::Installing
            );
            let release_url = status.release.as_ref().map_or_else(
                || RELEASES.into(),
                |r| format!("{RELEASES}/tag/v{}", r.version),
            );
            let mut actions = quietpro::dialog_actions()
                .child(
                    update_button(
                        "later-update",
                        tr("update.later"),
                        c,
                        status.phase != Phase::Installing,
                    )
                    .on_click(cx.listener(|s, _, w, cx| s.dismiss(w, cx))),
                )
                .child(
                    update_button("release-link", tr("update.releaseNotes"), c, !self.opening)
                        .on_click(cx.listener(move |s, _, w, cx| {
                            s.external(
                                release_url.clone(),
                                "toast.releaseNotesOpenFailed",
                                false,
                                w,
                                cx,
                            )
                        })),
                );
            if status.phase == Phase::Ready {
                actions = actions.child(
                    update_button(
                        "install-detail",
                        tr(if self.install_error {
                            "update.installAgain"
                        } else {
                            "update.restartInstall"
                        }),
                        c,
                        true,
                    )
                    .on_click(cx.listener(|s, _, w, cx| {
                        s.dismiss(w, cx);
                        s.ask_install(w, cx);
                    })),
                );
            } else if status.release.is_some() && !busy {
                actions = actions.child(
                    update_button("download-detail", tr("update.downloadNow"), c, true).on_click(
                        cx.listener(|s, _, w, cx| s.update_request(Request::Download, w, cx)),
                    ),
                );
            }
            if matches!(status.phase, Phase::Failed | Phase::Downloading) || self.install_error {
                actions = actions.child(
                    update_button("retry-update", tr("update.checkAgain"), c, !busy).on_click(
                        cx.listener(|s, _, w, cx| s.update_request(Request::Check, w, cx)),
                    ),
                );
            }
            content = content.child(actions);
        } else {
            if support {
                content = content.child(
                    label(tr("about.supportDialog.description"))
                        .text_size(px(12.))
                        .font_weight(FontWeight::MEDIUM),
                );
            }
            let (qr_heading, link_heading) = if support {
                let (wechat, kofi) = &*SUPPORT_MARKS;
                let mark = |image: &Arc<Image>| {
                    img(image.clone())
                        .size_full()
                        .object_fit(ObjectFit::Contain)
                };
                (
                    card_heading(
                        tr("about.supportDialog.wechatTitle"),
                        mark(wechat).rounded_full(),
                    ),
                    card_heading(tr("about.supportDialog.kofiTitle"), mark(kofi)),
                )
            } else {
                let mark = |data: &[u8]| svg().data(data).size_full().text_color(c.secondary);
                (
                    card_heading(
                        tr("about.feedbackDialog.qqTitle"),
                        mark(include_bytes!("../../../assets/about/qq-channel.svg")),
                    ),
                    card_heading(
                        tr("about.feedbackDialog.githubTitle"),
                        mark(include_bytes!("../../../assets/about/github.svg")),
                    ),
                )
            };
            let card = || {
                content_card(c.border, c.canvas)
                    .w_full()
                    .flex_shrink_0()
                    .py(px(12.) + px(1.))
                    .gap(px(quietpro::CARD_TITLE_GAP))
            };
            let qr_card = card()
                .child(qr_heading)
                .when_some(self.image.clone(), |d, image| {
                    d.child(
                        img(image)
                            .self_center()
                            .size(px(220.))
                            .object_fit(ObjectFit::Contain),
                    )
                });
            let name = tr(if support {
                "about.supportDialog.openKofi"
            } else {
                "about.feedbackDialog.githubAction"
            });
            let hit_padding = px(8.);
            let link_card = card().child(link_heading).child(
                gpui_kit::base::Button::new("external")
                    .accessibility_label(name)
                    .disabled(self.opening)
                    .py(hit_padding)
                    .my(-hit_padding)
                    .w_full()
                    .when_some(self.badge.clone(), |b, image| {
                        b.child(
                            img(image)
                                .w_full()
                                .h(px(36.))
                                .object_fit(ObjectFit::Contain),
                        )
                    })
                    .on_click(cx.listener(move |s, _, w, cx| {
                        s.external(
                            if support { SUPPORT } else { FEEDBACK }.into(),
                            if support {
                                "toast.supportOpenFailed"
                            } else {
                                "toast.feedbackOpenFailed"
                            },
                            !support,
                            w,
                            cx,
                        )
                    })),
            );
            content = content.child(
                div()
                    .id("about-dialog-body")
                    .min_h_0()
                    .overflow_y_scroll()
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .gap(px(quietpro::SECTION_GROUP_GAP))
                            .child(qr_card)
                            .child(link_card),
                    ),
            );
            if let Some(error) = self.link_error {
                content = content.child(label(tr(error)).text_color(c.danger));
            }
        }
        let weak = cx.weak_entity();
        quietpro::modal_dialog(
            title,
            self.focus.clone(),
            content,
            move |w, cx| {
                let _ = weak.update(cx, |s, cx| s.dismiss(w, cx));
            },
            cx,
        )
        .close_on_escape(false)
    }
}
