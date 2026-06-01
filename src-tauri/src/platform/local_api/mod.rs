use crate::domain::settings::LocalApiSettings;
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use std::future::Future;
use std::io;
use std::net::{IpAddr, Ipv4Addr, SocketAddr, TcpListener as StdTcpListener};
use std::pin::Pin;
use std::sync::Mutex;
use tauri::{AppHandle, Runtime};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{broadcast, watch};
use tokio::time::{timeout, Duration};
use tokio_tungstenite::{
    accept_async,
    tungstenite::{Error as WsError, Message},
};

const LOCAL_API_AUTH_TIMEOUT_SECS: u64 = 5;
const LOCAL_API_HANDSHAKE_TIMEOUT_SECS: u64 = 5;
const LOCAL_API_BROADCAST_CAPACITY: usize = 256;
pub const LOCAL_API_SETTINGS_CHANGED_EVENT: &str = "app-settings-changed";
pub const LOCAL_API_ACTIVE_WINDOW_EVENT: &str = "active-window-changed";
pub const LOCAL_API_TRACKING_DATA_EVENT: &str = "tracking-data-changed";

pub type LocalApiStringFuture = Pin<Box<dyn Future<Output = Option<String>> + Send>>;

pub struct LocalApiRuntimeDeps<R: Runtime> {
    pub load_token: fn(AppHandle<R>) -> LocalApiStringFuture,
    pub load_snapshot: fn(AppHandle<R>) -> LocalApiStringFuture,
}

impl<R: Runtime> Clone for LocalApiRuntimeDeps<R> {
    fn clone(&self) -> Self {
        *self
    }
}

impl<R: Runtime> Copy for LocalApiRuntimeDeps<R> {}

#[derive(Debug)]
pub struct LocalApiRuntimeState {
    inner: Mutex<LocalApiRuntimeInner>,
    event_tx: broadcast::Sender<String>,
    shutdown_tx: watch::Sender<u64>,
}

#[derive(Debug, Default)]
struct LocalApiRuntimeInner {
    settings: LocalApiSettings,
    server_task: Option<tauri::async_runtime::JoinHandle<()>>,
}

impl Default for LocalApiRuntimeState {
    fn default() -> Self {
        let (event_tx, _) = broadcast::channel(LOCAL_API_BROADCAST_CAPACITY);
        let (shutdown_tx, _) = watch::channel(0);
        Self {
            inner: Mutex::new(LocalApiRuntimeInner::default()),
            event_tx,
            shutdown_tx,
        }
    }
}

impl LocalApiRuntimeState {
    pub fn update<R: Runtime + 'static>(
        &self,
        app: AppHandle<R>,
        settings: LocalApiSettings,
        deps: LocalApiRuntimeDeps<R>,
    ) {
        let mut inner = lock_inner(&self.inner);
        let previous_settings = inner.settings.clone();
        let should_restart =
            should_restart_server(&previous_settings, &settings, inner.server_task.is_some());

        if should_restart {
            if let Some(task) = inner.server_task.take() {
                task.abort();
            }
            signal_shutdown(&self.shutdown_tx);
        }

        if settings.enabled && (should_restart || inner.server_task.is_none()) {
            inner.server_task = spawn_server(
                app,
                self.event_tx.clone(),
                self.shutdown_tx.subscribe(),
                settings.clone(),
                deps,
            );
        }

        inner.settings = settings;
    }

    pub fn broadcast(&self, message: String) {
        let _ = self.event_tx.send(message);
    }
}

fn should_restart_server(
    previous_settings: &LocalApiSettings,
    settings: &LocalApiSettings,
    has_server_task: bool,
) -> bool {
    previous_settings.enabled != settings.enabled
        || previous_settings.port != settings.port
        || previous_settings.token != settings.token
        || (!settings.enabled && has_server_task)
}

fn signal_shutdown(shutdown_tx: &watch::Sender<u64>) {
    shutdown_tx.send_modify(|generation| {
        *generation = generation.wrapping_add(1);
    });
}

