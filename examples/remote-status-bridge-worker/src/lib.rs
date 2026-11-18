#![cfg_attr(not(any(test, target_arch = "wasm32")), allow(dead_code))]

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

#[cfg(target_arch = "wasm32")]
mod cloudflare;

#[derive(Clone, Serialize, Deserialize, PartialEq, Eq, Debug)]
#[serde(rename_all = "lowercase")]
enum Presence {
    Active,
    Afk,
    Offline,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct Machine {
    machine_id: String,
    sampled_at_ms: i64,
    presence: Presence,
    app_name: String,
    icon_hash: String,
    icon_data: Option<String>,
    last_received_at_ms: i64,
}

type Machines = BTreeMap<String, Machine>;

fn snapshot(message: &Value, received: i64) -> Option<Machine> {
    if message.get("version")?.as_f64()? != 1.0 {
        return None;
    }
    let machine_id = message.get("machineId")?.as_str()?.trim();
    if machine_id.is_empty() {
        return None;
    }
    let icon_data = match message.get("iconData") {
        None | Some(Value::Null) => None,
        Some(value) => Some(value.as_str()?.to_owned()),
    };
    Some(Machine {
        machine_id: machine_id.into(),
        sampled_at_ms: message.get("sampledAtMs")?.as_f64()?.trunc() as i64,
        presence: match message.get("presence")?.as_str()? {
            "active" => Presence::Active,
            "afk" => Presence::Afk,
            _ => return None,
        },
        app_name: message.get("appName")?.as_str()?.into(),
        icon_hash: message.get("iconHash")?.as_str()?.into(),
        icon_data,
        last_received_at_ms: received,
    })
}

fn merge(machines: &mut Machines, mut incoming: Machine) {
    if incoming.icon_data.is_none()
        && let Some(old) = machines.get(&incoming.machine_id)
    {
        incoming.icon_data = old.icon_data.clone();
    }
    machines.insert(incoming.machine_id.clone(), incoming);
}

fn visible(machines: Machines, now: i64) -> Vec<Machine> {
    machines
        .into_values()
        .map(|mut m| {
            if now.saturating_sub(m.last_received_at_ms) > 180_000 {
                m.presence = Presence::Offline;
            }
            m
        })
        .collect()
}

fn authenticated(expected: &str, message: &Value) -> bool {
    let expected = expected.trim();
    !expected.is_empty()
        && message.get("type").and_then(Value::as_str) == Some("auth")
        && message
            .get("token")
            .and_then(Value::as_str)
            .is_some_and(|s| s.trim() == expected)
}

#[derive(Debug, PartialEq)]
enum Packet {
    Authenticated,
    RejectAuth,
    Close(u16, &'static str),
    Pong,
    Ignore,
    Snapshot(Machine),
}

fn handle(authorized: bool, token: &str, bytes: &[u8], now: i64) -> Packet {
    let Ok(value) = serde_json::from_slice::<Value>(bytes) else {
        return Packet::Close(1003, "invalid json");
    };
    let Some(kind) = value.get("type").and_then(Value::as_str) else {
        return Packet::Close(1003, "invalid json");
    };
    if !authorized {
        if kind != "auth" {
            return Packet::Close(1008, "auth required");
        }
        return if authenticated(token, &value) {
            Packet::Authenticated
        } else {
            Packet::RejectAuth
        };
    }
    match kind {
        "ping" => Packet::Pong,
        "snapshot" => {
            snapshot(&value, now).map_or(Packet::Close(1003, "invalid snapshot"), Packet::Snapshot)
        }
        _ => Packet::Ignore,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn socket_protocol_requires_auth_before_writing_or_ping() {
        assert_eq!(
            handle(false, "sample", br#"{"type":"ping"}"#, 0),
            Packet::Close(1008, "auth required")
        );
        assert_eq!(
            handle(false, "sample", br#"{"type":"auth","token":"invalid"}"#, 0),
            Packet::RejectAuth
        );
        assert_eq!(
            handle(false, "sample", br#"{"type":"auth","token":"sample"}"#, 0),
            Packet::Authenticated
        );
        assert_eq!(handle(true, "", br#"{"type":"ping"}"#, 0), Packet::Pong);
        assert_eq!(
            handle(true, "", br#"{"type":"snapshot"}"#, 0),
            Packet::Close(1003, "invalid snapshot")
        );
        assert_eq!(
            handle(true, "", &[255], 0),
            Packet::Close(1003, "invalid json")
        );
    }

    #[test]
    fn rejects_invalid_auth_and_snapshots() {
        let auth = json!({"type":"auth","token":" sample "});
        assert!(authenticated("sample", &auth));
        assert!(!authenticated("", &json!({"type":"auth","token":""})));
        assert!(!authenticated(
            "sample",
            &json!({"type":"snapshot","token":"sample"})
        ));
        assert!(snapshot(&json!({"version":2}), 0).is_none());
    }
    #[test]
    fn persisted_state_survives_reconnect_and_expires_from_receipt_time() {
        let mut machines = Machines::new();
        let mut m = json!({"type":"snapshot","version":1,"machineId":" b ","sampledAtMs":10.9,"presence":"active","appName":"Demo","iconHash":"hash","iconData":"image"});
        merge(&mut machines, snapshot(&m, 1000).unwrap());
        let mut restored: Machines =
            serde_json::from_slice(&serde_json::to_vec(&machines).unwrap()).unwrap();
        m["iconData"] = Value::Null;
        m["presence"] = json!("afk");
        merge(&mut restored, snapshot(&m, 2000).unwrap());
        assert_eq!(restored["b"].icon_data.as_deref(), Some("image"));
        assert_eq!(restored["b"].sampled_at_ms, 10);
        assert_eq!(visible(restored.clone(), 182000)[0].presence, Presence::Afk);
        assert_eq!(visible(restored, 182001)[0].presence, Presence::Offline);
    }
}
