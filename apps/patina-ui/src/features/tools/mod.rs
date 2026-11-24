mod clock;
mod composition;
mod fields;
mod home;
mod panel;
mod schedule;
mod settings;
mod store;
mod target_picker;
#[cfg(all(test, feature = "test-support"))]
mod tests;

use crate::{client::Client, features::page_controls::label};
use gpui_kit::base::TestSupportExt;
use gpui_kit::base::input::{InputAccessibility, InputEvent, InputState};
use gpui_kit::{prelude::*, *};
use patina_desktop_protocol::FromReply;

use patina_desktop_protocol::tools::{Control, Installed, Preview};
use patina_desktop_protocol::tools::{ToolCall, call};
use patina_i18n::text;
use quietpro::{content_card, page, page_title_row};
use std::{path::PathBuf, rc::Rc};

#[derive(Clone)]
enum Confirm {
    Install(PathBuf, Preview),
    Remove(Installed, Vec<String>, FocusHandle),
}

fn task_list_frame(id: &'static str, title: String, c: quietpro::Palette) -> Stateful<Div> {
    div()
        .id(id)
        .role(Role::Group)
        .aria_label(title)
        .flex()
        .flex_col()
        .flex_1()
        .min_h(px(quietpro::SETTINGS_ROW_HEIGHT))
        .rounded(px(16.))
        .border_1()
        .border_dashed()
        .border_color(c.border)
        .p(px(quietpro::SUBHEADING_GAP))
}

fn tool_name(tool: &Installed, locale: patina_activity_model::Locale) -> String {
    manifest_name(&tool.manifest, locale)
}

fn manifest_name(
    manifest: &patina_desktop_protocol::tools::Manifest,
    locale: patina_activity_model::Locale,
) -> String {
    manifest
        .presentation
        .as_ref()
        .and_then(|p| p.names.get(locale.tag()))
        .unwrap_or(&manifest.name)
        .clone()
}

