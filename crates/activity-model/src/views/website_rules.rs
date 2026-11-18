use crate::web_links::{group_domain, group_key, registrable_domain, SETTING_PREFIX};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::{BTreeMap, BTreeSet};

const DOMAIN_PREFIX: &str = "__web_domain_override::";

#[derive(Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WebsiteMemberRule {
    pub domain: String,
    pub track: bool,
    pub titles: bool,
}

#[derive(Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WebsiteRule {
    pub identity: String,
    pub domain: String,
    pub root: Option<String>,
    pub name: String,
    pub category: String,
    pub color: String,
    pub track: bool,
    pub titles: bool,
    pub tracking_mixed: bool,
    pub titles_mixed: bool,
    pub members: Vec<String>,
    pub member_rules: Vec<WebsiteMemberRule>,
    pub favicon: Option<String>,
}

/// A website draft retains independent and group settings when members move.
/// Only changed settings are persisted; observed metadata is read-only.
#[derive(Clone, Default, Serialize, Deserialize)]
pub struct WebsiteRuleDraft {
    pub original: BTreeMap<String, Option<String>>,
    pub values: BTreeMap<String, Map<String, Value>>,
    pub domains: BTreeSet<String>,
    pub totals: BTreeMap<String, i64>,
    pub favicons: BTreeMap<String, String>,
}

impl WebsiteRuleDraft {
    fn value(&self, key: &str) -> Map<String, Value> {
        self.values.get(key).cloned().unwrap_or_else(|| {
            self.original
                .get(key)
                .and_then(|s| s.as_deref())
                .and_then(|s| serde_json::from_str(s).ok())
                .unwrap_or_default()
        })
    }

    pub fn cards(&self) -> Vec<WebsiteRule> {
        let mut groups = BTreeMap::<String, Vec<WebsiteMemberRule>>::new();
        for domain in &self.domains {
            let root = registrable_domain(domain);
            let independent = root.as_ref().is_some_and(|root| {
                self.value(&format!("{SETTING_PREFIX}{root}"))
                    .get("exceptions")
                    .and_then(Value::as_array)
                    .is_some_and(|items| items.iter().any(|v| v.as_str() == Some(domain)))
            });
            let identity = root
                .filter(|_| !independent)
                .map(|root| group_key(&root))
                .unwrap_or_else(|| domain.clone());
            let raw = self.value(&format!("{DOMAIN_PREFIX}{domain}"));
            groups.entry(identity).or_default().push(WebsiteMemberRule {
                domain: domain.clone(),
                track: raw.get("enabled").and_then(Value::as_bool).unwrap_or(true),
                titles: raw
                    .get("captureTitle")
                    .and_then(Value::as_bool)
                    .unwrap_or(true),
            });
        }
        groups
            .into_iter()
            .map(|(identity, members)| {
                let group = group_domain(&identity);
                let domain = group.clone().unwrap_or_else(|| identity.clone());
                let raw = self.value(&format!(
                    "{}{domain}",
                    if group.is_some() {
                        SETTING_PREFIX
                    } else {
                        DOMAIN_PREFIX
                    }
                ));
                let get = |key: &str, fallback: &str| {
                    raw.get(key)
                        .and_then(Value::as_str)
                        .filter(|s| !s.trim().is_empty())
                        .unwrap_or(fallback)
                        .to_owned()
                };
                let enabled = members.iter().filter(|m| m.track).count();
                let titles = members.iter().filter(|m| m.titles).count();
                let favicon = members
                    .iter()
                    .filter(|m| group.is_none() || m.track)
                    .filter(|m| {
                        self.favicons
                            .get(&m.domain)
                            .is_some_and(|s| !s.trim().is_empty())
                    })
                    .min_by(|a, b| {
                        self.totals
                            .get(&b.domain)
                            .unwrap_or(&0)
                            .cmp(self.totals.get(&a.domain).unwrap_or(&0))
                            .then(a.domain.cmp(&b.domain))
                    })
                    .and_then(|m| self.favicons.get(&m.domain))
                    .cloned();
                WebsiteRule {
                    root: registrable_domain(&domain),
                    identity,
                    domain: domain.clone(),
                    name: get("displayName", &domain),
                    category: get("category", "other"),
                    color: get("color", ""),
                    track: enabled > 0,
                    titles: titles == members.len(),
                    tracking_mixed: enabled > 0 && enabled < members.len(),
                    titles_mixed: titles > 0 && titles < members.len(),
                    members: members.iter().map(|m| m.domain.clone()).collect(),
                    member_rules: members,
                    favicon,
                }
            })
            .collect()
    }

