use crate::{client::Client, features::page_controls::label};
use gpui_kit::base::input::{InputAccessibility, InputEvent, InputState};
use gpui_kit::{prelude::*, *};
use patina_desktop_protocol::FromReply;

use patina_desktop_protocol::tools::{Control, Installed, Preview};
use patina_desktop_protocol::tools::{ToolCall, call};
use patina_i18n::text;
use quietpro::{content_card, page, page_actions, page_title_row};
use std::{path::PathBuf, rc::Rc};

#[derive(Clone)]
enum Confirm {
    Install(PathBuf, Preview),
    Remove(Installed, Vec<String>),
}

fn tool_name(id: &str, fallback: &str, locale: patina_activity_model::Locale) -> String {
    match id {
        "patina.focus" => text(locale, "tools.pomodoroTitle"),
        "patina.reminders" => text(locale, "tools.remindersTitle"),
        _ => fallback.to_owned(),
    }
}

pub(crate) struct Tools {
    client: Rc<Client>,
    tools: Vec<Installed>,
    selected: Option<Installed>,
    controls: Vec<Control>,
    inputs: std::collections::BTreeMap<String, Entity<InputState>>,
    choices: std::collections::BTreeMap<String, String>,
    manager: bool,
    preferences: Option<patina_activity_model::NoticePreferences>,
    delivery_focus: [FocusHandle; 2],
    sound_focus: [FocusHandle; 4],
    target: Option<patina_activity_model::ToolTarget>,
    pending: Option<Confirm>,
    modal_focus: Option<FocusHandle>,
    section_focus: Vec<FocusHandle>,
    pub(crate) labels: bool,
    manager_focus: FocusHandle,
    confirm_focus: FocusHandle,
    cancel_focus: FocusHandle,
    busy: bool,
    refresh_pending: bool,
    display_failed: bool,
    error: Option<String>,
}

impl Tools {
    pub fn new(
        client: Rc<Client>,
        target: Option<patina_activity_model::ToolTarget>,
        labels: bool,
        cx: &mut Context<Self>,
    ) -> Self {
        let mut page = Self {
            client,
            tools: Vec::new(),
            selected: None,
            controls: Vec::new(),
            inputs: Default::default(),
            choices: Default::default(),
            manager: false,
            preferences: None,
            delivery_focus: std::array::from_fn(|_| cx.focus_handle()),
            sound_focus: std::array::from_fn(|_| cx.focus_handle()),
            target,
            pending: None,
            modal_focus: None,
            section_focus: Vec::new(),
            labels,
            manager_focus: cx.focus_handle(),
            confirm_focus: cx.focus_handle(),
            cancel_focus: cx.focus_handle(),
            busy: false,
            refresh_pending: false,
            display_failed: false,
            error: None,
        };
        page.list(cx);
        page
    }

