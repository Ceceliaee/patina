use gpui_kit::{App, Styled, TextSystem, base::Root};
use std::borrow::Cow;

const UI_FAMILY: &str = "Source Han Sans CN VF";

pub(crate) fn apply_ui_fonts(surface: &mut impl Styled) {
    let style = surface.text_style();
    style.font_family = Some(UI_FAMILY.into());
    style.font_weight = Some(crate::REGULAR_TEXT_WEIGHT);
}

fn register_fonts(text: &TextSystem) -> gpui_kit::Result<()> {
    text.add_fonts(vec![Cow::Borrowed(include_bytes!(
        "../assets/fonts/SourceHanSansCN-VF.ttf"
    ))])
}

pub fn init_fonts(cx: &mut App) -> gpui_kit::Result<()> {
    register_fonts(cx.text_system())?;
    let typography = &mut gpui_kit::base::Theme::global_mut(cx).tokens.typography;
    typography.sans = UI_FAMILY.into();
    typography.mono = UI_FAMILY.into();
    cx.observe_new::<Root>(|root, _, cx| {
        apply_ui_fonts(root);
        cx.notify();
    })
    .detach();
    Ok(())
}

#[cfg(all(test, feature = "native-tests"))]
mod tests {
    use super::*;
    use gpui_kit::{FontWeight, TextStyle, WindowTextSystem, px};

    #[test]
    #[ignore = "native DirectWrite shaping on an isolated Windows desktop"]
    fn mixed_text_uses_source_han_at_all_three_weights() -> gpui_kit::Result<()> {
        if !patina_test_support::run_case()? {
            return Ok(());
        }
        let app = gpui_kit::application();
        let text = app.text_system();
        register_fonts(&text)?;
        let shaper = WindowTextSystem::new(text.clone());
        let sample = "A中9文";
        let mut previous_advance = None;
        for weight in [FontWeight::NORMAL, FontWeight::MEDIUM, FontWeight::BOLD] {
            let style = TextStyle {
                font_family: UI_FAMILY.into(),
                font_weight: weight,
                ..Default::default()
            };
            let line =
                shaper.shape_line(sample.into(), px(14.), &[style.to_run(sample.len())], None);
            let face = text.resolve_font(&style.font());
            assert_eq!(text.units_per_em(face), 1000);
            assert_eq!(
                line.runs.iter().map(|r| r.glyphs.len()).sum::<usize>(),
                sample.chars().count()
            );
            for run in &line.runs {
                assert_eq!(run.font_id, face, "unexpected fallback at {weight:?}");
                assert!(run.glyphs.iter().all(|g| g.id.0 != 0));
            }
            let advance = text.advance(face, px(14.), 'A')?.width;
            assert!(
                previous_advance.is_none_or(|previous| advance > previous),
                "indistinct weight {weight:?}"
            );
            previous_advance = Some(advance);
        }
        Ok(())
    }
}