pub(crate) struct Tools {
    client: Rc<Client>,
    tools: Vec<Installed>,
    selected: Option<Installed>,
    showing_home: bool,
    home_focus: FocusHandle,
    controls: Option<Rc<[Control]>>,
    panel: panel::State,
    focus_dialog_pending: bool,
    saved_tabs: std::collections::BTreeMap<String, String>,
    inputs: std::collections::BTreeMap<String, Entity<InputState>>,
    choices: std::collections::BTreeMap<String, String>,
    manager: bool,
    store_focus: Option<store::StoreFocus>,
    settings: Option<settings::SettingsDialog>,
    settings_focus: FocusHandle,
    target: Option<patina_activity_model::ToolTarget>,
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
        target: Option<patina_activity_model::ToolTarget>,
        cx: &mut Context<Self>,
    ) -> Self {
        let mut page = Self {
            client,
            tools: Vec::new(),
            selected: None,
            showing_home: false,
            home_focus: cx.focus_handle(),
            controls: None,
            panel: panel::State::new(cx),
            focus_dialog_pending: false,
            saved_tabs: Default::default(),
            inputs: Default::default(),
            choices: Default::default(),
            manager: false,
            store_focus: None,
            settings: None,
            settings_focus: cx.focus_handle(),
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
        page.list(call::list(), cx);
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
                    Err(e) => this.error = Some(e.to_string()),
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

    fn list(
        &mut self,
        request: ToolCall<patina_desktop_protocol::ToolList>,
        cx: &mut Context<Self>,
    ) {
        self.run(
            request,
            |this, (mut tools, failed, last): (Vec<Installed>, bool, Option<String>), cx| {
                tools.sort_by_key(|tool| {
                    tool.manifest
                        .presentation
                        .as_ref()
                        .map_or(u16::MAX, |p| p.order)
                });
                this.display_failed = failed;
                let target = this.target.take();
                let requested = target.and_then(|target| {
                    use patina_activity_model::ToolTarget;
                    use patina_desktop_protocol::tools::Capability;
                    if let Some(generation) = target.generation() {
                        return tools.iter().find(|tool| tool.generation == generation);
                    }
                    let capability = match target {
                        ToolTarget::Focus => Capability::Focus,
                        ToolTarget::Reminders => Capability::Reminders,
                        ToolTarget::Plugin { .. } => unreachable!(),
                    };
                    tools
                        .iter()
                        .find(|tool| tool.manifest.capabilities.contains(&capability))
                });
                let preferred = if target.is_some() {
                    this.manager = requested.is_none();
                    requested.map(|tool| tool.manifest.id.as_str())
                } else {
                    this.selected
                        .as_ref()
                        .map(|t| t.manifest.id.as_str())
                        .or(last.as_deref())
                };
                let selected = tools
                    .iter()
                    .find(|p| Some(p.manifest.id.as_str()) == preferred)
                    .cloned();
                if selected.is_none() {
                    this.showing_home = true;
                }
                let changed = this
                    .selected
                    .as_ref()
                    .map(|t| (&t.manifest.id, &t.generation))
                    != selected.as_ref().map(|t| (&t.manifest.id, &t.generation));
                this.selected = selected;
                this.tools = tools;
                if changed {
                    this.controls = None;
                }
                if this.showing_home {
                    return;
                }
                if this.controls.is_none() {
                    this.load(None, cx);
                } else if !this.manager {
                    this.background_refresh(cx);
                }
            },
            cx,
        );
    }

    pub fn background_refresh(&mut self, cx: &mut Context<Self>) {
        if self.showing_home {
            return;
        }
        if self.busy || self.manager || self.settings.is_some() || self.panel.expanded.is_some() {
            self.refresh_pending = true;
            return;
        }
        self.refresh_panel(false, cx);
    }

    fn refresh_panel(&mut self, remember: bool, cx: &mut Context<Self>) {
        let Some(t) = &self.selected else {
            return;
        };
        self.run(
            call::panel(t.manifest.id.clone(), t.generation.clone(), None, remember),
            |t, controls, _| t.update_panel(controls, None),
            cx,
        );
    }

    pub(crate) fn ready_to_present(&self) -> bool {
        self.controls.is_some() || !self.busy
    }

    fn load(&mut self, action: Option<String>, cx: &mut Context<Self>) {
        let Some(tool) = &self.selected else {
            self.controls = None;
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
            move |this, controls, cx| {
                if remember || panel::layout(&controls).is_none() {
                    this.inputs.clear();
                    this.choices.clear();
                    this.panel = panel::State::new(cx);
                    this.panel.tab = this
                        .selected
                        .as_ref()
                        .and_then(|t| this.saved_tabs.get(&t.manifest.id))
                        .cloned();
                }
                this.update_panel(controls, None);
            },
            cx,
        );
    }

    fn update_panel(&mut self, controls: Vec<Control>, submitted: Option<&str>) {
        let next = panel::layout(&controls);
        let old = self.controls.as_deref().and_then(panel::layout);
        self.focus_dialog_pending = next.and_then(|p| p.dialog.as_ref()).is_some()
            && old.and_then(|p| p.dialog.as_ref()).is_none();
        if let Some(old) = old {
            for form in old.tabs.iter().filter_map(|t| t.form.as_ref()) {
                if submitted == Some(&form.submit)
                    || !next.is_some_and(|p| {
                        p.tabs
                            .iter()
                            .any(|t| t.form.as_ref().is_some_and(|f| f.submit == form.submit))
                    })
                {
                    let mut keys = Vec::new();
                    for field in &form.fields {
                        field.bindings(&mut keys);
                    }
                    for key in keys {
                        self.choices.remove(key);
                        self.inputs.remove(key);
                    }
                    self.panel.close_picker();
                }
            }
        } else if submitted.is_some() {
            self.inputs.clear();
            self.choices.clear();
        }
        self.controls = Some(controls.into());
    }

    fn input(
        &mut self,
        id: &str,
        name: &str,
        value: &str,
        placeholder: &str,
        win: &mut Window,
        cx: &mut Context<Self>,
    ) -> Entity<InputState> {
        let input = self.inputs.entry(id.to_owned()).or_insert_with(|| {
            let input = cx.new(|cx| {
                let mut input = InputState::new(win, cx).placeholder(placeholder.to_owned());
                input.set_accessibility(
                    InputAccessibility::new(Some(Role::TextInput))
                        .with_label(Some(name.to_owned().into())),
                );
                input.set_value(value.to_owned(), win, cx);
                input
            });
            cx.subscribe(&input, |this, _, event, cx| {
                if matches!(event, InputEvent::Focus | InputEvent::Blur)
                    || this.panel.expanded.is_some() && matches!(event, InputEvent::Change)
                {
                    cx.notify();
                }
            })
            .detach();
            input
        });
        input.clone()
    }

    fn submit(&mut self, button: &str, cx: &mut Context<Self>) {
        let Some(tool) = &self.selected else { return };
        let mut fields = self.choices.clone();
        fields.extend(
            self.inputs
                .iter()
                .map(|(key, input)| (key.clone(), input.read(cx).value().to_string())),
        );
        if let Some(controls) = self.controls.as_deref()
            && let Some(page) = panel::layout(controls)
        {
            let Some(form) = page
                .tabs
                .iter()
                .filter_map(|t| t.form.as_ref())
                .find(|f| f.submit == button)
            else {
                return;
            };
            let mut keys = Vec::new();
            for f in &form.fields {
                f.bindings(&mut keys);
            }
            fields.retain(|key, _| keys.contains(&key.as_str()));
            for c in controls {
                if let Control::Input { id, value, .. } | Control::Select { id, value, .. } = c
                    && keys.contains(&id.as_str())
                {
                    fields.entry(id.clone()).or_insert_with(|| value.clone());
                }
            }
        }
        let submitted = button.to_owned();
        self.run(
            call::submit(
                tool.manifest.id.clone(),
                tool.generation.clone(),
                button.to_owned(),
                fields,
            ),
            move |t, controls, _| t.update_panel(controls, Some(&submitted)),
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
                    this.showing_home = false;
                    this.controls = None;
                    this.selected = Some(tool);
                    this.list(call::list(), cx);
                },
                cx,
            ),
            Some(Confirm::Remove(tool, _, _)) => self.run(
                call::uninstall(tool.manifest.id, tool.generation),
                |this, (): (), cx| {
                    this.list(call::list(), cx);
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
        let controls_for_page = self.controls.clone();
        let show_home = self.showing_home
            || (self.busy && self.selected.is_some() && controls_for_page.is_none());
        let page_spec = controls_for_page
            .as_deref()
            .filter(|_| !show_home)
            .and_then(panel::layout);
        let details = page_spec.and_then(|p| p.dialog.as_ref());
        let ready = !self.busy && !self.manager && self.settings.is_none() && details.is_none();
        if !self.manager && self.store_focus.take().is_some() {
            win.focus(&self.manager_focus, cx);
        }
        let mut content = if show_home && !self.tools.is_empty() {
            div().flex().flex_col().min_w_0()
        } else {
            content_card(colors.border, colors.panel).when(
                self.tools.is_empty() && self.error.is_none() && !self.display_failed,
                |card| card.h_full().items_center().justify_center().text_center(),
            )
        }
        .gap(px(quietpro::SECTION_GROUP_GAP));
        let field_group = || {
            div()
                .flex()
                .flex_col()
                .flex_none()
                .gap(px(quietpro::SUBHEADING_GAP))
        };
        let header_button = |id: &'static str, key, icon, focus: &FocusHandle| {
            quietpro::IconControl::new(id, tr(key), icon)
                .icon_size(px(20.))
                .track_focus(focus)
                .with_tooltip()
                .disabled(!ready)
        };
        let home = header_button(
            "plugin-home",
            "tools.home",
            quietpro::Icon::HousePlug,
            &self.home_focus,
        )
        .action(
            colors,
            cx.listener(|this, _, _, cx| {
                this.panel.close_picker();
                this.showing_home = true;
                this.list(call::open_home(), cx);
            }),
        );
        let manager = header_button(
            "tool-manager",
            "tools.manager",
            quietpro::Icon::Store,
            &self.manager_focus,
        )
        .action(
            colors,
            cx.listener(|this, _, _, cx| {
                this.panel.close_picker();
                this.manager = true;
                this.list(call::list(), cx);
            }),
        );
        let preferences = header_button(
            "tool-settings",
            "tools.settingsTitle",
            quietpro::Icon::Settings,
            &self.settings_focus,
        )
        .action(
            colors,
            cx.listener(|t, _, win, cx| t.open_settings(win, cx)),
        );
        let action_size = quietpro::ControlSize::Large.height();
        let top = page_title_row(tr("tools.title"), quietpro::Icon::ToolCase, colors).child(
            quietpro::icon_actions()
                .child(home.size(action_size))
                .child(manager.size(action_size))
                .child(preferences.size(action_size)),
        );
        if self.tools.is_empty() {
            if !self.busy && !self.manager {
                content = content.child(label(tr("tools.empty")).test_support());
            }
        } else if show_home {
            content = content.child(self.home_grid(ready, colors, win, cx));
        } else if let (Some(spec), Some(controls)) = (page_spec, controls_for_page.as_deref()) {
            content = self.render_page(
                content,
                spec,
                fields::PanelView {
                    in_popover: false,
                    controls,
                    colors,
                    ready,
                },
                win,
                cx,
            );
        } else {
            if let Some(tool) = &self.selected {
                content = content.child(quietpro::heading(tool_name(tool, locale)));
            }
            let controls = self.controls.clone();
            for (index, control) in controls.as_deref().unwrap_or_default().iter().enumerate() {
                content = match control {
                    Control::Page(_) => content,
                    Control::Text(s) => content.child(label(s.clone()).id(("tool-text", index))),
                    Control::ListRow {
                        title,
                        detail,
                        actions,
                        id,
                        clock,
                    } => {
                        let mut row = quietpro::settings_row()
                            .child(label(title.clone()))
                            .when_some(clock.as_ref(), |row, clock| {
                                row.child(clock::row_clock(id, clock, win, cx))
                            })
                            .child(quietpro::caption(detail.clone(), colors));
                        for (id, name) in actions {
                            let id = id.clone();
                            row = row.child(
                                quietpro::text_button(
                                    SharedString::from(id.clone()),
                                    name.clone(),
                                    colors,
                                    ready,
                                )
                                .on_click(
                                    cx.listener(move |t, _, _, cx| t.load(Some(id.clone()), cx)),
                                ),
                            );
                        }
                        content.child(row)
                    }
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
                            label(format!("{title} ･ {:02}:{:02}", seconds / 60, seconds % 60))
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
                        content.child(
                            field_group()
                                .child(label(name.clone()).id(("tool-choice", index)))
                                .child(row),
                        )
                    }
                    Control::Input {
                        id,
                        label: name,
                        value,
                    } => {
                        let input = self.input(id, name, value, "", win, cx);
                        content.child(
                            field_group()
                                .child(label(name.clone()).id(("tool-field", index)))
                                .child(
                                    div().flex().flex_none().child(
                                        quietpro::TextInput::new(
                                            SharedString::from(format!("tool-input-{id}")),
                                            &input,
                                            colors,
                                        )
                                        .disabled(!ready),
                                    ),
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
                                    t.submit(&button, cx);
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
        if let Some(error) = &self.error
            && self.settings.is_none()
            && !self.manager
        {
            content = content.child(label(error.clone())).child({
                let accessible_name = tr("common.retry");
                quietpro::text_button("retry-tools", tr("common.retry"), colors, ready)
                    .accessibility_label(accessible_name)
                    .on_click(cx.listener(|t, _, _, cx| t.list(call::list(), cx)))
            });
        }
        if self.busy && !self.manager && self.controls.is_none() {
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
                            t.run(
                                call::retry_display(),
                                |t, (): (), cx| t.list(call::list(), cx),
                                cx,
                            )
                        }))
                });
        }
        let panel = div()
            .id("tool-panel")
            .flex_1()
            .min_w_0()
            .min_h_0()
            .overflow_y_scroll()
            .child(content)
            .test_support();
        let mut shell = page(colors).child(top).child(panel);
        if let (Some(details), Some(controls)) = (details, controls_for_page.as_deref()) {
            if std::mem::take(&mut self.focus_dialog_pending) {
                self.focus_dialog(win, cx);
            }
            return shell.child(self.details_dialog(details, controls, win, cx));
        }
        if let Some(settings) = &self.settings {
            return shell.child(self.settings_dialog(settings, win, cx));
        }
        if self.manager {
            shell = shell.child(self.store_dialog(win, cx));
        }
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
                            "{} ･ {}",
                            manifest_name(&preview.manifest, locale),
                            preview.manifest.version
                        )))
                        .child(label(preview.manifest.id.clone()))
                        .child(label(format!("Ed25519 ･ {}", preview.publisher)))
                        .child(label(path.display().to_string()))
                        .child(label(tr("tools.panelAccess")));
                    if preview
                        .manifest
                        .capabilities
                        .contains(&patina_desktop_protocol::tools::Capability::Timer)
                    {
                        content = content.child(label(tr("tools.timerAccess")));
                    }
                    for (cap, key) in [
                        (
                            patina_desktop_protocol::tools::Capability::Focus,
                            "tools.focusAccess",
                        ),
                        (
                            patina_desktop_protocol::tools::Capability::Reminders,
                            "tools.remindersAccess",
                        ),
                    ] {
                        if preview.manifest.capabilities.contains(&cap) {
                            content = content.child(label(tr(key)));
                        }
                    }
                }
                Confirm::Remove(tool, stopping, _) => {
                    content = content
                        .child(label(tool_name(tool, locale)))
                        .child(label(tr("tools.uninstallDeletesData")));
                    for (i, name) in stopping.iter().enumerate() {
                        content = content.child(label(name.clone()).id(("stopping", i)));
                    }
                }
            }
            let actions = quietpro::dialog_actions()
                .child(
                    quietpro::text_button("cancel-tool", tr("common.cancel"), colors, true)
                        .on_click(cx.listener(|t, _, win, cx| {
                            t.cancel_store_confirmation(win, cx);
                        }))
                        .track_focus(&self.cancel_focus),
                )
                .child(
                    quietpro::text_button("confirm-tool", tr("common.confirm"), colors, true)
                        .on_click(cx.listener(|t, _, win, cx| {
                            t.focus_store_install(win, cx);
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
                    win.focus(&self.cancel_focus, cx);
                    f
                })
                .clone();
            let weak = cx.weak_entity();
            let keyboard = weak.clone();
            return shell.child(
                quietpro::modal_dialog(
                    tr(match confirm {
                        Confirm::Remove(..) => "tools.uninstall",
                        Confirm::Install(..) => "tools.install",
                    }),
                    focus,
                    content.id("tool-consent"),
                    move |win, cx| {
                        let _ = weak.update(cx, |t, cx| {
                            t.cancel_store_confirmation(win, cx);
                        });
                    },
                    cx,
                )
                .layer(1, true)
                .on_ok(move |_, win, cx| {
                    let _ = keyboard.update(cx, |t, cx| {
                        if t.confirm_focus.is_focused(win) {
                            t.focus_store_install(win, cx);
                            t.confirm(cx);
                        } else if t.cancel_focus.is_focused(win) {
                            t.cancel_store_confirmation(win, cx);
                        }
                    });
                    false
                }),
            );
        }
        self.modal_focus = None;
        shell
    }
}
