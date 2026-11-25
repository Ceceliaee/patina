use gpui_kit::{
    AppContext, Context, Focusable, IntoElement, Render, TestAppContext, Window, WindowOptions,
    div,
    prelude::*,
    px,
    test::{TestSupportExt, TestWindowExt},
};
use quietpro::{Icon, IconControl, Palette, text_button};

struct SecretField(gpui_kit::Entity<gpui_kit::base::input::InputState>);

impl Render for SecretField {
    fn render(&mut self, window: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        quietpro::TextInput::new("secret", &self.0, Palette::from(window.appearance())).fixed_mask()
    }
}

#[gpui_kit::test]
fn fixed_secret_mask_hides_length_and_preserves_the_editable_value(cx: &mut TestAppContext) {
    cx.update(gpui_kit::init);
    let (handle, view) = cx.update(|cx| {
        gpui_kit::open_window(WindowOptions::default(), cx, |win, cx| {
            let input = cx.new(|cx| gpui_kit::base::input::InputState::new(win, cx).masked(true));
            cx.new(|_| SecretField(input))
        })
        .unwrap()
    });
    cx.update_window(handle, |_, window, cx| {
        let field = view.read(cx).0.clone();
        let dot_count = |window: &Window| {
            let color = Palette::from(window.appearance()).secondary.into();
            let dot_size = px(4.).scale(window.scale_factor());
            window
                .painted_quads()
                .iter()
                .filter(|q| {
                    q.background == color
                        && q.bounds.size.width == dot_size
                        && q.bounds.size.height == dot_size
                })
                .count()
        };
        for (value, count) in [("x", 6), ("中文🔑".repeat(24).as_str(), 6), ("", 0)] {
            field.update(cx, |s, cx| s.set_value(value.to_owned(), window, cx));
            window.render_frame(cx);
            assert_eq!(dot_count(window), count);
        }
        window.focus(&field.focus_handle(cx), cx);
        window.input("example", cx);
        window.render_frame(cx);
        assert_eq!(dot_count(window), 6);
        window.input("-edited", cx);
        for (masked, count) in [(false, 0), (true, 6)] {
            field.update(cx, |s, cx| s.set_masked(masked, window, cx));
            window.render_frame(cx);
            assert_eq!(dot_count(window), count);
            assert_eq!(field.read(cx).value().as_ref(), "example-edited");
        }
    })
    .unwrap();
}

struct WindowFont(Option<gpui_kit::Font>);

impl Render for WindowFont {
    fn render(&mut self, window: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        self.0 = Some(window.text_style().font());
        div().child("Patina 中文 123")
    }
}

#[gpui_kit::test]
fn window_content_inherits_ui_typography(cx: &mut TestAppContext) {
    cx.update(|cx| {
        gpui_kit::init(cx);
        quietpro::init_fonts(cx).unwrap();
    });
    let (handle, view) = cx.update(|cx| {
        gpui_kit::open_window(WindowOptions::default(), cx, |_, cx| {
            cx.new(|_| WindowFont(None))
        })
        .unwrap()
    });
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        let font = view.read(cx).0.as_ref().unwrap();
        assert_eq!(font.family.as_ref(), "Source Han Sans CN VF");
        assert_eq!(font.weight, gpui_kit::FontWeight::NORMAL);
    })
    .unwrap();
}

struct SegmentedOptions;

impl Render for SegmentedOptions {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        div()
            .flex()
            .items_start()
            .child(quietpro::segmented_with_medium_labels(
                ("mode", "Mode".into()),
                ["Apps", "Categories"]
                    .into_iter()
                    .enumerate()
                    .map(|(i, name)| (i, name.to_owned(), None, cx.focus_handle())),
                0,
                true,
                Palette::from(window.appearance()),
                quietpro::ControlSize::Medium,
                |_, _, _| {},
            ))
    }
}

