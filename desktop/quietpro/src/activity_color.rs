use gpui_kit::{Rgba, rgb};

fn channels(color: u32) -> [f64; 3] {
    [16, 8, 0].map(|shift| f64::from((color >> shift) & 255) / 255.)
}

fn linear(value: f64) -> f64 {
    if value <= 0.04045 {
        value / 12.92
    } else {
        ((value + 0.055) / 1.055).powf(2.4)
    }
}

fn contrast(a: u32, b: u32) -> f64 {
    let luminance = |color| {
        let [r, g, b] = channels(color).map(linear);
        0.2126 * r + 0.7152 * g + 0.0722 * b
    };
    let a = luminance(a);
    let b = luminance(b);
    (a.max(b) + 0.05) / (a.min(b) + 0.05)
}

fn to_lab(color: u32) -> [f64; 3] {
    let [r, g, b] = channels(color).map(linear);
    let l = (0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b).cbrt();
    let m = (0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b).cbrt();
    let s = (0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b).cbrt();
    [
        0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
        1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
        0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
    ]
}

fn from_lab([lightness, a, b]: [f64; 3]) -> [f64; 3] {
    let l = (lightness + 0.3963377774 * a + 0.2158037573 * b).powi(3);
    let m = (lightness - 0.1055613458 * a - 0.0638541728 * b).powi(3);
    let s = (lightness - 0.0894841775 * a - 1.291485548 * b).powi(3);
    [
        4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
        -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
        -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
    ]
}

fn in_gamut(lab: [f64; 3]) -> bool {
    from_lab(lab)
        .iter()
        .all(|c| (-0.000001..=1.000001).contains(c))
}

fn at_lightness(lightness: f64, a: f64, b: f64) -> u32 {
    let mut scale = 1.;
    if !in_gamut([lightness, a, b]) {
        let (mut low, mut high) = (0., 1.);
        for _ in 0..22 {
            let middle = (low + high) / 2.;
            if in_gamut([lightness, a * middle, b * middle]) {
                low = middle;
            } else {
                high = middle;
            }
        }
        scale = low;
    }
    from_lab([lightness, a * scale, b * scale])
        .into_iter()
        .fold(0, |color, value| {
            let value = value.clamp(0., 1.);
            let srgb = if value <= 0.0031308 {
                12.92 * value
            } else {
                1.055 * value.powf(1. / 2.4) - 0.055
            };
            (color << 8) | (srgb * 255.).round() as u32
        })
}

fn packed(color: Rgba) -> u32 {
    [color.r, color.g, color.b]
        .into_iter()
        .fold(0, |rgb, channel| {
            (rgb << 8) | (channel.clamp(0., 1.) * 255.).round() as u32
        })
}

/// Applies the same OKLCH lightness and gamut rules as the Web activity display colors.
pub fn activity_display_color(source: u32, background: Rgba, dark: bool) -> Rgba {
    let background = packed(background);
    let target = if dark { 3. } else { 2. };
    if contrast(source, background) >= target {
        return rgb(source);
    }
    let [lightness, mut a, mut b] = to_lab(source);
    let [r, g, blue] = channels(source);
    if r == g && g == blue {
        a = 0.;
        b = 0.;
    }
    let end = if contrast(0xffffff, background) > contrast(0, background) {
        1.
    } else {
        0.
    };
    let (mut fail, mut pass) = (0., 1.);
    for _ in 0..26 {
        let middle = (fail + pass) / 2.;
        if contrast(
            at_lightness(lightness + (end - lightness) * middle, a, b),
            background,
        ) >= target
        {
            pass = middle;
        } else {
            fail = middle;
        }
    }
    rgb(at_lightness(lightness + (end - lightness) * pass, a, b))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Palette, ThemePreset};

    #[test]
    fn activity_colors_match_web_reference() {
        for (source, background, dark, expected) in [
            (0xffffff, 0xe6e6e6, false, 0xa3a3a3),
            (0x00ff00, 0xe6e6e6, false, 0x00be00),
            (0x000000, 0x484848, true, 0x949494),
            (0x0000ff, 0x484848, true, 0x5d90ff),
            (0x35a69e, 0xe6e6e6, false, 0x35a69e),
            (0x6f7ae6, 0x484848, true, 0x7e8bf8),
        ] {
            assert_eq!(
                packed(activity_display_color(source, rgb(background), dark)),
                expected
            );
        }
    }

    #[test]
    fn activity_colors_meet_contrast_on_chart_panels_and_ranking_tracks() {
        for dark in [false, true] {
            for (scheme, _) in ThemePreset::options(dark) {
                let palette = Palette::for_scheme(dark, scheme);
                for background in [palette.panel, palette.track] {
                    for source in [
                        0,
                        0xffffff,
                        0xeeeeee,
                        0x181818,
                        0xff0000,
                        0x00ff00,
                        0x0000ff,
                        0x35a69e,
                        0xc56a73,
                        0x6f7ae6,
                        0x8f98a8,
                        u32::from(palette.accent) >> 8,
                        u32::from(palette.secondary) >> 8,
                    ] {
                        let result = packed(activity_display_color(source, background, dark));
                        let target = if dark { 3. } else { 2. };
                        assert!(
                            contrast(result, packed(background)) >= target,
                            "{scheme}: {source:06x}"
                        );
                        if contrast(source, packed(background)) >= target {
                            assert_eq!(
                                result, source,
                                "sufficient original colors must stay unchanged"
                            );
                        }
                    }
                }
            }
        }
    }
}
