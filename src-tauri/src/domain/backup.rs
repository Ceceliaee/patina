use serde::{Deserialize, Serialize};

pub const CURRENT_BACKUP_VERSION: u32 = 1;
pub const CURRENT_BACKUP_SCHEMA_VERSION: u32 = 3;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct BackupMeta {
    pub exported_at_ms: u64,
    pub schema_version: u32,
    pub app_version: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct BackupSession {
    pub id: i64,
    pub app_name: String,
    pub exe_name: String,
    pub window_title: Option<String>,
    pub start_time: i64,
    pub end_time: Option<i64>,
    pub duration: Option<i64>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct BackupSetting {
    pub key: String,
    pub value: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct BackupIconCache {
    pub exe_name: String,
    pub icon_base64: String,
    pub last_updated: Option<i64>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct BackupPayload {
    pub version: u32,
    pub meta: BackupMeta,
    pub sessions: Vec<BackupSession>,
    pub settings: Vec<BackupSetting>,
    pub icon_cache: Vec<BackupIconCache>,
}

#[derive(Clone, Debug, Serialize)]
pub struct BackupPreview {
    pub version: u32,
    pub exported_at_ms: u64,
    pub schema_version: u32,
    pub app_version: String,
    pub compatibility_level: String,
    pub compatibility_message: String,
    pub session_count: usize,
    pub setting_count: usize,
    pub icon_cache_count: usize,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BackupCompatibilityLevel {
    Compatible,
    Legacy,
    Incompatible,
}

impl BackupCompatibilityLevel {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Compatible => "compatible",
            Self::Legacy => "legacy",
            Self::Incompatible => "incompatible",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BackupCompatibility {
    pub level: BackupCompatibilityLevel,
    pub message: String,
    pub supported: bool,
}

impl BackupCompatibility {
    pub fn level_str(&self) -> &'static str {
        self.level.as_str()
    }
}

impl BackupPayload {
    pub fn compatibility(&self) -> BackupCompatibility {
        if self.version > CURRENT_BACKUP_VERSION {
            return BackupCompatibility {
                level: BackupCompatibilityLevel::Incompatible,
                message: format!(
                    "备份格式版本 {} 高于当前支持的 {}，请升级应用后再恢复。",
                    self.version, CURRENT_BACKUP_VERSION
                ),
                supported: false,
            };
        }

        if self.version < CURRENT_BACKUP_VERSION {
            return BackupCompatibility {
                level: BackupCompatibilityLevel::Legacy,
                message: format!(
                    "备份格式版本 {} 低于当前版本 {}，将按兼容模式尝试恢复。",
                    self.version, CURRENT_BACKUP_VERSION
                ),
                supported: true,
            };
        }

        if self.meta.schema_version > CURRENT_BACKUP_SCHEMA_VERSION {
            return BackupCompatibility {
                level: BackupCompatibilityLevel::Incompatible,
                message: format!(
                    "备份 schema 版本 {} 高于当前支持的 {}，请升级应用后再恢复。",
                    self.meta.schema_version, CURRENT_BACKUP_SCHEMA_VERSION
                ),
                supported: false,
            };
        }

        BackupCompatibility {
            level: BackupCompatibilityLevel::Compatible,
            message: "当前版本可直接恢复该备份。".to_string(),
            supported: true,
        }
    }

    pub fn preview(&self) -> BackupPreview {
        let compatibility = self.compatibility();

        BackupPreview {
            version: self.version,
            exported_at_ms: self.meta.exported_at_ms,
            schema_version: self.meta.schema_version,
            app_version: self.meta.app_version.clone(),
            compatibility_level: compatibility.level_str().to_string(),
            compatibility_message: compatibility.message,
            session_count: self.sessions.len(),
            setting_count: self.settings.len(),
            icon_cache_count: self.icon_cache.len(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        BackupCompatibilityLevel, BackupIconCache, BackupMeta, BackupPayload, BackupSession,
        BackupSetting, CURRENT_BACKUP_SCHEMA_VERSION, CURRENT_BACKUP_VERSION,
    };

    fn sample_payload(version: u32, schema_version: u32) -> BackupPayload {
        BackupPayload {
            version,
            meta: BackupMeta {
                exported_at_ms: 1_717_171_717_000,
                schema_version,
                app_version: "0.3.0".to_string(),
            },
            sessions: vec![BackupSession {
                id: 1,
                app_name: "App".to_string(),
                exe_name: "app.exe".to_string(),
                window_title: Some("Window".to_string()),
                start_time: 10,
                end_time: Some(20),
                duration: Some(10),
            }],
            settings: vec![BackupSetting {
                key: "k".to_string(),
                value: "v".to_string(),
            }],
            icon_cache: vec![BackupIconCache {
                exe_name: "app.exe".to_string(),
                icon_base64: "aWNvbg==".to_string(),
                last_updated: Some(30),
            }],
        }
    }

    #[test]
    fn compatibility_is_incompatible_when_backup_version_is_newer() {
        let payload = sample_payload(CURRENT_BACKUP_VERSION + 1, CURRENT_BACKUP_SCHEMA_VERSION);
        let compatibility = payload.compatibility();

        assert_eq!(compatibility.level, BackupCompatibilityLevel::Incompatible);
        assert!(!compatibility.supported);
        assert!(compatibility.message.contains("高于当前支持"));
    }

    #[test]
    fn compatibility_is_legacy_but_supported_when_backup_version_is_older() {
        let payload = sample_payload(CURRENT_BACKUP_VERSION.saturating_sub(1), 1);
        let compatibility = payload.compatibility();

        assert_eq!(compatibility.level, BackupCompatibilityLevel::Legacy);
        assert!(compatibility.supported);
        assert!(compatibility.message.contains("兼容模式"));
    }

    #[test]
    fn compatibility_is_incompatible_when_schema_is_newer() {
        let payload = sample_payload(CURRENT_BACKUP_VERSION, CURRENT_BACKUP_SCHEMA_VERSION + 1);
        let compatibility = payload.compatibility();

        assert_eq!(compatibility.level, BackupCompatibilityLevel::Incompatible);
        assert!(!compatibility.supported);
        assert!(compatibility.message.contains("schema 版本"));
    }

    #[test]
    fn preview_exposes_contract_counts_and_compatibility_fields() {
        let mut payload = sample_payload(CURRENT_BACKUP_VERSION, CURRENT_BACKUP_SCHEMA_VERSION);
        payload.sessions.push(BackupSession {
            id: 2,
            app_name: "App 2".to_string(),
            exe_name: "app2.exe".to_string(),
            window_title: None,
            start_time: 11,
            end_time: None,
            duration: None,
        });

        let preview = payload.preview();
        assert_eq!(preview.compatibility_level, "compatible");
        assert!(preview.compatibility_message.contains("可直接恢复"));
        assert_eq!(preview.session_count, 2);
        assert_eq!(preview.setting_count, 1);
        assert_eq!(preview.icon_cache_count, 1);
    }
}
