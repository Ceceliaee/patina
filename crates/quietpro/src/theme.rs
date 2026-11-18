use gpui_kit::{Rgba, WindowAppearance, rgb};
use serde::{Deserialize, Deserializer};
use std::{collections::BTreeMap, sync::LazyLock};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SemanticColors {
    #[serde(deserialize_with = "hex")]
    diff_added: Rgba,
    #[serde(deserialize_with = "hex")]
    diff_removed: Rgba,
    #[serde(deserialize_with = "hex")]
    skill: Rgba,
}

fn hex<'de, D: Deserializer<'de>>(d: D) -> Result<Rgba, D::Error> {
    let value = <&str>::deserialize(d)?;
    let raw = value
        .strip_prefix('#')
        .filter(|s| s.len() == 6)
        .ok_or_else(|| serde::de::Error::custom("expected #RRGGBB"))?;
    u32::from_str_radix(raw, 16)
        .map(rgb)
        .map_err(serde::de::Error::custom)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThemePreset {
    pub label: Option<String>,
    #[serde(deserialize_with = "hex")]
    surface: Rgba,
    #[serde(deserialize_with = "hex")]
    ink: Rgba,
    #[serde(deserialize_with = "hex")]
    accent: Rgba,
    contrast: f32,
    semantic_colors: SemanticColors,
}

type Library = BTreeMap<String, ThemePreset>;
#[derive(Deserialize)]
struct Libraries {
    light: Library,
    dark: Library,
}
static LIBRARIES: LazyLock<Libraries> = LazyLock::new(|| {
    serde_json::from_str(include_str!("theme/presets.json")).expect("valid built-in theme presets")
});
impl ThemePreset {
    fn library(dark: bool) -> &'static Library {
        if dark {
            &LIBRARIES.dark
        } else {
            &LIBRARIES.light
        }
    }
    pub fn options(dark: bool) -> impl Iterator<Item = (&'static str, &'static Self)> {
        let library = Self::library(dark);
        std::iter::once(("default", &library["default"])).chain(
            library
                .iter()
                .filter(|(k, _)| k.as_str() != "default")
                .map(|(k, v)| (k.as_str(), v)),
        )
    }
    pub fn swatches(&self) -> [Rgba; 6] {
        [
            self.surface,
            self.ink,
            self.accent,
            self.semantic_colors.diff_added,
            self.semantic_colors.diff_removed,
            self.semantic_colors.skill,
        ]
    }
}

#[derive(Clone, Copy)]
pub struct Palette {
    pub canvas: Rgba,
    pub chrome: Rgba,
    pub panel: Rgba,
    pub border: Rgba,
    pub border_strong: Rgba,
    pub text: Rgba,
    pub secondary: Rgba,
    pub accent: Rgba,
    pub hover: Rgba,
    pub track: Rgba,
    pub success: Rgba,
    pub warning: Rgba,
    pub danger: Rgba,
    pub disabled_text: Rgba,
    pub control_fill: Rgba,
    pub switch_thumb_off: Rgba,
    pub switch_track: Rgba,
    pub switch_track_hover: Rgba,
}

impl Palette {
    pub fn for_scheme(dark: bool, scheme: &str) -> Self {
        let library = ThemePreset::library(dark);
        let Some(p) = library.get(scheme).filter(|_| scheme != "default") else {
            return Self::from(if dark {
                WindowAppearance::Dark
            } else {
                WindowAppearance::Light
            });
        };
        let base = p.surface;
        let ink = p.ink;
        let mix = |a: Rgba, b: Rgba, n| a.blend(b.opacity(n));
        let baseline = if dark { 60. } else { 45. };
        let c = p.contrast / 100. + (p.contrast - baseline) / 60. * 0.7;
        Self {
            canvas: base,
            text: ink,
            accent: p.accent,
            chrome: if dark {
                mix(base, rgb(0), 0.16 + (p.contrast - 60.) * 0.0015)
            } else {
                mix(base, ink, 0.04 + (p.contrast - 45.) * 0.0012)
            },
            panel: if dark {
                mix(base, ink, 0.03 + c * 0.03)
            } else {
                mix(base, rgb(0xffffff), 0.18 + c * 0.008)
            },
            border: mix(base, ink, if dark { 0.30 } else { 0.16 }),
            border_strong: mix(base, ink, if dark { 0.46 } else { 0.32 }),
            secondary: mix(base, ink, if dark { 0.78 } else { 0.76 }),
            hover: mix(base, p.accent, if dark { 0.20 } else { 0.12 }),
            track: mix(base, ink, if dark { 0.28 } else { 0.05 }),
            success: p.semantic_colors.diff_added,
            danger: p.semantic_colors.diff_removed,
            warning: if dark {
                mix(rgb(0xd29922), p.accent, 0.52)
            } else {
                mix(rgb(0xb58900), p.accent, 0.64)
            },
            disabled_text: mix(base, ink, if dark { 0.34 } else { 0.38 }),
            control_fill: mix(base, ink, if dark { 0.92 } else { 0.60 }),
            switch_thumb_off: mix(base, ink, if dark { 0.38 } else { 0.30 }),
            switch_track: mix(base, ink, if dark { 0.08 } else { 0.04 }),
            switch_track_hover: mix(base, ink, if dark { 0.14 } else { 0.08 }),
        }
    }
}

impl From<WindowAppearance> for Palette {
    fn from(value: WindowAppearance) -> Self {
        let dark = matches!(
            value,
            WindowAppearance::Dark | WindowAppearance::VibrantDark
        );
        let tone = |light, night| rgb(if dark { night } else { light });
        Self {
            canvas: tone(0xfbfbfb, 0x262626),
            chrome: tone(0xf4f4f4, 0x212121),
            panel: tone(0xffffff, 0x2d2d2d),
            border: tone(0xdddddd, 0x404040),
            border_strong: tone(0xc5c5c5, 0x5f5f5f),
            text: tone(0x171717, 0xd1d5dc),
            secondary: tone(0x434343, 0xadb3bd),
            accent: tone(0x315f9f, 0x8ba1c0),
            hover: tone(0xe8eef6, 0x333b46),
            track: tone(0xe6e6e6, 0x484848),
            success: tone(0x2f7d49, 0x82ad8b),
            warning: tone(0x9a6700, 0xc19b5c),
            danger: tone(0xb53a3a, 0xc98383),
            disabled_text: tone(0xadadad, 0x6f7680),
            control_fill: tone(0x858a90, 0xd6d9df),
            switch_thumb_off: tone(0xc2c5c8, 0x73777e),
            switch_track: tone(0xf5f5f5, 0x303030),
            switch_track_hover: tone(0xededed, 0x373737),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn named_schemes_apply_the_library_colors_and_unknown_ids_use_the_mode_default() {
        for dark in [false, true] {
            for (id, preset) in ThemePreset::options(dark) {
                let palette = Palette::for_scheme(dark, id);
                let [surface, ink, accent, success, danger, _] = preset.swatches();
                assert_eq!(
                    (palette.canvas, palette.text, palette.accent),
                    (surface, ink, accent)
                );
                assert_eq!((palette.success, palette.danger), (success, danger));
            }
            assert_eq!(
                Palette::for_scheme(dark, "unknown").panel,
                Palette::for_scheme(dark, "default").panel
            );
        }
        assert_eq!(Palette::for_scheme(true, "nord").canvas, rgb(0x2e3440));
        assert_eq!(Palette::for_scheme(false, "nord").canvas, rgb(0xfbfbfb));
    }
}
