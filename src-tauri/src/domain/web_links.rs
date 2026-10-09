use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

// Preserve stored keys when renaming the association implementation.
pub const SETTING_PREFIX: &str = "__web_site::";
pub const MAX_AUTOMATIC_RULE_BYTES: usize = 1024 * 1024;

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct GroupIdentity {
    kind: String,
    domain: String,
}

pub fn group_key(domain: &str) -> String {
    serde_json::to_string(&GroupIdentity {
        kind: "group".into(),
        domain: domain.into(),
    })
    .expect("string identity serializes")
}

pub fn group_domain(key: &str) -> Option<String> {
    let identity: GroupIdentity = serde_json::from_str(key).ok()?;
    (identity.kind == "group"
        && registrable_domain(&identity.domain).as_deref() == Some(&identity.domain))
    .then_some(identity.domain)
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WebLinkRule {
    #[serde(default, skip_serializing_if = "is_zero")]
    pub version: u8,
    /// Read only when converting the earlier automatic-grouping format.
    #[serde(default, skip_serializing_if = "is_false")]
    pub enabled: bool,
    #[serde(
        default,
        deserialize_with = "deserialize_exceptions",
        skip_serializing_if = "BTreeSet::is_empty"
    )]
    pub exceptions: BTreeSet<String>,
    /// Explicit members in legacy configuration; never written by version 2.
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

fn is_zero(value: &u8) -> bool {
    *value == 0
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

pub fn registrable_domain(value: &str) -> Option<String> {
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
    if rule.version != 0 && rule.version != 2 {
        return Err("unsupported website grouping version".into());
    }
    if rule.version == 2
        && (registrable_domain(root).as_deref() != Some(root)
            || rule.enabled
            || rule.members.is_some()
            || rule.auto_root.is_some()
            || rule
                .exceptions
                .iter()
                .any(|member| registrable_domain(member).as_deref() != Some(root)))
    {
        return Err("invalid automatic website grouping".into());
    }
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
        > if rule.version == 2 {
            MAX_AUTOMATIC_RULE_BYTES
        } else {
            4096
        }
    {
        return Err("invalid website display settings or too many exceptions".into());
    }
    Ok(())
}

pub fn resolve_owner(domain: &str, rules: &WebLinkRules) -> String {
    let Some(root) = registrable_domain(domain) else {
        return domain.to_string();
    };
    if rules
        .get(&root)
        .is_some_and(|rule| rule.version == 2 && rule.exceptions.contains(domain))
    {
        return domain.to_string();
    }
    group_key(&root)
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
        if rule.enabled && (rule.members.is_none() || rule.auto_root == registrable_domain(parent))
        {
            if let Some(root) = registrable_domain(parent) {
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
    fn automatic_groups_without_configuration_and_respects_exact_exceptions() {
        let rules = BTreeMap::new();
        assert_eq!(
            resolve_owner("chat.deepseek.com", &rules),
            r#"{"kind":"group","domain":"deepseek.com"}"#
        );
        assert_eq!(resolve_owner("127.0.0.1", &rules), "127.0.0.1");
        let rules = BTreeMap::from([(
            "deepseek.com".into(),
            serde_json::from_str::<WebLinkRule>(
                r#"{"version":2,"exceptions":["chat.deepseek.com"]}"#,
            )
            .unwrap(),
        )]);
        assert_eq!(
            resolve_owner("chat.deepseek.com", &rules),
            "chat.deepseek.com"
        );
        assert_eq!(
            resolve_owner("new.deepseek.com", &rules),
            r#"{"kind":"group","domain":"deepseek.com"}"#
        );
        assert_eq!(
            resolve_owner("a.chat.deepseek.com", &rules),
            r#"{"kind":"group","domain":"deepseek.com"}"#
        );
    }

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
            assert_eq!(registrable_domain(host).as_deref(), expected, "{host}");
        }
    }

    #[test]
    fn automatic_rules_reject_cross_site_exceptions_and_future_formats() {
        for json in [
            r#"{"version":2,"exceptions":["other.com"]}"#,
            r#"{"version":2,"members":["www.example.com"]}"#,
            r#"{"version":3}"#,
        ] {
            let rule = serde_json::from_str(json).unwrap();
            assert!(validate_rule("example.com", &rule).is_err());
        }
        assert!(serde_json::from_str::<WebLinkRule>(
            r#"{"version":2,"exceptions":["example.com","example.com"]}"#
        )
        .is_err());
        assert_eq!(
            registrable_domain("www.食狮.com.cn"),
            registrable_domain("www.xn--85x722f.com.cn")
        );
        let rule = serde_json::from_str(r#"{"version":2,"exceptions":["example.com"]}"#).unwrap();
        validate_rule("example.com", &rule).unwrap();
        assert_ne!(group_key("example.com"), "example.com");
        assert_eq!(
            group_domain(&group_key("example.com")).as_deref(),
            Some("example.com")
        );
        assert!(group_domain(r#"{"kind":"other","domain":"example.com"}"#).is_none());
    }
}
