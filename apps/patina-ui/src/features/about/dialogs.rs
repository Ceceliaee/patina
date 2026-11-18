use super::*;

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
        let request = self.client.open_external(url);
        cx.spawn_in(win, async move |view, cx| {
            let result = request.await;
            let _ = view.update_in(cx, |s, win, cx| {
                s.opening = false;
                if result.is_err() {
                    s.link_error = Some(failure);
                } else if close {
                    s.dismiss(win, cx);
                }
                cx.notify();
            });
        })
        .detach();
        cx.notify();
    }
    pub(super) fn progress(&self, c: quietpro::Palette) -> Div {
        let tr = |key| text(self.client.locale.get(), key);
        let size = self.status.release.as_ref().map_or(0, |r| r.size);
        let percent = if size > 0 {
            (self.status.received_bytes as f64 / size as f64).clamp(0., 1.) as f32
        } else {
            0.
        };
        div()
            .flex()
            .flex_col()
            .gap(px(6.))
            .w_full()
            .child(label(if size == 0 {
                tr("update.progressPending")
            } else {
                format!(
                    "{:.0}% · {:.1} / {:.1} MiB",
                    percent * 100.,
                    self.status.received_bytes as f64 / 1048576.,
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
                    ),
            )
    }
    pub(super) fn detail_dialog(
        &self,
        kind: DialogKind,
        win: &mut Window,
        cx: &mut Context<Self>,
    ) -> gpui_kit::base::Dialog {
        let c = self.client.palette(win);
        let tr = |key| text(self.client.locale.get(), key);
        let title = tr(match kind {
            DialogKind::Feedback => "about.feedbackDialog.title",
            DialogKind::Support => "update.support",
            DialogKind::Update if self.install_error => "update.installFailedDialog",
            DialogKind::Update => match self.status.phase {
                Phase::Failed if self.status.release.is_some() => "update.downloadFailedDialog",
                Phase::Failed => "update.checkFailedDialog",
                Phase::Ready => "update.dialogDownloaded",
                Phase::Downloading => "update.dialogDownloading",
                Phase::Checking => "update.checkingUpdates",
                Phase::Current => "update.upToDate",
                _ => "update.dialogAvailable",
            },
        });
        let mut content = quietpro::dialog_surface(c, win.viewport_size())
            .w(px(760.))
            .child(heading(title.clone()))
            .track_focus(&self.content_focus)
            .on_key_down(cx.listener(|s, event: &KeyDownEvent, w, cx| {
                if event.keystroke.key == "escape" {
                    s.dismiss(w, cx);
                    cx.stop_propagation();
                }
            }));
        if matches!(kind, DialogKind::Update) {
            if let Some(release) = &self.status.release {
                content = content.child(label(format!(
                    "v{} → v{}",
                    self.status.installed_version, release.version
                )));
            }
            let detail = match self.status.phase {
                _ if self.install_error => Some("update.installErrorDetail"),
                Phase::Ready => Some("update.dialogDownloadedDetail"),
                Phase::Downloading => Some("update.dialogDownloadingDetail"),
                Phase::Failed if self.status.release.is_some() => {
                    Some("update.downloadErrorDetail")
                }
                Phase::Failed => Some("update.checkErrorDetail"),
                Phase::Current | Phase::Checking => None,
                _ => Some("update.dialogAvailableDetail"),
            };
            if let Some(detail) = detail {
                content = content.child(label(tr(detail)));
            }
            if matches!(self.status.phase, Phase::Checking | Phase::Downloading) {
                content = content.child(self.progress(c));
            }
            if let Some(release) = &self.status.release
                && !release.notes.is_empty()
            {
                content = content.child(
                    div()
                        .id("release-notes")
                        .min_h_0()
                        .max_h(px(260.))
                        .overflow_y_scroll()
                        .child(heading(tr("update.releaseNotes")))
                        .child(label(release.notes.clone())),
                );
            }
            let busy = matches!(
                self.status.phase,
                Phase::Checking | Phase::Downloading | Phase::Installing
            );
            let mut actions = quietpro::dialog_actions().child(
                text_button(
                    "later-update",
                    tr("update.later"),
                    c,
                    self.status.phase != Phase::Installing,
                )
                .on_click(cx.listener(|s, _, w, cx| s.dismiss(w, cx))),
            );
            if self.status.phase == Phase::Ready {
                actions = actions.child(
                    text_button(
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
            } else if self.status.release.is_some() && !busy {
                actions = actions.child(
                    text_button("download-detail", tr("update.downloadNow"), c, true).on_click(
                        cx.listener(|s, _, _, cx| s.update_request(Request::Download, cx)),
                    ),
                );
            }
            if self.install_error {
                actions = actions.child(
                    text_button(
                        "redownload-update",
                        tr("update.redownloadInstaller"),
                        c,
                        true,
                    )
                    .on_click(cx.listener(|s, _, _, cx| s.update_request(Request::Download, cx))),
                );
            }
            let release_url = self.status.release.as_ref().map_or_else(
                || RELEASES.into(),
                |r| format!("{RELEASES}/tag/v{}", r.version),
            );
            actions = actions.child(
                text_button("release-link", tr("update.releaseNotes"), c, !self.opening).on_click(
                    cx.listener(move |s, _, w, cx| {
                        s.external(
                            release_url.clone(),
                            "toast.releaseNotesOpenFailed",
                            false,
                            w,
                            cx,
                        )
                    }),
                ),
            );
            if matches!(self.status.phase, Phase::Failed | Phase::Downloading) || self.install_error
            {
                if let Some(r) = &self.status.release {
                    let url = r.url.clone();
                    actions = actions.child(
                        text_button(
                            "installer-link",
                            tr("update.downloadInstaller"),
                            c,
                            !self.opening,
                        )
                        .on_click(cx.listener(move |s, _, w, cx| {
                            s.external(url.clone(), "toast.releaseNotesOpenFailed", false, w, cx)
                        })),
                    );
                }
                actions = actions.child(
                    text_button("retry-update", tr("update.checkAgain"), c, !busy)
                        .on_click(cx.listener(|s, _, _, cx| s.update_request(Request::Check, cx))),
                );
            }
            content = content.child(actions);
        } else {
            let support = matches!(kind, DialogKind::Support);
            if support {
                content = content.child(label(tr("about.supportDialog.description")));
            }
            let left = content_card(c.border, c.canvas)
                .flex_1()
                .min_w_0()
                .gap(px(12.))
                .child(
                    div()
                        .flex()
                        .items_center()
                        .gap(px(8.))
                        .when(!support, |d| {
                            d.child(
                                quietpro::glyph(Icon::Info, c.secondary)
                                    .data(include_bytes!("../../../assets/about/qq-channel.svg"))
                                    .size(px(24.)),
                            )
                        })
                        .child(heading(tr(if support {
                            "about.supportDialog.wechatTitle"
                        } else {
                            "about.feedbackDialog.qqTitle"
                        }))),
                )
                .when_some(self.image.clone(), |d, image| {
                    d.child(
                        img(image)
                            .self_center()
                            .size(px(220.))
                            .object_fit(ObjectFit::Contain),
                    )
                });
            let name = tr(if self.opening {
                "about.feedbackDialog.githubOpening"
            } else if support {
                "about.supportDialog.openKofi"
            } else {
                "about.feedbackDialog.githubAction"
            });
            let right = content_card(c.border, c.canvas)
                .flex_1()
                .min_w_0()
                .gap(px(12.))
                .child(
                    div()
                        .flex()
                        .items_center()
                        .gap(px(8.))
                        .when(!support, |d| {
                            d.child(
                                quietpro::glyph(Icon::Info, c.secondary)
                                    .data(include_bytes!("../../../assets/about/github.svg"))
                                    .size(px(24.)),
                            )
                        })
                        .child(heading(tr(if support {
                            "about.supportDialog.kofiTitle"
                        } else {
                            "about.feedbackDialog.githubTitle"
                        }))),
                )
                .child(
                    gpui_kit::base::Button::new("external")
                        .accessibility_label(name.clone())
                        .disabled(self.opening)
                        .min_h(px(56.))
                        .w_full()
                        .when_some(self.badge.clone(), |b, image| {
                            b.child(
                                img(image)
                                    .w_full()
                                    .h(px(52.))
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
                )
                .when(self.opening, |d| d.child(label(name)));
            content = content
                .child(
                    div()
                        .id("about-dialog-body")
                        .min_h_0()
                        .overflow_y_scroll()
                        .child(
                            div()
                                .flex()
                                .when(win.viewport_size().width < px(850.), |d| d.flex_col())
                                .gap(px(12.))
                                .child(left)
                                .child(right),
                        ),
                )
                .child(
                    quietpro::dialog_actions().child(
                        text_button("close-about", tr("common.close"), c, !self.opening)
                            .on_click(cx.listener(|s, _, w, cx| s.dismiss(w, cx))),
                    ),
                );
        }
        if let Some(error) = self.link_error {
            content = content.child(label(tr(error)).text_color(c.danger));
        }
        let weak = cx.weak_entity();
        gpui_kit::base::Dialog::new(cx)
            .focus_handle(self.focus.clone())
            .accessibility_label(title)
            .close_on_escape(false)
            .backdrop(quietpro::dialog_backdrop())
            .popup(gpui_kit::base::DialogPopup::new().child(content))
            .on_open_change(move |open, _, w, cx| {
                if !open {
                    let _ = weak.update(cx, |s, cx| s.dismiss(w, cx));
                }
            })
    }
}
