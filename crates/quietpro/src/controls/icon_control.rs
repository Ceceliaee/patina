use crate::{Icon, Palette, glyph, superellipse::superellipse_layer};
use gpui_kit::{
    App, ClickEvent, ElementId, FocusHandle, Pixels, SharedString, Window,
    base::{Button, TestSupportExt, Toggle},
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
    highlighted: bool,
) -> C {
    let hover_fill = colors
        .secondary
        .opacity(if highlighted { 0.12 } else { 0.08 });
    let active_fill = if highlighted {
        colors.secondary.opacity(0.20)
    } else {
        colors.track
    };
    let fill = div()
        .id("surface")
        .absolute()
        .inset_0()
        .text_color(transparent_black())
        .when(highlighted && !disabled, |s| s.text_color(hover_fill))
        .when(!disabled, |s| {
            s.group_hover(CONTROL_GROUP, move |s| s.text_color(hover_fill))
        })
        .when(!disabled, |s| {
            s.group_active(CONTROL_GROUP, move |s| s.text_color(active_fill))
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
    icon_size: Pixels,
    disabled: bool,
    highlighted: bool,
) -> C {
    let icon_color = if disabled {
        colors.disabled_text
    } else {
        colors.secondary
    };
    control_surface(control, colors, disabled, highlighted).child(
        glyph(icon, icon_color)
            .size(icon_size)
            .id("glyph")
            .test_support(),
    )
}

/// An icon-only control always has an identity and an accessible name.
pub struct IconControl {
    id: ElementId,
    label: SharedString,
    icon: Icon,
    icon_size: Pixels,
    disabled: bool,
    focus: Option<FocusHandle>,
    selected_background: bool,
    tooltip: bool,
}

impl IconControl {
    pub fn new(id: impl Into<ElementId>, label: impl Into<SharedString>, icon: Icon) -> Self {
        Self {
            id: id.into(),
            label: label.into(),
            icon,
            icon_size: px(16.),
            disabled: false,
            focus: None,
            selected_background: false,
            tooltip: false,
        }
    }

    pub fn icon_size(mut self, size: Pixels) -> Self {
        self.icon_size = size;
        self
    }

    pub fn disabled(mut self, disabled: bool) -> Self {
        self.disabled = disabled;
        self
    }

    pub fn with_tooltip(mut self) -> Self {
        self.tooltip = true;
        self
    }

    pub fn track_focus(mut self, focus: &FocusHandle) -> Self {
        self.focus = Some(focus.clone());
        self
    }

    pub fn with_selected_background(mut self) -> Self {
        self.selected_background = true;
        self
    }

    pub fn button(self, colors: Palette) -> Button {
        let tip = self.label.clone();
        control(
            Button::new(self.id)
                .when_some(self.focus, |button, focus| button.track_focus(&focus))
                .accessibility_label(self.label)
                .disabled(self.disabled)
                .when(self.tooltip, |button| {
                    crate::with_text_tooltip(button, tip, colors)
                }),
            colors,
            self.icon,
            self.icon_size,
            self.disabled,
            false,
        )
    }

    pub fn action(
        self,
        colors: Palette,
        click: impl Fn(&ClickEvent, &mut Window, &mut App) + 'static,
    ) -> Button {
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
        let tip = self.label.clone();
        control(
            Toggle::new(self.id)
                .when_some(self.focus, |button, focus| button.track_focus(&focus))
                .pressed(pressed)
                .accessibility_label(self.label)
                .disabled(self.disabled)
                .when(self.tooltip, |button| {
                    crate::with_text_tooltip(button, tip, colors)
                }),
            colors,
            self.icon,
            self.icon_size,
            self.disabled,
            self.selected_background && pressed,
        )
        .on_change(change)
    }
    /// A group policy reports indeterminate state when its members differ.
    pub fn mixed_toggle(
        self,
        colors: Palette,
        checked: bool,
        mixed: bool,
        change: impl Fn(bool, &ClickEvent, &mut Window, &mut App) + 'static,
    ) -> impl IntoElement {
        let tip = self.label.clone();
        control(
            gpui_kit::base::Checkbox::new(self.id)
                .when_some(self.focus, |button, focus| button.track_focus(&focus))
                .checked(checked)
                .indeterminate(mixed)
                .accessibility_label(self.label)
                .disabled(self.disabled)
                .when(self.tooltip, |button| {
                    crate::with_text_tooltip(button, tip, colors)
                }),
            colors,
            self.icon,
            self.icon_size,
            self.disabled,
            false,
        )
        .on_change(move |state, event, win, cx| {
            change(
                state == gpui_kit::base::CheckboxState::Checked,
                event,
                win,
                cx,
            )
        })
    }
}
