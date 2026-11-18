//! Bounded debug-only platform input for isolated full-tracker fault acceptance.
use super::protocol::{ProbeKind, RequestBody, TestAction};
use super::{ForegroundResponse, WindowInfo};
use serde::Deserialize;
use serde_json::Value;
use std::collections::BTreeMap;
use std::io::Read;
use std::path::PathBuf;

const LIMIT: usize = 4 * 1024;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Fixture {
    foreground: WindowInfo,
    #[serde(default)]
    names: BTreeMap<String, String>,
    fault: Option<Fault>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Fault {
    kind: ProbeKind,
    action: FaultAction,
}

#[derive(Deserialize)]
#[serde(rename_all = "kebab-case")]
enum FaultAction {
    Busy,
    PartialResponse,
}

fn enabled(e2e: Option<&str>, fixture: Option<&str>) -> bool {
    e2e == Some("1") && fixture == Some("1")
}

pub(super) fn load() -> Result<Option<Fixture>, String> {
    if !enabled(
        std::env::var("PATINA_E2E").ok().as_deref(),
        std::env::var("PATINA_E2E_NATIVE_FIXTURE").ok().as_deref(),
    ) {
        return Ok(None);
    }
    let root = std::env::var_os("PATINA_E2E_DATA_ROOT")
        .map(PathBuf::from)
        .filter(|root| root.is_absolute())
        .ok_or("native fixture requires absolute isolated data root")?;
    let input = std::fs::File::open(root.join("native-probe-fixture.json"))
        .map_err(|_| "native fixture unavailable")?;
    parse(input).map(Some)
}

fn parse(input: impl Read) -> Result<Fixture, String> {
    let mut bytes = Vec::new();
    input
        .take((LIMIT + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|_| "native fixture read failed")?;
    if bytes.len() > LIMIT {
        return Err("native fixture exceeds limit".into());
    }
    serde_json::from_slice(&bytes).map_err(|_| "native fixture invalid".into())
}

impl Fixture {
    pub(super) fn request(&self, kind: ProbeKind, body: RequestBody) -> RequestBody {
        match self.fault.as_ref().filter(|fault| fault.kind == kind) {
            Some(fault) => RequestBody::Test(match fault.action {
                FaultAction::Busy => TestAction::Busy,
                FaultAction::PartialResponse => TestAction::PartialResponse,
            }),
            None => body,
        }
    }

    pub(super) fn response(&self, body: &RequestBody) -> Option<Result<Value, String>> {
        let result = match body {
            RequestBody::Foreground { .. } => serde_json::to_value(ForegroundResponse {
                app_user_model_id: self.foreground.app_user_model_id.clone(),
                window: self.foreground.clone(),
            }),
            RequestBody::Name { process_path, .. } if self.names.contains_key(process_path) => {
                serde_json::to_value(self.names.get(process_path))
            }
            _ => return None,
        };
        Some(result.map_err(|_| "native fixture response invalid".into()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> Vec<u8> {
        serde_json::to_vec(&serde_json::json!({
            "foreground": { "hwnd":"0x1", "root_owner_hwnd":"0x1", "process_id":42,
                "window_class":"fixture", "title":"fixture", "exe_name":"fixture.exe",
                "process_path":"C:\\fixture.exe", "is_afk":false, "idle_time_ms":0 },
            "names": {"C:\\fixture.exe":"Fixture"},
            "fault":{"kind":"name","action":"busy"}
        }))
        .unwrap()
    }

    #[test]
    fn fixture_requires_explicit_isolated_debug_opt_in() {
        for (e2e, fixture, expected) in [
            (None, None, false),
            (None, Some("1"), false),
            (Some("1"), None, false),
            (Some("0"), Some("1"), false),
            (Some("1"), Some("1"), true),
        ] {
            assert_eq!(enabled(e2e, fixture), expected);
        }
    }

    #[test]
    fn fixture_limits_input_and_rejects_unknown_faults() {
        assert!(parse(&vec![b' '; LIMIT + 1][..]).is_err());
        let bytes = fixture();
        let mut value: Value = serde_json::from_slice(&bytes).unwrap();
        value["fault"]["action"] = "arbitrary-command".into();
        assert!(parse(&serde_json::to_vec(&value).unwrap()[..]).is_err());
        assert!(parse(&bytes[..bytes.len() - 1]).is_err());
    }

    #[test]
    fn fault_replaces_only_its_channel_and_cannot_be_masked_by_fixture_response() {
        let fixture = parse(&fixture()[..]).unwrap();
        let foreground = RequestBody::Foreground {
            afk_threshold_secs: 180,
        };
        let unaffected = fixture.request(ProbeKind::Foreground, foreground);
        assert_eq!(
            fixture.response(&unaffected).unwrap().unwrap()["window"]["exe_name"],
            "fixture.exe"
        );
        let name = RequestBody::Name {
            process_path: "C:\\fixture.exe".into(),
            app_user_model_id: String::new(),
        };
        assert_eq!(fixture.response(&name).unwrap().unwrap(), "Fixture");
        let fault = fixture.request(ProbeKind::Name, name);
        assert!(matches!(fault, RequestBody::Test(TestAction::Busy)));
        assert!(fixture.response(&fault).is_none());
    }
}
