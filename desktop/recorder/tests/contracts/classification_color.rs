#[test]
fn classification_color_defaults() {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD.decode("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEUlEQVR4nGNQSDjwH4QZYAwASvQI/dnllI8AAAAASUVORK5CYII=").unwrap();
    assert_eq!(patina_recorder::icon_color(&bytes), Some(0x2060C0));
    let png = patina_recorder::icon_png(&bytes).unwrap();
    assert_eq!(patina_recorder::icon_color(&png), Some(0x2060C0));
    assert!(patina_recorder::icon_png(b"broken icon").is_none());
    assert_eq!(patina_recorder::icon_color(b"broken PNG"), None);
    assert_eq!(
        patina_recorder::default_app_color(" Studio "),
        patina_recorder::default_app_color("studio.exe")
    );
}
