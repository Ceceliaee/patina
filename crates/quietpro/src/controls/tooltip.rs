use crate::{Palette, continuous_frame};
use gpui_kit::base::TestSupportExt;
use gpui_kit::{prelude::*, *};

pub fn tooltip_surface(colors: Palette) -> Div {
    // GPUI paints tooltips outside the window's styled root.
    let mut surface = continuous_frame(px(12.), colors.border, colors.panel);
    crate::typography::apply_ui_fonts(&mut surface);
    surface
        .flex_col()
        .px(px(12.))
        .py(px(8.))
        .max_w(px(320.))
        .text_size(px(12.))
        .line_height(px(16.))
        .font_weight(FontWeight::NORMAL)
        .text_color(colors.text)
}

pub struct TextTooltip(pub SharedString, pub Palette, pub Bounds<Pixels>);

pub fn with_text_tooltip<E>(element: E, text: impl Into<SharedString>, colors: Palette) -> E
where
    E: Styled + StatefulInteractiveElement + ParentElement,
{
    let text = text.into();
    let bounds = std::rc::Rc::new(std::cell::Cell::new(Bounds::<Pixels>::default()));
    let tip_bounds = bounds.clone();
    element
        .child(
            canvas(move |rect, _, _| bounds.set(rect), |_, _, _, _| {})
                .absolute()
                .inset_0(),
        )
        .tooltip(move |_, cx| {
            cx.new(|_| TextTooltip(text.clone(), colors, tip_bounds.get()))
                .into()
        })
}

impl Render for TextTooltip {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        gpui_kit::base::Positioner::side(self.2)
            .placement(gpui_kit::base::Placement::Top)
            .offset(px(8.))
            .margin(px(4.))
            .child(
                tooltip_surface(self.1)
                    .id("quietpro-text-tooltip")
                    .test_support()
                    .role(Role::Tooltip)
                    .aria_label(self.0.clone())
                    .child(self.0.clone()),
            )
    }
}