    fn run<T: FromReply + 'static>(
        &mut self,
        request: ToolCall<T>,
        done: impl FnOnce(&mut Self, T, &mut Context<Self>) + 'static,
        cx: &mut Context<Self>,
    ) {
        if self.busy {
            return;
        }
        self.busy = true;
        self.error = None;
        let result = self.client.tool(request);
        cx.spawn(async move |view, cx| {
            let result = result.await;
            let _ = view.update(cx, |this, cx| {
                this.busy = false;
                match result {
                    Ok(data) => done(this, data, cx),
                    Err(e) => this.error = Some(e),
                }
                if !this.busy && std::mem::take(&mut this.refresh_pending) {
                    this.background_refresh(cx);
                }
                cx.notify();
            });
        })
        .detach();
        cx.notify();
    }

    fn list(&mut self, cx: &mut Context<Self>) {
        self.run(
            call::list(),
            |this, (mut tools, failed, last): (Vec<Installed>, bool, Option<String>), cx| {
                tools.sort_by_key(|tool| match tool.manifest.id.as_str() {
                    "patina.reminders" => 0,
                    "patina.focus" => 1,
                    _ => 2,
                });
                this.display_failed = failed;
                let target = this.target.take();
                let preferred = target
                    .map(|t| t.id())
                    .or_else(|| this.selected.as_ref().map(|p| p.manifest.id.as_str()))
                    .or(last.as_deref());
                if target.is_some()
                    && !tools
                        .iter()
                        .any(|t| Some(t.manifest.id.as_str()) == preferred)
                {
                    this.manager = true;
                }
                this.selected = tools
                    .iter()
                    .find(|p| Some(p.manifest.id.as_str()) == preferred)
                    .or_else(|| tools.first())
                    .cloned();
                this.section_focus
                    .resize_with(tools.len(), || cx.focus_handle());
                this.tools = tools;
                if !this.manager {
                    this.load(None, cx);
                }
            },
            cx,
        );
    }

    pub fn background_refresh(&mut self, cx: &mut Context<Self>) {
        if self.pending.is_some() || self.manager || self.preferences.is_some() {
            return;
        }
        if self.busy {
            self.refresh_pending = true;
            return;
        }
        let Some(t) = &self.selected else {
            return;
        };
        self.run(
            call::panel(t.manifest.id.clone(), t.generation.clone(), None, false),
            |t, controls, _| {
                t.controls = controls;
            },
            cx,
        );
    }

    fn load(&mut self, action: Option<String>, cx: &mut Context<Self>) {
        let Some(tool) = &self.selected else {
            self.controls.clear();
            return;
        };
        let remember = action.is_none();
        let request = call::panel(
            tool.manifest.id.clone(),
            tool.generation.clone(),
            action,
            remember,
        );
        self.run(
            request,
            |this, controls, _| {
                this.inputs.clear();
                this.choices.clear();
                this.controls = controls;
            },
            cx,
        );
    }

    fn choose(&mut self, cx: &mut Context<Self>) {
        let picked = cx.prompt_for_paths(PathPromptOptions {
            files: true,
            directories: false,
            multiple: false,
            prompt: Some(text(self.client.locale.get(), "tools.install").into()),
        });
        self.busy = true;
        self.error = None;
        cx.notify();
        cx.spawn(async move |view, cx| {
            let result = picked.await;
            let _ = view.update(cx, |this, cx| {
                this.busy = false;
                match result {
                    Ok(Ok(Some(paths))) => {
                        if let Some(path) = paths.into_iter().next() {
                            this.run(
                                call::inspect(path.clone()),
                                move |t, preview, _| {
                                    t.pending = Some(Confirm::Install(path, preview));
                                },
                                cx,
                            );
                        }
                    }
                    Ok(Err(e)) => this.error = Some(e.to_string()),
                    Err(e) => this.error = Some(e.to_string()),
                    Ok(Ok(None)) => (),
                }
                cx.notify();
            });
        })
        .detach();
    }

    fn confirm(&mut self, cx: &mut Context<Self>) {
        match self.pending.take() {
            Some(Confirm::Install(path, preview)) => self.run(
                call::install(path, preview),
                |this, tool: Installed, cx| {
                    this.manager = false;
                    this.selected = Some(tool);
                    this.list(cx);
                },
                cx,
            ),
            Some(Confirm::Remove(tool, _)) => self.run(
                call::uninstall(tool.manifest.id, tool.generation),
                |this, (): (), cx| {
                    this.controls.clear();
                    this.list(cx);
                },
                cx,
            ),
            None => (),
        }
    }
}

