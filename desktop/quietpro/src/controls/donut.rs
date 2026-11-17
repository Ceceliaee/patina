use crate::Palette;
use gpui_kit::{
    base::plot::shape::{Arc, ArcData},
    prelude::*,
    *,
};
use std::f32::consts::TAU;

pub const DONUT_SIZE: f32 = 144.;
pub const DONUT_COMPACT_SIZE: f32 = 112.;
const SEGMENT_GAP_DEGREES: f32 = 4.;

pub struct DonutSlice {
    pub value: f64,
    pub color: Rgba,
    pub description: SharedString,
    pub dotted: bool,
}

#[derive(IntoElement)]
pub struct DonutChart {
    pub id: ElementId,
    pub compact: bool,
    pub slices: Vec<DonutSlice>,
    pub colors: Palette,
}

fn spans(slices: &[DonutSlice]) -> Vec<(f32, f32)> {
    let sum: f64 = slices.iter().map(|s| s.value.max(0.)).sum();
    let mut angle = 0.;
    let count = slices.iter().filter(|s| s.value > 0.).count();
    slices
        .iter()
        .map(|s| {
            let sweep = if sum > 0. {
                (s.value.max(0.) / sum) as f32 * TAU
            } else {
                0.
            };
            let gap = if count > 1 {
                SEGMENT_GAP_DEGREES.to_radians().min(sweep * 0.25)
            } else {
                0.
            };
            let span = (angle, angle + sweep - gap);
            angle += sweep;
            span
        })
        .collect()
}

impl RenderOnce for DonutChart {
    fn render(self, _: &mut Window, _: &mut App) -> impl IntoElement {
        let size = if self.compact {
            DONUT_COMPACT_SIZE
        } else {
            DONUT_SIZE
        };
        let ring = if self.compact { 16. } else { 20. };
        let geometry = spans(&self.slices);
        let c = self.colors;
        let descriptions: Vec<_> = self.slices.iter().map(|s| s.description.clone()).collect();
        div()
            .id(self.id)
            .role(Role::Group)
            .aria_label(
                descriptions
                    .iter()
                    .map(|s| s.as_ref())
                    .collect::<Vec<_>>()
                    .join("; "),
            )
            .absolute()
            .inset_0()
            .size(px(size))
            .child(
                canvas(
                    |_, _, _| {},
                    move |b, _, win, _| {
                        let arc = Arc::new()
                            .outer_radius(size / 2.)
                            .inner_radius(size / 2. - ring);
                        arc.paint(&ArcData::new(&(), 0, 1., 0., TAU), c.track, &b, win);
                        for (slice, &(start, end)) in self.slices.iter().zip(geometry.iter()) {
                            if end > start {
                                arc.paint(
                                    &ArcData::new(&(), 0, 1., start, end),
                                    slice.color,
                                    &b,
                                    win,
                                );
                                if slice.dotted {
                                    let inset = Arc::new()
                                        .outer_radius(size / 2. - 0.7)
                                        .inner_radius(size / 2. - ring + 0.7);
                                    super::dot_pattern::paint_dots(b, c.secondary, win, |p| {
                                        inset.contains(&ArcData::new(&(), 0, 1., start, end), p, &b)
                                    });
                                }
                            }
                        }
                    },
                )
                .size_full(),
            )
    }
}

#[cfg(test)]
mod tests {
    use super::{DonutSlice, spans};
    use gpui_kit::rgb;
    use std::f32::consts::TAU;
    fn slice(value: f64) -> DonutSlice {
        DonutSlice {
            value,
            color: rgb(0),
            description: "test".into(),
            dotted: false,
        }
    }
    #[test]
    fn small_slices_remain_visible_and_empty_is_safe() {
        let result = spans(&[slice(9999.), slice(1.)]);
        assert!(result[1].1 > result[1].0);
        assert_eq!(spans(&[slice(0.)]), vec![(0., 0.)]);
        assert_eq!(spans(&[slice(1.)]), vec![(0., TAU)]);
    }
}
