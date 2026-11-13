use gpui_kit::{Rgba, WindowAppearance, rgb};

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
        }
    }
}
