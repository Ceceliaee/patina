use chrono::{Local, TimeZone};
use gpui_kit::{prelude::*, *};

pub(crate) mod anonymous;
pub(crate) mod quick_edit;

pub(crate) fn stamp(ms: i64, format: &str) -> String {
    Local
        .timestamp_millis_opt(ms)
        .single()
        .map(|v| v.format(format).to_string())
        .unwrap_or_default()
}
pub(crate) fn label(s: String) -> Stateful<Div> {
    div()
        .id(SharedString::from(s.clone()))
        .role(Role::Label)
        .aria_value(s.clone())
        .child(s)
}
pub(crate) fn save_status(status: String, colors: quietpro::Palette) -> Stateful<Div> {
    quietpro::caption(status.clone(), colors)
        .id("save-status")
        .role(Role::Status)
        .aria_label(status)
        .whitespace_nowrap()
}
pub(crate) fn logo() -> Img {
    static IMAGE: std::sync::LazyLock<std::sync::Arc<Image>> = std::sync::LazyLock::new(|| {
        std::sync::Arc::new(Image::from_bytes(
            ImageFormat::Png,
            include_bytes!("../../../assets/icons/128x128.png").to_vec(),
        ))
    });
    img(IMAGE.clone())
}
actions!(patina_lists, [NextControl, PreviousControl]);

struct RowBindings;
impl Global for RowBindings {}

/// Bind Tab at the row so that focus can reach controls beyond the rendered viewport.
pub(crate) fn keyboard_row(
    scroll: UniformListScrollHandle,
    index: usize,
    count: usize,
    cx: &mut App,
) -> Div {
    const CONTEXT: &str = "PatinaVirtualRow";
    if !cx.has_global::<RowBindings>() {
        cx.bind_keys([
            KeyBinding::new("tab", NextControl, Some(CONTEXT)),
            KeyBinding::new("shift-tab", PreviousControl, Some(CONTEXT)),
        ]);
        cx.set_global(RowBindings);
    }
    let back = scroll.clone();
    div()
        .key_context(CONTEXT)
        .on_action(move |_: &NextControl, win, cx| {
            scroll.scroll_to_item(
                (index + 1).min(count.saturating_sub(1)),
                ScrollStrategy::Nearest,
            );
            win.focus_next(cx);
            win.refresh();
        })
        .on_action(move |_: &PreviousControl, win, cx| {
            back.scroll_to_item(index.saturating_sub(1), ScrollStrategy::Nearest);
            win.focus_prev(cx);
            win.refresh();
        })
}
