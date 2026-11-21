use crate::client::Client;
use gpui_kit::{
    base::input::{InputAccessibility, InputEvent, InputState},
    prelude::*,
    *,
};
use patina_i18n::text;
use quietpro::{Icon, IconControl};
use raw_window_handle::{HasWindowHandle, RawWindowHandle};
use std::{cell::Cell, rc::Rc};

pub(super) struct Changed(pub Option<String>);
pub(super) struct FormatChanged(pub usize);

pub(super) fn parse_hex(value: &str) -> Option<Rgba> {
    let raw = value.trim().strip_prefix('#').unwrap_or(value.trim());
    if !raw.bytes().all(|b| b.is_ascii_hexdigit()) {
        return None;
    }
    let value = match raw.len() {
        6 => u32::from_str_radix(raw, 16).ok()?,
        3 => raw.bytes().fold(0u32, |n, b| {
            n * 256 + (b as char).to_digit(16).unwrap() * 17
        }),
        _ => return None,
    };
    Some(rgb(value))
}

fn hex(c: Rgba) -> String {
    format!(
        "#{:02X}{:02X}{:02X}",
        (c.r * 255.).round() as u8,
        (c.g * 255.).round() as u8,
        (c.b * 255.).round() as u8
    )
}

fn hsv(c: Rgba, previous_hue: f32) -> (f32, f32, f32) {
    let max = c.r.max(c.g).max(c.b);
    let min = c.r.min(c.g).min(c.b);
    let delta = max - min;
    let hue = if delta < f32::EPSILON {
        previous_hue
    } else if max == c.r {
        ((c.g - c.b) / delta / 6.).rem_euclid(1.)
    } else if max == c.g {
        ((c.b - c.r) / delta + 2.) / 6.
    } else {
        ((c.r - c.g) / delta + 4.) / 6.
    };
    (hue, if max == 0. { 0. } else { delta / max }, max)
}

fn from_hsv(h: f32, s: f32, v: f32) -> Rgba {
    let l = v * (1. - s / 2.);
    let saturation = if l == 0. || l == 1. {
        0.
    } else {
        (v - l) / l.min(1. - l)
    };
    hsla(h.rem_euclid(1.), saturation, l, 1.).into()
}

pub(super) struct ColorPicker {
    client: Rc<Client>,
    value: Rgba,
    default: Rgba,
    hue: f32,
    saturation: f32,
    brightness: f32,
    format: usize,
    format_focus: [FocusHandle; 3],
    area_focus: FocusHandle,
    hue_focus: FocusHandle,
    fields: [Entity<InputState>; 4],
    bounds: [Rc<Cell<Bounds<Pixels>>>; 2],
    drag: Option<usize>,
    invalid: bool,
    picking: Option<crate::windows::eyedropper::Selection>,
    pick_task: Option<Task<()>>,
    pick_error: bool,
    pick_focus: FocusHandle,
}

impl ColorPicker {
    pub(super) fn new(
        client: Rc<Client>,
        value: Rgba,
        default: Rgba,
        format: usize,
        win: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        let fields = std::array::from_fn(|_| cx.new(|cx| InputState::new(win, cx)));
        for field in &fields {
            cx.subscribe_in(field, win, |this, _, event: &InputEvent, win, cx| {
                if matches!(event, InputEvent::Change | InputEvent::PressEnter { .. }) {
                    this.read_fields(win, cx);
                }
                if matches!(event, InputEvent::Focus | InputEvent::Blur) {
                    cx.notify();
                }
            })
            .detach();
        }
        let (hue, saturation, brightness) = hsv(value, 0.);
        let mut this = Self {
            client,
            value,
            default,
            hue,
            saturation,
            brightness,
            format,
            format_focus: std::array::from_fn(|_| cx.focus_handle()),
            area_focus: cx.focus_handle(),
            hue_focus: cx.focus_handle(),
            fields,
            bounds: std::array::from_fn(|_| Rc::new(Cell::new(Bounds::default()))),
            drag: None,
            invalid: false,
            picking: None,
            pick_task: None,
            pick_error: false,
            pick_focus: cx.focus_handle(),
        };
        this.sync_fields(win, cx);
        this
    }

