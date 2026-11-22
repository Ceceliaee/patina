use gpui_kit::{prelude::*, *};
use patina_activity_model::Recent;
use quietpro::Palette;

use crate::features::format::duration;

pub(super) fn render(data: &Recent, colors: Palette, dark: bool) -> Div {
    let activity_color = |source| quietpro::activity_display_color(source, colors.canvas, dark);
    let summary = div()
        .flex()
        .justify_between()
        .items_baseline()
        .pt(px(4.))
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
                .text_color(colors.secondary)
                .child(data.day_range.clone()),
        );
    let track = div()
        .relative()
        .w_full()
        .h(px(12.))
        .rounded(px(3.))
        .overflow_hidden()
        .bg(colors.track)
        .children(data.spans.iter().map(|span| {
            div()
                .absolute()
                .left(relative(span.left))
                .w(relative(span.width))
                .h_full()
                .bg(activity_color(span.color))
        }));
    let axis = div()
        .flex()
        .justify_between()
        .h(px(18.))
        .text_color(colors.secondary)
        .child(data.hour_labels.0.clone())
        .child(data.hour_labels.1.clone());
    let leaders = div()
        .flex_none()
        .mt(px(4.))
        .children(data.leaders.iter().map(|app| {
            div()
                .flex()
                .items_center()
                .gap(px(8.))
                .h(px(32.))
                .child(
                    div()
                        .flex_none()
                        .size(px(5.))
                        .rounded_full()
                        .bg(activity_color(app.color)),
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
        .flex_1()
        .min_h_0()
        .p(px(12.))
        .text_size(px(12.))
        .child(summary)
        .child(
            div()
                .flex()
                .flex_col()
                .flex_none()
                .mt(px(12.))
                .gap(px(8.))
                .child(track)
                .child(axis),
        )
        .child(leaders)
}

#[cfg(all(test, feature = "test-support"))]
mod tests {
    use super::{Palette, Recent, render};
    use gpui_kit::prelude::*;
    use gpui_kit::test::TestWindowExt;
    use gpui_kit::{
        AppContext, Context, IntoElement, Render, TestAppContext, Window, WindowOptions, div, px,
        rgb,
    };
    use patina_activity_model::views::recent::{Leader, Span};

    #[gpui_kit::test]
    fn track_and_three_leaders_fit_the_mini_insets_in_each_theme(cx: &mut TestAppContext) {
        struct Preview(bool);
        impl Render for Preview {
            fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
                let dark = self.0;
                let color = if dark { 0 } else { 0xffffff };
                let data = Recent {
                    spans: vec![Span {
                        left: 0.,
                        width: 0.5,
                        color,
                    }],
                    leaders: ["Editor", "Browser", "Notes"]
                        .map(|name| Leader {
                            name: name.into(),
                            duration_ms: 60_000,
                            color,
                        })
                        .into(),
                    hour_labels: ("15:00".into(), "16:00".into()),
                    day_range: "15:00–16:00".into(),
                    day_total_ms: 60_000,
                };
                let (width, height) = crate::MINI_PANEL_SIZE_DIP;
                div()
                    .flex()
                    .flex_col()
                    .w(px(width))
                    .h(px(height - 32.))
                    .child(render(&data, Palette::for_scheme(dark, "default"), dark))
            }
        }
        cx.update(gpui_kit::init);
        let (handle, preview) = cx.update(|cx| {
            gpui_kit::open_window(WindowOptions::default(), cx, |_, cx| {
                cx.new(|_| Preview(false))
            })
            .unwrap()
        });
        cx.update_window(handle, |_, window, cx| {
            for dark in [false, true] {
                preview.update(cx, |p, cx| {
                    p.0 = dark;
                    cx.notify();
                });
                window.render_frame(cx);
                let canvas = Palette::for_scheme(dark, "default").canvas;
                let source = if dark { 0 } else { 0xffffff };
                let expected = quietpro::activity_display_color(source, canvas, dark);
                assert_ne!(expected, rgb(source));
                let scale = window.scale_factor();
                let quads = window.painted_quads();
                assert!(quads.iter().any(|q| q.background == expected.into()
                    && q.bounds.size.height == px(12.).scale(scale)));
                let dots: Vec<_> = quads
                    .iter()
                    .filter(|q| {
                        q.background == expected.into()
                            && q.bounds.size.height == px(5.).scale(scale)
                    })
                    .map(|q| q.bounds)
                    .collect();
                assert_eq!(dots.len(), 3);
                assert!(dots.iter().all(|dot| dot.left() == px(12.).scale(scale)));
                let last_center = dots.iter().map(|dot| dot.center().y).max().unwrap();
                let expected_center =
                    px(crate::MINI_PANEL_SIZE_DIP.1 - 32. - 12. - 16.).scale(scale);
                assert!((last_center - expected_center).as_f32().abs() <= scale);
            }
        })
        .unwrap();
    }
}
