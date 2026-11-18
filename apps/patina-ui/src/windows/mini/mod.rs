mod activity;
pub(crate) mod geometry;
mod interaction;
mod native;
use geometry::logical_dock_bounds;
use gpui_kit::{prelude::*, *};
use interaction::{Interaction, LEAVE_GRACE, motion_progress};
use patina_activity_model::CurrentActivity;
use quietpro::{Icon, IconControl, Palette};
use std::{rc::Rc, time::Instant};

#[derive(Clone, Copy, Eq, PartialEq)]
enum StatusTone {
    Idle,
    Recording,
    Paused,
    Failed,
}

impl StatusTone {
    fn for_activity(activity: &CurrentActivity) -> Self {
        match activity {
            CurrentActivity::Application(_) | CurrentActivity::Anonymous => Self::Recording,
            CurrentActivity::Paused => Self::Paused,
            CurrentActivity::Unavailable => Self::Failed,
            CurrentActivity::Waiting | CurrentActivity::Inactive => Self::Idle,
        }
    }

    fn color(self, palette: Palette) -> Rgba {
        match self {
            Self::Idle => palette.secondary,
            Self::Recording => palette.success,
            Self::Paused => palette.warning,
            Self::Failed => palette.danger,
        }
    }
}

pub struct Mini {
    tone: StatusTone,
    focus: FocusHandle,
    interaction: Interaction,
    pinned: bool,
    leave: Option<Task<()>>,
    pointer_inside: Option<bool>,
    awaiting_entry: bool,
    recent: Option<Result<patina_activity_model::Recent, patina_desktop_protocol::RequestError>>,
    read: Option<Task<()>>,
    client: Rc<crate::client::Client>,
    motion: Option<(Instant, f32)>,
    progress: f32,
    clipped: Option<(Bounds<Pixels>, f32)>,
}

impl Mini {
    pub fn open(
        cx: &mut App,
        client: Rc<crate::client::Client>,
        focus: bool,
    ) -> Result<(AnyWindowHandle, WeakEntity<Self>)> {
        let area = cx.primary_display().map(|d| d.visible_bounds());
        let options = WindowOptions {
            window_bounds: area.map(|work| {
                let mut bounds = logical_dock_bounds(work.size, true);
                bounds.origin += work.origin;
                WindowBounds::Windowed(bounds)
            }),
            app_id: Some(crate::APP_ID.into()),
            kind: WindowKind::PopUp,
            titlebar: None,
            focus,
            is_movable: false,
            is_resizable: false,
            is_minimizable: false,
            ..Default::default()
        };
        let (handle, view) = gpui_kit::open_window(options, cx, |window, cx| {
            window.set_window_title("Patina Mini");
            crate::windows::handle_close(window, cx);
            cx.new(|cx: &mut Context<Self>| {
                cx.observe_window_appearance(window, |_, _, cx| cx.notify())
                    .detach();
                cx.observe_window_activation(window, |mini, window, cx| {
                    mini.sync_pointer(window, cx);
                })
                .detach();
                let mut mini = Self {
                    tone: StatusTone::for_activity(&client.current_activity()),
                    focus: cx.focus_handle(),
                    interaction: Interaction {
                        expanded: true,
                        ..Default::default()
                    },
                    pinned: false,
                    leave: None,
                    pointer_inside: None,
                    awaiting_entry: true,
                    recent: None,
                    read: None,
                    client,
                    motion: None,
                    progress: 1.,
                    clipped: None,
                };
                mini.read_recent(cx);
                if focus {
                    window.focus(&mini.focus, cx);
                }
                mini
            })
        })?;
        handle
            .update(cx, |_, win, _| {
                let placed = native::place(win);
                if placed.is_err() {
                    win.remove_window();
                }
                placed
            })?
            .map_err(std::io::Error::other)?;
        Ok((handle, view.downgrade()))
    }

    pub fn reopen(&mut self, focus: bool, window: &mut Window, cx: &mut Context<Self>) {
        self.expand(true, cx);
        if focus {
            window.activate_window();
            window.focus(&self.focus, cx);
        }
    }

    fn expand(&mut self, value: bool, cx: &mut Context<Self>) {
        if !value && self.pinned {
            return;
        }
        self.leave = None;
        self.pointer_inside = None;
        self.awaiting_entry = value;
        let mut next = self.interaction.clone();
        if value {
            next.reveal();
        } else {
            next.expanded = false;
            next.require_leave = true;
            next.leave_since = None;
        }
        self.apply(next, cx);
    }

