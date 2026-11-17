use super::*;
use gpui_kit::base::{
    Dialog, DialogPopup,
    input::{InputAccessibility, InputEvent, InputState},
};

#[derive(Copy, Clone, PartialEq)]
enum Field {
    Port,
    WebToken,
    Url,
    Machine,
    RemoteToken,
}
use Field::*;

impl Field {
    fn label(self) -> &'static str {
        match self {
            Port => "settings.webActivityAddressLabel",
            WebToken => "settings.webActivityTokenLabel",
            Url => "settings.remoteStatusBridgeUrlLabel",
            Machine => "settings.remoteStatusBridgeMachineIdLabel",
            RemoteToken => "settings.remoteStatusBridgeTokenLabel",
        }
    }
    fn secret(self) -> bool {
        matches!(self, WebToken | Machine | RemoteToken)
    }
}
const FIELDS: [Field; 5] = [Port, WebToken, Url, Machine, RemoteToken];

#[derive(IntoElement)]
struct ServiceGuideSteps(WeakEntity<Settings>);

impl RenderOnce for ServiceGuideSteps {
    fn render(self, win: &mut Window, cx: &mut App) -> impl IntoElement {
        self.0
            .update(cx, |settings, cx| {
                settings.service_guide_steps(settings.client.palette(win), cx)
            })
            .unwrap_or_else(|_| div())
    }
}

fn store_badges(c: quietpro::Palette) -> Div {
    use std::sync::{Arc, LazyLock};
    static IMAGES: LazyLock<[Arc<Image>; 3]> = LazyLock::new(|| {
        [
            (
                ImageFormat::Png,
                include_bytes!("../../assets/store-badges/chrome-web-store.png").as_slice(),
            ),
            (
                ImageFormat::Svg,
                include_bytes!("../../assets/store-badges/firefox-add-ons.svg").as_slice(),
            ),
            (
                ImageFormat::Png,
                include_bytes!("../../assets/store-badges/edge-add-ons.png").as_slice(),
            ),
        ]
        .map(|(format, bytes)| Arc::new(Image::from_bytes(format, bytes.to_vec())))
    });
    let mut row = div()
        .flex()
        .flex_none()
        .flex_wrap()
        .items_center()
        .justify_center()
        .gap(px(8.))
        .py(px(4.));
    for (index, (name, width, url)) in [
        ("Chrome Web Store", 128., "https://chromewebstore.google.com/detail/patina-web-sync/gimdckblhckibmeklhemgccabmbnoemd"),
        ("Firefox Add-ons", 104., "https://addons.mozilla.org/firefox/addon/patina-web-sync/"),
        ("Microsoft Edge Add-ons", 136., "https://microsoftedge.microsoft.com/addons/detail/gogmlpjhbfjghilmpcciedplifdiibai"),
    ].into_iter().enumerate() {
        row = row.child(gpui_kit::base::Button::new(name)
            .accessibility_label(name)
            .rounded(px(4.))
            .cursor_pointer()
                .border_1()
                .border_color(transparent_black())
                .focus_visible(move |s| s.border_color(c.secondary))
            .child(img(IMAGES[index].clone()).w(px(width)).h(px(36.)))
            .on_click(move |_, _, cx| cx.open_url(url)));
    }
    row
}

pub(super) struct ServiceFields {
    inputs: [Entity<InputState>; 5],
    revealed: [bool; 5],
    pub(super) invalid_port: bool,
    pub(super) guide: bool,
    guide_focus: FocusHandle,
    guide_title_focus: FocusHandle,
    guide_trigger: FocusHandle,
    guide_copied: Option<Field>,
    copy_reset: Option<Task<()>>,
}

