use gpui_kit::{
    AppContext, Context, IntoElement, Render, TestAppContext, Window, WindowOptions, div,
    prelude::*, px, test::TestWindowExt,
};
use quietpro::{Icon, IconControl, Palette, text_button};

#[derive(Default)]
struct Controls {
    enabled: bool,
    changes: usize,
}

impl Render for Controls {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let colors = Palette::from(window.appearance());
        let view = cx.weak_entity();
        div()
            .size_full()
            .flex()
            .items_start()
            .gap(px(8.))
            .child(IconControl::new("enable", "Enable", Icon::Pin).toggle(
                colors,
                self.enabled,
                move |enabled, _, _, cx| {
                    view.update(cx, |this, cx| {
                        this.enabled = enabled;
                        this.changes += 1;
                        cx.notify();
                    })
                    .unwrap();
                },
            ))
            .child(
                text_button("apply", "Apply", colors, self.enabled).on_click(cx.listener(
                    |this, _, _, cx| {
                        this.changes += 1;
                        cx.notify();
                    },
                )),
            )
    }
}

#[gpui_kit::test]
fn pointer_activation_respects_disabled_controls_and_emits_once(cx: &mut TestAppContext) {
    cx.update(gpui_kit::init);
    let (handle, view) = cx.update(|cx| {
        gpui_kit::open_window(WindowOptions::default(), cx, |_, cx| {
            cx.new(|_| Controls::default())
        })
        .unwrap()
    });
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        assert_eq!(window.find("apply").disabled(), Some(true));
        window.click("apply", cx);
        assert_eq!(view.read(cx).changes, 0);
        window.click("enable", cx);
        assert!(view.read(cx).enabled);
        assert_eq!(view.read(cx).changes, 1);
        assert_ne!(window.find("apply").disabled(), Some(true));
        window.click("apply", cx);
        assert_eq!(view.read(cx).changes, 2);
        window.click("enable", cx);
        window.click("apply", cx);
        assert!(!view.read(cx).enabled);
        assert_eq!(view.read(cx).changes, 3);
    })
    .unwrap();
}

#[gpui_kit::test]
fn keyboard_activation_uses_the_focused_control(cx: &mut TestAppContext) {
    cx.update(gpui_kit::init);
    let (handle, view) = cx.update(|cx| {
        gpui_kit::open_window(WindowOptions::default(), cx, |_, cx| {
            cx.new(|_| Controls::default())
        })
        .unwrap()
    });
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        window.click("enable", cx);
        window.press("space", cx);
        assert!(!view.read(cx).enabled);
        assert_eq!(view.read(cx).changes, 2);
        window.press("space", cx);
        assert!(view.read(cx).enabled);
        window.press("tab", cx);
        window.press("enter", cx);
        assert_eq!(view.read(cx).changes, 4);
    })
    .unwrap();
}
