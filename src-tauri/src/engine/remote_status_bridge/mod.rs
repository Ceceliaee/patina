use crate::domain::settings::RemoteStatusBridgeSettings;
use crate::engine::tracking::metadata;
use crate::engine::tracking::runtime_snapshot::TrackingRuntimeSnapshotState;
use crc32fast::Hasher as Crc32Hasher;
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use std::collections::hash_map::DefaultHasher;
use std::future::Future;
use std::hash::{Hash, Hasher};
use std::pin::Pin;
use std::sync::Arc;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Listener, Manager, Runtime};
use tokio::sync::watch;
use tokio::time::{interval, sleep, Duration, Instant, MissedTickBehavior};
use tokio_tungstenite::{
    connect_async,
    tungstenite::{Error as WsError, Message},
};

const SETTINGS_CHANGED_EVENT: &str = "app-settings-changed";
const TRACKING_EVENT_NAMES: [&str; 2] = ["active-window-changed", "tracking-data-changed"];
const HEARTBEAT_INTERVAL_SECS: u64 = 60;
const AUTH_TIMEOUT_SECS: u64 = 5;
const RECONNECT_BACKOFF_SECS: [u64; 5] = [1, 2, 5, 10, 30];

pub type RemoteStatusStoreFuture<'a, T> =
    Pin<Box<dyn Future<Output = Result<T, String>> + Send + 'a>>;

pub trait RemoteStatusBridgeStore: Send + Sync {
    fn load_settings(&self) -> RemoteStatusStoreFuture<'_, RemoteStatusBridgeSettings>;
    fn save_machine_id<'a>(&'a self, machine_id: &'a str) -> RemoteStatusStoreFuture<'a, ()>;
    fn load_icon<'a>(&'a self, exe_name: &'a str) -> RemoteStatusStoreFuture<'a, Option<String>>;
}

#[derive(Debug)]
pub struct RemoteStatusBridgeRuntimeState {
    inner: Mutex<RemoteStatusBridgeRuntimeInner>,
    wake_tx: watch::Sender<u64>,
    shutdown_tx: watch::Sender<u64>,
}

#[derive(Debug, Default)]
struct RemoteStatusBridgeRuntimeInner {
    settings: RemoteStatusBridgeSettings,
    task: Option<tauri::async_runtime::JoinHandle<()>>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct RemoteStatusBridgeSnapshot {
    machine_id: String,
    sampled_at_ms: i64,
    presence: String,
    app_name: String,
    exe_name: String,
    icon_hash: String,
    icon_data: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct RemoteStatusBridgeSnapshotPayload {
    sampled_at_ms: i64,
    presence: String,
    app_name: String,
    exe_name: String,
    icon_hash: String,
    icon_data: Option<String>,
}

impl Default for RemoteStatusBridgeRuntimeState {
    fn default() -> Self {
        let (wake_tx, _) = watch::channel(0);
        let (shutdown_tx, _) = watch::channel(0);
        Self {
            inner: Mutex::new(RemoteStatusBridgeRuntimeInner::default()),
            wake_tx,
            shutdown_tx,
        }
    }
}

impl RemoteStatusBridgeRuntimeState {
    pub fn update<R: Runtime + 'static>(
        &self,
        app: AppHandle<R>,
        store: Arc<dyn RemoteStatusBridgeStore>,
        settings: RemoteStatusBridgeSettings,
    ) {
        let mut inner = lock_inner(&self.inner);
        let should_restart = inner.settings != settings;

        if should_restart {
            if let Some(task) = inner.task.take() {
                task.abort();
            }
            signal_watch(&self.shutdown_tx);
        }

        if settings.enabled && (should_restart || inner.task.is_none()) {
            inner.task = Some(spawn_runtime_task(
                app,
                store,
                settings.clone(),
                self.wake_tx.subscribe(),
                self.shutdown_tx.subscribe(),
            ));
        }

        inner.settings = settings;
    }

    pub fn notify_snapshot_change(&self) {
        signal_watch(&self.wake_tx);
    }
}

pub async fn ensure_machine_id<R: Runtime>(
    app: &AppHandle<R>,
    store: &dyn RemoteStatusBridgeStore,
) -> Result<String, String> {
    let current = store
        .load_settings()
        .await
        .map_err(|error| format!("failed to load remote status bridge settings: {error}"))?;

    if !current.machine_id.trim().is_empty() {
        return Ok(current.machine_id);
    }

    let machine_id = generate_machine_id();
    store.save_machine_id(&machine_id).await?;
    app.emit(SETTINGS_CHANGED_EVENT, json!({}))
        .map_err(|error| format!("failed to emit settings refresh event: {error}"))?;
    Ok(machine_id)
}

pub fn start<R: Runtime + 'static>(app: AppHandle<R>, store: Arc<dyn RemoteStatusBridgeStore>) {
    reload_runtime_settings(app.clone(), Arc::clone(&store));