impl ServiceFields {
    pub(super) fn set_busy(&self, busy: bool, cx: &mut Context<Settings>) {
        for field in &self.inputs {
            field.update(cx, |input, cx| input.set_disabled(busy, cx));
        }
    }
    pub(super) fn new(win: &mut Window, cx: &mut Context<Settings>) -> Self {
        let inputs = FIELDS.map(|field| {
            let input = cx.new(|cx| {
                let mut input = InputState::new(win, cx).masked(field.secret());
                input.set_readonly(field == Machine, cx);
                input
            });
            cx.subscribe(&input, move |s, input, event: &InputEvent, cx| {
                if matches!(event, InputEvent::Focus | InputEvent::Blur) {
                    cx.notify();
                }
                if !matches!(event, InputEvent::Change) {
                    return;
                }
                let Some(p) = &mut s.draft else { return };
                let value = input.read(cx).value().to_string();
                match field {
                    Port => {
                        let port = value.parse::<u16>().ok().filter(|n| *n >= 1024);
                        s.services.invalid_port = port.is_none();
                        if let Some(port) = port {
                            p.web.port = port;
                        }
                    }
                    WebToken => p.web.token = value.trim().into(),
                    RemoteToken => p.remote.token = value.trim().into(),
                    Url => p.remote.url = value.trim().into(),
                    Machine => return,
                }
                cx.notify();
            })
            .detach();
            input
        });
        Self {
            inputs,
            revealed: [false; 5],
            invalid_port: false,
            guide: false,
            guide_focus: cx.focus_handle(),
            guide_title_focus: cx.focus_handle(),
            guide_trigger: cx.focus_handle(),
            guide_copied: None,
            copy_reset: None,
        }
    }
    pub(super) fn reset(
        &mut self,
        p: &TrackingPreferences,
        win: &mut Window,
        cx: &mut Context<Settings>,
    ) {
        self.invalid_port = false;
        self.revealed.fill(false);
        self.guide = false;
        self.set_locale(p.locale, cx);
        for (field, value) in FIELDS.into_iter().zip([
            p.web.port.to_string(),
            p.web.token.clone(),
            p.remote.url.clone(),
            p.remote.machine_id.clone(),
            p.remote.token.clone(),
        ]) {
            self.inputs[field as usize].update(cx, |i, cx| {
                i.set_value(value, win, cx);
                i.set_masked(field.secret(), win, cx);
            });
        }
    }
    pub(super) fn set_locale(&self, locale: Locale, cx: &mut Context<Settings>) {
        for field in FIELDS {
            self.inputs[field as usize].update(cx, |input, _| {
                input.set_accessibility(
                    InputAccessibility::new(Some(Role::TextInput))
                        .with_label(Some(text(locale, field.label()).into())),
                );
            });
        }
    }
}