    fn pick_screen_color(&mut self, win: &mut Window, cx: &mut Context<Self>) {
        if self.picking.is_some() {
            return;
        }
        let owner = win
            .window_handle()
            .ok()
            .and_then(|handle| match handle.as_raw() {
                RawWindowHandle::Win32(handle) => Some(handle.hwnd.get()),
                _ => None,
            });
        let selection = owner
            .ok_or_else(|| "missing native window".to_string())
            .and_then(|owner| {
                crate::windows::eyedropper::start(
                    owner,
                    text(self.client.locale.get(), "accessibility.color.eyedropper"),
                )
            });
        let (selection, result) = match selection {
            Ok(value) => value,
            Err(error) => {
                eprintln!("start screen color picker: {error}");
                self.pick_error = true;
                cx.notify();
                return;
            }
        };
        self.pick_error = false;
        self.picking = Some(selection);
        self.pick_task = Some(cx.spawn_in(win, async move |view, cx| {
            let result = result.recv().await;
            let _ = view.update_in(cx, |this, win, cx| {
                this.picking = None;
                this.pick_task = None;
                match result {
                    Ok(Ok(Some(color))) => {
                        this.value = rgb(color);
                        (this.hue, this.saturation, this.brightness) = hsv(this.value, this.hue);
                        this.sync_fields(win, cx);
                        cx.emit(Changed(Some(hex(this.value))));
                    }
                    Ok(Ok(None)) => {}
                    error => {
                        eprintln!("screen color picker: {error:?}");
                        this.pick_error = true;
                    }
                }
                win.focus(&this.pick_focus, cx);
                cx.notify();
            });
        }));
        cx.notify();
    }

    fn sync_fields(&mut self, win: &mut Window, cx: &mut Context<Self>) {
        let hsl: Hsla = self.value.into();
        let values = if self.format == 1 {
            [
                self.value.r * 255.,
                self.value.g * 255.,
                self.value.b * 255.,
            ]
        } else {
            [self.hue * 360., hsl.s * 100., hsl.l * 100.]
        };
        let labels = if self.format == 1 {
            ["redChannel", "greenChannel", "blueChannel"]
        } else {
            ["hueChannel", "saturationChannel", "lightnessChannel"]
        };
        self.fields[0].update(cx, |f, cx| {
            f.set_value(hex(self.value), win, cx);
            f.set_accessibility(
                InputAccessibility::new(Some(Role::TextInput)).with_label(Some(
                    text(self.client.locale.get(), "accessibility.color.hexValue").into(),
                )),
            );
        });
        for i in 0..3 {
            self.fields[i + 1].update(cx, |f, cx| {
                f.set_value(format!("{:.0}", values[i]), win, cx);
                f.set_accessibility(
                    InputAccessibility::new(Some(Role::TextInput)).with_label(Some(
                        text(
                            self.client.locale.get(),
                            &format!("accessibility.color.{}", labels[i]),
                        )
                        .into(),
                    )),
                );
            });
        }
        self.invalid = false;
    }

    fn read_fields(&mut self, _: &mut Window, cx: &mut Context<Self>) {
        let color = if self.format == 0 {
            parse_hex(self.fields[0].read(cx).value().as_str())
        } else {
            let values: Option<Vec<f32>> = self.fields[1..]
                .iter()
                .map(|f| f.read(cx).value().trim().parse::<f32>().ok())
                .collect();
            values.and_then(|v| {
                let limits = if self.format == 1 {
                    [255., 255., 255.]
                } else {
                    [360., 100., 100.]
                };
                if v.iter()
                    .zip(limits)
                    .any(|(n, max)| !n.is_finite() || *n < 0. || *n > max)
                {
                    return None;
                }
                Some(if self.format == 1 {
                    Rgba {
                        r: v[0] / 255.,
                        g: v[1] / 255.,
                        b: v[2] / 255.,
                        a: 1.,
                    }
                } else {
                    hsla((v[0] / 360.).rem_euclid(1.), v[1] / 100., v[2] / 100., 1.).into()
                })
            })
        };
        self.invalid = color.is_none();
        if let Some(color) = color {
            self.value = color;
            (self.hue, self.saturation, self.brightness) = hsv(color, self.hue);
            cx.emit(Changed(Some(hex(color))));
        }
        cx.notify();
    }