#[gpui_kit::test]
fn selected_and_hovered_segment_fills_share_the_same_inset(cx: &mut TestAppContext) {
    cx.update(gpui_kit::init);
    let (handle, _) = cx.update(|cx| {
        gpui_kit::open_window(WindowOptions::default(), cx, |_, cx| {
            cx.new(|_| SegmentedOptions)
        })
        .unwrap()
    });
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        window.hover(("segment", 1_usize), cx);
        window.render_frame(cx);
        for i in 0..2_usize {
            let option = window.find(("segment", i)).bounds();
            let fill = window.within(("segment", i)).find("fill").bounds();
            assert_eq!(option.size.height, px(28.));
            assert_eq!(fill.size.height, px(22.));
            assert_eq!(fill.top() - option.top(), px(3.));
            assert_eq!(option.bottom() - fill.bottom(), px(3.));
        }
    })
    .unwrap();
}

struct DistributionRows;

impl Render for DistributionRows {
    fn render(&mut self, window: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        let colors = Palette::from(window.appearance());
        let rows = [
            ("app", quietpro::UNFRAMED_APP_ICON_SIZE, "1h 42m", 0.54),
            ("category", quietpro::LEGEND_DOT_SIZE, "45m", 0.08),
            ("web", quietpro::UNFRAMED_APP_ICON_SIZE, "45m", 1.0),
        ];
        div()
            .w(px(320.))
            .flex()
            .flex_col()
            .children(rows.map(|(id, size, duration, ratio)| {
                quietpro::distribution_row(
                    id,
                    id.into(),
                    div().id("label").child(id).test_support(),
                    quietpro::DistributionValue {
                        duration: duration.into(),
                        ratio,
                        color: colors.accent,
                    },
                    div().id("mark").size(px(size)).test_support(),
                    colors,
                )
                .test_support()
            }))
    }
}

#[gpui_kit::test]
fn distribution_modes_align_labels_values_and_tracks(cx: &mut TestAppContext) {
    cx.update(gpui_kit::init);
    let (handle, _) = cx.update(|cx| {
        gpui_kit::open_window(WindowOptions::default(), cx, |_, cx| {
            cx.new(|_| DistributionRows)
        })
        .unwrap()
    });
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        let mut columns = |id: &'static str| {
            let row = window.within(id);
            let mark = row.find("mark").bounds();
            let track = row.find("track").bounds();
            (
                mark.center().x,
                row.find("label").bounds().left(),
                row.find("value").bounds().right(),
                track.left(),
                track.right(),
            )
        };
        let app = columns("app");
        assert_eq!(columns("category"), app);
        assert_eq!(columns("web"), app);
        let short = window.within("category").find("value").bounds();
        let long = window.within("web").find("value").bounds();
        assert!(short.size.width < long.size.width);
        let dot = window.within("category").find("mark").bounds();
        assert_eq!(dot.size.width, px(quietpro::LEGEND_DOT_SIZE));
        assert_eq!(dot.size.height, dot.size.width);
    })
    .unwrap();
}

struct Page;

impl Render for Page {
    fn render(&mut self, window: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        quietpro::page(Palette::from(window.appearance()))
            .id("page")
            .size_full()
            .test_support()
            .child(div().id("content").flex_1().test_support())
    }
}

#[gpui_kit::test]
fn page_has_sixteen_pixel_top_and_bottom_insets(cx: &mut TestAppContext) {
    cx.update(gpui_kit::init);
    let (handle, _) = cx.update(|cx| {
        gpui_kit::open_window(WindowOptions::default(), cx, |_, cx| cx.new(|_| Page)).unwrap()
    });
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        let page = window.find("page").bounds();
        let content = window.find("content").bounds();
        assert_eq!(content.top() - page.top(), px(16.));
        assert_eq!(page.bottom() - content.bottom(), px(16.));
    })
    .unwrap();
}

#[derive(Default)]
struct Controls {
    enabled: bool,
    changes: usize,
}

struct ButtonSpacing;

