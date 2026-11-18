use crate::Palette;
use gpui_kit::{
    base::{Slider, SliderIndicator, SliderThumb, SliderTrack, slider::SliderState},
    prelude::*,
    *,
};

pub fn value_slider(
    state: &Entity<SliderState>,
    label: String,
    enabled: bool,
    c: Palette,
    cx: &App,
) -> Slider {
    let progress = relative(state.read(cx).percentage().end);
    let rail = SliderIndicator::new(state)
        .relative()
        .w_full()
        .h(px(4.))
        .rounded_full()
        .bg(c.track)
        .child(div().w(progress).h_full().rounded_full().bg(c.control_fill))
        .child(
            SliderThumb::new(state)
                .disabled(!enabled)
                .when(enabled, |s| s.cursor_pointer())
                .absolute()
                .left(progress)
                .ml(px(-6.))
                .top(px(-4.))
                .size(px(12.))
                .rounded_full()
                .bg(c.control_fill),
        );
    Slider::new(state)
        .accessibility_label(label)
        .disabled(!enabled)
        .w(px(112.))
        .h(px(28.))
        .flex_none()
        .when(enabled, |s| s.cursor_pointer())
        .when(!enabled, |s| s.opacity(0.52))
        .child(
            SliderTrack::new(state)
                .disabled(!enabled)
                .relative()
                .size_full()
                .when(enabled, |s| s.cursor_pointer())
                .px(px(6.))
                .flex()
                .items_center()
                .child(rail),
        )
}
