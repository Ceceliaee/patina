use crate::domain::settings::LocalApiSettings;
use crate::domain::web_activity::LocalApiClientRole;
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use std::future::Future;
use std::io;
use std::net::{IpAddr, Ipv4Addr, SocketAddr, TcpListener as StdTcpListener};
use std::pin::Pin;
use std::sync::Mutex;
use tauri::{AppHandle, Runtime};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{broadcast, watch};
use tokio::time::{timeout, Duration};
use tokio_tungstenite::{
    accept_async,
    tungstenite::{Error as WsError, Message},
};

const LOCAL_API_AUTH_TIMEOUT_SECS: u64 = 5;
const LOCAL_API_HANDSHAKE_TIMEOUT_SECS: u64 = 5;
const LOCAL_API_HTTP_BODY_MAX_BYTES: usize = 64 * 1024;
const LOCAL_API_HTTP_HEADER_MAX_BYTES: usize = 16 * 1024;
const LOCAL_API_BROADCAST_CAPACITY: usize = 256;
pub const LOCAL_API_SETTINGS_CHANGED_EVENT: &str = "app-settings-changed";
pub const LOCAL_API_ACTIVE_WINDOW_EVENT: &str = "active-window-changed";
pub const LOCAL_API_TRACKING_DATA_EVENT: &str = "tracking-data-changed";