fn spawn_server<R: Runtime + 'static>(
    app: AppHandle<R>,
    event_tx: broadcast::Sender<String>,
    mut shutdown_rx: watch::Receiver<u64>,
    settings: LocalApiSettings,
    deps: LocalApiRuntimeDeps<R>,
) -> Option<tauri::async_runtime::JoinHandle<()>> {
    let (address, std_listener) = match open_local_api_listener(settings.port) {
        Ok(listener) => listener,
        Err(error) => {
            eprintln!(
                "[local-api] failed to bind 127.0.0.1:{}: {error}",
                settings.port
            );
            return None;
        }
    };

    Some(tauri::async_runtime::spawn(async move {
        let listener = match TcpListener::from_std(std_listener) {
            Ok(listener) => listener,
            Err(error) => {
                eprintln!("[local-api] failed to attach listener {address}: {error}");
                return;
            }
        };

        loop {
            let (stream, remote_addr) = tokio::select! {
                changed = shutdown_rx.changed() => {
                    if changed.is_err() {
                        eprintln!("[local-api] shutdown channel closed");
                    }
                    return;
                }
                next = listener.accept() => {
                    match next {
                        Ok(next) => next,
                        Err(error) => {
                            eprintln!("[local-api] accept failed: {error}");
                            continue;
                        }
                    }
                }
            };
            let client_app = app.clone();
            let client_event_tx = event_tx.clone();
            let client_shutdown_rx = shutdown_rx.clone();
            let fallback_token = settings.token.clone();

            tauri::async_runtime::spawn(async move {
                if let Err(error) = handle_client(
                    client_app,
                    client_event_tx,
                    client_shutdown_rx,
                    fallback_token,
                    stream,
                    deps,
                )
                .await
                {
                    eprintln!("[local-api] client {remote_addr} closed: {error}");
                }
            });
        }
    }))
}

fn open_local_api_listener(port: u16) -> io::Result<(SocketAddr, StdTcpListener)> {
    let address = SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), port);
    let listener = StdTcpListener::bind(address)?;
    listener.set_nonblocking(true)?;
    Ok((address, listener))
}

async fn handle_client<R: Runtime>(
    app: AppHandle<R>,
    event_tx: broadcast::Sender<String>,
    mut shutdown_rx: watch::Receiver<u64>,
    fallback_token: String,
    stream: TcpStream,
    deps: LocalApiRuntimeDeps<R>,
) -> Result<(), String> {
    let token = tokio::select! {
        changed = shutdown_rx.changed() => {
            return shutdown_result(changed);
        }
        token = (deps.load_token)(app.clone()) => {
            token.unwrap_or(fallback_token)
        }
    };

    let ws_stream = tokio::select! {
        changed = shutdown_rx.changed() => {
            return shutdown_result(changed);
        }
        handshake = timeout(
            Duration::from_secs(LOCAL_API_HANDSHAKE_TIMEOUT_SECS),
            accept_async(stream),
        ) => {
            handshake
                .map_err(|_| "websocket handshake timed out".to_string())?
                .map_err(|error| format!("websocket handshake failed: {error}"))?
        }
    };
    let (mut sink, mut stream) = ws_stream.split();
    let mut event_rx = event_tx.subscribe();

    if !authenticate_client(&mut sink, &mut stream, &mut shutdown_rx, &token).await? {
        return Ok(());
    }

    if !send_text_or_shutdown(&mut sink, &mut shutdown_rx, auth_ok_message()).await? {
        return Ok(());
    }
    let snapshot = tokio::select! {
        changed = shutdown_rx.changed() => {
            return shutdown_result(changed);
        }
        snapshot = (deps.load_snapshot)(app) => snapshot,
    };
    if let Some(snapshot) = snapshot {
        if !send_text_or_shutdown(&mut sink, &mut shutdown_rx, snapshot).await? {
            return Ok(());
        }
    }

    loop {
        tokio::select! {
            changed = shutdown_rx.changed() => {
                return shutdown_result(changed);
            }
            received = event_rx.recv() => {
                match received {
                    Ok(message) => {
                        if !send_text_or_shutdown(&mut sink, &mut shutdown_rx, message).await? {
                            return Ok(());
                        }
                    }
                    Err(broadcast::error::RecvError::Lagged(_)) => {}
                    Err(broadcast::error::RecvError::Closed) => return Ok(()),
                }
            }
            next = stream.next() => {
                match next {
                    Some(Ok(message)) if message.is_close() => return Ok(()),
                    Some(Ok(_)) => {}
                    Some(Err(error)) => return Err(format!("receive failed: {error}")),
                    None => return Ok(()),
                }
            }
        }
    }
}