    let settings_app = app.clone();
    let settings_store = Arc::clone(&store);
    app.listen_any(SETTINGS_CHANGED_EVENT, move |_| {
        reload_runtime_settings(settings_app.clone(), Arc::clone(&settings_store));
    });

    for event_name in TRACKING_EVENT_NAMES {
        let tracking_app = app.clone();
        app.listen_any(event_name, move |_| {
            if let Some(state) = tracking_app.try_state::<RemoteStatusBridgeRuntimeState>() {
                state.notify_snapshot_change();
            }
        });
    }
}

fn reload_runtime_settings<R: Runtime + 'static>(
    app: AppHandle<R>,
    store: Arc<dyn RemoteStatusBridgeStore>,
) {
    tauri::async_runtime::spawn(async move {
        match store.load_settings().await {
            Ok(settings) => {
                if let Some(state) = app.try_state::<RemoteStatusBridgeRuntimeState>() {
                    state.update(app.clone(), Arc::clone(&store), settings);
                }
            }
            Err(error) => eprintln!("[remote-status-bridge] failed to load settings: {error}"),
        }
    });
}

fn spawn_runtime_task<R: Runtime + 'static>(
    app: AppHandle<R>,
    store: Arc<dyn RemoteStatusBridgeStore>,
    settings: RemoteStatusBridgeSettings,
    wake_rx: watch::Receiver<u64>,
    shutdown_rx: watch::Receiver<u64>,
) -> tauri::async_runtime::JoinHandle<()> {
    tauri::async_runtime::spawn(async move {
        let mut attempt = 0_usize;
        loop {
            let result = run_connection(
                app.clone(),
                Arc::clone(&store),
                settings.clone(),
                wake_rx.clone(),
                shutdown_rx.clone(),
            )
            .await;

            match result {
                Ok(()) => return,
                Err(error) => {
                    eprintln!("[remote-status-bridge] connection ended: {error}");
                }
            }

            let Some(backoff_secs) = RECONNECT_BACKOFF_SECS
                .get(attempt)
                .copied()
                .or_else(|| RECONNECT_BACKOFF_SECS.last().copied())
            else {
                return;
            };
            attempt = (attempt + 1).min(RECONNECT_BACKOFF_SECS.len().saturating_sub(1));
            let jitter_ms = now_ms() % 500;

            let delay = sleep(Duration::from_secs(backoff_secs) + Duration::from_millis(jitter_ms));
            tokio::pin!(delay);
            let mut local_shutdown_rx = shutdown_rx.clone();
            tokio::select! {
                _ = &mut delay => {}
                _ = local_shutdown_rx.changed() => return,
            }
        }
    })
}

