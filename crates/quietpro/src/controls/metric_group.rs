use crate::Palette;
use gpui_kit::{base::TestSupportExt, prelude::*, *};

const FONT_SIZE: f32 = 14.;

/// Read-only summary values; labels and formatted values belong to the consumer.
#[derive(IntoElement)]
pub struct MetricGroup {
    pub id: ElementId,
    pub items: [(String, String); 4],
    pub colors: Palette,
}

impl RenderOnce for MetricGroup {
    fn render(self, _: &mut Window, _: &mut App) -> impl IntoElement {
        let c = self.colors;
        div()
            .id(self.id)
            .flex()
            .items_center()
            .w_full()
            .min_w_0()
            .flex_none()
            .pb(px(12.))
            .border_b_1()
            .border_color(c.border)
            .text_color(c.text)
            .text_size(px(FONT_SIZE))
            .line_height(px(20.))
            .font_weight(FontWeight::MEDIUM)
            .children(
                self.items
                    .into_iter()
                    .enumerate()
                    .map(|(column, (label, value))| {
                        div()
                            .id(("metric", column))
                            .role(Role::Group)
                            .aria_label(format!("{label} ･ {value}"))
                            .test_support()
                            .relative()
                            .flex_1()
                            .min_w_0()
                            .pl(px(if column == 0 { 0. } else { 16. }))
                            .pr(px(if column == 3 { 0. } else { 16. }))
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
                            .child(div().truncate().text_color(c.secondary).child(label))
                            .child(div().truncate().mt(px(4.)).child(value))
                    }),
            )
    }
}
