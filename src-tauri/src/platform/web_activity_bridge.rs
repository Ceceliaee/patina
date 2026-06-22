use crate::domain::settings::WebActivityBridgeSettings;
use serde_json::{json, Value};
use std::future::Future;
use std::io;
use std::net::{IpAddr, Ipv4Addr, SocketAddr, TcpListener as StdTcpListener};
use std::pin::Pin;
use std::sync::Mutex;
use tauri::{AppHandle, Runtime};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::watch;

const WEB_ACTIVITY_BRIDGE_HTTP_BODY_MAX_BYTES: usize = 64 * 1024;
const WEB_ACTIVITY_BRIDGE_HTTP_HEADER_MAX_BYTES: usize = 16 * 1024;
pub const WEB_ACTIVITY_BRIDGE_SETTINGS_CHANGED_EVENT: &str = "app-settings-changed";
pub const WEB_ACTIVITY_BRIDGE_ACTIVE_WINDOW_EVENT: &str = "active-window-changed";
pub const WEB_ACTIVITY_BRIDGE_TRACKING_DATA_EVENT: &str = "tracking-data-changed";

pub type WebActivityBridgeHttpFuture =
    Pin<Box<dyn Future<Output = WebActivityBridgeHttpResponse> + Send>>;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct WebActivityBridgeHttpRequest {
    pub method: String,
    pub path: String,
    pub authorization: Option<String>,
    pub body: Vec<u8>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct WebActivityBridgeHttpResponse {
    pub status: u16,
    pub body: String,
}

impl WebActivityBridgeHttpResponse {
    pub fn json(status: u16, data: Value) -> Self {
        Self {
            status,
            body: data.to_string(),
        }
    }
}

pub struct WebActivityBridgeRuntimeDeps<R: Runtime> {
    pub handle_http_request:
        fn(AppHandle<R>, WebActivityBridgeHttpRequest) -> WebActivityBridgeHttpFuture,
}

impl<R: Runtime> Clone for WebActivityBridgeRuntimeDeps<R> {
    fn clone(&self) -> Self {
        *self
    }
}

impl<R: Runtime> Copy for WebActivityBridgeRuntimeDeps<R> {}

#[derive(Debug)]
pub struct WebActivityBridgeRuntimeState {
    inner: Mutex<WebActivityBridgeRuntimeInner>,
    shutdown_tx: watch::Sender<u64>,
}

#[derive(Debug, Default)]
struct WebActivityBridgeRuntimeInner {
    settings: WebActivityBridgeSettings,
    server_task: Option<tauri::async_runtime::JoinHandle<()>>,
}

impl Default for WebActivityBridgeRuntimeState {
    fn default() -> Self {
        let (shutdown_tx, _) = watch::channel(0);
        Self {
            inner: Mutex::new(WebActivityBridgeRuntimeInner::default()),
            shutdown_tx,
        }
    }
}

impl WebActivityBridgeRuntimeState {
    pub fn update<R: Runtime + 'static>(
        &self,
        app: AppHandle<R>,
        settings: WebActivityBridgeSettings,
        deps: WebActivityBridgeRuntimeDeps<R>,
    ) -> bool {
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
            inner.server_task =
                spawn_server(app, self.shutdown_tx.subscribe(), settings.clone(), deps);
        }

        inner.settings = settings;
        should_restart
    }

    pub fn current_settings(&self) -> WebActivityBridgeSettings {
        lock_inner(&self.inner).settings.clone()
    }
}