impl Render for ButtonSpacing {
    fn render(&mut self, window: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        let colors = Palette::from(window.appearance());
        let name = "English";
        div()
            .flex()
            .flex_col()
            .items_start()
            .child(
                div()
                    .id("label-width")
                    .test_support()
                    .text_size(px(12.))
                    .font_weight(gpui_kit::FontWeight::BOLD)
                    .child(name),
            )
            .child(
                div()
                    .id("language-label-width")
                    .test_support()
                    .text_size(px(12.))
                    .font_weight(gpui_kit::FontWeight::MEDIUM)
                    .child(name),
            )
            .child(text_button("plain", name, colors, true).text_size(px(12.)))
            .child(
                quietpro::text_button_with_icon(
                    "leading-icon",
                    name,
                    colors,
                    true,
                    gpui_kit::svg(),
                    [],
                )
                .text_size(px(12.)),
            )
            .child(
                quietpro::inline_choice_entry("entry", name, true, colors, colors.text)
                    .text_size(px(12.))
                    .font_weight(gpui_kit::FontWeight::BOLD),
            )
            .child(
                div().id("dropdown-width").test_support().flex().child(
                    quietpro::Dropdown::new(
                        "language",
                        "Language",
                        [(0, name), (1, "A longer option")],
                        0,
                        colors,
                        |_, _, _| {},
                    )
                    .value_typography(px(12.), gpui_kit::FontWeight::MEDIUM)
                    .fit_trigger_to_value(),
                ),
            )
    }
}

#[gpui_kit::test]
fn buttons_fit_label_padding_and_icons(cx: &mut TestAppContext) {
    cx.update(gpui_kit::init);
    let (handle, _) = cx.update(|cx| {
        gpui_kit::open_window(WindowOptions::default(), cx, |_, cx| {
            cx.new(|_| ButtonSpacing)
        })
        .unwrap()
    });
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        let label = window.find("label-width").bounds().size.width;
        let language_label = window.find("language-label-width").bounds().size.width;
        for (id, label, icon_width) in [
            ("plain", label, 0.),
            ("leading-icon", label, 14.),
            ("entry", label, 16.),
            ("dropdown-width", language_label, 12.),
        ] {
            let gap = if icon_width == 0. { 0. } else { 8. };
            let expected = label + px(2. * (1. + 12.) + gap + icon_width);
            let actual = window.find(id).bounds().size.width;
            assert!(
                (actual - expected).abs() <= px(1.),
                "{id}: {actual:?} vs {expected:?}"
            );
        }
    })
    .unwrap();
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
            .child(
                IconControl::new("enable", "Enable", Icon::Pin)
                    .with_selected_background()
                    .toggle(colors, self.enabled, move |enabled, _, _, cx| {
                        view.update(cx, |this, cx| {
                            this.enabled = enabled;
                            this.changes += 1;
                            cx.notify();
                        })
                        .unwrap();
                    }),
            )
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

#[derive(Default)]
struct TooltipControls {
    selected: bool,
}

struct ModalHints {
    depth: usize,
    focus: [gpui_kit::FocusHandle; 2],
}

impl Render for ModalHints {
    fn render(&mut self, win: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let colors = Palette::from(win.appearance());
        let button = |id| {
            IconControl::new(id, id, Icon::Plus)
                .with_tooltip()
                .button(colors)
        };
        let mut root = div()
            .size_full()
            .child(button("background").on_click(cx.listener(|view, _, _, cx| {
                view.depth = 1;
                cx.notify();
            })));
        for layer in 0..self.depth {
            let name = ["parent", "nested"][layer];
            let width = [360., 140.][layer];
            let content = quietpro::dialog_surface(colors, win.viewport_size())
                .w(px(width))
                .child(button(name));
            let view = cx.weak_entity();
            root = root.child(
                quietpro::modal_dialog(
                    name,
                    self.focus[layer].clone(),
                    content,
                    move |_, cx| {
                        let _ = view.update(cx, |view, cx| {
                            view.depth = layer;
                            cx.notify();
                        });
                    },
                    cx,
                )
                .layer(layer, layer + 1 == self.depth),
            );
        }
        root
    }
}

