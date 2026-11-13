use crate::{
    page_controls::{
        action, content_card, heading, label, page, page_actions, page_title_row, save_status,
    },
    window_process::Query,
    windows_host::Client,
};
use gpui_kit::{
    base::{
        Slider, SliderIndicator, SliderThumb, SliderTrack,
        slider::{SliderEvent, SliderState, SliderValue},
    },
    prelude::*,
    *,
};
use patina_recorder::{Locale, Theme, TrackingPreferences, text};
use quietpro::{Icon, IconControl, text_button};
use std::rc::Rc;
pub(super) struct Settings {
    client: Rc<Client>,
    saved: Option<TrackingPreferences>,
    draft: Option<TrackingPreferences>,
    sliders: [Entity<SliderState>; 2],
    busy: bool,
    error: bool,
}
impl Settings {
    pub(super) fn new(client: Rc<Client>, win: &mut Window, cx: &mut Context<Self>) -> Self {
        let sliders = std::array::from_fn(|i| {
            let (min, max, val) = if i == 0 { (1., 5., 3.) } else { (5., 30., 15.) };
            let state = cx.new(|_| {
                SliderState::new()
                    .min(min)
                    .max(max)
                    .step(1.)
                    .default_value(val)
            });
            cx.subscribe(
                &state,
                move |this: &mut Self, _, event: &SliderEvent, cx| {
                    if let SliderEvent::Change(SliderValue::Single(v)) = event
                        && let Some(p) = this.draft.as_mut()
                    {
                        let n = v.round() as i64 * 60;
                        if i == 0 {
                            p.gap = n;
                        } else {
                            p.idle = n;
                        }
                        cx.notify();
                    }
                },
            )
            .detach();
            state
        });
        let mut this = Self {
            client,
            saved: None,
            draft: None,
            sliders,
            busy: false,
            error: false,
        };
        this.reload(win, cx);
        this
    }
    fn reload(&mut self, win: &mut Window, cx: &mut Context<Self>) {
        let read = self
            .client
            .request::<TrackingPreferences>(Query::Preferences);
        cx.spawn_in(win, async move |view, cx| {
            let res = read.await;
            let _ = view.update_in(cx, |t, win, cx| {
                if let Ok(p) = res {
                    t.saved = Some(p);
                    t.reset(win, cx);
                    t.error = false;
                } else {
                    t.error = true;
                }
                cx.notify();
            });
        })
        .detach();
    }
    fn reset(&mut self, win: &mut Window, cx: &mut Context<Self>) {
        self.draft = self.saved;
        if let Some(p) = self.saved {
            for (s, v) in self.sliders.iter().zip([p.gap, p.idle]) {
                s.update(cx, |s, cx| s.set_value((v / 60) as f32, win, cx));
            }
        }
        cx.notify();
    }
    pub(super) fn dirty(&self) -> bool {
        self.saved != self.draft || self.busy
    }
    pub(super) fn save(&mut self, cx: &mut Context<Self>) {
        let (Some(p), Some(old)) = (self.draft, self.saved) else {
            return;
        };
        if self.busy {
            return;
        }
        self.busy = true;
        let client = self.client.clone();
        let write = client.request::<()>(Query::SavePreferences(old, p));
        cx.spawn(async move |view, cx| {
            let res = write.await;
            let _ = view.update(cx, |t, cx| {
                t.busy = false;
                t.error = res.is_err();
                if res.is_ok() {
                    t.saved = Some(p);
                    client.locale.set(p.locale);
                    client.theme.set(p.theme);
                    cx.refresh_windows();
                    cx.emit(crate::main_window::Saved);
                }
                cx.notify();
            });
        })
        .detach();
        cx.notify();
    }
}
impl Render for Settings {
    fn render(&mut self, win: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let c = self.client.palette(win);
        let tr = |k| text(self.client.locale.get(), k);
        let can_apply = self.dirty() && !self.busy;
        let actions = page_actions()
            .when(self.draft.is_some(), |row| {
                let status = tr(if self.busy {
                    "common.saving"
                } else if can_apply {
                    "settings.unsaved"
                } else {
                    "common.saved"
                });
                row.child(save_status(status, c))
            })
            .child(
                text_button("cancel", tr("common.cancel"), c, can_apply)
                    .on_click(cx.listener(|t, _, win, cx| t.reset(win, cx))),
            )
            .child(
                text_button("save", tr("common.save"), c, can_apply)
                    .on_click(cx.listener(|t, _, _, cx| t.save(cx))),
            );
        let mut shell =
            page(c).child(page_title_row(tr("settings.title"), Icon::Settings2, c).child(actions));
        if self.error {
            shell = shell.child(action(
                "retry",
                tr("common.retry"),
                tr("common.retry"),
                true,
                cx.listener(|t, _, win, cx| t.reload(win, cx)),
            ));
        }
        let Some(p) = self.draft else {
            return shell.child(label(tr("common.loading")));
        };
        let inner_card = || content_card(c.border, c.canvas).px(px(12.) + px(1.));
        let mut time_group = inner_card().py(px(1.));
        for (i, k, value, min, max) in [
            (0, "settings.timelineMergeGapLabel", p.gap / 60, 1, 5),
            (1, "settings.idleTimeoutLabel", p.idle / 60, 5, 30),
        ] {
            let name = tr(k);
            let mut row = div()
                .id(k)
                .h(px(48.))
                .flex()
                .items_center()
                .gap(px(8.))
                .child(label(name.clone()).flex_1());
            for (dir, symbol) in [(-1, "−"), (1, "+")] {
                if dir == 1 {
                    let s = &self.sliders[i];
                    row = row
                        .child(
                            Slider::new(s)
                                .accessibility_label(name.clone())
                                .w(px(160.))
                                .h(px(24.))
                                .flex()
                                .items_center()
                                .child(
                                    SliderTrack::new(s)
                                        .w_full()
                                        .h(px(4.))
                                        .bg(c.track)
                                        .child(SliderIndicator::new(s).h_full().bg(c.accent))
                                        .child(
                                            SliderThumb::new(s)
                                                .size(px(12.))
                                                .rounded_full()
                                                .bg(c.accent),
                                        ),
                                ),
                        )
                        .child(label(format!("{value} min")));
                }
                row = row.child(action(
                    SharedString::from(format!("{k}-{dir}")),
                    format!("{symbol} {name}"),
                    symbol.into(),
                    !self.busy && (min..=max).contains(&(value + dir)),
                    cx.listener(move |t, _, win, cx| {
                        let next = (value + dir).clamp(min, max);
                        if let Some(p) = &mut t.draft {
                            if i == 0 {
                                p.gap = next * 60;
                            } else {
                                p.idle = next * 60;
                            }
                        }
                        t.sliders[i].update(cx, |s, cx| s.set_value(next as f32, win, cx));
                        cx.notify();
                    }),
                ));
            }
            time_group = time_group.child(row);
        }
        let mut options = inner_card().flex_row().gap(px(20.)).py(px(8.) + px(1.));
        for (i, k, on) in [
            (0, "settings.trackingPausedLabel", p.paused),
            (1, "settings.globalTitleLabel", p.titles),
        ] {
            let v = cx.weak_entity();
            options = options.child(
                div()
                    .flex_1()
                    .flex()
                    .items_center()
                    .justify_between()
                    .child(label(tr(k)))
                    .child(
                        IconControl::new(k, tr(k), Icon::Check)
                            .disabled(self.busy)
                            .toggle(c, on, move |next, _, _, cx| {
                                let _ = v.update(cx, |t, cx| {
                                    if let Some(p) = &mut t.draft {
                                        if i == 0 {
                                            p.paused = next;
                                        } else {
                                            p.titles = next;
                                        }
                                    }
                                    cx.notify();
                                });
                            }),
                    ),
            );
        }
        let settings_group = |name, controls: Div| {
            div()
                .flex()
                .flex_col()
                .gap(px(8.))
                .child(
                    heading(name)
                        .aria_level(3)
                        .text_size(px(14.))
                        .line_height(px(20.))
                        .text_color(c.secondary),
                )
                .child(controls)
        };
        let section = |icon, title| {
            content_card(c.border, c.panel)
                .flex_none()
                .gap(px(16.))
                .child(
                    div()
                        .flex()
                        .items_center()
                        .gap(px(8.))
                        .child(quietpro::glyph(icon, c.secondary).size(px(16.)))
                        .child(heading(title).aria_level(2).line_height(px(24.))),
                )
        };
        let track = section(Icon::Clock, tr("settings.trackingPanelTitle"))
            .child(settings_group(tr("settings.timeRulesTitle"), time_group))
            .child(settings_group(
                tr("settings.recordingOptionsTitle"),
                options,
            ));
        let choice_row = |name| {
            content_card(c.border, c.canvas)
                .flex_row()
                .flex_wrap()
                .min_h(px(48.))
                .py(px(8.) + px(1.))
                .gap(px(8.))
                .items_center()
                .child(label(name).flex_1())
        };
        let mut themes = choice_row(tr("settings.themeModeLabel"));
        for (theme, key) in [
            (Theme::Light, "settings.themeModeOptions.light"),
            (Theme::Dark, "settings.themeModeOptions.dark"),
            (Theme::System, "settings.themeModeOptions.system"),
        ] {
            themes = themes.child(action(
                key,
                tr(key),
                tr(key),
                !self.busy && p.theme != theme,
                cx.listener(move |t, _, _, cx| {
                    if let Some(p) = &mut t.draft {
                        p.theme = theme;
                    }
                    cx.notify();
                }),
            ));
        }
        let mut langs = choice_row(tr("settings.languageLabel"));
        for (locale, name) in [
            (Locale::ZhCn, "简体中文"),
            (Locale::EnUs, "English"),
            (Locale::RuRu, "Русский"),
            (Locale::Es, "Español"),
        ] {
            langs = langs.child(action(
                name,
                name.into(),
                name.into(),
                !self.busy && p.locale != locale,
                cx.listener(move |t, _, _, cx| {
                    if let Some(p) = &mut t.draft {
                        p.locale = locale;
                    }
                    cx.notify();
                }),
            ));
        }
        let appearance = section(Icon::Layers, tr("settings.appearanceTitle"))
            .child(settings_group(tr("settings.themeGroupTitle"), themes))
            .child(settings_group(tr("settings.interfaceGroupTitle"), langs));
        shell.child(
            div()
                .id("settings-scroll")
                .min_h_0()
                .flex_1()
                .overflow_y_scroll()
                .flex()
                .flex_col()
                .gap(px(crate::page_controls::CARD_GAP))
                .child(track)
                .child(appearance),
        )
    }
}

impl gpui_kit::EventEmitter<crate::main_window::Saved> for Settings {}
