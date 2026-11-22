use patina_desktop_protocol::tools::{NoticeChoices, NoticeContent, NoticeContext, NoticeTarget};
use patina_i18n::{Locale, text};

/// Packages built before API 7 relied on the desktop to supply their actions.
pub(super) fn content(notice: &NoticeContext, locale: &str) -> NoticeContent {
    let locale = Locale::from_tag(Some(locale));
    let tr = |key| text(locale, key);
    let mut content = NoticeContent {
        title: notice.label.clone(),
        detail: notice.local_time.clone(),
        actions: vec![("dismiss".into(), tr("common.confirm"))],
        choices: None,
    };
    match notice.target {
        NoticeTarget::Reminder(_) => {
            content.choices = Some(NoticeChoices {
                label: tr("tools.usageExtensionDuration"),
                options: ["5", "15", "30"]
                    .map(|n| {
                        (
                            n.into(),
                            patina_i18n::format_text(
                                locale,
                                "settings.minuteValue",
                                &[("minutes", n.into())],
                            ),
                        )
                    })
                    .into(),
            });
        }
        NoticeTarget::Usage(_) => {
            content.detail = tr("tools.usageLimitReached");
            content.choices = Some(NoticeChoices {
                label: tr("tools.usageExtend"),
                options: [
                    ("fifteen_minutes", "tools.usageExtendFifteen"),
                    ("one_hour", "tools.usageExtendHour"),
                    ("today", "tools.usageExtendToday"),
                ]
                .map(|(id, key)| (id.into(), tr(key)))
                .into(),
            });
        }
        NoticeTarget::Focus { .. } => content.actions.push(("start".into(), tr("tools.start"))),
        NoticeTarget::Timer => {}
    }
    content
}
