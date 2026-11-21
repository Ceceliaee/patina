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
    let mut reader =
        image::io::Reader::with_format(std::io::Cursor::new(bytes), image::ImageFormat::Png);
    let mut limits = image::io::Limits::default();
    limits.max_image_width = Some(2048);
    limits.max_image_height = Some(2048);
    limits.max_alloc = Some(32 * 1024 * 1024);
    reader.limits(limits);
    sample_color(reader.decode().ok()?.to_rgba32f())
}

pub fn icon_color_from_bgra(bytes: &[u8], width: u32, height: u32) -> Option<u32> {
    if !(1..=2048).contains(&width)
        || !(1..=2048).contains(&height)
        || bytes.len() != (width * height * 4) as usize
    {
        return None;
    }
    let pixels = image::ImageBuffer::from_fn(width, height, |x, y| {
        let i = ((y * width + x) * 4) as usize;
        image::Rgba(
            [bytes[i + 2], bytes[i + 1], bytes[i], bytes[i + 3]].map(|c| f32::from(c) / 255.),
        )
    });
    sample_color(pixels)
}

fn sample_color(mut pixels: image::Rgba32FImage) -> Option<u32> {
    use image::{
        imageops::{overlay, resize, FilterType},
        RgbaImage,
    };
    let size = 48;
    let scale = (f64::from(size) / f64::from(pixels.width()))
        .min(f64::from(size) / f64::from(pixels.height()));
    let width = (f64::from(pixels.width()) * scale).round().max(1.0) as u32;
    let height = (f64::from(pixels.height()) * scale).round().max(1.0) as u32;
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn display_pixels_preserve_the_png_palette_and_alpha() {
        for id in 0_u8..48 {
            let bgra: Vec<_> = (0_u8..128)
                .flat_map(|y| {
                    (0_u8..32).flat_map(move |x| {
                        [
                            x.wrapping_mul(7),
                            y.wrapping_mul(3),
                            id.wrapping_mul(11),
                            [0, 64, 128, 255][usize::from((x ^ y ^ id) % 4)],
                        ]
                    })
                })
                .collect();
            let png = icon_png_from_bgra(&bgra, 32, 128).unwrap();
            assert_eq!(icon_color_from_bgra(&bgra, 32, 128), icon_color(&png));
        }
        assert_eq!(icon_color_from_bgra(&[0; 4], 0, 1), None);
        assert_eq!(icon_color_from_bgra(&[0; 3], 1, 1), None);
        assert_eq!(icon_color_from_bgra(&[], 2049, 2049), None);
    }
}
