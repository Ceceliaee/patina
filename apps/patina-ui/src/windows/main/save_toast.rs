use super::MainWindow;
use gpui_kit::{prelude::*, *};
use quietpro::Palette;
use std::time::{Duration, Instant};

pub(super) struct SaveToast {
    pub(super) message: &'static str,
    text: Option<String>,
    remaining: Duration,
    started: Instant,
    timer: Option<Task<()>>,
}

impl MainWindow {
    pub(super) fn show_save_toast(&mut self, cx: &mut Context<Self>) {
        self.show_feedback("common.saved", cx);
    }

    pub(super) fn update_edit_toast(&mut self, dirty: bool, cx: &mut Context<Self>) {
        if dirty && !self.had_unsaved_changes {
            self.show_feedback("settings.unsaved", cx);
        } else if !dirty
            && self
                .save_toast
                .as_ref()
                .is_some_and(|toast| toast.message == "settings.unsaved")
        {
            self.save_toast = None;
            cx.notify();
        }
        self.had_unsaved_changes = dirty;
    }

    pub(super) fn show_feedback(&mut self, message: &'static str, cx: &mut Context<Self>) {
        self.save_toast = Some(SaveToast {
            message,
            text: None,
            remaining: Duration::from_secs(3),
            started: Instant::now(),
            timer: None,
        });
        self.resume_save_toast(cx);
        cx.notify();
    }

    pub(super) fn show_result(&mut self, text: String, cx: &mut Context<Self>) {
        self.show_feedback("", cx);
        self.save_toast.as_mut().unwrap().text = Some(text);
    }

    fn resume_save_toast(&mut self, cx: &mut Context<Self>) {
        let Some(toast) = &mut self.save_toast else {
            return;
        };
        if toast.message == "settings.unsaved" {
            return;
        }
        toast.started = Instant::now();
        let timer = cx.background_executor().timer(toast.remaining);
        toast.timer = Some(cx.spawn(async move |view, cx| {
            timer.await;
            let _ = view.update(cx, |this, cx| {
                this.save_toast = None;
                if this.had_unsaved_changes {
                    this.show_feedback("settings.unsaved", cx);
                }
                cx.notify();
            });
        }));
    }

    pub(super) fn render_save_toast(
        &self,
        colors: Palette,
        cx: &mut Context<Self>,
    ) -> Option<impl IntoElement> {
        let toast = self.save_toast.as_ref()?;
        let locale = self.client.locale.get();
        let text = toast
            .text
            .clone()
            .unwrap_or_else(|| patina_i18n::text(locale, toast.message));
        Some(
            deferred(
                div()
                    .absolute()
                    .top(px(44.))
                    .left(px(8.))
                    .right(px(8.))
                    .flex()
                    .justify_end()
                    .child(
                        quietpro::toast_surface(colors)
                            .id("save-toast")
                            .occlude()
                            .role(Role::Status)
                            .aria_label(text.clone())
                            .on_hover(cx.listener(|this, hovered, _, cx| {
                                if *hovered {
                                    if let Some(toast) = &mut this.save_toast
                                        && toast.timer.is_some()
                                    {
                                        toast.remaining =
                                            toast.remaining.saturating_sub(toast.started.elapsed());
                                        toast.timer = None;
                                    }
                                } else {
                                    this.resume_save_toast(cx);
                                }
                            }))
                            .child(div().min_w_0().child(text)),
                    ),
            )
            .with_priority(gpui_kit::base::POPUP_PRIORITY + 2),
        )
    }
}