#[gpui_kit::test]
fn only_the_top_dialog_can_show_hover_tooltips(cx: &mut TestAppContext) {
    cx.update(gpui_kit::init);
    let (window, view) = cx.update(|cx| {
        gpui_kit::open_window(WindowOptions::default(), cx, |_, cx| {
            cx.new(|cx| ModalHints {
                depth: 0,
                focus: [cx.focus_handle(), cx.focus_handle()],
            })
        })
        .unwrap()
    });
    let hover = |cx: &mut TestAppContext, id: &'static str| {
        cx.update_window(window, |_, win, cx| win.hover(id, cx))
            .unwrap();
        cx.run_until_parked();
    };
    let wait = |cx: &mut TestAppContext| {
        cx.executor()
            .advance_clock(std::time::Duration::from_secs(1));
        cx.run_until_parked();
    };
    let visible = |cx: &mut TestAppContext| {
        cx.update_window(window, |_, win, cx| {
            win.render_frame(cx);
            win.try_find("quietpro-text-tooltip").is_some()
        })
        .unwrap()
    };
    let depth = |cx: &mut TestAppContext, count| {
        cx.update(|cx| {
            view.update(cx, |view, cx| {
                view.depth = count;
                cx.notify();
            })
        })
    };
    hover(cx, "background");
    wait(cx);
    assert!(visible(cx));
    depth(cx, 1);
    assert!(
        !visible(cx),
        "an already visible page tooltip survives opening a dialog"
    );
    hover(cx, "parent");
    wait(cx);
    assert!(visible(cx), "dialog control tooltip missing");
    hover(cx, "background");
    wait(cx);
    assert!(!visible(cx), "page tooltip shows through backdrop");
    hover(cx, "parent");
    depth(cx, 2);
    wait(cx);
    assert!(
        !visible(cx),
        "pending parent tooltip survives a nested dialog"
    );
    hover(cx, "parent");
    wait(cx);
    assert!(
        !visible(cx),
        "covered parent control still responds to hover"
    );
    hover(cx, "nested");
    wait(cx);
    assert!(visible(cx));
    cx.update_window(window, |_, win, cx| win.click("background", cx))
        .unwrap();
    assert_eq!(
        cx.update(|cx| view.read(cx).depth),
        1,
        "only the top backdrop dismisses"
    );
    cx.update_window(window, |_, win, cx| win.click("background", cx))
        .unwrap();
    assert_eq!(cx.update(|cx| view.read(cx).depth), 0);
    hover(cx, "background");
    wait(cx);
    assert!(visible(cx), "page tooltip did not return after dismissal");
}
impl Render for TooltipControls {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let colors = Palette::from(window.appearance());
        let view = cx.weak_entity();
        let mixed_view = cx.weak_entity();
        let name = if self.selected { "Turn off" } else { "Turn on" };
        div()
            .size_full()
            .p(px(80.))
            .flex()
            .gap(px(40.))
            .child(
                IconControl::new("tip-toggle", name, Icon::Layers)
                    .with_tooltip()
                    .toggle(colors, self.selected, move |value, _, _, cx| {
                        view.update(cx, |this, cx| {
                            this.selected = value;
                            cx.notify();
                        })
                        .unwrap();
                    }),
            )
            .child(
                IconControl::new("tip-mixed", "Group policy", Icon::Captions)
                    .with_tooltip()
                    .mixed_toggle(colors, false, true, move |value, _, _, cx| {
                        mixed_view
                            .update(cx, |this, cx| {
                                this.selected = value;
                                cx.notify();
                            })
                            .unwrap();
                    }),
            )
    }
}

#[gpui_kit::test]
fn icon_toggle_variants_keep_activation_with_tooltips(cx: &mut TestAppContext) {
    cx.update(gpui_kit::init);
    let (handle, view) = cx.update(|cx| {
        gpui_kit::open_window(WindowOptions::default(), cx, |_, cx| {
            cx.new(|_| TooltipControls::default())
        })
        .unwrap()
    });
    for id in ["tip-toggle", "tip-mixed"] {
        cx.update_window(handle, |_, window, cx| {
            window.render_frame(cx);
            window.hover(id, cx);
        })
        .unwrap();
        cx.update_window(handle, |_, window, cx| {
            window.click(id, cx);
        })
        .unwrap();
        cx.update(|cx| assert!(view.read(cx).selected));
    }
}
