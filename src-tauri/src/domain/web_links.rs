use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

// Preserve stored keys when renaming the association implementation.
pub const SETTING_PREFIX: &str = "__web_site::";
pub const LINK_GROUP_PREFIX: &str = "site:";

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WebLinkRule {
    /// Read only when converting the earlier automatic-grouping format.
    #[serde(default, skip_serializing_if = "is_false")]
    pub enabled: bool,
    #[serde(
        default,
        deserialize_with = "deserialize_exceptions",
        skip_serializing_if = "BTreeSet::is_empty"
    )]
    pub exceptions: BTreeSet<String>,
    /// Presence selects explicit links; absence preserves the previous root-grouping format.
    #[serde(
        default,
        deserialize_with = "deserialize_members",
        skip_serializing_if = "Option::is_none"
    )]
    pub members: Option<BTreeSet<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auto_root: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub category: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
}

pub type WebLinkRules = BTreeMap<String, WebLinkRule>;

fn is_false(value: &bool) -> bool {
    !value
}

fn deserialize_members<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<BTreeSet<String>>, D::Error> {
    let values = Vec::<String>::deserialize(deserializer)?;
    let members: BTreeSet<_> = values.iter().cloned().collect();
    if members.len() != values.len() {
        return Err(serde::de::Error::custom("duplicate website member"));
    }
    Ok(Some(members))
}

fn deserialize_exceptions<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<BTreeSet<String>, D::Error> {
    let values = Vec::<String>::deserialize(deserializer)?;
    let unique: BTreeSet<_> = values.iter().cloned().collect();
    if unique.len() != values.len() {
        return Err(serde::de::Error::custom("duplicate website exception"));
    }
    Ok(unique)
}

fn legacy_registrable_domain(value: &str) -> Option<String> {
    let value = value.trim().trim_end_matches('.');
    let url::Host::Domain(host) = url::Host::parse(value).ok()? else {
        return None;
    };
    if host.len() > 253
        || host.split('.').any(|label| {
            label.is_empty()
                || label.len() > 63
                || label.starts_with('-')
                || label.ends_with('-')
                || !label
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
        })
    {
        return None;
    }
    let domain = psl::domain(host.as_bytes())?;
    domain
        .suffix()
        .is_known()
        .then(|| String::from_utf8_lossy(domain.as_bytes()).into_owned())
}

pub fn validate_rule(root: &str, rule: &WebLinkRule) -> Result<(), String> {
    let canonical = match url::Host::parse(root) {
        Ok(url::Host::Domain(host))
            if host.split('.').all(|label| {
                !label.is_empty()
                    && label.len() <= 63
                    && !label.starts_with('-')
                    && !label.ends_with('-')
                    && label
                        .bytes()
                        .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
            }) =>
        {
            Some(host)
        }
        Ok(host @ (url::Host::Ipv4(_) | url::Host::Ipv6(_))) if rule.members.is_some() => {
            Some(host.to_string())
        }
        _ => None,
    };
    if canonical.as_deref() != Some(root)
        || root.len() + SETTING_PREFIX.len() > 256
        || (rule.members.is_none() && (root.contains(':') || !root.contains('.')))
    {
        return Err("invalid website root".into());
    }
    for member in &rule.exceptions {
        if url::Host::parse(member)
            .ok()
            .map(|host| host.to_string())
            .as_deref()
            != Some(member)
            || (rule.members.is_none()
                && !(member == root || member.ends_with(&format!(".{root}"))))
        {
            return Err("invalid website exception".into());
        }
    }
    if let Some(members) = &rule.members {
        for member in members {
            if member == root
                || rule.exceptions.contains(member)
                || url::Host::parse(member)
                    .ok()
                    .map(|host| host.to_string())
                    .as_deref()
                    != Some(member)
            {
                return Err("invalid linked website member".into());
            }
        }
        if rule.exceptions.contains(root) {
            return Err("website parent cannot be an exception".into());
        }
    }
    if rule.display_name.as_ref().is_some_and(|name| {
        name.trim().is_empty() || name.len() > 256 || name.chars().any(char::is_control)
    }) || rule.color.as_ref().is_some_and(|color| {
        color.len() != 7
            || !color.starts_with('#')
            || !color[1..].bytes().all(|b| b.is_ascii_hexdigit())
    }) || rule.category.as_ref().is_some_and(|category| {
        category.is_empty() || category.len() > 128 || category.chars().any(char::is_control)
    }) || serde_json::to_vec(rule)
        .map_err(|error| error.to_string())?
        .len()
        > 4096
    {
        return Err("invalid website display settings or too many exceptions".into());
    }
    Ok(())
}

pub fn resolve_owner(domain: &str, rules: &WebLinkRules) -> String {
    for (parent, rule) in rules {
        if let Some(members) = &rule.members {
            if domain == parent || members.contains(domain) {
                return format!("{LINK_GROUP_PREFIX}{parent}");
            }
        }
    }
    domain.to_string()
}

/// Only the one-time legacy conversion uses automatic domain matching.
pub fn resolve_legacy_owner(domain: &str, rules: &WebLinkRules) -> String {
    let explicit = resolve_owner(domain, rules);
    if explicit != domain {
        return explicit;
    }
    let Some(root) = legacy_registrable_domain(domain) else {
        return domain.to_string();
    };
    for (parent, rule) in rules {
        if rule.members.is_some()
            && rule.enabled
            && !rule.exceptions.contains(domain)
            && rule.auto_root.as_deref() == Some(&root)
            && legacy_registrable_domain(parent).as_deref() == Some(&root)
        {
            return format!("{LINK_GROUP_PREFIX}{parent}");
        }
    }
    match rules.get(&root) {
        Some(rule)
            if rule.members.is_none() && rule.enabled && !rule.exceptions.contains(domain) =>
        {
            format!("{LINK_GROUP_PREFIX}{root}")
        }
        _ => domain.to_string(),
    }
}

