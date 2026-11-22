use gpui_kit::{base::Button, prelude::*, *};
use quietpro::{Icon, Palette};

pub(super) const MAIN_TITLEBAR_HEIGHT: f32 = 36.;
const GROUP: &str = "window-caption-button";

#[cfg(all(test, feature = "test-support", feature = "native-tests"))]
mod tests;

pub(super) enum Caption {
    Main,
    Mini,
}

impl Caption {
    pub(super) fn button(
        self,
        id: &'static str,
        label: String,
        icon: Icon,
        colors: Palette,
    ) -> Button {
        let (hover, active, ink) = match icon {
            Icon::X => (
                colors.panel.blend(colors.danger.opacity(0.11)),
                colors.panel.blend(colors.danger.opacity(0.17)),
                colors.danger,
            ),
            _ => (colors.secondary.opacity(0.08), colors.track, colors.text),
        };
        let button = Button::new(id)
            .accessibility_label(label)
            .group(GROUP)
            .flex_none()
            .cursor_pointer();
        let button = match self {
            Self::Main => button
                .size(px(MAIN_TITLEBAR_HEIGHT))
                .hover(move |s| s.bg(hover))
                .active(move |s| s.bg(active))
                .focus_visible(move |s| s.border_1().border_color(colors.secondary)),
            Self::Mini => button
                .relative()
                .size(px(quietpro::ICON_CONTROL_SIZE))
                .text_color(transparent_black())
                .focus_visible(move |s| s.text_color(colors.secondary))
                .child(
                    div()
                        .id("surface")
                        .absolute()
                        .inset_0()
                        .text_color(transparent_black())
                        .group_hover(GROUP, move |s| s.text_color(hover))
                        .group_active(GROUP, move |s| s.text_color(active))
                        .child(quietpro::superellipse_layer(false)),
                )
                .child(quietpro::superellipse_layer(true)),
        };
        button.child(
            quietpro::glyph(icon, colors.secondary)
                .id("glyph")
                .size(px(16.))
                .group_hover(GROUP, move |s| s.text_color(ink))
                .group_active(GROUP, move |s| s.text_color(ink)),
        )
    }
}
