use crate::{
    page_controls::{action, content_card, label, page, page_actions, page_title_row, panel},
    tool_service::ToolRequest,
    window_process::Query,
    windows_host::Client,
};
use gpui_kit::base::{
    Input,
    input::{InputAccessibility, InputState},
};
use gpui_kit::{prelude::*, *};
use patina_recorder::text;
use patina_tool_host::{Control, Installed, Preview};
use serde::de::DeserializeOwned;
use std::{path::PathBuf, rc::Rc};

#[derive(Clone)]
enum Confirm {
    Install(PathBuf, Preview),
    Remove(Installed, Vec<String>),
}

fn tool_name(id: &str, fallback: &str, locale: patina_recorder::Locale) -> String {
    match id {
        "patina.focus" => text(locale, "tools.pomodoroTitle"),
        "patina.reminders" => text(locale, "tools.remindersTitle"),
        _ => fallback.to_owned(),
    }
}

pub(super) struct Tools {
    client: Rc<Client>,
    tools: Vec<Installed>,
    selected: Option<Installed>,
    controls: Vec<Control>,
    inputs: std::collections::BTreeMap<String, Entity<InputState>>,
    choices: std::collections::BTreeMap<String, String>,
    manager: bool,
    preferences: Option<patina_recorder::NoticePreferences>,
    target: Option<patina_recorder::ToolTarget>,
    pending: Option<Confirm>,
    modal_focus: Option<FocusHandle>,
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
        target: Option<patina_recorder::ToolTarget>,
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
            target,
            pending: None,
            modal_focus: None,
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