async fn run_connection<R: Runtime>(
    app: AppHandle<R>,
    store: Arc<dyn RemoteStatusBridgeStore>,
    settings: RemoteStatusBridgeSettings,
    mut wake_rx: watch::Receiver<u64>,
    mut shutdown_rx: watch::Receiver<u64>,
) -> Result<(), String> {
    let (stream, _) = connect_async(&settings.url)
        .await
        .map_err(|error| format!("failed to connect worker websocket: {error}"))?;
    let (mut sink, mut socket_stream) = stream.split();

    send_text(
        &mut sink,
        json!({
            "type": "auth",
            "token": settings.token,
        })
        .to_string(),
    )
    .await?;

    let auth_deadline = Instant::now() + Duration::from_secs(AUTH_TIMEOUT_SECS);
    let mut pending_snapshot = build_snapshot_payload(&app, store.as_ref()).await.ok();
    loop {
        let timeout_sleep = sleep_until_deadline(auth_deadline);
        tokio::pin!(timeout_sleep);
        tokio::select! {
            _ = shutdown_rx.changed() => return Ok(()),
            _ = wake_rx.changed() => {
                pending_snapshot = build_snapshot_payload(&app, store.as_ref()).await.ok();
            }
            _ = &mut timeout_sleep => return Err("worker auth timed out".to_string()),
            next = socket_stream.next() => {
                let Some(next) = next else {
                    return Err("worker closed before auth response".to_string());
                };
                let message = next.map_err(|error| format!("worker auth read failed: {error}"))?;
                if message.is_close() {
                    return Err("worker closed during auth".to_string());
                }
                match parse_message_type(&message)?.as_deref() {
                    Some("auth-ok") => break,
                    Some("auth-failed") => return Err("worker rejected auth token".to_string()),
                    Some("unsupported-version") => return Err("worker rejected protocol version".to_string()),
                    Some("ping") => {
                        send_text(&mut sink, json!({ "type": "pong" }).to_string()).await?;
                    }
                    _ => {}
                }
            }
        }
    }

    let mut heartbeat = interval(Duration::from_secs(HEARTBEAT_INTERVAL_SECS));
    heartbeat.set_missed_tick_behavior(MissedTickBehavior::Delay);
    heartbeat.tick().await;

    let initial_payload = match pending_snapshot.take() {
        Some(payload) => payload,
        None => build_snapshot_payload(&app, store.as_ref()).await?,
    };
    let initial_snapshot = build_snapshot(&settings.machine_id, initial_payload, true);
    let mut last_sent_identity = snapshot_identity(&initial_snapshot);
    send_snapshot(&mut sink, initial_snapshot).await?;

    loop {
        tokio::select! {
            _ = shutdown_rx.changed() => return Ok(()),
            _ = wake_rx.changed() => {
                let next_snapshot = build_snapshot_for_change(
                    &app,
                    store.as_ref(),
                    &settings.machine_id,
                    Some(&last_sent_identity),
                )
                .await?;
                if let Some(snapshot) = next_snapshot {
                    last_sent_identity = snapshot_identity(&snapshot);
                    send_snapshot(&mut sink, snapshot).await?;
                }
            }
            _ = heartbeat.tick() => {
                let heartbeat_snapshot = build_snapshot_for_heartbeat(
                    &app,
                    store.as_ref(),
                    &settings.machine_id,
                    &last_sent_identity,
                ).await?;
                last_sent_identity = snapshot_identity(&heartbeat_snapshot);
                send_snapshot(&mut sink, heartbeat_snapshot).await?;
            }
            next = socket_stream.next() => {
                let Some(next) = next else {
                    return Err("worker connection closed".to_string());
                };
                let message = next.map_err(|error| format!("worker read failed: {error}"))?;
                if message.is_close() {
                    return Err("worker closed websocket".to_string());
                }
                if matches!(parse_message_type(&message)?.as_deref(), Some("ping")) {
                    send_text(&mut sink, json!({ "type": "pong" }).to_string()).await?;
                }
            }
        }
    }
}

async fn build_snapshot_for_change<R: Runtime>(
    app: &AppHandle<R>,
    store: &dyn RemoteStatusBridgeStore,
    machine_id: &str,
    last_identity: Option<&SnapshotIdentity>,
) -> Result<Option<RemoteStatusBridgeSnapshot>, String> {
    let payload = build_snapshot_payload(app, store).await?;
    let next_identity = snapshot_identity_from_payload(&payload);
    if last_identity == Some(&next_identity) {
        return Ok(None);
    }

    let snapshot = build_snapshot(
        machine_id,
        payload,
        should_include_icon_data(last_identity, &next_identity),
    );
    Ok(Some(snapshot))
}

