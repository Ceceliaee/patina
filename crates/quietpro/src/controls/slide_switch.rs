use crate::Palette;
use gpui_kit::{
    App, ClickEvent, Div, ElementId, IntoElement, RenderOnce, Rgba, SharedString, Window,
    base::Switch, div, prelude::*, px,
};
use std::{cell::Cell, time::Instant};

const SWITCH_GROUP: &str = "quietpro-slide-switch";

#[derive(Clone, Copy)]
struct Slide {
    from: f32,
    target: f32,
    started: Instant,
}

impl Slide {
    fn position(self, now: Instant) -> f32 {
        let t = (now.duration_since(self.started).as_secs_f32() / 0.12).min(1.);
        self.target + (self.from - self.target) * (1. - t).powi(2)
    }
}

#[derive(IntoElement)]
struct Thumb {
    checked: bool,
    fill: Rgba,
}

impl RenderOnce for Thumb {
    fn render(self, win: &mut Window, cx: &mut App) -> impl IntoElement {
        let target = if self.checked { 16. } else { 0. };
        let now = Instant::now();
        let state = win.use_keyed_state("slide-motion", cx, |_, _| {
            Cell::new(Slide {
                from: target,
                target,
                started: now,
            })
        });
        let cell = state.read(cx);
        let mut motion = cell.get();
        if motion.target != target || (cx.reduce_motion() && motion.from != target) {
            let from = if cx.reduce_motion() {
                target
            } else {
                motion.position(now)
            };
            motion = Slide {
                from,
                target,
                started: now,
            };
            cell.set(motion);
        }
        let pos = motion.position(now);
        if pos != target {
            win.request_animation_frame();
        }
        div()
            .size(px(12.))
            .flex_none()
            .rounded_full()
            .bg(self.fill)
            .ml(px(pos))
    }
}
/// A 36 × 20 px sliding switch with an independent 36 × 28 px hit target.
pub fn slide_switch(
    id: impl Into<ElementId>,
    label: impl Into<SharedString>,
    checked: bool,
    enabled: bool,
    colors: Palette,
    change: impl Fn(bool, &ClickEvent, &mut Window, &mut App) + 'static,
) -> Div {
    let label = label.into();
    let face = switch_control(id, label.clone(), checked, enabled, colors, change);
    div()
        .flex()
        .items_center()
        .justify_between()
        .gap(px(12.))
        .when(!enabled, |s| s.opacity(0.52))
        .child(div().text_color(colors.text).child(label))
        .child(face)
}

/// The switch alone, for headings with adjacent actions.
pub fn switch_control(
    id: impl Into<ElementId>,
    label: impl Into<SharedString>,
    checked: bool,
    enabled: bool,
    colors: Palette,
    change: impl Fn(bool, &ClickEvent, &mut Window, &mut App) + 'static,
) -> Switch {
    let dot = if checked {
        colors.control_fill
    } else {
        colors.switch_thumb_off
    };
    Switch::new(id)
        .group(SWITCH_GROUP)
        .accessibility_label(label)
        .checked(checked)
        .disabled(!enabled)
        .on_change(change)
        .relative()
        .w(px(36.))
        .h(px(28.))
        .rounded_full()
        .flex_none()
        .flex()
        .items_center()
        .justify_center()
        .border_1()
        .border_color(gpui_kit::transparent_black())
        .child(
            div()
                .id("track")
                .flex_none()
                .w(px(36.))
                .h(px(20.))
                .rounded_full()
                .flex()
                .items_center()
                .px(px(3.))
                .border_1()
                .border_color(colors.border)
                .bg(colors.switch_track)
                .when(enabled, |s| {
                    s.group_hover(SWITCH_GROUP, move |s| s.bg(colors.switch_track_hover))
                })
                .child(Thumb { checked, fill: dot }),
        )
        .when(enabled, |s| {
            s.cursor_pointer()
                .focus_visible(move |s| s.border_1().border_color(colors.secondary))
        })
}