pub type LocalApiStringFuture = Pin<Box<dyn Future<Output = Option<String>> + Send>>;
pub type LocalApiAuthFuture = Pin<Box<dyn Future<Output = LocalApiAuthConfig> + Send>>;
pub type LocalApiInboundFuture = Pin<Box<dyn Future<Output = Option<String>> + Send>>;
pub type LocalApiHttpFuture = Pin<Box<dyn Future<Output = LocalApiHttpResponse> + Send>>;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LocalApiHttpRequest {
    pub method: String,
    pub path: String,
    pub authorization: Option<String>,
    pub body: Vec<u8>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LocalApiHttpResponse {
    pub status: u16,
    pub body: String,
}

impl LocalApiHttpResponse {
    pub fn json(status: u16, data: Value) -> Self {
        Self {
            status,
            body: data.to_string(),
        }
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct LocalApiAuthConfig {
    pub general_token: String,
    pub browser_bridge_token: String,
}

pub struct LocalApiRuntimeDeps<R: Runtime> {
    pub load_auth_config: fn(AppHandle<R>) -> LocalApiAuthFuture,
    pub load_snapshot: fn(AppHandle<R>) -> LocalApiStringFuture,
    pub handle_inbound_message:
        fn(AppHandle<R>, LocalApiClientRole, String) -> LocalApiInboundFuture,
    pub handle_http_request: fn(AppHandle<R>, LocalApiHttpRequest) -> LocalApiHttpFuture,
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
        || previous_settings.web_activity_enabled != settings.web_activity_enabled
        || previous_settings.web_activity_token != settings.web_activity_token
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
    let auth_config = tokio::select! {
        changed = shutdown_rx.changed() => {
            return shutdown_result(changed);
        }
        auth_config = (deps.load_auth_config)(app.clone()) => {
            let mut auth_config = auth_config;
            if auth_config.general_token.is_empty() {
                auth_config.general_token = fallback_token;
            }
            auth_config
        }
    };

    let ws_stream = tokio::select! {
        changed = shutdown_rx.changed() => {
            return shutdown_result(changed);
        }
        is_http = looks_like_http_request(&stream) => {
            if is_http? {
                return handle_http_client(app, stream, deps).await;
            }
            timeout(
                Duration::from_secs(LOCAL_API_HANDSHAKE_TIMEOUT_SECS),
                accept_async(stream),
            ).await
        }
    }
    .map_err(|_| "websocket handshake timed out".to_string())?
    .map_err(|error| format!("websocket handshake failed: {error}"))?;
    let (mut sink, mut stream) = ws_stream.split();
    let mut event_rx = event_tx.subscribe();

    let Some(client_role) =
        authenticate_client(&mut sink, &mut stream, &mut shutdown_rx, &auth_config).await?
    else {
        return Ok(());
    };

    if !send_text_or_shutdown(&mut sink, &mut shutdown_rx, auth_ok_message()).await? {
        return Ok(());
    }
    if client_role == LocalApiClientRole::General {
        let snapshot = tokio::select! {
            changed = shutdown_rx.changed() => {
                return shutdown_result(changed);
            }
            snapshot = (deps.load_snapshot)(app.clone()) => snapshot,
        };
        if let Some(snapshot) = snapshot {
            if !send_text_or_shutdown(&mut sink, &mut shutdown_rx, snapshot).await? {
                return Ok(());
            }
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
                    Some(Ok(message)) => {
                        if let Some(text) = message.to_text().ok().map(str::to_string) {
                            let response = tokio::select! {
                                changed = shutdown_rx.changed() => {
                                    return shutdown_result(changed);
                                }
                                response = (deps.handle_inbound_message)(
                                    app.clone(),
                                    client_role,
                                    text,
                                ) => response,
                            };
                            if let Some(response) = response {
                                if !send_text_or_shutdown(&mut sink, &mut shutdown_rx, response).await? {
                                    return Ok(());
                                }
                            }
                        }
                    }
                    Some(Err(error)) => return Err(format!("receive failed: {error}")),
                    None => return Ok(()),
                }
            }
        }
    }
}

async fn looks_like_http_request(stream: &TcpStream) -> Result<bool, String> {
    let mut probe = [0_u8; 8];
    let read = timeout(
        Duration::from_secs(LOCAL_API_HANDSHAKE_TIMEOUT_SECS),
        stream.peek(&mut probe),
    )
    .await
    .map_err(|_| "client probe timed out".to_string())?
    .map_err(|error| format!("client probe failed: {error}"))?;

    if read == 0 {
        return Err("client closed before protocol probe".to_string());
    }

    Ok(probe[..read].starts_with(b"POST ") || probe[..read].starts_with(b"OPTIONS "))
}

async fn handle_http_client<R: Runtime>(
    app: AppHandle<R>,
    mut stream: TcpStream,
    deps: LocalApiRuntimeDeps<R>,
) -> Result<(), String> {
    let response = match read_http_request(&mut stream).await {
        Ok(request) if request.method.eq_ignore_ascii_case("OPTIONS") => {
            LocalApiHttpResponse::json(204, json!({}))
        }
        Ok(request) => (deps.handle_http_request)(app, request).await,
        Err(error) => LocalApiHttpResponse::json(
            400,
            json!({
                "ok": false,
                "message": error,
            }),
        ),
    };
    write_http_response(&mut stream, response).await
}

async fn read_http_request(stream: &mut TcpStream) -> Result<LocalApiHttpRequest, String> {
    let mut buffer = Vec::with_capacity(2048);
    let header_end = loop {
        if let Some(index) = find_http_header_end(&buffer) {
            break index;
        }
        if buffer.len() > LOCAL_API_HTTP_HEADER_MAX_BYTES {
            return Err("http headers are too large".to_string());
        }

        let mut chunk = [0_u8; 1024];
        let read = stream
            .read(&mut chunk)
            .await
            .map_err(|error| format!("failed to read http request: {error}"))?;
        if read == 0 {
            return Err("client closed before http headers completed".to_string());
        }
        buffer.extend_from_slice(&chunk[..read]);
    };

    let header_text = std::str::from_utf8(&buffer[..header_end])
        .map_err(|error| format!("invalid http headers: {error}"))?;
    let mut lines = header_text.split("\r\n");
    let request_line = lines
        .next()
        .ok_or_else(|| "missing http request line".to_string())?;
    let mut request_parts = request_line.split_whitespace();
    let method = request_parts
        .next()
        .ok_or_else(|| "missing http method".to_string())?
        .to_string();
    let path = request_parts
        .next()
        .ok_or_else(|| "missing http path".to_string())?
        .to_string();
    let mut authorization = None;
    let mut content_length = 0_usize;

    for line in lines {
        let Some((name, value)) = line.split_once(':') else {
            continue;
        };
        let normalized_name = name.trim().to_ascii_lowercase();
        let normalized_value = value.trim();
        match normalized_name.as_str() {
            "authorization" => authorization = Some(normalized_value.to_string()),
            "content-length" => {
                content_length = normalized_value
                    .parse::<usize>()
                    .map_err(|_| "invalid content-length header".to_string())?;
            }
            _ => {}
        }
    }

    if content_length > LOCAL_API_HTTP_BODY_MAX_BYTES {
        return Err("http body is too large".to_string());
    }

    let body_start = header_end + 4;
    while buffer.len().saturating_sub(body_start) < content_length {
        let mut chunk = [0_u8; 1024];
        let read = stream
            .read(&mut chunk)
            .await
            .map_err(|error| format!("failed to read http body: {error}"))?;
        if read == 0 {
            return Err("client closed before http body completed".to_string());
        }
        buffer.extend_from_slice(&chunk[..read]);
        if buffer.len().saturating_sub(body_start) > LOCAL_API_HTTP_BODY_MAX_BYTES {
            return Err("http body is too large".to_string());
        }
    }

    Ok(LocalApiHttpRequest {
        method,
        path,
        authorization,
        body: buffer[body_start..body_start + content_length].to_vec(),
    })
}

fn find_http_header_end(buffer: &[u8]) -> Option<usize> {
    buffer.windows(4).position(|window| window == b"\r\n\r\n")
}

async fn write_http_response(
    stream: &mut TcpStream,
    response: LocalApiHttpResponse,
) -> Result<(), String> {
    let status_text = match response.status {
        200 => "OK",
        204 => "No Content",
        400 => "Bad Request",
        401 => "Unauthorized",
        404 => "Not Found",
        405 => "Method Not Allowed",
        409 => "Conflict",
        500 => "Internal Server Error",
        _ => "OK",
    };
    let body = if response.status == 204 {
        Vec::new()
    } else {
        response.body.into_bytes()
    };
    let headers = format!(
        "HTTP/1.1 {} {}\r\n\
         Content-Type: application/json; charset=utf-8\r\n\
         Content-Length: {}\r\n\
         Connection: close\r\n\
         Access-Control-Allow-Origin: *\r\n\
         Access-Control-Allow-Headers: Authorization, Content-Type\r\n\
         Access-Control-Allow-Methods: POST, OPTIONS\r\n\r\n",
        response.status,
        status_text,
        body.len(),
    );
    stream
        .write_all(headers.as_bytes())
        .await
        .map_err(|error| format!("failed to write http response headers: {error}"))?;
    if !body.is_empty() {
        stream
            .write_all(&body)
            .await
            .map_err(|error| format!("failed to write http response body: {error}"))?;
    }
    Ok(())
}

async fn authenticate_client<S>(
    sink: &mut S,
    stream: &mut futures_util::stream::SplitStream<tokio_tungstenite::WebSocketStream<TcpStream>>,
    shutdown_rx: &mut watch::Receiver<u64>,
    auth_config: &LocalApiAuthConfig,
) -> Result<Option<LocalApiClientRole>, String>
where
    S: futures_util::Sink<Message, Error = WsError> + Unpin,
{
    if auth_config.general_token.is_empty() && auth_config.browser_bridge_token.is_empty() {
        return Ok(Some(LocalApiClientRole::General));
    }

    let auth_message = match tokio::select! {
        changed = shutdown_rx.changed() => {
            shutdown_result(changed)?;
            return Ok(None);
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
            return Ok(None);
        }
    };

    let Some(Ok(message)) = auth_message else {
        send_text(sink, auth_failed_message()).await?;
        let _ = sink.close().await;
        return Ok(None);
    };

    let token = parse_auth_token(&message);
    if token.as_deref() == Some(auth_config.general_token.as_str())
        && !auth_config.general_token.is_empty()
    {
        return Ok(Some(LocalApiClientRole::General));
    }
    if token.as_deref() == Some(auth_config.browser_bridge_token.as_str())
        && !auth_config.browser_bridge_token.is_empty()
    {
        return Ok(Some(LocalApiClientRole::BrowserBridge));
    }

    send_text(sink, auth_failed_message()).await?;
    let _ = sink.close().await;
    Ok(None)
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
            local_api_enabled: true,
            port: 17_321,
            token: "old-token".to_string(),
            web_activity_enabled: false,
            web_activity_token: String::new(),
        };
        let next = LocalApiSettings {
            token: "new-token".to_string(),
            ..previous.clone()
        };

        assert!(should_restart_server(&previous, &next, true));
    }

    #[test]
    fn browser_bridge_token_rotation_requires_server_restart() {
        let previous = LocalApiSettings {
            enabled: true,
            local_api_enabled: false,
            port: 17_321,
            token: String::new(),
            web_activity_enabled: true,
            web_activity_token: "old-token".to_string(),
        };
        let next = LocalApiSettings {
            web_activity_token: "new-token".to_string(),
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