async fn build_snapshot_for_heartbeat<R: Runtime>(
    app: &AppHandle<R>,
    store: &dyn RemoteStatusBridgeStore,
    machine_id: &str,
    last_identity: &SnapshotIdentity,
) -> Result<RemoteStatusBridgeSnapshot, String> {
    let payload = build_snapshot_payload(app, store).await?;
    let next_identity = snapshot_identity_from_payload(&payload);
    Ok(build_snapshot(
        machine_id,
        payload,
        should_include_icon_data(Some(last_identity), &next_identity),
    ))
}

async fn build_snapshot_payload<R: Runtime>(
    app: &AppHandle<R>,
    store: &dyn RemoteStatusBridgeStore,
) -> Result<RemoteStatusBridgeSnapshotPayload, String> {
    let runtime_snapshot = app
        .try_state::<TrackingRuntimeSnapshotState>()
        .and_then(|state| state.snapshot())
        .ok_or_else(|| "tracking runtime snapshot is not ready".to_string())?;

    let app_name = metadata::map_app_name(
        &runtime_snapshot.window.exe_name,
        &runtime_snapshot.window.process_path,
    );
    let icon_data = load_icon_for_exe(store, &runtime_snapshot.window.exe_name).await;
    let icon_hash = compute_icon_hash(icon_data.as_deref());

    Ok(RemoteStatusBridgeSnapshotPayload {
        sampled_at_ms: runtime_snapshot.sampled_at_ms,
        presence: if runtime_snapshot.status.is_tracking_active {
            "active".to_string()
        } else {
            "afk".to_string()
        },
        app_name,
        exe_name: runtime_snapshot.window.exe_name,
        icon_hash,
        icon_data,
    })
}

fn build_snapshot(
    machine_id: &str,
    payload: RemoteStatusBridgeSnapshotPayload,
    include_icon_data: bool,
) -> RemoteStatusBridgeSnapshot {
    RemoteStatusBridgeSnapshot {
        machine_id: machine_id.to_string(),
        sampled_at_ms: payload.sampled_at_ms,
        presence: payload.presence,
        app_name: payload.app_name,
        exe_name: payload.exe_name,
        icon_hash: payload.icon_hash,
        icon_data: if include_icon_data {
            payload.icon_data
        } else {
            None
        },
    }
}

fn snapshot_identity_from_payload(payload: &RemoteStatusBridgeSnapshotPayload) -> SnapshotIdentity {
    SnapshotIdentityFields {
        presence: payload.presence.clone(),
        app_name: payload.app_name.clone(),
        icon_hash: payload.icon_hash.clone(),
    }
}

async fn load_icon_for_exe(store: &dyn RemoteStatusBridgeStore, exe_name: &str) -> Option<String> {
    store.load_icon(exe_name).await.ok().flatten()
}

type SnapshotIdentity = SnapshotIdentityFields;

#[derive(Clone, Debug, PartialEq, Eq)]
struct SnapshotIdentityFields {
    presence: String,
    app_name: String,
    icon_hash: String,
}

fn snapshot_identity(snapshot: &RemoteStatusBridgeSnapshot) -> SnapshotIdentity {
    SnapshotIdentityFields {
        presence: snapshot.presence.clone(),
        app_name: snapshot.app_name.clone(),
        icon_hash: snapshot.icon_hash.clone(),
    }
}

fn should_include_icon_data(
    last_identity: Option<&SnapshotIdentity>,
    next_identity: &SnapshotIdentity,
) -> bool {
    last_identity
        .map(|identity| identity.icon_hash != next_identity.icon_hash)
        .unwrap_or(true)
}