    fn apply(&mut self, next: Interaction, cx: &mut Context<Self>) {
        let changed = self.interaction.expanded != next.expanded;
        self.interaction = next;
        if !changed {
            return;
        }
        self.motion = (!cx.reduce_motion() && native::animations_enabled())
            .then(|| (Instant::now(), self.progress));
        if self.interaction.expanded {
            self.read_recent(cx);
        } else {
            self.read = None;
        }
        cx.notify();
    }

    fn read_recent(&mut self, cx: &mut Context<Self>) {
        if !self.interaction.expanded {
            return;
        }
        // Dropping the GPUI waiter on hide/replacement prevents delivery into
        // a newer view. SQL only reads the experiment database.
        let client = self.client.clone();
        self.read = Some(cx.spawn(async move |view, cx| {
            loop {
                let data = client.recent().await;
                if view
                    .update(cx, |v, cx| {
                        v.recent = Some(data);
                        cx.notify();
                    })
                    .is_err()
                {
                    break;
                }
                cx.background_executor()
                    .timer(std::time::Duration::from_secs(60))
                    .await;
            }
        }));
    }

    fn sync_pointer(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let inside = native::contains_cursor(window);
        if inside {
            self.awaiting_entry = false;
        }
        let protected = self.awaiting_entry
            || self.pinned
            || (window.is_window_active()
                && window.last_input_was_keyboard()
                && !self.focus.is_focused(window)
                && self.focus.contains_focused(window, cx));
        if self.pointer_inside == Some(inside) && self.interaction.protected == protected {
            return;
        }
        self.pointer_inside = Some(inside);
        self.leave = None;
        let mut next = self.interaction.clone();
        next.protected = protected;
        next.observe_pointer(inside, Instant::now());
        let deadline = next.leave_since.map(|t| t + LEAVE_GRACE);
        self.apply(next, cx);
        if let Some(deadline) = deadline {
            self.leave = Some(cx.spawn_in(window, async move |view, cx| {
                cx.background_executor()
                    .timer(deadline.saturating_duration_since(Instant::now()))
                    .await;
                let _ = view.update_in(cx, |v, window, cx| {
                    v.pointer_inside = None;
                    v.sync_pointer(window, cx)
                });
            }));
        }
    }
}

impl Mini {
    fn text(&self, key: &str) -> String {
        patina_i18n::text(self.client.locale.get(), key)
    }

    fn header(&self, colors: Palette, cx: &Context<Self>) -> Div {
        let view = cx.weak_entity();
        let pin = IconControl::new("pin", self.text("miniWindow.hold"), Icon::Pin)
            .selected_icon(quietpro::FILLED_PIN_ICON)
            .toggle(colors, self.pinned, move |held, _, window, cx| {
                let _ = view.update(cx, |mini, cx| {
                    mini.pinned = held;
                    mini.sync_pointer(window, cx);
                    cx.notify();
                });
            });
        let client = self.client.clone();
        let main = IconControl::new(
            "open-main",
            self.text("accessibility.miniWindow.openMainWindow"),
            Icon::SquareArrowOutUpRight,
        )
        .action(colors, move |_, _, _| {
            client.open(patina_desktop_protocol::Target::Today);
        });
        let close = IconControl::new("close", self.text("common.close"), Icon::X)
            .action(colors, |_, window, _| window.remove_window());
        div()
            .flex()
            .items_center()
            .justify_between()
            .w_full()
            .flex_none()
            .h(px(32.))
            .px(px(8.))
            .bg(colors.chrome)
            .border_b_1()
            .border_color(colors.border)
            .child(quietpro::glyph(Icon::AppWindow, self.tone.color(colors)))
            .child(
                quietpro::icon_actions()
                    .children(self.client.shortcut_buttons(true))
                    .child(pin)
                    .child(main)
                    .child(close),
            )
    }

    pub fn recording_changed(&mut self, cx: &mut Context<Self>) {
        let next = StatusTone::for_activity(&self.client.current_activity());
        if self.interaction.expanded || next != self.tone {
            self.tone = next;
            cx.notify();
        }
    }