async fn authenticate_client<S>(
    sink: &mut S,
    stream: &mut futures_util::stream::SplitStream<tokio_tungstenite::WebSocketStream<TcpStream>>,
    shutdown_rx: &mut watch::Receiver<u64>,
    token: &str,
) -> Result<bool, String>
where
    S: futures_util::Sink<Message, Error = WsError> + Unpin,
{
    if token.is_empty() {
        return Ok(true);
    }

    let auth_message = match tokio::select! {
        changed = shutdown_rx.changed() => {
            shutdown_result(changed)?;
            return Ok(false);
        }
        message = timeout(
            Duration::from_secs(LOCAL_API_AUTH_TIMEOUT_SECS),
            stream.next(),
        ) => message,
    } {
        Ok(message) => message,
        Err(_) => {
            send_text(sink, auth_failed_message()).await?;
            let _ = sink.close().await;
            return Ok(false);
        }
    };

    let Some(Ok(message)) = auth_message else {
        send_text(sink, auth_failed_message()).await?;
        let _ = sink.close().await;
        return Ok(false);
    };

    if parse_auth_token(&message).as_deref() == Some(token) {
        return Ok(true);
    }

    send_text(sink, auth_failed_message()).await?;
    let _ = sink.close().await;
    Ok(false)
}

async fn send_text<S>(sink: &mut S, text: String) -> Result<(), String>
where
    S: futures_util::Sink<Message, Error = WsError> + Unpin,
{
    sink.send(Message::Text(text.into()))
        .await
        .map_err(|error| format!("send failed: {error}"))
}

async fn send_text_or_shutdown<S>(
    sink: &mut S,
    shutdown_rx: &mut watch::Receiver<u64>,
    text: String,
) -> Result<bool, String>
where
    S: futures_util::Sink<Message, Error = WsError> + Unpin,
{
    tokio::select! {
        changed = shutdown_rx.changed() => {
            shutdown_result(changed)?;
            Ok(false)
        }
        result = send_text(sink, text) => {
            result?;
            Ok(true)
        }
    }
}

fn parse_auth_token(message: &Message) -> Option<String> {
    let text = message.to_text().ok()?;
    let value: Value = serde_json::from_str(text).ok()?;
    let message_type = value.get("type")?.as_str()?;
    if message_type != "auth" {
        return None;
    }
    value.get("token")?.as_str().map(str::to_string)
}

pub fn message_json(message_type: &str, data: Value) -> String {
    json!({
        "type": message_type,
        "data": data,
    })
    .to_string()
}

fn auth_ok_message() -> String {
    json!({ "type": "auth-ok" }).to_string()
}

fn auth_failed_message() -> String {
    json!({ "type": "auth-failed" }).to_string()
}

fn shutdown_result(changed: Result<(), watch::error::RecvError>) -> Result<(), String> {
    match changed {
        Ok(()) => Ok(()),
        Err(error) => Err(format!("shutdown channel closed: {error}")),
    }
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
    fn auth_token_accepts_expected_shape() {
        let message = Message::Text(r#"{"type":"auth","token":"abc"}"#.into());
        assert_eq!(parse_auth_token(&message).as_deref(), Some("abc"));

        let wrong = Message::Text(r#"{"type":"hello","token":"abc"}"#.into());
        assert_eq!(parse_auth_token(&wrong), None);
    }

    #[test]
    fn listener_bind_can_recover_after_occupied_port_is_released() {
        let (_address, occupied_listener) = open_local_api_listener(0).unwrap();
        let port = occupied_listener.local_addr().unwrap().port();

        assert!(open_local_api_listener(port).is_err());

        drop(occupied_listener);

        let (_address, recovered_listener) = open_local_api_listener(port).unwrap();
        assert_eq!(recovered_listener.local_addr().unwrap().port(), port);
    }

    #[test]
    fn token_rotation_requires_server_restart() {
        let previous = LocalApiSettings {
            enabled: true,
            port: 17_321,
            token: "old-token".to_string(),
        };
        let next = LocalApiSettings {
            token: "new-token".to_string(),
            ..previous.clone()
        };

        assert!(should_restart_server(&previous, &next, true));
    }

    #[test]
    fn shutdown_generation_notifies_existing_receivers() {
        tauri::async_runtime::block_on(async {
            let (shutdown_tx, mut shutdown_rx) = watch::channel(0);

            signal_shutdown(&shutdown_tx);

            shutdown_rx.changed().await.unwrap();
            assert_eq!(*shutdown_rx.borrow(), 1);
        });
    }
}
