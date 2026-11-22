use gpui_kit::{Bounds, Pixels, Size, point, px, size};
use patina_activity_model::views::mini::{Edge, MonitorAffinity, Placement, Rect};

pub const MINI_PANEL_SIZE_DIP: (f32, f32) = (320., 240.);
pub(super) const CORNER_RADIUS: f32 = 8.;

#[derive(Clone, Debug, PartialEq)]
pub(super) struct Monitor {
    pub affinity: MonitorAffinity,
    pub scale: f32,
}

#[derive(Clone, Copy, Debug)]
pub(super) struct Layout {
    pub panel: Rect,
    pub handle: Rect,
}

fn extent(dip: f32, scale: f32, available: u32) -> u32 {
    ((dip * scale).round() as u32).clamp(1, available.max(1))
}

fn axis(origin: i32, available: u32, length: u32, offset: f64) -> i32 {
    origin.saturating_add_unsigned((offset.round() as u32).min(available.saturating_sub(length)))
}

fn relative_axis(position: i32, origin: i32, extent: u32, length: u32) -> f64 {
    ((f64::from(position) - f64::from(origin)) / f64::from(extent.saturating_sub(length).max(1)))
        .clamp(0., 1.)
}

impl Monitor {
    pub fn layout(&self, placement: &Placement) -> Layout {
        let work = self.affinity.work_area;
        let bounds = |(w, h): (f32, f32)| {
            let width = extent(w, self.scale, work.width);
            let height = extent(h, self.scale, work.height);
            let anchor = placement.anchor.clamp(0., 1.);
            let anchored =
                |extent: u32, size: u32| (f64::from(extent) * anchor).round() - f64::from(size / 2);
            let (x, y) = match placement.edge {
                Some(Edge::Top) => (anchored(work.width, width), 0.),
                Some(Edge::Left) => (0., anchored(work.height, height)),
                Some(Edge::Right) => (
                    f64::from(work.width.saturating_sub(width)),
                    anchored(work.height, height),
                ),
                None => {
                    let old = placement.monitor.as_ref().map_or(work, |m| m.work_area);
                    let available_x = f64::from(work.width.saturating_sub(width));
                    let available_y = f64::from(work.height.saturating_sub(height));
                    match placement.floating {
                        Some(r) => (
                            relative_axis(r.x, old.x, old.width, r.width) * available_x,
                            if old == work {
                                f64::from(r.y) - f64::from(work.y)
                            } else {
                                relative_axis(r.y, old.y, old.height, r.height) * available_y
                            },
                        ),
                        None => (available_x / 2., available_y / 2.),
                    }
                }
            };
            Rect {
                x: axis(work.x, work.width, width, x),
                y: axis(work.y, work.height, height, y),
                width,
                height,
            }
        };
        let panel = bounds(MINI_PANEL_SIZE_DIP);
        let handle = match placement.edge {
            Some(Edge::Top) => bounds((112., 24.)),
            Some(Edge::Left | Edge::Right) => bounds((24., 88.)),
            None => panel,
        };
        Layout { panel, handle }
    }

    pub fn dragged_panel(&self, pointer: (i32, i32), grab: (f32, f32)) -> Rect {
        let work = self.affinity.work_area;
        Rect {
            x: pointer
                .0
                .saturating_sub((grab.0 * self.scale).round() as i32),
            y: pointer
                .1
                .saturating_sub((grab.1 * self.scale).round() as i32),
            width: extent(MINI_PANEL_SIZE_DIP.0, self.scale, work.width),
            height: extent(MINI_PANEL_SIZE_DIP.1, self.scale, work.height),
        }
    }

    pub fn released(&self, previous: &Placement, mut panel: Rect) -> Placement {
        let work = self.affinity.work_area;
        panel.x = axis(
            work.x,
            work.width,
            panel.width,
            f64::from(panel.x) - f64::from(work.x),
        );
        panel.y = axis(
            work.y,
            work.height,
            panel.height,
            f64::from(panel.y) - f64::from(work.y),
        );
        let x = i64::from(panel.x) - i64::from(work.x);
        let y = i64::from(panel.y) - i64::from(work.y);
        let right = i64::from(work.width) - i64::from(panel.width) - x;
        let edge = [(Edge::Top, y), (Edge::Left, x), (Edge::Right, right)]
            .into_iter()
            .filter(|(_, d)| *d <= (24. * self.scale).round() as i64)
            .min_by_key(|(edge, d)| (*d, *edge != previous.last_edge))
            .map(|(edge, _)| edge);
        let mut next = Placement {
            monitor: Some(self.affinity.clone()),
            edge,
            ..previous.clone()
        };
        if let Some(edge) = edge {
            next.last_edge = edge;
            next.anchor = match edge {
                Edge::Top => (x as f64 + f64::from(panel.width / 2)) / f64::from(work.width.max(1)),
                _ => (y as f64 + f64::from(panel.height / 2)) / f64::from(work.height.max(1)),
            };
        } else {
            next.floating = Some(panel);
        }
        next
    }
}

