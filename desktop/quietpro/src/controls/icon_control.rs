use crate::{Icon, Palette, glyph, superellipse::superellipse_layer};
use gpui_kit::{
    App, ClickEvent, ElementId, FocusHandle, SharedString, Window,
    base::{Button, Toggle},
    div,
    prelude::*,
    px, transparent_black,
};

const CONTROL_GROUP: &str = "quietpro-icon-control";
pub const ICON_CONTROL_SIZE: f32 = 28.;

pub(crate) fn control_surface<
    C: Styled + StatefulInteractiveElement + ParentElement + FluentBuilder,
>(
    control: C,
    colors: Palette,
    disabled: bool,
) -> C {
    let fill = div()
        .id("surface")
        .absolute()
        .inset_0()
        .text_color(transparent_black())
        .when(!disabled, |s| {
            s.group_hover(CONTROL_GROUP, move |s| {
                s.text_color(colors.secondary.opacity(0.08))
            })
        })
        .when(!disabled, |s| {
            s.group_active(CONTROL_GROUP, move |s| s.text_color(colors.track))
        })
        .child(superellipse_layer(false));
    control
        .group(CONTROL_GROUP)
        .relative()
        .flex()
        .items_center()
        .justify_center()
        .flex_none()
        .size(px(ICON_CONTROL_SIZE))
        .text_color(transparent_black())
        .when(!disabled, |s| {
            s.cursor_pointer()
                .focus_visible(move |s| s.text_color(colors.secondary))
        })
        .child(fill)
        .child(superellipse_layer(true))
}

fn control<C: Styled + StatefulInteractiveElement + ParentElement + FluentBuilder>(
    control: C,
    colors: Palette,
    icon: Icon,
    disabled: bool,
    icon_data: Option<&'static [u8]>,
) -> C {
    let icon_color = if disabled {
        colors.disabled_text
    } else {
        colors.secondary
    };
    control_surface(control, colors, disabled).child(
        glyph(icon, icon_color)
            .when_some(icon_data, |icon, data| icon.data(data))
            .size(px(16.)),
    )
}

/// An icon-only control always has an identity and an accessible name.
pub struct IconControl {
    id: ElementId,
    label: SharedString,
    icon: Icon,
    disabled: bool,
    focus: Option<FocusHandle>,
    selected_icon: Option<&'static [u8]>,
}

impl IconControl {
    pub fn new(id: impl Into<ElementId>, label: impl Into<SharedString>, icon: Icon) -> Self {
        Self {
            id: id.into(),
            label: label.into(),
            icon,
            disabled: false,
            focus: None,
            selected_icon: None,
        }
    }

    pub fn disabled(mut self, disabled: bool) -> Self {
        self.disabled = disabled;
        self
    }

    pub fn track_focus(mut self, focus: &FocusHandle) -> Self {
        self.focus = Some(focus.clone());
        self
    }

    /// A functional toggle can distinguish its enabled state with a different glyph.
    pub fn selected_icon(mut self, svg: &'static [u8]) -> Self {
        self.selected_icon = Some(svg);
        self
    }

    pub fn button(self, colors: Palette) -> Button {
        control(
            Button::new(self.id)
                .when_some(self.focus, |button, focus| button.track_focus(&focus))
                .accessibility_label(self.label)
                .disabled(self.disabled),
            colors,
            self.icon,
            self.disabled,
            None,
        )
    }

    pub fn action(
        self,
        colors: Palette,
        click: impl Fn(&ClickEvent, &mut Window, &mut App) + 'static,
    ) -> impl IntoElement {
        self.button(colors).on_click(click)
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
                .when_some(self.focus, |button, focus| button.track_focus(&focus))
                .pressed(pressed)
                .accessibility_label(self.label)
                .disabled(self.disabled),
            colors,
            self.icon,
            self.disabled,
            self.selected_icon.filter(|_| pressed),
        )
        .on_change(change)
    }
}