    fn publish(&mut self, win: &mut Window, cx: &mut Context<Self>) {
        self.value = from_hsv(self.hue, self.saturation, self.brightness);
        self.sync_fields(win, cx);
        cx.emit(Changed(Some(hex(self.value))));
        cx.notify();
    }

    fn point(
        &mut self,
        index: usize,
        point: Point<Pixels>,
        win: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let b = self.bounds[index].get();
        let x = (f32::from(point.x - b.left()) / f32::from(b.size.width).max(1.)).clamp(0., 1.);
        if index == 0 {
            self.saturation = x;
            self.brightness = 1.
                - (f32::from(point.y - b.top()) / f32::from(b.size.height).max(1.)).clamp(0., 1.);
        } else {
            self.hue = x;
        }
        self.publish(win, cx);
    }

    fn surface(&self, index: usize, cx: &mut Context<Self>) -> Stateful<Div> {
        let bounds = self.bounds[index].clone();
        let focus = if index == 0 {
            self.area_focus.clone()
        } else {
            self.hue_focus.clone()
        };
        div()
            .id(if index == 0 { "color-sv" } else { "color-hue" })
            .relative()
            .w_full()
            .track_focus(&focus)
            .tab_stop(true)
            .role(Role::Slider)
            .aria_label(text(
                self.client.locale.get(),
                if index == 0 {
                    "accessibility.color.colorPicker"
                } else {
                    "accessibility.color.hueSlider"
                },
            ))
            .when(index == 0, |s| s.cursor_crosshair())
            .when(index == 1, |s| s.cursor_pointer())
            .child(
                canvas(
                    move |mut b, _, _| {
                        if index == 1 {
                            b.origin.x += px(6.);
                            b.size.width -= px(12.);
                        }
                        bounds.set(b);
                    },
                    |_, _, _, _| (),
                )
                .absolute()
                .inset_0()
                .size_full(),
            )
            .on_mouse_down(
                MouseButton::Left,
                cx.listener(move |t, e: &MouseDownEvent, win, cx| {
                    win.focus(&focus, cx);
                    t.drag = Some(index);
                    t.point(index, e.position, win, cx);
                    cx.stop_propagation();
                }),
            )
            .on_mouse_move(cx.listener(move |t, e: &MouseMoveEvent, win, cx| {
                if t.drag == Some(index) && e.pressed_button == Some(MouseButton::Left) {
                    t.point(index, e.position, win, cx);
                }
            }))
            .on_mouse_up(MouseButton::Left, cx.listener(|t, _, _, _| t.drag = None))
            .on_mouse_up_out(MouseButton::Left, cx.listener(|t, _, _, _| t.drag = None))
            .on_key_down(cx.listener(move |t, e: &KeyDownEvent, win, cx| {
                let step = if e.keystroke.modifiers.shift {
                    0.1
                } else {
                    0.01
                };
                match (index, e.keystroke.key.as_str()) {
                    (0, "left") => t.saturation = (t.saturation - step).max(0.),
                    (0, "right") => t.saturation = (t.saturation + step).min(1.),
                    (0, "up") => t.brightness = (t.brightness + step).min(1.),
                    (0, "down") => t.brightness = (t.brightness - step).max(0.),
                    (1, "left" | "down") => t.hue = (t.hue - step).max(0.),
                    (1, "right" | "up") => t.hue = (t.hue + step).min(1.),
                    _ => return,
                }
                t.publish(win, cx);
                cx.stop_propagation();
            }))
    }
}