impl Render for Tools {
    fn render(&mut self, win: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let colors = self.client.palette(win);
        let locale = self.client.locale.get();
        let tr = |key| text(locale, key);
        let ready = !self.busy && self.pending.is_none();
        let mut content = content_card(colors.border, colors.panel).gap(px(12.));
        let manager = quietpro::text_button("tool-manager", tr("tools.manager"), colors, ready)
            .track_focus(&self.manager_focus)
            .on_click(cx.listener(|this, _, _, cx| {
                this.manager = !this.manager;
                this.preferences = None;
                this.list(cx);
            }));
        let preferences =
            quietpro::text_button("tool-settings", tr("tools.settingsTitle"), colors, ready)
                .on_click(cx.listener(|t, _, _, cx| {
                    if t.preferences.take().is_some() {
                        cx.notify();
                    } else {
                        t.run(call::preferences(), |t, p, _| t.preferences = Some(p), cx);
                    }
                }));
        let selected = self.selected.as_ref().and_then(|selected| {
            self.tools
                .iter()
                .position(|tool| tool.manifest.id == selected.manifest.id)
        });
        let view = cx.weak_entity();
        let selector = quietpro::section_rail(
            ("tool-select", tr("tools.title")),
            self.tools.iter().enumerate().map(|(index, tool)| {
                (
                    index,
                    tool_name(&tool.manifest.id, &tool.manifest.name, locale),
                    Some(match tool.manifest.id.as_str() {
                        "patina.reminders" => quietpro::Icon::Bell,
                        "patina.focus" => quietpro::Icon::Clock,
                        _ => quietpro::Icon::ToolCase,
                    }),
                    self.section_focus[index].clone(),
                )
            }),
            selected
                .filter(|_| !self.manager && self.preferences.is_none())
                .unwrap_or(usize::MAX),
            ready,
            colors,
            self.labels,
            move |index, _, cx| {
                let _ = view.update(cx, |this, cx| {
                    if this.busy || this.pending.is_some() {
                        return;
                    }
                    this.manager = false;
                    this.preferences = None;
                    let Some(tool) = this.tools.get(index) else {
                        return;
                    };
                    this.selected = Some(tool.clone());
                    this.controls.clear();
                    this.load(None, cx);
                });
            },
        );
        let top = page_title_row(tr("tools.title"), quietpro::Icon::ToolCase, colors)
            .child(page_actions().child(manager).child(preferences));
        if let Some(p) = &self.preferences {
            use patina_activity_model::{
                NoticeDelivery as D, NoticePreferencesPatch as Patch, NoticeSound as S,
            };
            content = content.child(label(tr("tools.notificationDelivery")));
            let delivery_options = [
                (D::Notification, "tools.notificationSoftware"),
                (D::Dialog, "tools.notificationDialog"),
            ];
            let view = cx.weak_entity();
            content = content.child(div().flex().child(quietpro::segmented(
                "notification-delivery",
                tr("tools.notificationDelivery"),
                std::array::from_fn::<_, 2, _>(|i| {
                    let (value, key) = delivery_options[i];
                    (value, tr(key), None, self.delivery_focus[i].clone())
                }),
                p.delivery,
                ready,
                colors,
                move |d, _, cx| {
                    let _ = view.update(cx, |t, cx| {
                        if t.preferences.as_ref().is_some_and(|p| p.delivery != d) {
                            t.run(
                                call::save_preferences(Patch {
                                    delivery: Some(d),
                                    sound: None,
                                }),
                                |t, p, _| t.preferences = Some(p),
                                cx,
                            );
                        }
                    });
                },
            )));
            content = content.child(label(tr("tools.notificationSound")));
            let sound_options = [
                (S::Default, "tools.notificationSoundDefault"),
                (S::Bell, "tools.notificationSoundBell"),
                (S::Clear, "tools.notificationSoundClear"),
                (S::None, "tools.notificationSoundNone"),
            ];
            let view = cx.weak_entity();
            content = content.child(div().flex().child(quietpro::segmented(
                "notification-sound",
                tr("tools.notificationSound"),
                std::array::from_fn::<_, 4, _>(|i| {
                    let (value, key) = sound_options[i];
                    (value, tr(key), None, self.sound_focus[i].clone())
                }),
                p.sound,
                ready,
                colors,
                move |s, _, cx| {
                    let _ = view.update(cx, |t, cx| {
                        if t.preferences.as_ref().is_some_and(|p| p.sound != s) {
                            t.run(
                                call::save_preferences(Patch {
                                    delivery: None,
                                    sound: Some(s),
                                }),
                                |t, p, _| t.preferences = Some(p),
                                cx,
                            );
                        }
                    });
                },
            )));
        } else if self.manager || self.tools.is_empty() {
            if self.tools.is_empty() && !self.busy {
                content = content.child(label(tr("tools.empty")));
            }
            if !self.tools.is_empty() || !self.busy {
                content = content.child({
                    let accessible_name = tr("tools.install");
                    quietpro::text_button("install-tool", tr("tools.install"), colors, ready)
                        .accessibility_label(accessible_name)
                        .on_click(cx.listener(|t, _, _, cx| t.choose(cx)))
                });
            }
            for tool in &self.tools {
                let tool = tool.clone();
                let title = tool_name(&tool.manifest.id, &tool.manifest.name, locale);
                content = content.child(
                    div()
                        .flex()
                        .gap(px(8.))
                        .items_center()
                        .child(label(title.clone()))
                        .child({
                            let accessible_name = format!("{} {}", tr("tools.uninstall"), title);
                            quietpro::text_button(
                                SharedString::from(format!("remove-{}", tool.manifest.id)),
                                tr("tools.uninstall"),
                                colors,
                                ready,
                            )
                            .accessibility_label(accessible_name)
                            .on_click(cx.listener(
                                move |t, _, _, cx| {
                                    let selected = tool.clone();
                                    t.run(
                                        call::stopping(
                                            tool.manifest.id.clone(),
                                            tool.generation.clone(),
                                        ),
                                        move |t, labels, cx| {
                                            t.pending = Some(Confirm::Remove(selected, labels));
                                            cx.notify();
                                        },
                                        cx,
                                    );
                                },
                            ))
                        }),
                );
            }
            for id in patina_desktop_protocol::tools::BUNDLED_IDS {
                if !self.tools.iter().any(|p| p.manifest.id == id) {
                    let title =
                        format!("{} · {}", tr("tools.reinstall"), tool_name(id, id, locale));
                    content = content.child({
                        let accessible_name = title.clone();
                        quietpro::text_button(id, title, colors, ready)
                            .accessibility_label(accessible_name)
                            .on_click(cx.listener(move |t, _, _, cx| {
                                t.run(
                                    call::restore(id.into()),
                                    |t, tool: Installed, cx| {
                                        t.selected = Some(tool);
                                        t.manager = false;
                                        t.list(cx);
                                    },
                                    cx,
                                );
                            }))
                    });
                }
            }
        } else {
            if let Some(tool) = &self.selected {
                content = content.child(quietpro::heading(tool_name(
                    &tool.manifest.id,
                    &tool.manifest.name,
                    locale,
                )));
            }
            for (index, control) in self.controls.iter().enumerate() {
                content = match control {
                    Control::Text(s) => content.child(label(s.clone()).id(("tool-text", index))),
                    Control::Clock {
                        label: title,
                        anchor_ms,
                        counting_up,
                    } => {
                        let now = patina_desktop_protocol::tools::now_ms();
                        let seconds = (if *counting_up {
                            now.saturating_sub(*anchor_ms)
                        } else {
                            anchor_ms.saturating_sub(now)
                        })
                        .max(0)
                            / 1000;
                        content.child(
                            label(format!("{title} · {:02}:{:02}", seconds / 60, seconds % 60))
                                .id(("tool-clock", index)),
                        )
                    }
                    Control::Select {
                        id,
                        label: name,
                        value,
                        choices,
                    } => {
                        let selected = self
                            .choices
                            .entry(id.clone())
                            .or_insert_with(|| value.clone())
                            .clone();
                        let mut row = div().flex().flex_wrap().gap(px(4.));
                        for (val, display) in choices {
                            let field = id.clone();
                            let val = val.clone();
                            row = row.child({
                                let accessible_name = display.clone();
                                quietpro::text_button(
                                    SharedString::from(format!("choice-{id}-{val}")),
                                    display.clone(),
                                    colors,
                                    ready && val != selected,
                                )
                                .accessibility_label(accessible_name)
                                .on_click(cx.listener(
                                    move |t, _, _, cx| {
                                        t.choices.insert(field.clone(), val.clone());
                                        cx.notify();
                                    },
                                ))
                            });
                        }
                        content
                            .child(label(name.clone()).id(("tool-choice", index)))
                            .child(row)
                    }
                    Control::Input {
                        id,
                        label: name,
                        value,
                    } => {
                        let input = self.inputs.entry(id.clone()).or_insert_with(|| {
                            let input = cx.new(|cx| {
                                let mut input = InputState::new(win, cx);
                                input.set_accessibility(
                                    InputAccessibility::new(Some(Role::TextInput))
                                        .with_label(Some(name.clone().into())),
                                );
                                input.set_value(value.clone(), win, cx);
                                input
                            });
                            cx.subscribe(&input, |_, _, event, cx| {
                                if matches!(event, InputEvent::Focus | InputEvent::Blur) {
                                    cx.notify();
                                }
                            })
                            .detach();
                            input
                        });
                        content
                            .child(label(name.clone()).id(("tool-field", index)))
                            .child(
                                div().flex().flex_none().child(
                                    quietpro::TextInput::new(
                                        SharedString::from(format!("tool-input-{id}")),
                                        input,
                                        colors,
                                    )
                                    .disabled(!ready),
                                ),
                            )
                    }
                    Control::Submit { id, label: name } => {
                        let button = id.clone();
                        content.child({
                            let accessible_name = name.clone();
                            quietpro::text_button(
                                SharedString::from(format!("submit-{id}")),
                                name.clone(),
                                colors,
                                ready,
                            )
                            .accessibility_label(accessible_name)
                            .on_click(cx.listener(
                                move |t, _, _, cx| {
                                    if let Some(tool) = &t.selected {
                                        let mut fields = t.choices.clone();
                                        fields.extend(t.inputs.iter().map(|(k, v)| {
                                            (k.clone(), v.read(cx).value().to_string())
                                        }));
                                        let request = call::submit(
                                            tool.manifest.id.clone(),
                                            tool.generation.clone(),
                                            button.clone(),
                                            fields,
                                        );
                                        t.run(
                                            request,
                                            |t, controls, _| {
                                                t.controls = controls;
                                                t.inputs.clear();
                                                t.choices.clear();
                                            },
                                            cx,
                                        );
                                    }
                                },
                            ))
                        })
                    }
                    Control::Button { id, label: name } => {
                        let id = id.clone();
                        content.child({
                            let accessible_name = name.clone();
                            quietpro::text_button(
                                SharedString::from(format!("plugin-action-{id}")),
                                name.clone(),
                                colors,
                                ready,
                            )
                            .accessibility_label(accessible_name)
                            .on_click(cx.listener(move |t, _, _, cx| t.load(Some(id.clone()), cx)))
                        })
                    }
                };
            }
        }
        if let Some(error) = &self.error {
            content = content.child(label(error.clone())).child({
                let accessible_name = tr("common.retry");
                quietpro::text_button("retry-tools", tr("common.retry"), colors, ready)
                    .accessibility_label(accessible_name)
                    .on_click(cx.listener(|t, _, _, cx| t.list(cx)))
            });
        }
        if self.busy {
            content = content.child(label(tr("common.loading")));
        }
        if self.display_failed {
            content = content
                .child(label(tr("tools.notificationDisplayFailed")))
                .child({
                    let accessible_name = tr("common.retry");
                    quietpro::text_button("retry-notice", tr("common.retry"), colors, ready)
                        .accessibility_label(accessible_name)
                        .on_click(cx.listener(|t, _, _, cx| {
                            t.run(call::retry_display(), |t, (): (), cx| t.list(cx), cx)
                        }))
                });
        }
        let panel = div()
            .id("tool-panel")
            .flex_1()
            .min_w_0()
            .min_h_0()
            .overflow_y_scroll()
            .child(content);
        let workspace = div()
            .flex()
            .flex_1()
            .min_h_0()
            .gap(px(quietpro::APP_CARD_GAP))
            .when(!self.tools.is_empty(), |this| {
                this.child(
                    div()
                        .id("tool-sections")
                        .flex_none()
                        .min_h_0()
                        .overflow_y_scroll()
                        .child(selector),
                )
            })
            .child(panel);
        let shell = page(colors).child(top).child(workspace);
        if let Some(confirm) = &self.pending {
            let mut content = div()
                .id("tool-consent-body")
                .flex()
                .flex_col()
                .min_h_0()
                .gap(px(12.))
                .overflow_y_scroll();
            match confirm {
                Confirm::Install(path, preview) => {
                    content = content
                        .child(label(format!(
                            "{} · {}",
                            preview.manifest.name, preview.manifest.version
                        )))
                        .child(label(preview.manifest.id.clone()))
                        .child(label(format!("Ed25519 · {}", preview.publisher)))
                        .child(label(path.display().to_string()))
                        .child(label(tr("tools.panelAccess")));
                    if preview
                        .manifest
                        .capabilities
                        .contains(&patina_desktop_protocol::tools::Capability::Timer)
                    {
                        content = content.child(label(tr("tools.timerAccess")));
                    }
                }
                Confirm::Remove(tool, stopping) => {
                    content = content
                        .child(label(tool_name(
                            &tool.manifest.id,
                            &tool.manifest.name,
                            locale,
                        )))
                        .child(label(tr("tools.retain")));
                    for (i, name) in stopping.iter().enumerate() {
                        content = content.child(label(name.clone()).id(("stopping", i)));
                    }
                }
            }
            let actions = quietpro::dialog_actions()
                .child(
                    quietpro::text_button("cancel-tool", tr("common.cancel"), colors, true)
                        .on_click(cx.listener(|t, _, win, cx| {
                            win.focus(&t.manager_focus, cx);
                            t.pending = None;
                            cx.notify();
                        }))
                        .track_focus(&self.cancel_focus),
                )
                .child(
                    quietpro::text_button("confirm-tool", tr("common.confirm"), colors, true)
                        .on_click(cx.listener(|t, _, win, cx| {
                            win.focus(&t.manager_focus, cx);
                            t.confirm(cx);
                        }))
                        .track_focus(&self.confirm_focus),
                );
            let content = quietpro::dialog_surface(colors, win.viewport_size())
                .max_w((win.viewport_size().width - px(48.)).min(px(640.)))
                .child(content)
                .child(actions);
            let focus = self
                .modal_focus
                .get_or_insert_with(|| {
                    let f = cx.focus_handle();
                    win.focus(&f, cx);
                    f
                })
                .clone();
            let weak = cx.weak_entity();
            let keyboard = weak.clone();
            return shell.child(
                gpui_kit::base::Dialog::new(cx)
                    .focus_handle(focus)
                    .accessibility_label(tr("tools.manager"))
                    .on_ok(move |_, win, cx| {
                        let _ = keyboard.update(cx, |t, cx| {
                            if t.confirm_focus.is_focused(win) {
                                win.focus(&t.manager_focus, cx);
                                t.confirm(cx);
                            } else if t.cancel_focus.is_focused(win) {
                                t.pending = None;
                                win.focus(&t.manager_focus, cx);
                                cx.notify();
                            }
                        });
                        false
                    })
                    .backdrop(quietpro::dialog_backdrop())
                    .popup(gpui_kit::base::DialogPopup::new().child(content.id("tool-consent")))
                    .on_open_change(move |open, _, win, cx| {
                        if !open {
                            let _ = weak.update(cx, |t, cx| {
                                t.pending = None;
                                win.focus(&t.manager_focus, cx);
                                cx.notify();
                            });
                        }
                    }),
            );
        }
        self.modal_focus = None;
        shell
    }
}
