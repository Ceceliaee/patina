use crate::{
    client::Client,
    features::page_controls::{label, save_status},
};
use gpui_kit::{
    base::slider::{SliderEvent, SliderState, SliderValue},
    prelude::*,
    *,
};
use patina_activity_model::{AppPreferences, CloseBehavior, Locale, Theme, text};
use quietpro::{ButtonSizeExt, ControlSize, Icon, IconControl, text_button};
use quietpro::{CARD_TITLE_GAP, content_card, heading, page, page_actions, page_title_row};
use std::rc::Rc;
mod schemes;
mod services;
mod storage;
use quietpro::{
    SECTION_GROUP_GAP, SETTINGS_ROW_HEIGHT, SUBHEADING_GAP, choice_card, divider_color, line_above,
    settings_row, settings_row_label, settings_rows_card, settings_title, vertical_divider,
};
use services::ServiceFields;

pub(crate) type PreferencesRead = futures::future::LocalBoxFuture<
    'static,
    Result<AppPreferences, patina_desktop_protocol::RequestError>,
>;

#[derive(Clone, Copy, PartialEq, Eq)]
enum Failure {
    Load,
    Save,
    Conflict,
    Token {
        field: services::Field,
        reveal: bool,
    },
}

pub(crate) struct Settings {
    storage: Entity<storage::StorageCard>,
    client: Rc<Client>,
    saved: Option<AppPreferences>,
    load: Option<Task<()>>,
    write: Option<Task<()>>,
    draft: Option<AppPreferences>,
    sliders: [Entity<SliderState>; 2],
    theme_focus: [FocusHandle; 3],
    scheme_triggers: [FocusHandle; 2],
    picker: Option<schemes::Picker>,
    failure: Option<Failure>,
    services: ServiceFields,
}
impl Settings {
    pub(crate) fn new(
        client: Rc<Client>,
        read: PreferencesRead,
        win: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
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
                            p.timeline_merge_gap_secs = n;
                        } else {
                            p.idle_timeout_secs = n;
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
            if let Some(saved) = &s.saved {
                s.client.locale.set(saved.locale);
                s.client.theme.set(saved.theme);
                cx.refresh_windows();
            }
            if s.picker.is_some() {
                s.client.scheme_preview.set(None);
                cx.refresh_windows();
            }
        })
        .detach();
        let storage = cx.new(|cx| storage::StorageCard::new(client.clone(), win, cx));
        cx.subscribe(
            &storage,
            |_, _, event: &crate::windows::main::Feedback, cx| cx.emit(event.clone()),
        )
        .detach();
        let mut this = Self {
            storage,
            services,
            client,
            saved: None,
            load: None,
            write: None,
            draft: None,
            sliders,
            theme_focus: std::array::from_fn(|_| cx.focus_handle()),
            scheme_triggers: std::array::from_fn(|_| cx.focus_handle()),
            picker: None,
            failure: None,
        };
        this.load_preferences(read, win, cx);
        this
    }
    pub(crate) fn ready_to_present(&self) -> bool {
        self.draft.is_some() || self.failure == Some(Failure::Load)
    }
    fn load_preferences(
        &mut self,
        mut read: PreferencesRead,
        win: &mut Window,
        cx: &mut Context<Self>,
    ) {
        use futures::FutureExt;

        if let Some(result) = read.as_mut().now_or_never() {
            self.finish_load(result.ok(), win, cx);
            return;
        }
        self.services.set_busy(true, cx);
        self.load = Some(cx.spawn_in(win, async move |view, cx| {
            let preferences = read.await.ok();
            let _ = view.update_in(cx, |t, win, cx| {
                t.load = None;
                t.finish_load(preferences, win, cx);
            });
        }));
        cx.notify();
    }
    fn finish_load(
        &mut self,
        preferences: Option<AppPreferences>,
        win: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.services.set_busy(false, cx);
        if let Some(p) = preferences {
            self.saved = Some(p);
            self.reset(win, cx);
        } else {
            self.failure = Some(Failure::Load);
            cx.notify();
        }
    }
    fn reset(&mut self, win: &mut Window, cx: &mut Context<Self>) {
        self.failure = None;
        self.draft = self.saved.clone();
        if let Some(p) = &self.saved {
            self.client.locale.set(p.locale);
            self.client.theme.set(p.theme);
            cx.refresh_windows();
            self.services.reset(p, win, cx);
            for (s, v) in self
                .sliders
                .iter()
                .zip([p.timeline_merge_gap_secs, p.idle_timeout_secs])
            {
                s.update(cx, |s, cx| s.set_value((v / 60) as f32, win, cx));
            }
        }
        cx.notify();
    }
    fn busy(&self) -> bool {
        self.load.is_some() || self.write.is_some()
    }
    pub(crate) fn dirty(&self) -> bool {
        self.saved != self.draft || self.services.invalid_port || self.write.is_some()
    }
    pub(crate) fn save(&mut self, cx: &mut Context<Self>) {
        let (Some(p), Some(old)) = (self.draft.clone(), self.saved.clone()) else {
            return;
        };
        if self.busy()
            || matches!(self.failure, Some(Failure::Load | Failure::Conflict))
            || !p.valid()
            || self.services.invalid_port
        {
            return;
        }
        self.services.set_busy(true, cx);
        let client = self.client.clone();
        let write = client.save_preferences(old, p.clone());
        self.write = Some(cx.spawn(async move |view, cx| {
            let res = write.await;
            let _ = view.update(cx, |t, cx| {
                t.write = None;
                t.services.set_busy(false, cx);
                if let Err(error) = res {
                    eprintln!("save preferences: {error}");
                    t.failure = Some(
                        if matches!(error, patina_desktop_protocol::RequestError::Conflict(_)) {
                            Failure::Conflict
                        } else {
                            Failure::Save
                        },
                    );
                } else {
                    t.failure = None;
                    t.saved = Some(p.clone());
                    client.locale.set(p.locale);
                    t.services.set_locale(p.locale, cx);
                    client.theme.set(p.theme);
                    cx.refresh_windows();
                    cx.emit(crate::windows::main::Saved { show_toast: true });
                }
                cx.notify();
            });
        }));
        cx.notify();
    }
}
impl Render for Settings {
    fn render(&mut self, win: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let c = self.client.palette(win);
        let tr = |k| text(self.client.locale.get(), k);
        let busy = self.busy();
        let changed = self.dirty() && !busy;
        let needs_reload = matches!(self.failure, Some(Failure::Conflict | Failure::Load));
        let can_apply = !needs_reload
            && changed
            && !self.services.invalid_port
            && self.draft.as_ref().is_some_and(|p| p.valid());
        let actions = page_actions()
            .when(self.write.is_some(), |row| {
                row.child(save_status(tr("common.saving"), c))
            })
            .child(
                text_button(
                    "cancel",
                    tr("common.cancel"),
                    c,
                    changed || (!busy && self.failure == Some(Failure::Conflict)),
                )
                .control_size(ControlSize::Large)
                .on_click(cx.listener(|t, _, win, cx| {
                    if matches!(t.failure, Some(Failure::Conflict | Failure::Load)) {
                        t.load_preferences(Box::pin(t.client.preferences()), win, cx);
                    } else {
                        t.reset(win, cx);
                    }
                })),
            )
            .child(
                text_button("save", tr("common.save"), c, can_apply)
                    .control_size(ControlSize::Large)
                    .on_click(cx.listener(|t, _, _, cx| t.save(cx))),
            );
        let mut shell =
            page(c).child(page_title_row(tr("settings.title"), Icon::Settings2, c).child(actions));
        match self.failure {
            Some(Failure::Load) => {
                shell = shell.child(label(tr("settings.loadFailed"))).child(
                    text_button("retry", tr("common.retry"), c, !busy).on_click(cx.listener(
                        |t, _, win, cx| {
                            t.load_preferences(Box::pin(t.client.preferences()), win, cx)
                        },
                    )),
                );
            }
            Some(Failure::Save) => {
                shell = shell.child(label(tr("settings.saveFailed"))).child(
                    text_button("retry", tr("common.retry"), c, can_apply)
                        .on_click(cx.listener(|t, _, _, cx| t.save(cx))),
                );
            }
            Some(Failure::Conflict) => {
                shell = shell.child(label(tr("settings.saveConflict")));
            }
            Some(Failure::Token { field, reveal }) => {
                shell = shell.child(text_button("retry", tr("common.retry"), c, !busy).on_click(
                    cx.listener(move |t, _, win, cx| t.generate_token(field, reveal, win, cx)),
                ));
            }
            None => {}
        }
        let Some(p) = self.draft.as_ref() else {
            return shell;
        };
        let divider = divider_color(c);
        let mut time_group = settings_rows_card(c);
        for (i, k, value, min, max) in [
            (
                0,
                "settings.timelineMergeGapLabel",
                p.timeline_merge_gap_secs / 60,
                1,
                5,
            ),
            (
                1,
                "settings.idleTimeoutLabel",
                p.idle_timeout_secs / 60,
                5,
                30,
            ),
        ] {
            let name = tr(k);
            let mut row = settings_row().id(k).gap(px(8.)).child(
                settings_row_label(name.clone())
                    .font_weight(FontWeight::BOLD)
                    .flex_1(),
            );
            for (dir, symbol) in [(-1, "−"), (1, "+")] {
                if dir == 1 {
                    let s = &self.sliders[i];
                    row = row
                        .child(quietpro::value_slider(s, name.clone(), !busy, c, cx))
                        .child(label(format!("{value} min")).w(px(48.)).text_right());
                }
                row = row.child(
                    IconControl::new(
                        SharedString::from(format!("{k}-{dir}")),
                        format!("{symbol} {name}"),
                        if dir == 1 { Icon::Plus } else { Icon::Minus },
                    )
                    .disabled(busy || !(min..=max).contains(&(value + dir)))
                    .action(
                        c,
                        cx.listener(move |t, _, win, cx| {
                            let next = (value + dir).clamp(min, max);
                            if let Some(p) = &mut t.draft {
                                if i == 0 {
                                    p.timeline_merge_gap_secs = next * 60;
                                } else {
                                    p.idle_timeout_secs = next * 60;
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
        let update_toggle = |set: fn(&mut AppPreferences, bool)| {
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
            quietpro::slide_switch(k, tr(k), on, !busy, c, update_toggle(set))
                .font_weight(FontWeight::BOLD)
                .flex_1()
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
                    quietpro::group_heading(tr(key))
                        .id("group-title")
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
                        .gap(px(SECTION_GROUP_GAP))
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
                .child(
                    settings_row_label(name)
                        .font_weight(FontWeight::BOLD)
                        .flex_1(),
                )
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
            .child(
                settings_row_label(theme_name.clone())
                    .font_weight(FontWeight::BOLD)
                    .flex_1(),
            )
            .child(quietpro::segmented_with_medium_labels(
                ("theme-mode", theme_name),
                std::array::from_fn::<_, 3, _>(|i| {
                    let (theme, key) = theme_options[i];
                    (theme, tr(key), None, self.theme_focus[i].clone())
                }),
                p.theme,
                !busy,
                c,
                ControlSize::Medium,
                move |theme, _, cx| {
                    let _ = view.update(cx, |t, cx| {
                        if let Some(p) = &mut t.draft {
                            p.theme = theme;
                            t.client.theme.set(theme);
                            cx.refresh_windows();
                        }
                    });
                },
            ));
        let themes = settings_rows_card(c).child(theme_row).child(line_above(
            self.scheme_row(c, win, cx),
            c,
            0.,
        ));
        let language_label =
            patina_i18n::messages::settings_language_label(self.client.locale.get());
        let view = cx.weak_entity();
        let langs = choice_row(language_label.clone()).child(
            quietpro::Dropdown::new(
                "language-select",
                language_label,
                Locale::ALL.iter().map(|&locale| (locale, locale.label())),
                p.locale,
                c,
                move |locale, _, cx| {
                    let _ = view.update(cx, |t, cx| {
                        if let Some(p) = &mut t.draft {
                            p.locale = locale;
                        }
                        t.client.locale.set(locale);
                        t.services.set_locale(locale, cx);
                        cx.refresh_windows();
                    });
                },
            )
            .trigger_size(ControlSize::Medium)
            .value_typography(px(12.), FontWeight::MEDIUM)
            .selected_option_color(c.text)
            .fit_trigger_to_value()
            .disabled(busy),
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
                    crate::windows::main::page_width(win.viewport_size().width),
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

impl gpui_kit::EventEmitter<crate::windows::main::Saved> for Settings {}

impl gpui_kit::EventEmitter<crate::windows::main::Feedback> for Settings {}