impl EventEmitter<Changed> for ColorPicker {}
impl EventEmitter<FormatChanged> for ColorPicker {}
impl Render for ColorPicker {
    fn render(&mut self, win: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let c = self.client.palette(win);
        let tr = |k| text(self.client.locale.get(), k);
        let sv = quietpro::color_plane(
            self.surface(0, cx),
            self.hue,
            self.saturation,
            self.brightness,
            self.value,
            c,
        );
        let hue = quietpro::hue_strip(self.surface(1, cx), self.hue, c);
        let view = cx.weak_entity();
        let formats = quietpro::segmented_with_medium_labels(
            ("color-format", tr("accessibility.color.colorFormat")),
            std::array::from_fn::<_, 3, _>(|i| {
                (
                    i,
                    ["HEX", "RGB", "HSL"][i].into(),
                    None,
                    self.format_focus[i].clone(),
                )
            }),
            self.format,
            true,
            c,
            quietpro::ControlSize::Medium,
            move |format, win, cx| {
                let _ = view.update(cx, |t, cx| {
                    t.format = format;
                    cx.emit(FormatChanged(format));
                    t.sync_fields(win, cx);
                    cx.notify();
                });
            },
        );
        let mut fields = div().flex().items_center().gap(px(8.)).child(
            quietpro::caption(["HEX", "RGB", "HSL"][self.format], c)
                .font_weight(FontWeight::MEDIUM),
        );
        for index in if self.format == 0 { 0..1 } else { 1..4 } {
            fields = fields.child(
                quietpro::TextInput::new(("color-value", index), &self.fields[index], c)
                    .invalid(self.invalid),
            );
        }
        quietpro::color_picker_surface(c)
            .id("color-editor")
            .role(Role::Group)
            .aria_label(tr("mapping.color"))
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap(px(0.))
                    .child(quietpro::heading(tr("mapping.color")))
                    .child(div().flex_1())
                    .child(
                        IconControl::new(
                            "reset-color",
                            tr("mapping.restoreDefaultColor"),
                            Icon::RotateCcw,
                        )
                        .with_tooltip()
                        .action(
                            c,
                            cx.listener(|t, _, win, cx| {
                                t.value = t.default;
                                (t.hue, t.saturation, t.brightness) = hsv(t.default, t.hue);
                                t.sync_fields(win, cx);
                                cx.emit(Changed(None));
                                cx.notify();
                            }),
                        ),
                    )
                    .child(
                        IconControl::new(
                            "eyedropper",
                            tr("accessibility.color.eyedropper"),
                            Icon::Pipette,
                        )
                        .with_tooltip()
                        .track_focus(&self.pick_focus)
                        .disabled(self.picking.is_some())
                        .action(c, cx.listener(|t, _, win, cx| t.pick_screen_color(win, cx))),
                    ),
            )
            .child(sv)
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap(px(8.))
                    .child(formats)
                    .child(div().flex_1().child(hue)),
            )
            .child(fields)
            .when(self.pick_error, |view| {
                view.child(
                    div()
                        .id("screen-color-error")
                        .role(Role::Alert)
                        .aria_label(tr("accessibility.color.eyedropperUnsupported"))
                        .text_size(px(12.))
                        .text_color(c.danger)
                        .child(tr("accessibility.color.eyedropperUnsupported")),
                )
            })
    }
}

#[cfg(test)]
mod tests {
    use super::{from_hsv, hex, hsv, parse_hex};
    use gpui_kit::rgb;
    #[test]
    fn colors_round_trip_and_invalid_input_is_rejected() {
        for value in [
            "#35A69E", "#000000", "#FFFFFF", "#FF0000", "#808080", "#123456",
        ] {
            let c = parse_hex(value).unwrap();
            let (h, s, v) = hsv(c, 0.4);
            assert_eq!(hex(from_hsv(h, s, v)), value);
        }
        assert_eq!(hex(parse_hex("abc").unwrap()), "#AABBCC");
        for value in ["", "#12", "#12345678", "+12345", "#zzzzzz", "#１２３"] {
            assert!(parse_hex(value).is_none());
        }
        assert_eq!(hsv(rgb(0), 0.4).0, 0.4);
    }
}