impl Settings {
    fn generate_token(
        &mut self,
        field: Field,
        reveal: bool,
        win: &mut Window,
        cx: &mut Context<Self>,
    ) {
        use std::fmt::Write;
        let mut bytes = [0u8; 24];
        if getrandom::fill(&mut bytes).is_err() {
            self.error = true;
            cx.notify();
            return;
        }
        let mut token = String::with_capacity(48);
        for byte in bytes {
            write!(token, "{byte:02x}").unwrap();
        }
        let Some(p) = self.draft.as_mut() else { return };
        match field {
            WebToken => p.web.token.clone_from(&token),
            RemoteToken => p.remote.token.clone_from(&token),
            _ => return,
        }
        self.services.revealed[field as usize] = reveal;
        self.services.inputs[field as usize].update(cx, |i, cx| {
            i.set_value(token, win, cx);
            i.set_masked(!reveal, win, cx);
        });
        cx.notify();
    }
    fn service_field(&self, field: Field, c: quietpro::Palette, cx: &Context<Self>) -> Div {
        let tr = |k| text(self.client.locale.get(), k);
        let idx = field as usize;
        let prefs = self.draft.as_ref().expect("settings loaded");
        let error = match field {
            Port if self.services.invalid_port => Some("settings.servicePortInvalid"),
            WebToken if prefs.web.token.is_empty() => Some("settings.serviceTokenRequired"),
            RemoteToken if prefs.remote.token.is_empty() => Some("settings.serviceTokenRequired"),
            _ => None,
        };
        let mut input =
            quietpro::TextInput::new(("service-input", idx), &self.services.inputs[idx], c)
                .disabled(self.busy)
                .invalid(error.is_some());
        if matches!(field, WebToken | RemoteToken) {
            input = input.suffix(
                IconControl::new(
                    SharedString::from(format!("generate-{idx}")),
                    tr("accessibility.settings.generateServiceToken"),
                    Icon::Dices,
                )
                .disabled(self.busy)
                .action(
                    c,
                    cx.listener(move |s, _, win, cx| s.generate_token(field, true, win, cx)),
                ),
            );
        }
        if field.secret() {
            let key = match (field == Machine, self.services.revealed[idx]) {
                (true, true) => "accessibility.settings.hideRemoteMachineId",
                (true, false) => "accessibility.settings.showRemoteMachineId",
                (false, true) => "accessibility.settings.hideServiceToken",
                (false, false) => "accessibility.settings.showServiceToken",
            };
            input = input.suffix(
                IconControl::new(
                    SharedString::from(format!("reveal-{idx}")),
                    tr(key),
                    if self.services.revealed[idx] {
                        Icon::EyeOff
                    } else {
                        Icon::Eye
                    },
                )
                .disabled(self.busy)
                .action(
                    c,
                    cx.listener(move |s, _, win, cx| {
                        let visible = !s.services.revealed[idx];
                        s.services.revealed[idx] = visible;
                        s.services.inputs[idx].update(cx, |i, cx| {
                            i.set_masked(!visible, win, cx);
                            // The eye owns focus; show the new representation from its start
                            // without changing the stored selection or the field value.
                            i.set_scroll_offset(point(px(0.), px(0.)), cx);
                        });
                        cx.notify();
                    }),
                ),
            );
        }
        let row = settings_row()
            .gap(px(8.))
            .child(
                label(tr(field.label()))
                    .id(("service-field-label", idx))
                    .w(px(84.))
                    .flex_none(),
            )
            .child(input);
        div()
            .flex()
            .flex_col()
            .min_w_0()
            .child(row)
            .when_some(error, |d, key| {
                d.child(
                    label(tr(key))
                        .text_color(c.danger)
                        .pb(px(8.))
                        .id(("service-error", idx))
                        .role(Role::Status)
                        .aria_label(tr(key)),
                )
            })
    }
    pub(super) fn service_panel(
        &self,
        c: quietpro::Palette,
        page_width: Pixels,
        cx: &Context<Self>,
    ) -> Div {
        let tr = |k| text(self.client.locale.get(), k);
        let p = self.draft.as_ref().expect("settings loaded");
        let panel = content_card(c.border, c.panel)
            .flex_none()
            .gap(px(CARD_TITLE_GAP))
            .child(settings_title(
                c,
                Icon::Server,
                tr("settings.servicesTitle"),
            ));
        let mut sections = div().flex().flex_col().gap(px(SUBHEADING_GAP));
        for (web, enabled, title) in [
            (true, p.web.enabled, "settings.webActivityTitle"),
            (false, p.remote.enabled, "settings.remoteStatusBridgeTitle"),
        ] {
            let view = cx.weak_entity();
            let switch = quietpro::switch_control(
                title,
                tr(title),
                enabled,
                !self.busy,
                c,
                move |on, _, win, cx| {
                    let _ = view.update(cx, |s, cx| {
                        let Some(p) = s.draft.as_mut() else { return };
                        let (field, empty) = if web {
                            p.web.enabled = on;
                            (WebToken, p.web.token.is_empty())
                        } else {
                            p.remote.enabled = on;
                            (RemoteToken, p.remote.token.is_empty())
                        };
                        if on && empty {
                            s.generate_token(field, false, win, cx);
                        }
                        if !on && web {
                            s.services.invalid_port = false;
                            s.services.guide = false;
                            let port = s.draft.as_ref().unwrap().web.port;
                            s.services.inputs[Port as usize]
                                .update(cx, |i, cx| i.set_value(port.to_string(), win, cx));
                        }
                        cx.notify();
                    });
                },
            );
            let mut header = div()
                .flex()
                .items_center()
                .gap(px(8.))
                .child(heading(tr(title)).aria_level(3).text_size(px(14.)));
            if web && enabled {
                header = header.child(
                    gpui_kit::base::Button::new("sync-guide")
                        .track_focus(&self.services.guide_trigger)
                        .accessibility_label(tr("settings.webActivityHelpAction"))
                        .px(px(8.))
                        .h(px(20.))
                        .rounded_full()
                        .border_1()
                        .border_color(c.border)
                        .bg(c.canvas)
                        .text_color(c.secondary)
                        .text_size(px(12.))
                        .cursor_pointer()
                        .hover(move |s| s.bg(c.track))
                        .focus_visible(move |s| s.border_color(c.secondary))
                        .child(tr("settings.webActivityHelpAction"))
                        .on_click(cx.listener(|s, _, win, cx| {
                            s.services.guide = true;
                            s.services.guide_copied = None;
                            win.focus(&s.services.guide_title_focus, cx);
                            cx.notify();
                        })),
                );
            }
            let mut group = div()
                .flex()
                .flex_col()
                .gap(px(SUBHEADING_GAP))
                .child(header.child(div().flex_1()).child(switch));
            if enabled {
                let left = self.service_field(if web { Port } else { Machine }, c, cx);
                let right = self.service_field(if web { WebToken } else { RemoteToken }, c, cx);
                let pair = if page_width >= px(680.) {
                    div()
                        .flex()
                        .items_center()
                        .gap(px(12.))
                        .child(left.flex_initial().w(relative(0.4)))
                        .child(vertical_divider(c))
                        .child(right.flex_1())
                } else {
                    div()
                        .flex()
                        .flex_col()
                        .child(left)
                        .child(line_above(right, c, 0.))
                };
                let mut card = settings_rows_card(c);
                if web {
                    card = card.child(pair);
                } else {
                    card = card
                        .child(self.service_field(Url, c, cx))
                        .child(line_above(pair, c, 0.));
                }
                group = group.child(card);
            }
            sections = sections.child(group);
        }
        panel.child(sections)
    }

