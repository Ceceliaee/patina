use patina_recorder::{AppRule, WebRule};

#[derive(Clone)]
pub(super) enum Source {
    App(AppRule),
    Web(WebRule),
}

#[derive(Clone)]
pub(super) struct Card {
    pub key: String,
    pub identity: String,
    pub name: String,
    pub category: String,
    pub color: String,
    pub track: bool,
    pub titles: bool,
    pub source: Source,
}

impl From<AppRule> for Card {
    fn from(rule: AppRule) -> Self {
        Self {
            key: format!("app:{}", rule.exe),
            identity: rule.exe.clone(),
            name: rule.name.clone(),
            category: rule.category.clone(),
            color: rule.color.clone(),
            track: rule.track,
            titles: rule.titles,
            source: Source::App(rule),
        }
    }
}
impl From<WebRule> for Card {
    fn from(rule: WebRule) -> Self {
        Self {
            key: format!("web:{}", rule.identity),
            identity: rule.domain.clone(),
            name: rule.name.clone(),
            category: rule.category.clone(),
            color: rule.color.clone(),
            track: rule.track,
            titles: rule.titles,
            source: Source::Web(rule),
        }
    }
}
impl Card {
    pub fn matches_query(&self, query: &str) -> bool {
        self.name.to_lowercase().contains(query)
            || self.identity.to_lowercase().contains(query)
            || matches!(&self.source, Source::Web(site) if site.members.iter().any(|member| member.contains(query)))
    }
    pub fn titles_mixed(&self) -> bool {
        matches!(&self.source, Source::Web(s) if s.titles_mixed)
    }
    pub fn tracking_mixed(&self) -> bool {
        matches!(&self.source, Source::Web(s) if s.tracking_mixed)
    }
    pub fn is_web(&self) -> bool {
        matches!(self.source, Source::Web(_))
    }
    pub fn app_rule(&self) -> Option<AppRule> {
        let Source::App(mut rule) = self.source.clone() else {
            return None;
        };
        rule.name = self.name.clone();
        rule.category = self.category.clone();
        rule.color = self.color.clone();
        rule.track = self.track;
        rule.titles = self.titles;
        Some(rule)
    }
    pub fn web_rule(&self) -> Option<WebRule> {
        let Source::Web(mut rule) = self.source.clone() else {
            return None;
        };
        rule.name = self.name.clone();
        rule.category = self.category.clone();
        rule.color = self.color.clone();
        rule.track = self.track;
        rule.titles = self.titles;
        Some(rule)
    }
}
