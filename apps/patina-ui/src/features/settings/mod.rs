use crate::windows::main::scale;
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
    scale_slider: Entity<SliderState>,
    scale_focus: FocusHandle,
    scale_pointer: bool,
    theme_focus: [FocusHandle; 3],
    scheme_triggers: [FocusHandle; 2],
    picker: Option<schemes::Picker>,
    failure: Option<Failure>,
    services: ServiceFields,
}
impl Settings {
    fn set_slider_draft(&mut self, state: &Entity<SliderState>, value: f32) {
        if let Some(p) = &mut self.draft {
            if state == &self.scale_slider {
                p.window_scale = value as u16;
            } else if state == &self.sliders[0] {
                p.timeline_merge_gap_secs = value as i64 * 60;
            } else {
                p.idle_timeout_secs = value as i64 * 60;
            }
        }
    }
    fn slider_row(
        &self,
        key: &'static str,
        state: &Entity<SliderState>,
        formatted: String,
        enabled: bool,
        win: &Window,
        cx: &Context<Self>,
    ) -> Stateful<Div> {
        let c = self.client.palette(win);
        let name = text(self.client.locale.get(), key);
        let value = state.read(cx).value().end();
        let is_scale = state == &self.scale_slider;
        let step = |direction: i32| {
            let state = state.clone();
            let (symbol, icon, at_limit) = if direction < 0 {
                ("−", Icon::Minus, value <= state.read(cx).min_value())
            } else {
                ("+", Icon::Plus, value >= state.read(cx).max_value())
            };
            IconControl::new(
                SharedString::from(format!("{key}-{direction}")),
                format!("{symbol} {name}"),
                icon,
            )
            .disabled(!enabled || at_limit)
            .action(
                c,
                cx.listener(move |settings, _, win, cx| {
                    let next = state.update(cx, |s, cx| {
                        let next = (s.value().end() + direction as f32)
                            .clamp(s.min_value(), s.max_value());
                        s.set_value(next, win, cx);
                        next
                    });
                    settings.set_slider_draft(&state, next);
                    if is_scale {
                        scale::preview(win, next as u16);
                    }
                    cx.notify();
                }),
            )
        };
        let slider = quietpro::value_slider(state, name.clone(), enabled, c, cx)
            .when(is_scale && enabled, |s| {
                s.track_focus(&self.scale_focus.clone().tab_stop(true))
            });
        let track = div()
            .id("slider-input")
            .relative()
            .flex_none()
            .when(is_scale && enabled, |d| {
                d.capture_any_mouse_down(cx.listener(|s, event: &MouseDownEvent, win, cx| {
                    // The thumb consumes the bubbling press before the track sees it.
                    if event.button == MouseButton::Left {
                        s.scale_pointer = true;
                        win.focus(&s.scale_focus, cx);
                    }
                }))
                .on_mouse_up(
                    MouseButton::Left,
                    cx.listener(|s, _, _, _| s.scale_pointer = false),
                )
                .on_mouse_up_out(
                    MouseButton::Left,
                    cx.listener(|s, _, _, _| s.scale_pointer = false),
                )
                .on_key_down(cx.listener(|s, event: &KeyDownEvent, win, cx| {
                    let delta = match event.keystroke.key.as_str() {
                        "left" | "down" => -1.,
                        "right" | "up" => 1.,
                        "home" => -100.,
                        "end" => 100.,
                        _ => return,
                    };
                    s.scale_pointer = false;
                    s.scale_slider
                        .update(cx, |state, cx| state.step_thumb(false, delta, win, cx));
                    cx.stop_propagation();
                }))
            })
            .child(slider)
            .when(
                is_scale
                    && enabled
                    && self.scale_focus.is_focused(win)
                    && win.last_input_was_keyboard(),
                |d| {
                    d.child(
                        div()
                            .absolute()
                            .inset_0()
                            .rounded(px(4.))
                            .border_1()
                            .border_color(c.secondary),
                    )
                },
            );
        settings_row()
            .id(key)
            .gap(px(8.))
            .child(
                settings_row_label(name.clone())
                    .font_weight(FontWeight::BOLD)
                    .flex_1(),
            )
            .child(step(-1))
            .child(track)
            .child(label(formatted).w(px(48.)).text_right())
            .child(step(1))
    }
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
            cx.subscribe(&state, |this: &mut Self, state, event: &SliderEvent, cx| {
                if let SliderEvent::Change(SliderValue::Single(v)) = event {
                    this.set_slider_draft(&state, *v);
                    cx.notify();
                }
            })
            .detach();
            state
        });
        let scale_slider =
            cx.new(|_| Self::scale_state(scale::limit(win), client.window_scale.get()));
        cx.subscribe_in(
            &scale_slider,
            win,
            |s: &mut Self, _, event: &SliderEvent, win, cx| {
                let (SliderEvent::Change(SliderValue::Single(value))
                | SliderEvent::Release(SliderValue::Single(value))) = event
                else {
                    return;
                };
                if let Some(p) = &mut s.draft {
                    p.window_scale = *value as u16;
                    if matches!(event, SliderEvent::Release(_))
                        || (!s.scale_pointer && !win.last_input_was_touch())
                    {
                        s.scale_pointer = false;
                        scale::preview(win, p.window_scale);
                    }
                    cx.notify();
                }
            },
        )
        .detach();
        let services = ServiceFields::new(win, cx);
        let handle = win.window_handle();
        cx.on_release(move |s, cx| {
            if let Some(saved) = &s.saved {
                if s.draft
                    .as_ref()
                    .is_some_and(|p| p.window_scale != saved.window_scale)
                {
                    let percent = saved.window_scale;
                    cx.defer(move |cx| {
                        let _ = handle.update(cx, |_, win, _| scale::preview(win, percent));
                    });
                }
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
            scale_slider,
            scale_focus: cx.focus_handle(),
            scale_pointer: false,
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
    fn scale_state(limit: u16, percent: u16) -> SliderState {
        SliderState::new()
            .min(f32::from(AppPreferences::MIN_SCALE.min(limit)))
            .max(f32::from(limit))
            .step(1.)
            .default_value(f32::from(percent.min(limit)))
    }
    pub(crate) fn window_resized(
        &mut self,
        percent: u16,
        win: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if self.busy() {
            scale::preview(
                win,
                self.draft
                    .as_ref()
                    .map_or(self.client.window_scale.get(), |p| p.window_scale),
            );
            return;
        }
        if let Some(p) = &mut self.draft {
            p.window_scale = percent;
            self.scale_slider
                .update(cx, |s, cx| s.set_value(f32::from(percent), win, cx));
            cx.notify();
        }
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
            self.client.window_scale.set(p.window_scale);
            let limit = scale::limit(win);
            self.scale_slider.update(cx, |s, cx| {
                s.set_value(f32::from(p.window_scale.min(limit)), win, cx)
            });
            scale::preview(win, p.window_scale);
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
                    client.window_scale.set(p.window_scale);
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
        for (i, k, value) in [
            (
                0,
                "settings.timelineMergeGapLabel",
                p.timeline_merge_gap_secs / 60,
            ),
            (1, "settings.idleTimeoutLabel", p.idle_timeout_secs / 60),
        ] {
            let row = self.slider_row(k, &self.sliders[i], format!("{value} min"), !busy, win, cx);
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
            settings_row().gap(px(8.)).items_center().child(
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
        let limit = scale::limit(win);
        if self.scale_slider.read(cx).max_value() != f32::from(limit) {
            self.scale_slider
                .update(cx, |s, _| *s = Self::scale_state(limit, p.window_scale));
        }
        let percent = self.scale_slider.read(cx).value().end() as u16;
        let enabled = !busy
            && !win.is_maximized()
            && !win.is_fullscreen()
            && limit > AppPreferences::MIN_SCALE;
        let scale_row = self.slider_row(
            "settings.windowScale",
            &self.scale_slider,
            format!("{percent}%"),
            enabled,
            win,
            cx,
        );
        let interface = settings_rows_card(c)
            .child(langs.border_b_1().border_color(divider))
            .child(scale_row);
        let appearance = section(
            settings_title(c, Icon::Palette, tr("settings.appearanceTitle")),
            [
                settings_group("settings.themeGroupTitle", themes),
                settings_group("settings.interfaceGroupTitle", interface),
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
