use super::label;
use gpui_kit::{prelude::*, *};
use patina_desktop_protocol::tools::{RowClock, now_ms};
use std::time::Duration;

struct Clock {
    value: RowClock,
    timer: Option<Task<()>>,
}

impl Render for Clock {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let ms = self.value.milliseconds(now_ms());
        let seconds = ms / 1000;
        if self.timer.is_none()
            && (matches!(self.value, RowClock::Since(_))
                || matches!(self.value, RowClock::Until(_)) && ms > 0)
        {
            let timer = cx.background_executor().timer(Duration::from_secs(1));
            self.timer = Some(cx.spawn(async move |clock, cx| {
                timer.await;
                let _ = clock.update(cx, |clock, cx| {
                    clock.timer = None;
                    cx.notify();
                });
            }));
        }
        label(format!("{:02}:{:02}", seconds / 60, seconds % 60)).font_weight(FontWeight::MEDIUM)
    }
}

pub(super) fn row_clock(id: &str, value: &RowClock, win: &mut Window, cx: &mut App) -> AnyElement {
    let clock = win.use_keyed_state(SharedString::from(format!("clock-{id}")), cx, |_, _| {
        Clock {
            value: *value,
            timer: None,
        }
    });
    if clock.read(cx).value != *value {
        clock.update(cx, |clock, cx| {
            clock.value = *value;
            clock.timer = None;
            cx.notify();
        });
    }
    clock.into_any_element()
}