fn should_restart_server(
    previous_settings: &WebActivityBridgeSettings,
    settings: &WebActivityBridgeSettings,
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
    mut shutdown_rx: watch::Receiver<u64>,
    settings: WebActivityBridgeSettings,
    deps: WebActivityBridgeRuntimeDeps<R>,
) -> Option<tauri::async_runtime::JoinHandle<()>> {
    let (address, std_listener) = match open_web_activity_bridge_listener(settings.port) {
        Ok(listener) => listener,
        Err(error) => {
            eprintln!(
                "[web-activity-bridge] failed to bind 127.0.0.1:{}: {error}",
                settings.port
            );
            return None;
        }
    };

    Some(tauri::async_runtime::spawn(async move {
        let listener = match TcpListener::from_std(std_listener) {
            Ok(listener) => listener,
            Err(error) => {
                eprintln!("[web-activity-bridge] failed to attach listener {address}: {error}");
                return;
            }
        };

        loop {
            let (stream, remote_addr) = tokio::select! {
                changed = shutdown_rx.changed() => {
                    if changed.is_err() {
                        eprintln!("[web-activity-bridge] shutdown channel closed");
                    }
                    return;
                }
                next = listener.accept() => {
                    match next {
                        Ok(next) => next,
                        Err(error) => {
                            eprintln!("[web-activity-bridge] accept failed: {error}");
                            continue;
                        }
                    }
                }
            };
            let client_app = app.clone();
            let client_shutdown_rx = shutdown_rx.clone();

            tauri::async_runtime::spawn(async move {
                if let Err(error) =
                    handle_client(client_app, client_shutdown_rx, stream, deps).await
                {
                    eprintln!("[web-activity-bridge] client {remote_addr} closed: {error}");
                }
            });
        }
    }))
}

fn open_web_activity_bridge_listener(port: u16) -> io::Result<(SocketAddr, StdTcpListener)> {
    let address = SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), port);
    let listener = StdTcpListener::bind(address)?;
    listener.set_nonblocking(true)?;
    Ok((address, listener))
}

async fn handle_client<R: Runtime>(
    app: AppHandle<R>,
    mut shutdown_rx: watch::Receiver<u64>,
    stream: TcpStream,
    deps: WebActivityBridgeRuntimeDeps<R>,
) -> Result<(), String> {
    tokio::select! {
        changed = shutdown_rx.changed() => shutdown_result(changed),
        result = handle_http_client(app, stream, deps) => result,
    }
}

async fn handle_http_client<R: Runtime>(
    app: AppHandle<R>,
    mut stream: TcpStream,
    deps: WebActivityBridgeRuntimeDeps<R>,
) -> Result<(), String> {
    let response = match read_http_request(&mut stream).await {
        Ok(request) if request.method.eq_ignore_ascii_case("OPTIONS") => {
            WebActivityBridgeHttpResponse::json(204, json!({}))
        }
        Ok(request) => (deps.handle_http_request)(app, request).await,
        Err(error) => WebActivityBridgeHttpResponse::json(
            400,
            json!({
                "ok": false,
                "message": error,
            }),
        ),
    };
    write_http_response(&mut stream, response).await
}

async fn read_http_request(stream: &mut TcpStream) -> Result<WebActivityBridgeHttpRequest, String> {
    let mut buffer = Vec::with_capacity(2048);
    let header_end = loop {
        if let Some(index) = find_http_header_end(&buffer) {
            break index;
        }
        if buffer.len() > WEB_ACTIVITY_BRIDGE_HTTP_HEADER_MAX_BYTES {
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

    if content_length > WEB_ACTIVITY_BRIDGE_HTTP_BODY_MAX_BYTES {
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
        if buffer.len().saturating_sub(body_start) > WEB_ACTIVITY_BRIDGE_HTTP_BODY_MAX_BYTES {
            return Err("http body is too large".to_string());
        }
    }

    Ok(WebActivityBridgeHttpRequest {
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
    response: WebActivityBridgeHttpResponse,
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
    fn listener_bind_can_recover_after_occupied_port_is_released() {
        let (_address, occupied_listener) = open_web_activity_bridge_listener(0).unwrap();
        let port = occupied_listener.local_addr().unwrap().port();

        assert!(open_web_activity_bridge_listener(port).is_err());

        drop(occupied_listener);

        let (_address, recovered_listener) = open_web_activity_bridge_listener(port).unwrap();
        assert_eq!(recovered_listener.local_addr().unwrap().port(), port);
    }

    #[test]
    fn token_rotation_requires_server_restart() {
        let previous = WebActivityBridgeSettings {
            enabled: true,
            port: 12_345,
            token: "old-token".to_string(),
        };
        let next = WebActivityBridgeSettings {
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
