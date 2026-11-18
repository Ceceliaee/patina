use crate::Palette;
use gpui_kit::{prelude::*, *};

/// Read-only summary values; labels and formatted values belong to the consumer.
#[derive(IntoElement)]
pub struct MetricGroup {
    pub id: ElementId,
    pub items: [(String, String); 4],
    pub colors: Palette,
}

impl RenderOnce for MetricGroup {
    fn render(self, win: &mut Window, cx: &mut App) -> impl IntoElement {
        let c = self.colors;
        let required = self
            .items
            .iter()
            .map(|(label, value)| {
                [
                    (label, 12., FontWeight::NORMAL),
                    (value, 18., FontWeight::SEMIBOLD),
                ]
                .into_iter()
                .map(|(text, size, weight)| {
                    let mut run = win.text_style().to_run(text.len());
                    run.font.weight = weight;
                    f32::from(
                        win.text_system()
                            .shape_line(text.clone().into(), px(size), &[run], None)
                            .width,
                    )
                })
                .fold(0_f32, f32::max)
            })
            .fold(0_f32, f32::max);
        let width = win.use_keyed_state(self.id.clone(), cx, |_, _| 0_f32);
        let columns = if *width.read(cx) >= (required + 32.).ceil() * 4. {
            4
        } else {
            2
        };
        let rows = self
            .items
            .chunks(columns)
            .enumerate()
            .map(|(row, items)| {
                div()
                    .flex()
                    .w_full()
                    .items_center()
                    .children(items.iter().enumerate().map(|(column, (label, value))| {
                        div()
                            .id(("metric", row * columns + column))
                            .role(Role::Group)
                            .aria_label(format!("{label} · {value}"))
                            .relative()
                            .flex_1()
                            .min_w_0()
                            .pl(px(if column == 0 { 0. } else { 16. }))
                            .pr(px(if column + 1 == columns { 0. } else { 16. }))
                            .when(column > 0, |s| {
                                s.child(
                                    div()
                                        .absolute()
                                        .left_0()
                                        .top(relative(0.5))
                                        .mt(px(-20.))
                                        .w(px(1.))
                                        .h(px(40.))
                                        .bg(c.border),
                                )
                            })
                            .child(
                                div()
                                    .text_size(px(12.))
                                    .line_height(px(16.))
                                    .text_color(c.secondary)
                                    .child(label.clone()),
                            )
                            .child(
                                div()
                                    .mt(px(4.))
                                    .text_size(px(18.))
                                    .line_height(px(24.))
                                    .font_weight(FontWeight::SEMIBOLD)
                                    .child(value.clone()),
                            )
                    }))
            })
            .collect::<Vec<_>>();
        div()
            .id(self.id)
            .relative()
            .flex()
            .flex_col()
            .w_full()
            .min_w_0()
            .flex_none()
            .gap(px(16.))
            .pb(px(12.))
            .border_b_1()
            .border_color(c.border)
            .text_color(c.text)
            .children(rows)
            .child(
                canvas(
                    move |bounds, _, cx| {
                        width.update(cx, |width, cx| {
                            let measured = f32::from(bounds.size.width);
                            if (*width - measured).abs() > 0.5 {
                                *width = measured;
                                cx.notify();
                            }
                        });
                    },
                    |_, _, _, _| {},
                )
                .absolute()
                .inset_0()
                .size_full(),
            )
    }
}