impl Layout {
    pub fn visible(&self, viewport: Size<Pixels>, progress: f32) -> Bounds<Pixels> {
        let fraction = |length, total| length as f32 / total as f32;
        let sx = viewport.width * (1. - progress);
        let sy = viewport.height * (1. - progress);
        Bounds {
            origin: point(
                sx * fraction(self.handle.x - self.panel.x, self.panel.width),
                sy * fraction(self.handle.y - self.panel.y, self.panel.height),
            ),
            size: size(
                viewport.width * progress
                    + sx * fraction(self.handle.width as i32, self.panel.width),
                viewport.height * progress
                    + sy * fraction(self.handle.height as i32, self.panel.height),
            ),
        }
    }
}

pub(super) fn initial_bounds(panel: Rect, scale: f32) -> Bounds<Pixels> {
    Bounds {
        origin: point(px(panel.x as f32 / scale), px(panel.y as f32 / scale)),
        size: size(
            px(panel.width as f32 / scale),
            px(panel.height as f32 / scale),
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn monitor(x: i32, y: i32, width: u32, height: u32, scale: f32) -> Monitor {
        Monitor {
            affinity: MonitorAffinity {
                name: None,
                work_area: Rect {
                    x,
                    y,
                    width,
                    height,
                },
            },
            scale,
        }
    }

    #[test]
    fn all_three_handles_share_the_panel_anchor_at_each_scale() {
        for scale in [1., 1.25, 1.5, 2.] {
            let screen = monitor(-2560, -1440, 2560, 1400, scale);
            for edge in [Edge::Top, Edge::Left, Edge::Right] {
                for anchor in [0., 0.3, 0.5, 1.] {
                    let prefs = Placement {
                        edge: Some(edge),
                        anchor,
                        ..Default::default()
                    };
                    let Layout { panel, handle } = screen.layout(&prefs);
                    assert!(handle.x >= panel.x && handle.y >= panel.y);
                    assert!(handle.x + handle.width as i32 <= panel.x + panel.width as i32);
                    assert!(handle.y + handle.height as i32 <= panel.y + panel.height as i32);
                    match edge {
                        Edge::Top => {
                            assert_eq!(panel.y, -1440);
                            assert_eq!(handle.y, panel.y);
                            assert_eq!(handle.width, (112. * scale).round() as u32);
                        }
                        Edge::Left => assert_eq!((panel.x, handle.x), (-2560, -2560)),
                        Edge::Right => assert_eq!(
                            (panel.x + panel.width as i32, handle.x + handle.width as i32),
                            (0, 0)
                        ),
                    }
                    if edge != Edge::Top {
                        assert_eq!(handle.height, (88. * scale).round() as u32);
                        assert_eq!(handle.width, (24. * scale).round() as u32);
                    }
                }
            }
        }
        let tiny = monitor(i32::MIN, -51, 41, 28, 2.);
        let layout = tiny.layout(&Placement::default());
        assert_eq!(layout.panel, tiny.affinity.work_area);
        assert_eq!(layout.handle, layout.panel);
    }

    #[test]
    fn release_uses_destination_dpi_last_edge_and_leaves_bottom_floating() {
        let screen = monitor(-1920, 0, 1920, 1040, 1.5);
        let prefs = Placement {
            last_edge: Edge::Left,
            ..Default::default()
        };
        let grab = (80., 16.);
        let mut panel = screen.dragged_panel((-1800, 24), grab);
        assert_eq!(
            (panel.x, panel.y, panel.width, panel.height),
            (-1920, 0, 480, 360)
        );
        assert_eq!(screen.released(&prefs, panel).edge, Some(Edge::Left));
        panel.x = -900;
        for (y, edge) in [(36, Some(Edge::Top)), (37, None), (900, None)] {
            panel.y = y;
            let dock = screen.released(&prefs, panel);
            assert_eq!(dock.edge, edge);
            if edge.is_none() {
                assert_eq!(dock.floating.unwrap().y, y.min(680));
            }
        }
        panel.x = -480 - 36;
        assert_eq!(screen.released(&prefs, panel).edge, Some(Edge::Right));
    }

    #[test]
    fn legacy_floating_position_and_pin_restore_on_a_different_monitor() {
        use patina_activity_model::views::mini::MiniPreferences;
        let prefs: MiniPreferences = serde_json::from_str(include_str!(
            "../../../../../crates/test-support/fixtures/mini-window-preferences.json"
        ))
        .unwrap();
        let screen = monitor(0, -1440, 2560, 1400, 2.);
        let layout = screen.layout(&prefs.placement);
        assert!(prefs.held);
        assert_eq!(
            layout.panel,
            Rect {
                x: 499,
                y: -1210,
                width: 640,
                height: 480
            }
        );
        assert_eq!(layout.handle, layout.panel);
    }
}
