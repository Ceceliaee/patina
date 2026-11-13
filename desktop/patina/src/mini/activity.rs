use gpui_kit::{prelude::*, *};
use patina_recorder::Recent;
use quietpro::Palette;

use crate::format::duration;

pub(super) fn render(data: &Recent, colors: Palette) -> Div {
    let summary = div()
        .flex()
        .justify_between()
        .items_start()
        .pt(px(2.))
        .h(px(36.))
        .border_b_1()
        .border_color(colors.border)
        .child(
            div()
                .text_size(px(14.))
                .font_weight(FontWeight::MEDIUM)
                .child(duration(data.day_total_ms)),
        )
        .child(
            div()
                .pt(px(2.))
                .text_color(colors.secondary)
                .child(data.day_range.clone()),
        );
    let track = div()
        .relative()
        .w_full()
        .h(px(12.))
        .my(px(6.))
        .rounded(px(3.))
        .overflow_hidden()
        .bg(colors.track)
        .children(data.spans.iter().map(|span| {
            div()
                .absolute()
                .left(relative(span.left))
                .w(relative(span.width))
                .h_full()
                .bg(rgb(span.color))
        }));
    let axis = div()
        .flex()
        .justify_between()
        .h(px(18.))
        .text_color(colors.secondary)
        .child(data.hour_labels.0.clone())
        .child(data.hour_labels.1.clone());
    let leaders = div().mt(px(4.)).children(data.leaders.iter().map(|app| {
        div()
            .flex()
            .items_center()
            .gap(px(6.))
            .h(px(32.))
            .child(
                div()
                    .flex_none()
                    .size(px(5.))
                    .rounded_full()
                    .bg(rgb(app.color)),
            )
            .child(div().flex_1().min_w_0().truncate().child(app.name.clone()))
            .child(
                div()
                    .flex_none()
                    .text_color(colors.secondary)
                    .child(duration(app.duration_ms)),
            )
    }));
    div()
        .w_full()
        .flex()
        .flex_col()
        .px(px(12.))
        .py(px(10.))
        .text_size(px(12.))
        .child(summary)
        .child(div().mt(px(8.)).child(track).child(axis))
        .child(leaders)
}
