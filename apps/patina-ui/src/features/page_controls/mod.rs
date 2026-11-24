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
pub(crate) fn logo(side: Pixels, surface: Rgba, window: &mut Window, cx: &mut App) -> AnyElement {
    const BRAND_MARK: &[u8] =
        include_bytes!("../../../../patina/assets/icons/source/app-icon-brand.svg");
    let scale = window.scale_factor();
    let extent = size(side, side).to_device_pixels(scale);
    // Match the layout to the raster so fractional DPI does not resample its edges.
    let side = extent.to_pixels(scale).width;
    if Hsla::from(surface).l < 0.5 {
        return svg()
            .data(BRAND_MARK)
            .size(side)
            .text_color(rgb(0x8fa0b8))
            .into_any_element();
    }
    let image = window.use_keyed_state(("patina-logo", extent.width.0 as u32), cx, |_, cx| {
        let renderer = cx.svg_renderer();
        let mark = renderer
            .parse_svg(BRAND_MARK)
            .expect("invalid bundled Patina logo");
        let image = renderer
            .render_parsed(&mark, SvgSize::Size(extent))
            .expect("invalid Patina logo size");
        cx.on_release(|image: &mut std::sync::Arc<RenderImage>, cx| {
            cx.drop_image(image.clone(), None);
        })
        .detach();
        image
    });
    img(image.read(cx).clone()).size(side).into_any_element()
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