    fn close_service_guide(&mut self, win: &mut Window, cx: &mut Context<Self>) {
        self.services.guide = false;
        win.focus(&self.services.guide_trigger, cx);
        cx.notify();
    }

    fn service_guide_steps(&self, c: quietpro::Palette, cx: &Context<Self>) -> Div {
        let tr = |k| text(self.client.locale.get(), k);
        let steps = patina_recorder::localized_data(
            self.client.locale.get(),
            "settings.webActivityHelpSteps",
        )
        .expect("validated web sync guide");
        let p = self.draft.as_ref().expect("settings loaded");
        let mut list = div().flex().flex_col().flex_none().gap(px(12.));
        for (index, step) in steps.as_array().expect("guide steps").iter().enumerate() {
            let mut card = content_card(c.border, c.canvas)
                .id(("web-sync-guide-step", index))
                .role(Role::Group)
                .accessibility_id(format!("web-sync-guide-step-{index}"))
                .flex_none()
                .gap(px(CARD_TITLE_GAP))
                .child(
                    div()
                        .flex()
                        .items_center()
                        .gap(px(8.))
                        .child(
                            div()
                                .flex()
                                .flex_none()
                                .items_center()
                                .justify_center()
                                .min_w(px(24.))
                                .h(px(20.))
                                .px(px(4.))
                                .rounded(px(8.))
                                .border_1()
                                .border_color(c.border)
                                .bg(c.panel)
                                .text_color(c.secondary)
                                .text_size(px(12.))
                                .child((index + 1).to_string()),
                        )
                        .child(
                            heading(step["title"].as_str().unwrap().into())
                                .aria_level(3)
                                .text_size(px(14.)),
                        ),
                )
                .child(
                    label(step["description"].as_str().unwrap().into())
                        .flex_none()
                        .text_color(c.secondary),
                );
            if step["showStoreBadges"].as_bool() == Some(true) {
                card = card.child(store_badges(c));
            }
            let details = step["details"].as_array().unwrap();
            for (detail_index, detail) in details.iter().enumerate() {
                let value = detail.as_str().or_else(|| detail["text"].as_str()).unwrap();
                let mut line = div().flex().flex_wrap().items_center().gap(px(8.)).child(
                    label(value.into())
                        .text_size(px(12.))
                        .text_color(c.secondary),
                );
                if let Some(links) = detail["links"].as_array() {
                    for link in links {
                        let url = link["href"].as_str().unwrap().to_owned();
                        let name = link["label"].as_str().unwrap().to_owned();
                        line = line.child(
                            text_button(SharedString::from(url.clone()), name, c, true)
                                .min_h(px(24.))
                                .px(px(8.))
                                .text_size(px(12.))
                                .on_click(move |_, _, cx| cx.open_url(&url)),
                        );
                    }
                }
                if index == 0 && detail_index + 1 == details.len() {
                    for (field, key, value) in [
                        (
                            Port,
                            "settings.webActivityHelpCopyPortAction",
                            p.web.port.to_string(),
                        ),
                        (
                            WebToken,
                            "settings.webActivityHelpCopyTokenAction",
                            p.web.token.clone(),
                        ),
                    ] {
                        let shown = if self.services.guide_copied == Some(field) {
                            tr("settings.webActivityHelpCopiedAction")
                        } else {
                            tr(key)
                        };
                        line = line.child(
                            text_button(key, shown, c, !value.is_empty())
                                .accessibility_label(tr(key))
                                .min_h(px(24.))
                                .px(px(8.))
                                .text_size(px(12.))
                                .on_click(cx.listener(move |s, _, _, cx| {
                                    cx.write_to_clipboard(ClipboardItem::new_string(value.clone()));
                                    s.services.guide_copied = Some(field);
                                    s.services.copy_reset =
                                        Some(cx.spawn(async move |view, cx| {
                                            cx.background_executor()
                                                .timer(std::time::Duration::from_millis(1400))
                                                .await;
                                            let _ = view.update(cx, |s, cx| {
                                                if s.services.guide_copied == Some(field) {
                                                    s.services.guide_copied = None;
                                                    cx.notify();
                                                }
                                            });
                                        }));
                                    cx.notify();
                                })),
                        );
                    }
                }
                card = card.child(
                    div()
                        .flex()
                        .flex_none()
                        .items_start()
                        .gap(px(8.))
                        .child(div().text_color(c.secondary).child("•"))
                        .child(line.flex_1().min_w_0()),
                );
            }
            list = list.child(card);
        }
        list
    }