    fn content(&self, colors: Palette) -> Div {
        match &self.recent {
            Some(Ok(data)) => activity::render(data, colors),
            other => div()
                .flex_1()
                .flex()
                .items_center()
                .justify_center()
                .text_color(colors.secondary)
                .child(self.text(if other.is_some() {
                    "miniWindow.failed"
                } else {
                    "common.loading"
                })),
        }
    }

    fn expand_button(&self, colors: Palette, cx: &Context<Self>) -> gpui_kit::base::Button {
        let status = self.text(match self.tone {
            StatusTone::Idle => "miniWindow.idle",
            StatusTone::Recording => "miniWindow.tracking",
            StatusTone::Paused => "miniWindow.paused",
            StatusTone::Failed => "miniWindow.failed",
        });
        gpui_kit::base::Button::new("expand")
            .accessibility_label(format!("{} · {status}", self.text("miniWindow.open")))
            .size_full()
            .flex()
            .items_center()
            .justify_center()
            .focus_visible(move |s| s.border_1().border_color(colors.secondary))
            .child(Self::mark(self.tone.color(colors)))
            .on_click(cx.listener(|this, _, _, cx| this.expand(true, cx)))
    }

    fn mark(color: Rgba) -> Div {
        div().w(px(38.)).h(px(4.)).rounded(px(3.)).bg(color)
    }
}

impl Render for Mini {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        // Windows reports a native mouse leave as a hover-status refresh. It may not
        // deliver another MouseMove to the panel, especially across a child control.
        self.sync_pointer(window, cx);
        let target = if self.interaction.expanded { 1. } else { 0. };
        self.progress = motion_progress(target, self.motion, Instant::now(), cx.reduce_motion());
        if self.progress == target {
            self.motion = None;
            if !self.interaction.expanded {
                self.recent = None;
            }
        } else {
            window.request_animation_frame();
        }
        let p = self.progress * self.progress * (3. - 2. * self.progress);
        let viewport = window.viewport_size();
        let handle = logical_dock_bounds(viewport, false).size;
        let width = handle.width * (1. - p) + viewport.width * p;
        let height = handle.height * (1. - p) + viewport.height * p;
        let bounds = Bounds {
            origin: point((viewport.width - width) / 2., px(0.)),
            size: size(width, height),
        };
        let clip = (bounds, window.scale_factor());
        if width > px(0.) && height > px(0.) && self.clipped != Some(clip) {
            match native::clip(window, bounds) {
                Ok(()) => self.clipped = Some(clip),
                Err(error) => eprintln!("clip Mini: {error}"),
            }
        }
        let colors = self.client.palette(window);
        let panel = div()
            .id("panel")
            .track_focus(&self.focus)
            .aria_label(self.text("miniWindow.title"))
            .absolute()
            .left(bounds.origin.x)
            .top_0()
            .w(width)
            .h(height)
            .flex()
            .flex_col()
            .bg(if p == 0. { colors.panel } else { colors.canvas })
            .rounded(px(8.))
            .border_1()
            .border_color(colors.border)
            .overflow_hidden()
            .font_family("Segoe UI")
            .text_size(px(14.))
            .text_color(colors.text)
            .on_hover(cx.listener(|this, _: &bool, win, cx| {
                this.sync_pointer(win, cx);
            }))
            .on_key_down(cx.listener(|this, event: &KeyDownEvent, _, cx| {
                if event.keystroke.key == "escape" {
                    this.expand(false, cx);
                    cx.stop_propagation();
                }
            }));
        let panel = panel
            .when(p > 0., |panel| {
                panel.child(
                    div()
                        .absolute()
                        .left_0()
                        .top_0()
                        .w(viewport.width)
                        .h(viewport.height)
                        .opacity(p)
                        .flex()
                        .flex_col()
                        .child(self.header(colors, cx))
                        .child(self.content(colors)),
                )
            })
            .when(p < 1., |panel| {
                panel.child(
                    div()
                        .absolute()
                        .inset_0()
                        .opacity(1. - p)
                        .when(
                            self.interaction.expanded || self.motion.is_some(),
                            |marker| {
                                marker
                                    .flex()
                                    .items_center()
                                    .justify_center()
                                    .child(Self::mark(self.tone.color(colors)))
                            },
                        )
                        .when(
                            !self.interaction.expanded && self.motion.is_none(),
                            |marker| marker.child(self.expand_button(colors, cx)),
                        ),
                )
            });
        div().relative().size_full().child(panel)
    }
}
