mod generated;
pub use generated::Locale;

use icu_locale::Locale as IcuLocale;
use icu_plurals::{PluralCategory, PluralRules};
use std::collections::BTreeMap;
use std::sync::RwLock;

#[derive(Clone, Copy, Debug)]
pub(super) enum NativeExpr {
    Literal(&'static str),
    Arg(&'static str),
    Concat(&'static [NativeExpr]),
    Plural {
        arg: &'static str,
        cases: &'static [(&'static str, NativeExpr)],
    },
}

#[derive(Debug, Default)]
pub struct LocalizationState {
    locale: RwLock<Locale>,
}

impl LocalizationState {
    pub fn locale(&self) -> Locale {
        *self
            .locale
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    pub fn set_tag(&self, raw: &str) {
        *self
            .locale
            .write()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = Locale::from_tag(Some(raw));
    }
}

pub fn text(locale: Locale, key: &str) -> String {
    format_text(locale, key, &[])
}

pub fn format_text(locale: Locale, key: &str, args: &[(&str, String)]) -> String {
    let values = args.iter().cloned().collect::<BTreeMap<_, _>>();
    if let Some(expression) = generated::lookup(locale, key) {
        match evaluate(expression, locale.tag(), &values) {
            Ok(output) => return output,
            Err(error) => eprintln!(
                "[i18n] failed to format {key:?} for {}: {error}",
                locale.tag()
            ),
        }
    }
    if locale != generated::SOURCE_LOCALE {
        if let Some(expression) = generated::lookup(generated::SOURCE_LOCALE, key) {
            if let Ok(output) = evaluate(expression, generated::SOURCE_LOCALE.tag(), &values) {
                return output;
            }
        }
    }
    eprintln!("[i18n] missing or invalid native message key {key:?}");
    key.to_owned()
}

pub fn cardinal_category(locale_tag: &str, value: i64) -> Result<&'static str, String> {
    let locale: IcuLocale = locale_tag
        .parse()
        .map_err(|error| format!("invalid locale {locale_tag:?}: {error}"))?;
    let rules = PluralRules::try_new_cardinal(locale.into())
        .map_err(|error| format!("plural rules unavailable for {locale_tag:?}: {error}"))?;
    Ok(match rules.category_for(value) {
        PluralCategory::Zero => "zero",
        PluralCategory::One => "one",
        PluralCategory::Two => "two",
        PluralCategory::Few => "few",
        PluralCategory::Many => "many",
        PluralCategory::Other => "other",
    })
}

fn evaluate(
    expression: NativeExpr,
    locale_tag: &str,
    values: &BTreeMap<&str, String>,
) -> Result<String, String> {
    match expression {
        NativeExpr::Literal(value) => Ok(value.to_owned()),
        NativeExpr::Arg(name) => values
            .get(name)
            .cloned()
            .ok_or_else(|| format!("missing argument {name:?}")),
        NativeExpr::Concat(parts) => {
            let mut output = String::new();
            for part in parts {
                output.push_str(&evaluate(*part, locale_tag, values)?);
            }
            Ok(output)
        }
        NativeExpr::Plural { arg, cases } => {
            let raw = values
                .get(arg)
                .ok_or_else(|| format!("missing plural argument {arg:?}"))?;
            let value = raw
                .parse::<i64>()
                .map_err(|error| format!("plural argument {arg:?} is not an integer: {error}"))?;
            let category = cardinal_category(locale_tag, value)?;
            let selected = cases
                .iter()
                .find(|(candidate, _)| *candidate == category)
                .or_else(|| cases.iter().find(|(candidate, _)| *candidate == "other"))
                .ok_or_else(|| format!("plural expression has no {category:?} or other case"))?;
            evaluate(selected.1, locale_tag, values)
        }
    }
}

#[cfg(test)]
pub(crate) fn has_message(locale: Locale, key: &str) -> bool {
    generated::lookup(locale, key).is_some()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn russian_cardinal_categories_follow_cldr() {
        for &(value, expected) in generated::RUSSIAN_CARDINAL_CASES {
            assert_eq!(cardinal_category("ru-RU", value).unwrap(), expected);
            assert_eq!(
                evaluate(
                    generated::RUSSIAN_CARDINAL_MESSAGE,
                    "ru-RU",
                    &BTreeMap::from([("count", value.to_string())]),
                )
                .unwrap(),
                format!("{value}:{expected}")
            );
        }
    }

    #[test]
    fn spanish_native_messages_and_cardinals_are_available() {
        let locale = Locale::from_tag(Some("es"));
        assert_eq!(locale.tag(), "es");
        assert_eq!(text(locale, "native.tray.quit"), "Salir de Patina");
        assert_eq!(
            format_text(
                locale,
                "native.tools.activityReminderDefaultBody",
                &[
                    ("targetName", "Patina".into()),
                    ("usageMinutes", "1".into()),
                    ("limitMinutes", "1".into())
                ]
            ),
            "Patina ha estado activo durante 1 minuto, alcanzando el límite diario de 1 minuto"
        );
        for (count, category) in [
            (0, "other"),
            (1, "one"),
            (2, "other"),
            (21, "other"),
            (1_000_000, "many"),
        ] {
            assert_eq!(cardinal_category("es", count).unwrap(), category);
            let prefix = if count == 1 { "Registro" } else { "Registros" };
            assert_eq!(
                format_text(
                    locale,
                    "native.export.records",
                    &[("count", count.to_string())]
                ),
                format!("{prefix}: {count}")
            );
        }
    }

    #[test]
    fn formatter_substitutes_named_arguments_and_preserves_missing_ones() {
        assert_eq!(
            format_text(
                Locale::EnUs,
                "native.export.records",
                &[("count", "3".into())]
            ),
            "Records: 3"
        );
    }
}
