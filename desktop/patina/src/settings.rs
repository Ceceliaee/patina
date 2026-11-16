use crate::{
    page_controls::{label, save_status},
    window_process::Query,
    windows_host::Client,
};
use gpui_kit::{
    base::slider::{SliderEvent, SliderState, SliderValue},
    prelude::*,
    *,
};
use patina_recorder::{CloseBehavior, Locale, Theme, TrackingPreferences, text};
use quietpro::{CARD_TITLE_GAP, content_card, heading, page, page_actions, page_title_row};
use quietpro::{Icon, IconControl, text_button};
use std::rc::Rc;
mod schemes;
mod services;
mod storage;
use quietpro::{
    SETTINGS_ROW_HEIGHT, SUBHEADING_GAP, choice_card, divider_color, line_above, settings_row,
    settings_rows_card, settings_title, vertical_divider,
};
use services::ServiceFields;

pub(super) struct Settings {
    storage: Entity<storage::StorageCard>,
    client: Rc<Client>,
    saved: Option<TrackingPreferences>,
    draft: Option<TrackingPreferences>,
    sliders: [Entity<SliderState>; 2],
    theme_focus: [FocusHandle; 3],
    scheme_triggers: [FocusHandle; 2],
    picker: Option<schemes::Picker>,
    busy: bool,
    error: bool,
    services: ServiceFields,
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
        let services = ServiceFields::new(win, cx);
        cx.on_release(|s, cx| {
            if s.picker.is_some() {
                s.client.scheme_preview.set(None);
                cx.refresh_windows();
            }
        })
        .detach();
        let mut this = Self {
            storage: cx.new(|cx| storage::StorageCard::new(client.clone(), win, cx)),
            services,
            client,
            saved: None,
            draft: None,
            sliders,
            theme_focus: std::array::from_fn(|_| cx.focus_handle()),
            scheme_triggers: std::array::from_fn(|_| cx.focus_handle()),
            picker: None,
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
        self.draft = self.saved.clone();
        if let Some(p) = &self.saved {
            self.services.reset(p, win, cx);
            for (s, v) in self.sliders.iter().zip([p.gap, p.idle]) {
                s.update(cx, |s, cx| s.set_value((v / 60) as f32, win, cx));
            }
        }
        cx.notify();
    }
    pub(super) fn dirty(&self) -> bool {
        self.saved != self.draft || self.services.invalid_port || self.busy
    }
    pub(super) fn save(&mut self, cx: &mut Context<Self>) {
        let (Some(p), Some(old)) = (self.draft.clone(), self.saved.clone()) else {
            return;
        };
        if self.busy || !p.valid() || self.services.invalid_port {
            return;
        }
        self.busy = true;
        self.services.set_busy(true, cx);
        let client = self.client.clone();
        let write = client.request::<()>(Query::SavePreferences(old, p.clone()));
        cx.spawn(async move |view, cx| {
            let res = write.await;
            let _ = view.update(cx, |t, cx| {
                t.busy = false;
                t.services.set_busy(false, cx);
                t.error = res.is_err();
                if let Err(error) = &res {
                    eprintln!("save preferences: {error}");
                }
                if res.is_ok() {
                    t.saved = Some(p.clone());
                    client.locale.set(p.locale);
                    t.services.set_locale(p.locale, cx);
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
        let changed = self.dirty() && !self.busy;
        let can_apply = changed
            && !self.services.invalid_port
            && self.draft.as_ref().is_some_and(|p| p.valid());
        let actions = page_actions()
            .when(self.draft.is_some(), |row| {
                let status = tr(if self.busy {
                    "common.saving"
                } else if changed {
                    "settings.unsaved"
                } else {
                    "common.saved"
                });
                row.child(save_status(status, c))
            })
            .child(
                text_button("cancel", tr("common.cancel"), c, changed)
                    .on_click(cx.listener(|t, _, win, cx| t.reset(win, cx))),
            )
            .child(
                text_button("save", tr("common.save"), c, can_apply)
                    .on_click(cx.listener(|t, _, _, cx| t.save(cx))),
            );
        let mut shell =
            page(c).child(page_title_row(tr("settings.title"), Icon::Settings2, c).child(actions));
        if self.error {
            if self.draft.is_some() {
                shell = shell.child(label(tr("settings.saveFailed")));
            }
            shell = shell.child(
                text_button("retry", tr("common.retry"), c, true)
                    .on_click(cx.listener(|t, _, win, cx| t.reload(win, cx))),
            );
        }
        let Some(p) = self.draft.as_ref() else {
            return shell.child(label(tr("common.loading")));
        };
        let divider = divider_color(c);
        let mut time_group = settings_rows_card(c);
        for (i, k, value, min, max) in [
            (0, "settings.timelineMergeGapLabel", p.gap / 60, 1, 5),
            (1, "settings.idleTimeoutLabel", p.idle / 60, 5, 30),
        ] {
            let name = tr(k);
            let mut row = settings_row()
                .id(k)
                .gap(px(8.))
                .child(label(name.clone()).flex_1());
            for (dir, symbol) in [(-1, "−"), (1, "+")] {
                if dir == 1 {
                    let s = &self.sliders[i];
                    row = row
                        .child(quietpro::value_slider(s, name.clone(), !self.busy, c, cx))
                        .child(label(format!("{value} min")).w(px(48.)).text_right());
                }
                row = row.child(
                    IconControl::new(
                        SharedString::from(format!("{k}-{dir}")),
                        format!("{symbol} {name}"),
                        if dir == 1 { Icon::Plus } else { Icon::Minus },
                    )
                    .disabled(self.busy || !(min..=max).contains(&(value + dir)))
                    .action(
                        c,
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
                    ),
                );
            }
            time_group =
                time_group.child(row.when(i == 0, |r| r.border_b_1().border_color(divider)));
        }
        let update_toggle = |set: fn(&mut TrackingPreferences, bool)| {
            let v = cx.weak_entity();
            move |next: bool, _: &ClickEvent, _: &mut Window, cx: &mut App| {
                let _ = v.update(cx, |t, cx| {
                    if let Some(p) = &mut t.draft {
                        set(p, next);
                        cx.notify();
                    }
                });
            }
        };
        let pair = |left: Div, right: Div| {
            settings_rows_card(c)
                .flex_row()
                .items_center()
                .gap(px(12.))
                .h(px(SETTINGS_ROW_HEIGHT))
                .child(left)
                .child(vertical_divider(c))
                .child(right)
        };
        let toggle_row = |k: &'static str, on, set| {
            quietpro::slide_switch(k, tr(k), on, !self.busy, c, update_toggle(set)).flex_1()
        };
        let options = pair(
            toggle_row("settings.trackingPausedLabel", p.paused, |p, v| {
                p.paused = v
            }),
            toggle_row("settings.globalTitleLabel", p.titles, |p, v| p.titles = v),
        );
        let behavior = p.desktop;
        let windows = pair(
            toggle_row(
                "settings.closeToTrayLabel",
                behavior.should_keep_running_in_background(),
                |p, on| {
                    p.desktop.close_behavior = if on {
                        CloseBehavior::Tray
                    } else {
                        CloseBehavior::Exit
                    };
                },
            ),
            toggle_row(
                "settings.showTrayIconLabel",
                behavior.show_tray_icon,
                |p, v| p.desktop.show_tray_icon = v,
            ),
        );
        let startup = pair(
            toggle_row(
                "settings.launchAtLoginLabel",
                behavior.launch_at_login,
                |p, v| p.desktop.launch_at_login = v,
            ),
            toggle_row(
                "settings.startMinimizedLabel",
                behavior.start_minimized,
                |p, v| p.desktop.start_minimized = v,
            ),
        );
        let settings_group = |key: &'static str, controls: Div| {
            div()
                .id(key)
                .flex()
                .flex_col()
                .gap(px(SUBHEADING_GAP))
                .child(
                    heading(tr(key))
                        .id("group-title")
                        .aria_level(3)
                        .text_size(px(14.))
                        .line_height(px(20.))
                        .text_color(c.secondary),
                )
                .child(controls)
        };
        let section = |title_row: Div, groups: [Stateful<Div>; 2]| {
            content_card(c.border, c.panel)
                .flex_none()
                .gap(px(CARD_TITLE_GAP))
                .child(title_row)
                .child(
                    div()
                        .flex()
                        .flex_col()
                        .gap(px(SUBHEADING_GAP))
                        .children(groups),
                )
        };
        let track = section(
            settings_title(
                c,
                Icon::MousePointerClick,
                tr("settings.trackingPanelTitle"),
            ),
            [
                settings_group("settings.timeRulesTitle", time_group),
                settings_group("settings.recordingOptionsTitle", options),
            ],
        );
        let choice_row = |name| {
            settings_rows_card(c)
                .flex_row()
                .h(px(SETTINGS_ROW_HEIGHT))
                .gap(px(8.))
                .items_center()
                .child(label(name).flex_1())
        };
        let theme_options = [
            (Theme::Light, "settings.themeModeOptions.light"),
            (Theme::Dark, "settings.themeModeOptions.dark"),
            (Theme::System, "settings.themeModeOptions.system"),
        ];
        let theme_name = tr("settings.themeModeLabel");
        let view = cx.weak_entity();
        let theme_row = settings_row()
            .gap(px(8.))
            .child(label(theme_name.clone()).flex_1())
            .child(quietpro::segmented(
                "theme-mode",
                theme_name,
                std::array::from_fn::<_, 3, _>(|i| {
                    let (theme, key) = theme_options[i];
                    (theme, tr(key), None, self.theme_focus[i].clone())
                }),
                p.theme,
                !self.busy,
                c,
                move |theme, _, cx| {
                    let _ = view.update(cx, |t, cx| {
                        if let Some(p) = &mut t.draft {
                            p.theme = theme;
                            cx.notify();
                        }
                    });
                },
            ));
        let themes =
            settings_rows_card(c)
                .child(theme_row)
                .child(line_above(self.scheme_row(c, cx), c, 0.));
        let language_label = tr("settings.languageLabel");
        let view = cx.weak_entity();
        let langs = choice_row(language_label.clone()).child(
            quietpro::Dropdown::new(
                "language-select",
                language_label,
                [
                    (Locale::ZhCn, "简体中文"),
                    (Locale::EnUs, "English"),
                    (Locale::RuRu, "Русский"),
                    (Locale::Es, "Español"),
                ],
                p.locale,
                c,
                move |locale, _, cx| {
                    let _ = view.update(cx, |t, cx| {
                        if let Some(p) = &mut t.draft {
                            p.locale = locale;
                        }
                        cx.notify();
                    });
                },
            )
            .disabled(self.busy),
        );
        let appearance = section(
            settings_title(c, Icon::Palette, tr("settings.appearanceTitle")),
            [
                settings_group("settings.themeGroupTitle", themes),
                settings_group("settings.interfaceGroupTitle", langs),
            ],
        );
        let resident = section(
            settings_title(c, Icon::Monitor, tr("settings.residentTitle")),
            [
                settings_group("settings.windowBehaviorTitle", windows),
                settings_group("settings.runtimeBehaviorTitle", startup),
            ],
        );
        shell = shell.child(
            div()
                .id("settings-scroll")
                .min_h_0()
                .flex_1()
                .overflow_y_scroll()
                .flex()
                .flex_col()
                .gap(px(quietpro::CARD_GAP))
                .child(track)
                .child(appearance)
                .child(resident)
                .child(self.service_panel(
                    c,
                    crate::main_window::page_width(win.viewport_size().width),
                    cx,
                ))
                .child(self.storage.clone()),
        );
        if let Some(picker) = &self.picker {
            shell = shell.child(self.scheme_dialog(picker, c, win, cx));
        }
        if self.services.guide {
            shell = shell.child(self.service_guide(c, win, cx));
        }
        shell
    }
}

impl gpui_kit::EventEmitter<crate::main_window::Saved> for Settings {}