pub fn validate_rules(rules: &WebLinkRules) -> Result<(), String> {
    let parents: BTreeSet<_> = rules
        .iter()
        .filter(|(_, rule)| rule.members.is_some() || rule.enabled)
        .map(|(parent, _)| parent)
        .collect();
    let mut owners = BTreeSet::new();
    let mut automatic_roots = BTreeSet::new();
    for (parent, rule) in rules {
        if let Some(members) = &rule.members {
            for member in members {
                if parents.contains(member) || !owners.insert(member) {
                    return Err("nested or duplicate website membership".into());
                }
            }
        }
        if rule.enabled
            && (rule.members.is_none() || rule.auto_root == legacy_registrable_domain(parent))
        {
            if let Some(root) = legacy_registrable_domain(parent) {
                if !automatic_roots.insert(root) {
                    return Err("conflicting automatic website rules".into());
                }
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn public_private_unknown_and_exception_boundaries() {
        for (host, expected) in [
            ("www.example.com.cn", Some("example.com.cn")),
            ("a.b.example.com", Some("example.com")),
            ("a.github.io", Some("a.github.io")),
            ("b.github.io", Some("b.github.io")),
            ("www.city.kawasaki.jp", Some("city.kawasaki.jp")),
            ("a.b.ck", Some("a.b.ck")),
            ("www.ck", Some("www.ck")),
            ("WWW.Example.COM.", Some("example.com")),
            ("com.cn", None),
            ("localhost", None),
            ("127.0.0.1", None),
            ("[::1]", None),
            ("a.invalid", None),
            ("a..com", None),
        ] {
            assert_eq!(
                legacy_registrable_domain(host).as_deref(),
                expected,
                "{host}"
            );
        }
    }

    #[test]
    fn legacy_reader_preserves_explicit_members_and_exceptions() {
        let rule: WebLinkRule = serde_json::from_str(
            r#"{"enabled":true,"autoRoot":"example.com","members":["other.org"],"exceptions":["mail.example.com"]}"#,
        )
        .unwrap();
        validate_rule("chat.example.com", &rule).unwrap();
        let mut rules = BTreeMap::from([("chat.example.com".into(), rule.clone())]);
        for domain in ["chat.example.com", "other.org", "future.example.com"] {
            assert_eq!(
                resolve_legacy_owner(domain, &rules),
                "site:chat.example.com"
            );
        }
        assert_eq!(
            resolve_legacy_owner("mail.example.com", &rules),
            "mail.example.com"
        );
        rules.get_mut("chat.example.com").unwrap().enabled = false;
        assert_eq!(
            resolve_legacy_owner("other.org", &rules),
            "site:chat.example.com"
        );
        assert_eq!(
            resolve_legacy_owner("future.example.com", &rules),
            "future.example.com"
        );
        rules.insert("other.org".into(), rule.clone());
        assert!(validate_rules(&rules).is_err());
        assert!(serde_json::from_str::<WebLinkRule>(
            r#"{"enabled":false,"members":["a.com","a.com"],"exceptions":[]}"#
        )
        .is_err());
        let mut invalid = rule;
        invalid.members = Some(BTreeSet::from(["mail.example.com".into()]));
        assert!(validate_rule("chat.example.com", &invalid).is_err());
    }

    #[test]
    fn legacy_exceptions_and_disabled_rules_preserve_identity() {
        let rule = WebLinkRule {
            enabled: true,
            members: None,
            auto_root: None,
            exceptions: BTreeSet::from(["mail.example.com".into(), "example.com".into()]),
            display_name: None,
            category: None,
            color: None,
        };
        let mut rules = BTreeMap::from([("example.com".into(), rule)]);
        assert_eq!(
            resolve_legacy_owner("mail.example.com", &rules),
            "mail.example.com"
        );
        assert_eq!(resolve_legacy_owner("example.com", &rules), "example.com");
        assert_eq!(
            resolve_legacy_owner("a.mail.example.com", &rules),
            "site:example.com"
        );
        assert_eq!(
            resolve_legacy_owner("notexample.com", &rules),
            "notexample.com"
        );
        assert_eq!(
            resolve_legacy_owner("example.com.evil.com", &rules),
            "example.com.evil.com"
        );
        rules.get_mut("example.com").unwrap().enabled = false;
        assert_eq!(
            resolve_legacy_owner("www.example.com", &rules),
            "www.example.com"
        );
    }

    #[test]
    fn obsolete_roots_remain_inert_and_can_be_disabled() {
        let mut rule: WebLinkRule =
            serde_json::from_str(r#"{"enabled":true,"exceptions":[]}"#).unwrap();
        assert!(validate_rule("github.io", &rule).is_ok());
        let rules = BTreeMap::from([("github.io".into(), rule.clone())]);
        assert_eq!(resolve_legacy_owner("a.github.io", &rules), "a.github.io");
        rule.enabled = false;
        assert!(validate_rule("github.io", &rule).is_ok());
        assert!(validate_rule("127.0.0.1", &rule).is_err());
        assert!(serde_json::from_str::<WebLinkRule>(
            r#"{"enabled":true,"exceptions":["a.example.com","a.example.com"]}"#
        )
        .is_err());
        assert_eq!(
            legacy_registrable_domain("www.食狮.com.cn"),
            legacy_registrable_domain("www.xn--85x722f.com.cn")
        );
    }
}
