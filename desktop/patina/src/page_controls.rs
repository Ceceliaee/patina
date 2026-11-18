use chrono::{Local, TimeZone};
use gpui_kit::{prelude::*, *};

pub(super) mod anonymous;
pub(super) mod quick_edit;

pub(super) fn stamp(ms: i64, format: &str) -> String {
    Local
        .timestamp_millis_opt(ms)
        .single()
        .map(|v| v.format(format).to_string())
        .unwrap_or_default()
}
pub(super) fn label(s: String) -> Stateful<Div> {
    div()
        .id(SharedString::from(s.clone()))
        .role(Role::Label)
        .aria_value(s.clone())
        .child(s)
}
pub(super) fn save_status(status: String, colors: quietpro::Palette) -> Stateful<Div> {
    quietpro::caption(status.clone(), colors)
        .id("save-status")
        .role(Role::Status)
        .aria_label(status)
        .whitespace_nowrap()
}
pub(super) fn logo() -> Img {
    static IMAGE: std::sync::LazyLock<std::sync::Arc<Image>> = std::sync::LazyLock::new(|| {
        std::sync::Arc::new(Image::from_bytes(
            ImageFormat::Png,
            include_bytes!("../assets/icons/128x128.png").to_vec(),
        ))
    });
    img(IMAGE.clone())
}

pub(super) fn detail_dialog(
    content: Entity<crate::history::History>,
    focus: &FocusHandle,
    close_label: String,
    colors: quietpro::Palette,
    close: impl Fn(&mut Window, &mut App) + 'static,
    window: &Window,
    cx: &mut App,
) -> gpui_kit::base::Dialog {
    let close = std::rc::Rc::new(close);
    let button = close.clone();
    let popup = quietpro::dialog_surface(colors, window.viewport_size())
        .id("app-detail-popup")
        .relative()
        .w((window.viewport_size().width - px(48.)).min(px(800.)))
        .on_any_mouse_down(|_, _, cx| cx.stop_propagation())
        .child(content)
        .child(
            div().absolute().top(px(17.)).right(px(17.)).child(
                quietpro::IconControl::new("close-detail", close_label, quietpro::Icon::X)
                    .action(colors, move |_, win, cx| button(win, cx)),
            ),
        );
    gpui_kit::base::Dialog::new(cx)
        .focus_handle(focus.clone())
        .on_ok(|_, _, _| false)
        .backdrop(quietpro::dialog_backdrop())
        .popup(gpui_kit::base::DialogPopup::new().child(popup))
        .on_open_change(move |open, _, win, cx| {
            if !open {
                close(win, cx);
            }
        })
}
