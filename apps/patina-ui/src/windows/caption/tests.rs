use crate::windows::{main::MainWindow, mini::Mini};
use gpui_kit::{InputEvent, MouseButton, MouseDownEvent, px, size, test::TestWindowExt};

#[test]
#[ignore = "isolated Win32 desktop with the native renderer"]
fn window_close_buttons_match_reference_colors_and_bounds() -> Result<(), Box<dyn std::error::Error>>
{
    if !patina_test_support::run_case()? {
        return Ok(());
    }
    crate::windows::placement::enable_monitor_dpi()?;
    gpui_kit::application()
        .with_assets(quietpro::QuietProAssets)
        .run(|cx| {
            gpui_kit::init(cx);
            let (client, _requests) = crate::client::Client::test_connection();
            client.theme.set(patina_activity_model::Theme::Light);
            let (main, _) = MainWindow::open(cx, client.clone()).unwrap();
            let (mini, _) = Mini::open(cx, client, false, Default::default()).unwrap();
            for (handle, is_main) in [(main, true), (mini, false)] {
                handle
                    .update(cx, |_, window, cx| {
                        window.hover("close", cx);
                        let bounds = window.find("close").bounds();
                        let side = px(if is_main { 36. } else { 28. });
                        assert_eq!(bounds.size, size(side, side));
                        if is_main {
                            let mut right = window.viewport_size().width;
                            for id in ["close", "zoom", "minimize", "mini"] {
                                let button = window.find(id).bounds();
                                assert_eq!(button.top(), px(0.));
                                assert_eq!(button.right(), right);
                                assert_eq!(button.size, bounds.size);
                                right = button.left();
                            }
                        }
                        for (pressed, fill) in [(false, [247, 233, 233]), (true, [242, 222, 222])] {
                            if pressed {
                                window.dispatch_event(
                                    MouseDownEvent {
                                        position: bounds.center(),
                                        button: MouseButton::Left,
                                        ..Default::default()
                                    }
                                    .to_platform_input(),
                                    cx,
                                );
                            }
                            window.render_frame(cx);
                            let frame = window.render_to_image().unwrap();
                            let scale = window.scale_factor();
                            let pixel = |x: f32, y: f32| {
                                let x = (f32::from(bounds.left() + px(x)) * scale) as u32;
                                let y = (f32::from(bounds.top() + px(y)) * scale) as u32;
                                let [r, g, b, _] = frame.get_pixel(x, y).0;
                                [r, g, b]
                            };
                            let side = f32::from(side);
                            assert_eq!(
                                pixel(side / 2., 3.),
                                fill,
                                "main={is_main}, pressed={pressed}"
                            );
                            assert_eq!(pixel(1., 1.) == fill, is_main);
                            if is_main {
                                let y = (f32::from(bounds.bottom()) * scale).round() as u32 - 1;
                                assert!(
                                    (0..frame.width())
                                        .all(|x| frame.get_pixel(x, y).0 == [221, 221, 221, 255]),
                                    "title bar divider interrupted, pressed={pressed}"
                                );
                            }
                            assert!(
                                (6..side as u32 - 6).any(|i| (6..side as u32 - 6).any(|j| {
                                    let [r, g, b] = pixel(i as f32, j as f32);
                                    r.abs_diff(181) <= 3
                                        && g.abs_diff(58) <= 3
                                        && b.abs_diff(58) <= 3
                                })),
                                "missing red close glyph"
                            );
                        }
                    })
                    .unwrap();
            }
            cx.quit();
        });
    Ok(())
}