    pub fn assign(&mut self, edit: &WebsiteRule) {
        let Some(old) = self
            .cards()
            .into_iter()
            .find(|c| c.identity == edit.identity)
        else {
            return;
        };
        let prefix = if group_domain(&edit.identity).is_some() {
            SETTING_PREFIX
        } else {
            DOMAIN_PREFIX
        };
        let key = format!("{prefix}{}", edit.domain);
        let mut raw = self.value(&key);
        for (field, before, after) in [
            ("displayName", old.name.as_str(), edit.name.trim()),
            ("category", old.category.as_str(), edit.category.as_str()),
            ("color", old.color.as_str(), edit.color.as_str()),
        ] {
            if before != after {
                if after.is_empty() {
                    raw.remove(field);
                } else {
                    raw.insert(field.into(), after.into());
                }
            }
        }
        if raw != self.value(&key) {
            if prefix == SETTING_PREFIX {
                raw.insert("version".into(), 2.into());
            }
            self.values.insert(key, raw);
        }
        for member in &old.members {
            if old.track != edit.track {
                self.set_member(member, false, edit.track);
            }
            if old.titles != edit.titles {
                self.set_member(member, true, edit.titles);
            }
        }
    }

    pub fn set_member(&mut self, domain: &str, title: bool, enabled: bool) {
        if !self.domains.contains(domain) {
            return;
        }
        let key = format!("{DOMAIN_PREFIX}{domain}");
        let mut raw = self.value(&key);
        raw.insert(
            if title { "captureTitle" } else { "enabled" }.into(),
            enabled.into(),
        );
        self.values.insert(key, raw);
    }

    pub fn set_independent(&mut self, domain: &str, independent: bool) {
        if !self.domains.contains(domain) {
            return;
        }
        let Some(root) = registrable_domain(domain) else {
            return;
        };
        let key = format!("{SETTING_PREFIX}{root}");
        let mut raw = self.value(&key);
        let mut exceptions: BTreeSet<String> = raw
            .get("exceptions")
            .cloned()
            .and_then(|v| serde_json::from_value(v).ok())
            .unwrap_or_default();
        if independent {
            exceptions.insert(domain.into());
        } else {
            exceptions.remove(domain);
        }
        raw.insert("version".into(), 2.into());
        raw.insert(
            "exceptions".into(),
            serde_json::to_value(exceptions).expect("domain strings"),
        );
        self.values.insert(key, raw);
    }

    pub fn dirty(&self) -> bool {
        !self.changed().is_empty()
    }

    pub fn changed(&self) -> Vec<(&String, &Map<String, Value>)> {
        self.values
            .iter()
            .filter(|(key, value)| {
                let old: Map<String, Value> = self
                    .original
                    .get(*key)
                    .and_then(|s| s.as_deref())
                    .and_then(|s| serde_json::from_str(s).ok())
                    .unwrap_or_default();
                normalized_setting(key, value) != normalized_setting(key, &old)
            })
            .collect()
    }
}

// Compare defaults semantically while retaining metadata and dormant member overrides.
fn normalized_setting(key: &str, value: &Map<String, Value>) -> Map<String, Value> {
    let mut value = value.clone();
    let domain = key
        .split_once("::")
        .map(|(_, domain)| domain)
        .unwrap_or(key);
    for (field, default) in [
        ("enabled", Value::Bool(true)),
        ("captureTitle", Value::Bool(true)),
        ("category", Value::String("other".into())),
        ("color", Value::String(String::new())),
        ("displayName", Value::String(domain.into())),
    ] {
        if value.get(field) == Some(&default) {
            value.remove(field);
        }
    }
    if let Some(Value::String(color)) = value.get_mut("color") {
        *color = color.to_uppercase();
    }
    if key.starts_with(SETTING_PREFIX) {
        value.remove("version");
        if let Some(Value::Array(items)) = value.get_mut("exceptions") {
            items.sort_by(|a, b| a.as_str().cmp(&b.as_str()));
            items.dedup();
            if items.is_empty() {
                value.remove("exceptions");
            }
        }
    }
    value
}
