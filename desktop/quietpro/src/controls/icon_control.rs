use crate::{Icon, Palette, glyph};
use gpui_kit::{
    App, ClickEvent, ElementId, PathBuilder, SharedString, Window,
    base::{Button, Toggle},
    canvas, div, point,
    prelude::*,
    px, transparent_black,
};
use std::{f32::consts::TAU, sync::LazyLock};

const CONTROL_GROUP: &str = "quietpro-icon-control";

// Polar radius of |x|^4 + |y|^4 = 1, sampled at equal angles.
static CONTOUR: LazyLock<[(f32, f32); 64]> = LazyLock::new(|| {
    std::array::from_fn(|i| {
        let (y, x) = (TAU * i as f32 / 64.).sin_cos();
        let radius = (x.powi(4) + y.powi(4)).sqrt().sqrt().recip();
        (x * radius, y * radius)
    })
});

fn surface(outline: bool) -> impl IntoElement {
    canvas(
        |_, _, _| (),
        move |bounds, (), window, _| {
            let color = window.text_style().color;
            if color.a == 0. {
                return;
            }
            let (bounds, mut path) = if outline {
                (bounds.inset(px(0.5)), PathBuilder::stroke(px(1.)))
            } else {
                (bounds, PathBuilder::fill())
            };
            let center = bounds.center();
            let points = CONTOUR.map(|(x, y)| {
                point(
                    center.x + bounds.size.width * (0.5 * x),
                    center.y + bounds.size.height * (0.5 * y),
                )
            });
            path.add_polygon(&points, true);
            if let Ok(path) = path.build() {
                window.paint_path(path, color);
            }
        },
    )
    .absolute()
    .inset_0()
}

fn control<C: Styled + StatefulInteractiveElement + ParentElement + FluentBuilder>(
    control: C,
    colors: Palette,
    icon: Icon,
    disabled: bool,
    pressed: bool,
) -> C {
    let fill = div()
        .id("surface")
        .absolute()
        .inset_0()
        .text_color(if pressed {
            colors.hover
        } else {
            transparent_black().into()
        })
        .when(!disabled && !pressed, |s| {
            s.group_hover(CONTROL_GROUP, move |s| {
                s.text_color(colors.secondary.opacity(0.08))
            })
        })
        .when(!disabled, |s| {
            s.group_active(CONTROL_GROUP, move |s| {
                s.text_color(if pressed {
                    colors.accent.opacity(0.20)
                } else {
                    colors.track
                })
            })
        })
        .child(surface(false));
    let icon_color = if disabled {
        colors.disabled_text
    } else if pressed {
        colors.accent
    } else {
        colors.secondary
    };
    control
        .group(CONTROL_GROUP)
        .relative()
        .flex()
        .items_center()
        .justify_center()
        .flex_none()
        .size(px(28.))
        .text_color(if pressed {
            colors.accent.opacity(0.35)
        } else {
            transparent_black().into()
        })
        .when(!disabled, |s| {
            s.cursor_pointer()
                .focus_visible(move |s| s.text_color(colors.accent))
        })
        .child(fill)
        .child(surface(true))
        .child(glyph(icon, icon_color).size(px(16.)))
}

/// An icon-only control always has an identity and an accessible name.
pub struct IconControl {
    id: ElementId,
    label: SharedString,
    icon: Icon,
    disabled: bool,
}

impl IconControl {
    pub fn new(id: impl Into<ElementId>, label: impl Into<SharedString>, icon: Icon) -> Self {
        Self {
            id: id.into(),
            label: label.into(),
            icon,
            disabled: false,
        }
    }

    pub fn disabled(mut self, disabled: bool) -> Self {
        self.disabled = disabled;
        self
    }

    pub fn action(
        self,
        colors: Palette,
        click: impl Fn(&ClickEvent, &mut Window, &mut App) + 'static,
    ) -> impl IntoElement {
        control(
            Button::new(self.id)
                .accessibility_label(self.label)
                .disabled(self.disabled),
            colors,
            self.icon,
            self.disabled,
            false,
        )
        .on_click(click)
    }

    /// The caller owns the selected value. A pointer or keyboard activation
    /// proposes the next value exactly once through the same callback.
    pub fn toggle(
        self,
        colors: Palette,
        pressed: bool,
        change: impl Fn(bool, &ClickEvent, &mut Window, &mut App) + 'static,
    ) -> impl IntoElement {
        control(
            Toggle::new(self.id)
                .pressed(pressed)
                .accessibility_label(self.label)
                .disabled(self.disabled),
            colors,
            self.icon,
            self.disabled,
            pressed,
        )
        .on_change(change)
    }
}
