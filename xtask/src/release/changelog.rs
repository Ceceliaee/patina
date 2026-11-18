use super::{Result, TARGETS, Target, Version, asset_url};
use std::{fs, path::Path};

const SECTIONS: [(&str, &str); 4] = [
    ("Added", "新增"),
    ("Changed", "改进"),
    ("Fixed", "修复"),
    ("Removed", "移除"),
];

pub struct Notes {
    release: String,
    chinese: String,
    english: Option<String>,
    sections: [Vec<String>; 4],
}

pub fn read(root: &Path, version: &Version) -> Result<Notes> {
    parse(&fs::read_to_string(root.join("CHANGELOG.md"))?, version)
}

pub fn parse(text: &str, version: &Version) -> Result<Notes> {
    let prefix = format!("## [{version}] - ");
    let mut lines = text.lines();
    if !lines.any(|line| {
        line.strip_prefix(&prefix).is_some_and(|date| {
            date.len() == 10
                && date.bytes().enumerate().all(|(i, b)| match i {
                    4 | 7 => b == b'-',
                    _ => b.is_ascii_digit(),
                })
        })
    }) {
        return Err(format!("CHANGELOG.md lacks dated section for {version}").into());
    }
    let mut fields = std::collections::HashMap::new();
    let mut sections: [Vec<String>; 4] = Default::default();
    let mut active = None;
    for line in lines.take_while(|s| !s.starts_with("## [")) {
        if let Some(heading) = line.strip_prefix("### ") {
            active = SECTIONS.iter().position(|(key, _)| *key == heading.trim());
            continue;
        }
        if let Some((key, value)) = line.split_once(':')
            && matches!(key, "Release" | "App note" | "App note en")
            && fields.insert(key, value.trim().to_owned()).is_some()
        {
            return Err(format!("Duplicate {key} in {version}").into());
        }
        let bullet = line.trim();
        if let Some(i) = active
            && bullet.starts_with("- ")
            && !matches!(bullet, "- 暂无" | "- 暂无。")
        {
            sections[i].push(bullet.to_owned());
        }
    }
    let count: usize = sections.iter().map(Vec::len).sum();
    let limit = if version.patch == 0 && version.minor != 0 {
        14
    } else {
        7
    };
    if !(1..=limit).contains(&count) {
        return Err(
            format!("{version} needs 1–{limit} visible changelog entries; found {count}").into(),
        );
    }
    let field = |key| -> Result<String> {
        let s = fields
            .get(key)
            .ok_or_else(|| format!("Missing {key} in {version}"))?;
        if matches!(
            s.trim_end_matches('.').to_uppercase().as_str(),
            "" | "待定" | "TBD" | "TODO"
        ) {
            return Err(format!("Unfinished {key} in {version}").into());
        }
        Ok(s.to_owned())
    };
    Ok(Notes {
        release: field("Release")?,
        chinese: field("App note")?,
        english: fields
            .contains_key("App note en")
            .then(|| field("App note en"))
            .transpose()?,
        sections,
    })
}

impl Notes {
    pub fn app(&self) -> String {
        match &self.english {
            Some(en) => format!("zh-CN: {}\nen-US: {en}", self.chinese),
            None => self.chinese.clone(),
        }
    }

    pub fn public(&self, version: &Version) -> Result<String> {
        let mut text = format!("{}\n\n", self.release);
        for ((_, title), entries) in SECTIONS.iter().zip(&self.sections) {
            if !entries.is_empty() {
                text.push_str(&format!("### {title}\n\n{}\n\n", entries.join("\n")));
            }
        }
        let mut badges = Vec::new();
        for target in TARGETS {
            let label = match target {
                Target::X64 => "x64",
                Target::Arm64 => "ARM64",
            };
            let url = asset_url(version, "Ceceliaee/patina", target)?;
            badges.push(format!("[![Setup {label}](https://img.shields.io/badge/Setup-{label}-1683a7?logo=windows11&logoColor=white)]({url})"));
        }
        text.push_str(&format!(
            "### 下载\n\n| 系统 | 下载 |\n| --- | --- |\n| Windows | {} |\n",
            badges.join("<br>")
        ));
        Ok(text)
    }
}
