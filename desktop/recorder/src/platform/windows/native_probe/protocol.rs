use serde::{de::DeserializeOwned, Deserialize, Serialize};
use std::io::{Read, Write};

pub(super) const VERSION: u32 = 1;
pub(super) const REQUEST_LIMIT: usize = 64 * 1024;
pub(super) const RESPONSE_LIMIT: usize = 2 * 1024 * 1024;

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum ProbeKind {
    Foreground,
    Name,
    Icon,
    Media,
    Audio,
    Shell,
}

impl ProbeKind {
    pub(super) fn argument(self) -> &'static str {
        match self {
            Self::Foreground => "foreground",
            Self::Name => "name",
            Self::Icon => "icon",
            Self::Media => "media",
            Self::Audio => "audio",
            Self::Shell => "shell",
        }
    }
}

#[derive(Deserialize, Serialize)]
pub(super) struct Request {
    pub version: u32,
    pub id: u64,
    pub body: RequestBody,
}

#[derive(Deserialize, Serialize)]
pub(super) enum RequestBody {
    Foreground {
        afk_threshold_secs: u64,
    },
    Name {
        process_path: String,
        app_user_model_id: String,
    },
    Icon(IconRequest),
    Media,
    Audio {
        timestamp_ms: i64,
    },
    Shell {
        app_user_model_id: String,
        icon: bool,
    },
    #[cfg(debug_assertions)]
    Test(TestAction),
}

impl RequestBody {
    pub(super) fn accepts_kind(&self, kind: ProbeKind) -> bool {
        match self {
            Self::Foreground { .. } => kind == ProbeKind::Foreground,
            Self::Name { .. } => kind == ProbeKind::Name,
            Self::Icon(_) => kind == ProbeKind::Icon,
            Self::Media => kind == ProbeKind::Media,
            Self::Audio { .. } => kind == ProbeKind::Audio,
            Self::Shell { .. } => kind == ProbeKind::Shell,
            #[cfg(debug_assertions)]
            Self::Test(_) => true,
        }
    }
}

#[derive(Deserialize, Serialize)]
pub(crate) struct IconRequest {
    pub process_id: u32,
    pub process_path: String,
    pub exe_name: String,
    pub app_user_model_id: String,
    pub window_class: String,
    pub root_owner_hwnd: String,
    pub hwnd: String,
}

#[cfg(debug_assertions)]
#[derive(Deserialize, Serialize)]
pub(super) enum TestAction {
    Echo(u64),
    Busy,
    Crash,
    Malformed,
    WrongResponse,
    PartialResponse,
    SpawnBusyDescendant,
    ApartmentIsMta,
    ResourceSnapshot,
    AccessViolation,
    StalledAccessViolation,
    IdleAccessViolation,
    ShellAccessViolation,
    ShellUncached {
        app_user_model_id: String,
        icon: bool,
    },
}

#[derive(Deserialize, Serialize)]
pub(super) struct Response {
    pub version: u32,
    pub id: u64,
    pub result: Result<serde_json::Value, String>,
    pub caches: ProbeCacheCounts,
    pub shell: Option<super::ShellProbeDiagnostics>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub(crate) struct ProbeCacheCounts {
    pub process_details: usize,
    pub process_details_bytes: usize,
    pub process_identities: usize,
    pub process_identity_bytes: usize,
    pub icon_results: usize,
    pub icon_bytes: usize,
    pub shell_entries: usize,
    pub shell_bytes: usize,
}

pub(super) fn read_frame<T: DeserializeOwned>(
    input: &mut impl Read,
    limit: usize,
) -> Result<T, String> {
    let mut header = [0; 4];
    input
        .read_exact(&mut header)
        .map_err(|_| "probe pipe closed".to_owned())?;
    let size = u32::from_le_bytes(header) as usize;
    if size == 0 || size > limit {
        return Err("probe frame exceeds limit".into());
    }
    let mut bytes = vec![0; size];
    input
        .read_exact(&mut bytes)
        .map_err(|_| "probe frame incomplete".to_owned())?;
    serde_json::from_slice(&bytes).map_err(|_| "probe frame invalid".into())
}

pub(super) fn write_frame<T: Serialize>(
    output: &mut impl Write,
    value: &T,
    limit: usize,
) -> Result<(), String> {
    let bytes = serde_json::to_vec(value).map_err(|_| "probe encoding failed".to_owned())?;
    if bytes.len() > limit {
        return Err("probe frame exceeds limit".into());
    }
    output
        .write_all(&(bytes.len() as u32).to_le_bytes())
        .and_then(|_| output.write_all(&bytes))
        .and_then(|_| output.flush())
        .map_err(|_| "probe pipe write failed".to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn framing_rejects_size_truncation_and_invalid_payloads() {
        assert!(read_frame::<Response>(&mut &u32::MAX.to_le_bytes()[..], RESPONSE_LIMIT).is_err());
        assert!(read_frame::<Response>(&mut &[1, 0, 0, 0][..], RESPONSE_LIMIT).is_err());
        assert!(read_frame::<Response>(&mut &[1, 0, 0, 0, b'x'][..], RESPONSE_LIMIT).is_err());
        let mut output = Vec::new();
        assert!(write_frame(&mut output, &"too long", 2).is_err());
        assert!(output.is_empty());
    }

    #[test]
    fn metadata_cannot_take_over_foreground_channel() {
        assert!(!RequestBody::Media.accepts_kind(ProbeKind::Foreground));
        assert!(!RequestBody::Foreground {
            afk_threshold_secs: 180
        }
        .accepts_kind(ProbeKind::Name));
        let shell = RequestBody::Shell {
            app_user_model_id: "fixture!App".into(),
            icon: true,
        };
        assert!(shell.accepts_kind(ProbeKind::Shell));
        assert!(!shell.accepts_kind(ProbeKind::Icon));
        assert!(!RequestBody::Media.accepts_kind(ProbeKind::Shell));
    }
}
