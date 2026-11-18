// The same identity palette used by objectColor when the app has no custom colour.
pub fn app_color(key: &str) -> u32 {
    if key == "activity:anonymous" {
        return 0x8f98a8;
    }
    let key = crate::tracking::resolve_app_override_executable(key).unwrap_or_default();
    identity_color("app:", &key)
}

pub fn web_color(key: &str) -> u32 {
    identity_color("web:", &key.trim().to_lowercase())
}

fn identity_color(kind: &str, key: &str) -> u32 {
    const COLORS: [u32; 7] = [
        0x36ac7e, 0x4790cf, 0x6f7ae6, 0xb07e55, 0x35a69e, 0xc56a73, 0x8c6fa1,
    ];
    let hash = kind
        .chars()
        .chain(key.chars())
        .map(|ch| ch.encode_utf16(&mut [0; 2])[0])
        .fold(0u32, |hash, ch| {
            hash.wrapping_mul(31).wrapping_add(u32::from(ch))
        });
    COLORS[hash as usize % COLORS.len()]
}

pub fn source_color(anonymous: bool, custom: Option<u32>, icon: Option<u32>, fallback: u32) -> u32 {
    if anonymous {
        fallback
    } else {
        custom.or(icon).unwrap_or(fallback)
    }
}

pub fn icon_color(bytes: &[u8]) -> Option<u32> {
    use image::{
        imageops::{overlay, resize, FilterType},
        RgbaImage,
    };
    let mut reader =
        image::io::Reader::with_format(std::io::Cursor::new(bytes), image::ImageFormat::Png);
    let mut limits = image::io::Limits::default();
    limits.max_image_width = Some(2048);
    limits.max_image_height = Some(2048);
    limits.max_alloc = Some(32 * 1024 * 1024);
    reader.limits(limits);
    let decoded = reader.decode().ok()?;
    let size = 48;
    let scale = (f64::from(size) / f64::from(decoded.width()))
        .min(f64::from(size) / f64::from(decoded.height()));
    let width = (f64::from(decoded.width()) * scale).round().max(1.0) as u32;
    let height = (f64::from(decoded.height()) * scale).round().max(1.0) as u32;
    let mut pixels = decoded.to_rgba32f();
    for p in pixels.pixels_mut() {
        for i in 0..3 {
            p[i] *= p[3];
        }
    }
    let mut pixels = resize(&pixels, width, height, FilterType::Triangle);
    for p in pixels.pixels_mut() {
        if p[3] > 0.0 {
            for i in 0..3 {
                p[i] /= p[3];
            }
        }
    }
    let resized = image::DynamicImage::ImageRgba32F(pixels).to_rgba8();
    let mut sample = RgbaImage::new(size, size);
    overlay(
        &mut sample,
        &resized,
        i64::from((size - width) / 2),
        i64::from((size - height) / 2),
    );
    crate::icon_color::from_rgba(sample.as_raw(), size as usize)
}

pub fn icon_png(bytes: &[u8]) -> Option<Vec<u8>> {
    if bytes.len() > 4 * 1024 * 1024 {
        return None;
    }
    let mut reader = image::io::Reader::new(std::io::Cursor::new(bytes))
        .with_guessed_format()
        .ok()?;
    let mut limits = image::io::Limits::default();
    limits.max_image_width = Some(2048);
    limits.max_image_height = Some(2048);
    limits.max_alloc = Some(32 * 1024 * 1024);
    reader.limits(limits);
    let decoded = reader.decode().ok()?.thumbnail(128, 128);
    let mut output = std::io::Cursor::new(Vec::new());
    decoded
        .write_to(&mut output, image::ImageOutputFormat::Png)
        .ok()?;
    Some(output.into_inner())
}

pub fn icon_png_from_bgra(bytes: &[u8], width: u32, height: u32) -> Option<Vec<u8>> {
    if width > 128 || height > 128 || bytes.len() != (width * height * 4) as usize {
        return None;
    }
    let mut pixels = image::RgbaImage::from_raw(width, height, bytes.to_vec())?;
    for pixel in pixels.pixels_mut() {
        pixel.0.swap(0, 2);
    }
    let mut output = std::io::Cursor::new(Vec::new());
    pixels
        .write_to(&mut output, image::ImageOutputFormat::Png)
        .ok()?;
    Some(output.into_inner())
}
