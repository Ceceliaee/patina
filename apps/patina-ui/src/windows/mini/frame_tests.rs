use super::{CORNER_RADIUS, Mini, MiniPreferences};

#[test]
#[ignore = "isolated Win32 desktop with the native renderer"]
fn expanded_frame_composites_all_four_arcs() -> Result<(), Box<dyn std::error::Error>> {
    if !patina_test_support::run_case()? {
        return Ok(());
    }
    crate::windows::placement::enable_monitor_dpi()?;
    let (tx, rx) = std::sync::mpsc::channel();
    gpui_kit::application()
        .with_assets(quietpro::QuietProAssets)
        .run(move |cx| {
            gpui_kit::init(cx);
            let (client, _requests) = crate::client::Client::test_connection();
            let (handle, _) = Mini::open(cx, client, false, MiniPreferences::default()).unwrap();
            handle
                .update(cx, |_, window, _| {
                    tx.send((window.scale_factor(), window.render_to_image()))
                        .unwrap();
                    window.on_next_frame(|_, cx| cx.quit());
                })
                .unwrap();
        });
    let (scale, frame) = rx.recv()?;
    let frame = frame?;
    let radius = (CORNER_RADIUS * scale).ceil() as u32;
    let (width, height) = frame.dimensions();
    for right in [false, true] {
        for bottom in [false, true] {
            let alpha = |x, y| {
                frame.get_pixel(
                    if right { width - 1 - x } else { x },
                    if bottom { height - 1 - y } else { y },
                )[3]
            };
            assert_eq!(alpha(0, 0), 0, "transparent corner {right}/{bottom}");
            assert_eq!(alpha(radius, radius), 255);
            assert!(
                (0..radius).any(|x| (0..radius).any(|y| (1..255).contains(&alpha(x, y)))),
                "antialiased arc {right}/{bottom}"
            );
        }
    }
    Ok(())
}