    fn run<T: DeserializeOwned + 'static>(
        &mut self,
        request: ToolRequest,
        done: impl FnOnce(&mut Self, T, &mut Context<Self>) + 'static,
        cx: &mut Context<Self>,
    ) {
        if self.busy {
            return;
        }
        self.busy = true;
        self.error = None;
        let result = self.client.request(Query::Tools(request));
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
            ToolRequest::List,
            |this, (tools, failed): (Vec<Installed>, bool), cx| {
                this.display_failed = failed;
                let target = this.target.take();
                let preferred = target
                    .map(|t| t.id())
                    .or_else(|| this.selected.as_ref().map(|p| p.manifest.id.as_str()));
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
            ToolRequest::Panel {
                id: t.manifest.id.clone(),
                generation: t.generation.clone(),
                action: None,
            },
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
        let request = ToolRequest::Panel {
            id: tool.manifest.id.clone(),
            generation: tool.generation.clone(),
            action,
        };
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
                                ToolRequest::Inspect(path.clone()),
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
                ToolRequest::Install(path, preview),
                |this, tool: Installed, cx| {
                    this.manager = false;
                    this.selected = Some(tool);
                    this.list(cx);
                },
                cx,
            ),
            Some(Confirm::Remove(tool, _)) => self.run(
                ToolRequest::Uninstall {
                    id: tool.manifest.id,
                    generation: tool.generation,
                },
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
        let mut content = content_card(colors.border, colors.panel).gap(px(10.));
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
                        t.run(
                            ToolRequest::Preferences,
                            |t, p, _| t.preferences = Some(p),
                            cx,
                        );
                    }
                }));
        let top = page_title_row(tr("tools.title"), quietpro::Icon::ToolCase, colors)
            .child(page_actions().child(manager).child(preferences));
        let mut rail = content_card(colors.border, colors.panel)
            .w(px(165.))
            .gap(px(6.));
        for tool in &self.tools {
            let tool = tool.clone();
            let title = tool_name(&tool.manifest.id, &tool.manifest.name, locale);
            rail = rail.child(action(
                SharedString::from(tool.manifest.id.clone()),
                title.clone(),
                title,
                ready,
                cx.listener(move |this, _, _, cx| {
                    this.manager = false;
                    this.preferences = None;
                    this.selected = Some(tool.clone());
                    this.controls.clear();
                    this.load(None, cx);
                }),
            ));
        }
        if let Some(p) = &self.preferences {
            use patina_recorder::{
                NoticeDelivery as D, NoticePreferencesPatch as Patch, NoticeSound as S,
            };
            content = content.child(label(tr("tools.notificationDelivery")));
            for (d, key) in [
                (D::Notification, "tools.notificationSoftware"),
                (D::Dialog, "tools.notificationDialog"),
            ] {
                content = content.child(action(
                    key,
                    tr(key),
                    tr(key),
                    ready && d != p.delivery,
                    cx.listener(move |t, _, _, cx| {
                        t.run(
                            ToolRequest::SavePreferences(Patch {
                                delivery: Some(d),
                                sound: None,
                            }),
                            |t, p, _| t.preferences = Some(p),
                            cx,
                        );
                    }),
                ));
            }
            content = content.child(label(tr("tools.notificationSound")));
            for (s, key) in [
                (S::Default, "tools.notificationSoundDefault"),
                (S::Bell, "tools.notificationSoundBell"),
                (S::Clear, "tools.notificationSoundClear"),
                (S::None, "tools.notificationSoundNone"),
            ] {
                content = content.child(action(
                    key,
                    tr(key),
                    tr(key),
                    ready && s != p.sound,
                    cx.listener(move |t, _, _, cx| {
                        t.run(
                            ToolRequest::SavePreferences(Patch {
                                delivery: None,
                                sound: Some(s),
                            }),
                            |t, p, _| t.preferences = Some(p),
                            cx,
                        );
                    }),
                ));
            }
        } else if self.manager || self.tools.is_empty() {
            if self.tools.is_empty() && !self.busy {
                content = content.child(label(tr("tools.empty")));
            }
            if !self.tools.is_empty() || !self.busy {
                content = content.child(action(
                    "install-tool",
                    tr("tools.install"),
                    tr("tools.install"),
                    ready,
                    cx.listener(|t, _, _, cx| t.choose(cx)),
                ));
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
                        .child(action(
                            SharedString::from(format!("remove-{}", tool.manifest.id)),
                            format!("{} {}", tr("tools.uninstall"), title),
                            tr("tools.uninstall"),
                            ready,
                            cx.listener(move |t, _, _, cx| {
                                let selected = tool.clone();
                                t.run(
                                    ToolRequest::Stopping(
                                        tool.manifest.id.clone(),
                                        tool.generation.clone(),
                                    ),
                                    move |t, labels, cx| {
                                        t.pending = Some(Confirm::Remove(selected, labels));
                                        cx.notify();
                                    },
                                    cx,
                                );
                            }),
                        )),
                );
            }
            for id in crate::bundled_tools::IDS {
                if !self.tools.iter().any(|p| p.manifest.id == id) {
                    let title =
                        format!("{} · {}", tr("tools.reinstall"), tool_name(id, id, locale));
                    content = content.child(action(
                        id,
                        title.clone(),
                        title,
                        ready,
                        cx.listener(move |t, _, _, cx| {
                            t.run(
                                ToolRequest::Restore(id.into()),
                                |t, tool: Installed, cx| {
                                    t.selected = Some(tool);
                                    t.manager = false;
                                    t.list(cx);
                                },
                                cx,
                            );
                        }),
                    ));
                }
            }
        } else {
            if let Some(tool) = &self.selected {
                content = content.child(crate::page_controls::heading(tool_name(
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
                        let now = patina_tool_host::now_ms();
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
                            row = row.child(action(
                                SharedString::from(format!("choice-{id}-{val}")),
                                display.clone(),
                                display.clone(),
                                ready && val != selected,
                                cx.listener(move |t, _, _, cx| {
                                    t.choices.insert(field.clone(), val.clone());
                                    cx.notify();
                                }),
                            ));
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
                            cx.new(|cx| {
                                let mut input = InputState::new(win, cx);
                                input.set_accessibility(
                                    InputAccessibility::new(Some(Role::TextInput))
                                        .with_label(Some(name.clone().into())),
                                );
                                input.set_value(value.clone(), win, cx);
                                input
                            })
                        });
                        content
                            .child(label(name.clone()).id(("tool-field", index)))
                            .child(Input::new(input))
                    }
                    Control::Submit { id, label: name } => {
                        let button = id.clone();
                        content.child(action(
                            SharedString::from(format!("submit-{id}")),
                            name.clone(),
                            name.clone(),
                            ready,
                            cx.listener(move |t, _, _, cx| {
                                if let Some(tool) = &t.selected {
                                    let mut fields = t.choices.clone();
                                    fields.extend(
                                        t.inputs.iter().map(|(k, v)| {
                                            (k.clone(), v.read(cx).value().to_string())
                                        }),
                                    );
                                    let request = ToolRequest::Submit {
                                        id: tool.manifest.id.clone(),
                                        generation: tool.generation.clone(),
                                        button: button.clone(),
                                        fields,
                                    };
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
                            }),
                        ))
                    }
                    Control::Button { id, label: name } => {
                        let id = id.clone();
                        content.child(action(
                            SharedString::from(format!("plugin-action-{id}")),
                            name.clone(),
                            name.clone(),
                            ready,
                            cx.listener(move |t, _, _, cx| t.load(Some(id.clone()), cx)),
                        ))
                    }
                };
            }
        }
        if let Some(error) = &self.error {
            content = content.child(label(error.clone())).child(action(
                "retry-tools",
                tr("common.retry"),
                tr("common.retry"),
                ready,
                cx.listener(|t, _, _, cx| t.list(cx)),
            ));
        }
        if self.busy {
            content = content.child(label(tr("common.loading")));
        }
        if self.display_failed {
            content = content
                .child(label(tr("tools.notificationDisplayFailed")))
                .child(action(
                    "retry-notice",
                    tr("common.retry"),
                    tr("common.retry"),
                    ready,
                    cx.listener(|t, _, _, cx| {
                        t.run(ToolRequest::RetryDisplay, |t, (): (), cx| t.list(cx), cx)
                    }),
                ));
        }
        let shell = page(colors).child(top).child(
            div()
                .flex()
                .flex_1()
                .gap(px(crate::page_controls::CARD_GAP))
                .min_h_0()
                .child(rail)
                .child(
                    div()
                        .id("tool-panel")
                        .flex_1()
                        .min_h_0()
                        .overflow_y_scroll()
                        .child(content),
                ),
        );
        if let Some(confirm) = &self.pending {
            let mut content = panel(colors).w(px(480.)).max_h(px(460.)).gap(px(8.));
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
                        .contains(&patina_tool_host::Capability::Timer)
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
            content = content
                .child(
                    action(
                        "cancel-tool",
                        tr("common.cancel"),
                        tr("common.cancel"),
                        true,
                        cx.listener(|t, _, win, cx| {
                            win.focus(&t.manager_focus, cx);
                            t.pending = None;
                            cx.notify();
                        }),
                    )
                    .track_focus(&self.cancel_focus),
                )
                .child(
                    action(
                        "confirm-tool",
                        tr("common.confirm"),
                        tr("common.confirm"),
                        true,
                        cx.listener(|t, _, win, cx| {
                            win.focus(&t.manager_focus, cx);
                            t.confirm(cx);
                        }),
                    )
                    .track_focus(&self.confirm_focus),
                );
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
                    .backdrop(div().size_full().bg(rgba(0x00000055)))
                    .popup(
                        gpui_kit::base::DialogPopup::new()
                            .child(content.id("tool-consent").overflow_y_scroll()),
                    )
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
