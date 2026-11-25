use gpui_kit::{SharedString, TestAppContext};
use std::{sync::mpsc, time::Duration};

pub(crate) fn observe_tooltips(cx: &mut TestAppContext) -> mpsc::Receiver<SharedString> {
    let (sender, receiver) = mpsc::channel();
    cx.update(|cx| {
        cx.observe_new::<quietpro::TextTooltip>(move |tooltip, _, _| {
            let _ = sender.send(tooltip.0.clone());
        })
        .detach();
    });
    receiver
}

pub(crate) fn assert_tooltip(
    cx: &mut TestAppContext,
    tips: &mpsc::Receiver<SharedString>,
    expected: Option<&str>,
) {
    cx.run_until_parked();
    cx.executor().advance_clock(Duration::from_secs(1));
    cx.run_until_parked();
    assert_eq!(tips.try_iter().last().as_deref(), expected);
}
