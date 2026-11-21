//! Standalone keyboard and theme check for native Quiet Pro controls.
use gpui_kit::{prelude::*, *};
use quietpro::{Icon, IconControl, Palette, caption, text_button};

#[derive(Default)]
struct Controls {
    pinned: bool,
    changes: usize,
}

impl Render for Controls {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let colors = Palette::from(window.appearance());
        let view = cx.weak_entity();
        let count = format!("Changes: {}", self.changes);
        div()
            .size_full()
            .flex()
            .items_center()
            .justify_center()
            .gap(px(8.))
            .bg(colors.canvas)
            .text_color(colors.text)
            .child(
                IconControl::new("pin", "Pin", Icon::Pin)
                    .selected_icon(quietpro::FILLED_PIN_ICON)
                    .toggle(colors, self.pinned, move |pressed, _, _, cx| {
                        let _ = view.update(cx, |this, cx| {
                            this.pinned = pressed;
                            this.changes += 1;
                            cx.notify();
                        });
                    }),
            )
            .child(
                text_button("count", "Count", colors, self.pinned).on_click(cx.listener(
                    |this, _, _, cx| {
                        this.changes += 1;
                        cx.notify();
                    },
                )),
            )
            .child(
                IconControl::new("reset", "Reset", Icon::X)
                    .disabled(self.changes == 0)
                    .action(
                        colors,
                        cx.listener(|this, _, _, cx| {
                            this.pinned = false;
                            this.changes = 0;
                            cx.notify();
                        }),
                    ),
            )
            .child(
                caption(count.clone(), colors)
                    .id("changes")
                    .role(accesskit::Role::Status)
                    .aria_label(count),
            )
    }
}

fn main() {
    if std::env::args_os().any(|arg| arg == "--verify")
        && !patina_test_support::run_verify_example().expect("isolated controls desktop")
    {
        return;
    }
    gpui_kit::application()
        .with_assets(quietpro::QuietProAssets)
        .with_quit_mode(QuitMode::LastWindowClosed)
        .run(|cx| {
            gpui_kit::init(cx);
            quietpro::init_fonts(cx).expect("load bundled UI fonts");
            let options = WindowOptions {
                focus: !std::env::args_os().any(|arg| arg == "--verify"),
                ..Default::default()
            };
            gpui_kit::open_window(options, cx, |window, cx| {
                window.set_window_title("QuietPro controls");
                cx.new(|cx| {
                    cx.observe_window_appearance(window, |_, _, cx| cx.notify())
                        .detach();
                    Controls::default()
                })
            })
            .expect("open controls");
        });
}
