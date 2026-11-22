use super::{Mini, geometry::Monitor, native};
use gpui_kit::{prelude::*, *};

#[derive(Clone, Copy)]
pub(super) struct Drag {
    start: (i32, i32),
    grab: (f32, f32),
    threshold: f64,
    moving: bool,
}

impl Mini {
    pub(super) fn place_on(
        &mut self,
        monitor: Monitor,
        window: &Window,
        cx: &mut Context<Self>,
    ) -> Result<(), String> {
        let layout = monitor.layout(&self.preferences.placement);
        native::place(window, layout.panel)?;
        self.dock = Some((monitor, layout));
        self.clipped = None;
        cx.notify();
        Ok(())
    }

    pub(super) fn restore(
        &mut self,
        window: &Window,
        cx: &mut Context<Self>,
    ) -> Result<(), String> {
        self.place_on(
            native::restore_monitor(self.preferences.placement.monitor.as_ref())?,
            window,
            cx,
        )
    }

    pub(super) fn sync_environment(&mut self, window: &Window, cx: &mut Context<Self>) {
        if self.drag.is_none()
            && let Some((previous, _)) = &self.dock
            && let Ok(current) = native::window_monitor(window)
            && *previous != current
            && let Err(error) = self.place_on(current, window, cx)
        {
            eprintln!("adjust Mini to monitor: {error}");
        }
    }

    pub(super) fn persist(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.save_revision += 1;
        let revision = self.save_revision;
        let prefs = self.preferences.clone();
        let write = self.client.save_mini(prefs.clone());
        cx.spawn_in(window, async move |view, cx| {
            let result = write.await;
            let _ = view.update_in(cx, |mini, win, cx| match result {
                Ok(()) => mini.saved = prefs,
                Err(error) => {
                    eprintln!("save Mini placement: {error}");
                    if revision == mini.save_revision {
                        mini.preferences = mini.saved.clone();
                        mini.drag = None;
                        let _ = mini.restore(win, cx);
                        mini.expand(true, cx);
                        cx.notify();
                    }
                }
            });
        })
        .detach();
    }

    pub(super) fn drag_region(&self, cx: &Context<Self>) -> Div {
        div()
            .cursor(if self.drag.is_some_and(|d| d.moving) {
                CursorStyle::ClosedHand
            } else {
                CursorStyle::OpenHand
            })
            .on_mouse_down(
                MouseButton::Left,
                cx.listener(|this, e: &MouseDownEvent, window, cx| {
                    let Ok(start) = native::screen_point(window, e.position) else {
                        return;
                    };
                    this.drag = Some(Drag {
                        start,
                        grab: (e.position.x.into(), e.position.y.into()),
                        threshold: f64::from(4. * window.scale_factor()),
                        moving: false,
                    });
                    this.leave = None;
                    cx.notify();
                }),
            )
    }

    pub(super) fn cancel_drag(&mut self, window: &Window, cx: &mut Context<Self>) {
        if self.drag.take().is_some_and(|d| d.moving)
            && let Err(error) = self.restore(window, cx)
        {
            eprintln!("restore Mini after drag: {error}");
        }
        self.pointer_inside = None;
        cx.notify();
    }

    fn drag_to(
        &mut self,
        local: Point<Pixels>,
        released: bool,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Result<bool, String> {
        let Some(mut drag) = self.drag else {
            return Ok(false);
        };
        let point = native::screen_point(window, local)?;
        if !drag.moving {
            let dx = f64::from(point.0) - f64::from(drag.start.0);
            let dy = f64::from(point.1) - f64::from(drag.start.1);
            if dx.hypot(dy) < drag.threshold {
                if released {
                    self.drag = None;
                    self.pointer_inside = None;
                    cx.notify();
                }
                return Ok(false);
            }
            drag.moving = true;
            self.drag = Some(drag);
            self.expand(true, cx);
            self.motion = None;
            cx.notify();
        }
        let monitor = native::pointer_monitor(point)?;
        let panel = monitor.dragged_panel(point, drag.grab);
        if released {
            let previous = self.preferences.placement.clone();
            self.preferences.placement = monitor.released(&previous, panel);
            if let Err(error) = self.place_on(monitor, window, cx) {
                self.preferences.placement = previous;
                return Err(error);
            }
            self.drag = None;
            self.awaiting_entry = false;
            self.pointer_inside = None;
            self.persist(window, cx);
        } else {
            native::place(window, panel)?;
        }
        Ok(true)
    }

    pub(super) fn drag_events(&self, cx: &Context<Self>) -> impl IntoElement {
        let view = cx.weak_entity();
        canvas(
            |_, _, _| (),
            move |_, _, win, _| {
                let moving = view.clone();
                win.on_mouse_event(move |e: &MouseMoveEvent, phase, win, cx| {
                    if phase == DispatchPhase::Capture {
                        let _ = moving.update(cx, |mini, cx| {
                            if mini.drag.is_none() {
                                return;
                            }
                            if e.pressed_button != Some(MouseButton::Left) || !native::captured(win)
                            {
                                mini.cancel_drag(win, cx);
                            } else if let Err(error) = mini.drag_to(e.position, false, win, cx) {
                                eprintln!("drag Mini: {error}");
                                mini.cancel_drag(win, cx);
                            }
                        });
                    }
                });
                let up = view.clone();
                win.on_mouse_event(move |e: &MouseUpEvent, phase, win, cx| {
                    if phase == DispatchPhase::Capture && e.button == MouseButton::Left {
                        let _ = up.update(cx, |mini, cx| {
                            match mini.drag_to(e.position, true, win, cx) {
                                Ok(true) => cx.stop_propagation(),
                                Ok(false) => {}
                                Err(error) => {
                                    eprintln!("dock Mini: {error}");
                                    mini.cancel_drag(win, cx);
                                }
                            }
                        });
                    }
                });
            },
        )
        .absolute()
        .inset_0()
    }
}