    pub(super) fn service_guide(
        &self,
        c: quietpro::Palette,
        win: &Window,
        cx: &mut Context<Self>,
    ) -> impl IntoElement {
        let tr = |k| text(self.client.locale.get(), k);
        let title = tr("settings.webActivityHelpTitle");
        let content = quietpro::dialog_surface(c, win.viewport_size())
            .id("web-sync-guide")
            .role(Role::Group)
            .accessibility_id("web-sync-guide-surface")
            .max_w(px((f32::from(win.viewport_size().width) - 48.).min(760.)))
            .gap(px(CARD_TITLE_GAP))
            .on_key_down(cx.listener(|s, e: &KeyDownEvent, win, cx| {
                if e.keystroke.key == "escape" {
                    s.close_service_guide(win, cx);
                    cx.stop_propagation();
                }
            }))
            .child(
                div()
                    .flex()
                    .flex_none()
                    .items_center()
                    .gap(px(8.))
                    .child(
                        heading(title.clone())
                            .flex_1()
                            .track_focus(&self.services.guide_title_focus),
                    )
                    .child(
                        IconControl::new("close-sync-guide", tr("common.close"), Icon::X).action(
                            c,
                            cx.listener(|s, _, win, cx| s.close_service_guide(win, cx)),
                        ),
                    ),
            )
            .child(
                div()
                    .id("web-sync-guide-body")
                    .role(Role::Group)
                    .accessibility_id("web-sync-guide-body")
                    .min_h_0()
                    .overflow_y_scroll()
                    .flex()
                    .flex_col()
                    .gap(px(12.))
                    .child(ServiceGuideSteps(cx.weak_entity()))
                    .child(
                        label(tr("settings.webActivityHelpNote"))
                            .flex_none()
                            .text_color(c.secondary),
                    ),
            );
        let view = cx.weak_entity();
        Dialog::new(cx)
            .focus_handle(self.services.guide_focus.clone())
            .accessibility_label(title)
            .on_ok(|_, _, _| false)
            .close_on_escape(false)
            .close_on_backdrop_press(true)
            .backdrop(quietpro::dialog_backdrop())
            .popup(DialogPopup::new().child(content))
            .on_open_change(move |open, _, win, cx| {
                if !open {
                    let _ = view.update(cx, |s, cx| s.close_service_guide(win, cx));
                }
            })
    }
}