fn compute_icon_hash(icon_data: Option<&str>) -> String {
    let Some(icon_data) = icon_data else {
        return "png:none".to_string();
    };
    let mut hasher = Crc32Hasher::new();
    hasher.update(icon_data.as_bytes());
    format!("png:{:08x}", hasher.finalize())
}

async fn send_snapshot<S>(sink: &mut S, snapshot: RemoteStatusBridgeSnapshot) -> Result<(), String>
where
    S: futures_util::Sink<Message, Error = WsError> + Unpin,
{
    send_text(
        sink,
        json!({
            "type": "snapshot",
            "version": 1,
            "machineId": snapshot.machine_id,
            "sampledAtMs": snapshot.sampled_at_ms,
            "presence": snapshot.presence,
            "appName": snapshot.app_name,
            "iconHash": snapshot.icon_hash,
            "iconData": snapshot.icon_data,
        })
        .to_string(),
    )
    .await
}

async fn send_text<S>(sink: &mut S, text: String) -> Result<(), String>
where
    S: futures_util::Sink<Message, Error = WsError> + Unpin,
{
    sink.send(Message::Text(text.into()))
        .await
        .map_err(|error| format!("worker send failed: {error}"))
}

fn parse_message_type(message: &Message) -> Result<Option<String>, String> {
    let text = match message.to_text() {
        Ok(text) => text,
        Err(_) => return Ok(None),
    };
    let payload = serde_json::from_str::<Value>(text)
        .map_err(|error| format!("invalid worker json message: {error}"))?;
    Ok(payload
        .get("type")
        .and_then(Value::as_str)
        .map(str::to_string))
}

fn generate_machine_id() -> String {
    let mut hasher = DefaultHasher::new();
    std::env::var("COMPUTERNAME")
        .unwrap_or_default()
        .hash(&mut hasher);
    std::process::id().hash(&mut hasher);
    now_ms().hash(&mut hasher);
    format!("machine-{:016x}", hasher.finish())
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or_default()
}

fn signal_watch(sender: &watch::Sender<u64>) {
    sender.send_modify(|generation| {
        *generation = generation.wrapping_add(1);
    });
}

fn sleep_until_deadline(deadline: Instant) -> tokio::time::Sleep {
    tokio::time::sleep_until(deadline)
}

fn lock_inner<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    match mutex.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compute_icon_hash_changes_when_value_changes() {
        assert_eq!(
            compute_icon_hash(Some("abc")),
            compute_icon_hash(Some("abc"))
        );
        assert_ne!(
            compute_icon_hash(Some("abc")),
            compute_icon_hash(Some("def"))
        );
        assert_eq!(compute_icon_hash(None), "png:none");
    }

    #[test]
    fn snapshot_identity_only_tracks_presence_app_and_icon() {
        let snapshot = RemoteStatusBridgeSnapshot {
            machine_id: "machine".into(),
            sampled_at_ms: 1,
            presence: "active".into(),
            app_name: "Code".into(),
            exe_name: "Code.exe".into(),
            icon_hash: "png:1".into(),
            icon_data: None,
        };
        assert_eq!(
            snapshot_identity(&snapshot),
            SnapshotIdentityFields {
                presence: "active".into(),
                app_name: "Code".into(),
                icon_hash: "png:1".into(),
            }
        );
    }

    #[test]
    fn icon_data_only_repeats_when_icon_hash_changes() {
        let previous = SnapshotIdentityFields {
            presence: "active".into(),
            app_name: "Code".into(),
            icon_hash: "png:1".into(),
        };
        let same = SnapshotIdentityFields {
            presence: "afk".into(),
            app_name: "Code".into(),
            icon_hash: "png:1".into(),
        };
        let changed = SnapshotIdentityFields {
            presence: "afk".into(),
            app_name: "Code".into(),
            icon_hash: "png:2".into(),
        };

        assert!(!should_include_icon_data(Some(&previous), &same));
        assert!(should_include_icon_data(Some(&previous), &changed));
        assert!(should_include_icon_data(None, &same));
    }
}
