use futures_util::StreamExt;
use reqwest::{redirect::Policy, Body, Method, StatusCode, Url};
use std::net::IpAddr;
use std::path::Path;
use std::time::Duration;
use tokio::io::AsyncWriteExt;
use tokio_util::io::ReaderStream;

const MAX_TRANSFER_BYTES: u64 = 512 * 1024 * 1024;
const MAX_TEXT_RESPONSE_BYTES: usize = 2 * 1024 * 1024;
const REQUEST_TIMEOUT_SECONDS: u64 = 90;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct WebDavConfig {
    pub url: String,
    pub username: String,
    pub remote_dir: String,
}

pub struct WebDavClient {
    client: reqwest::Client,
    base_url: Url,
    username: String,
    password: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct WebDavObjectMetadata {
    pub size_bytes: Option<u64>,
    pub etag: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct WebDavTextSnapshot {
    pub value: Option<String>,
    pub etag: Option<String>,
}

fn parse_base_url(raw: &str) -> Result<Url, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("WebDAV server address cannot be empty".to_string());
    }

    let mut url =
        Url::parse(trimmed).map_err(|error| format!("invalid WebDAV server address: {error}"))?;
    if url.scheme() != "https" && url.scheme() != "http" {
        return Err("WebDAV server address must use http or https".to_string());
    }
    if url.scheme() == "http" {
        let is_literal_loopback = url
            .host_str()
            .and_then(|host| host.trim_matches(['[', ']']).parse::<IpAddr>().ok())
            .is_some_and(|address| address.is_loopback());
        if !is_literal_loopback {
            return Err(
                "WebDAV server address must use HTTPS; HTTP is allowed only for literal loopback addresses"
                    .to_string(),
            );
        }
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("WebDAV server address must not contain credentials".to_string());
    }
    url.set_query(None);
    url.set_fragment(None);
    Ok(url)
}

pub fn normalize_base_url(raw: &str) -> Result<String, String> {
    Ok(parse_base_url(raw)?.to_string())
}

pub fn normalize_remote_dir(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim();
    let candidate = if trimmed.is_empty() {
        "/Patina"
    } else {
        trimmed
    };

    if candidate.contains('\\') || candidate.contains("..") {
        return Err("WebDAV remote directory contains unsupported path segments".to_string());
    }
    if candidate.chars().any(|char| char.is_control()) {
        return Err("WebDAV remote directory contains control characters".to_string());
    }

    let mut normalized = candidate.replace("//", "/");
    if !normalized.starts_with('/') {
        normalized = format!("/{normalized}");
    }
    while normalized.len() > 1 && normalized.ends_with('/') {
        normalized.pop();
    }
    Ok(normalized)
}

fn split_path(path: &str) -> impl Iterator<Item = &str> {
    path.trim_matches('/')
        .split('/')
        .filter(|segment| !segment.is_empty())
}

fn validate_remote_path(path: &str) -> Result<(), String> {
    if !path.starts_with('/')
        || path.contains('\\')
        || path.chars().any(char::is_control)
        || split_path(path).any(|segment| matches!(segment, "." | ".."))
    {
        return Err("WebDAV remote path contains unsupported path segments".to_string());
    }
    Ok(())
}

fn response_metadata(response: &reqwest::Response) -> WebDavObjectMetadata {
    let range_size = response
        .headers()
        .get(reqwest::header::CONTENT_RANGE)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.rsplit_once('/'))
        .and_then(|(_, total)| total.parse::<u64>().ok());
    let size_bytes = range_size.or_else(|| {
        response
            .headers()
            .get(reqwest::header::CONTENT_LENGTH)
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.parse::<u64>().ok())
    });
    let etag = response
        .headers()
        .get(reqwest::header::ETAG)
        .and_then(|value| value.to_str().ok())
        .map(str::to_string);
    WebDavObjectMetadata { size_bytes, etag }
}

impl WebDavClient {
    pub fn new(config: &WebDavConfig, password: String) -> Result<Self, String> {
        let client = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(8))
            .timeout(Duration::from_secs(REQUEST_TIMEOUT_SECONDS))
            .redirect(Policy::none())
            .build()
            .map_err(|error| format!("failed to create WebDAV client: {error}"))?;

        Ok(Self {
            client,
            base_url: parse_base_url(&config.url)?,
            username: config.username.trim().to_string(),
            password,
        })
    }

    fn remote_url(&self, remote_path: &str) -> Result<Url, String> {
        validate_remote_path(remote_path)?;
        let mut url = self.base_url.clone();
        let base_segments = url
            .path_segments()
            .map(|segments| {
                segments
                    .filter(|segment| !segment.is_empty())
                    .map(str::to_string)
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();

        {
            let mut segments = url
                .path_segments_mut()
                .map_err(|_| "WebDAV server address cannot be used as a base URL".to_string())?;
            segments.clear();
            for segment in base_segments {
                segments.push(&segment);
            }
            for segment in split_path(remote_path) {
                segments.push(segment);
            }
        }

        Ok(url)
    }

    async fn request(
        &self,
        method: Method,
        remote_path: &str,
    ) -> Result<reqwest::RequestBuilder, String> {
        let url = self.remote_url(remote_path)?;
        Ok(self
            .client
            .request(method, url)
            .basic_auth(&self.username, Some(&self.password)))
    }

    pub async fn ping(&self, remote_dir: &str) -> Result<(), String> {
        self.ensure_dir(remote_dir).await
    }

    pub async fn ensure_dir(&self, remote_dir: &str) -> Result<(), String> {
        let normalized = normalize_remote_dir(remote_dir)?;
        let mut current = String::new();
        for segment in split_path(&normalized) {
            current.push('/');
            current.push_str(segment);
            let response = self
                .request(
                    Method::from_bytes(b"MKCOL").map_err(|error| error.to_string())?,
                    &current,
                )
                .await?
                .send()
                .await
                .map_err(|error| format!("failed to create WebDAV directory: {error}"))?;
            let status = response.status();
            if status == StatusCode::CREATED
                || status == StatusCode::METHOD_NOT_ALLOWED
                || status == StatusCode::OK
                || status == StatusCode::CONFLICT
            {
                continue;
            }
            return Err(format!("failed to create WebDAV directory: HTTP {status}"));
        }
        Ok(())
    }

    pub async fn read_text_snapshot(
        &self,
        remote_path: &str,
    ) -> Result<WebDavTextSnapshot, String> {
        let response = self
            .request(Method::GET, remote_path)
            .await?
            .send()
            .await
            .map_err(|error| format!("failed to read WebDAV file: {error}"))?;
        let status = response.status();
        if status == StatusCode::NOT_FOUND {
            return Ok(WebDavTextSnapshot {
                value: None,
                etag: None,
            });
        }
        if !status.is_success() {
            return Err(format!("failed to read WebDAV file: HTTP {status}"));
        }
        if response
            .content_length()
            .is_some_and(|size| size > MAX_TEXT_RESPONSE_BYTES as u64)
        {
            return Err("WebDAV text response exceeds the safe size limit".to_string());
        }
        let etag = response
            .headers()
            .get(reqwest::header::ETAG)
            .and_then(|value| value.to_str().ok())
            .map(str::to_string);
        let mut bytes = Vec::new();
        let mut stream = response.bytes_stream();
        while let Some(chunk) = stream.next().await {
            let chunk =
                chunk.map_err(|error| format!("failed to read WebDAV response: {error}"))?;
            if bytes.len().saturating_add(chunk.len()) > MAX_TEXT_RESPONSE_BYTES {
                return Err("WebDAV text response exceeds the safe size limit".to_string());
            }
            bytes.extend_from_slice(&chunk);
        }
        let value = String::from_utf8(bytes)
            .map_err(|_| "WebDAV text response is not valid UTF-8".to_string())?;
        Ok(WebDavTextSnapshot {
            value: Some(value),
            etag,
        })
    }

    pub async fn write_text_conditionally(
        &self,
        remote_path: &str,
        value: &str,
        expected_etag: Option<&str>,
        create_new: bool,
    ) -> Result<(), String> {
        if value.len() > MAX_TEXT_RESPONSE_BYTES {
            return Err("WebDAV index exceeds the safe size limit".to_string());
        }
        let mut request = self
            .request(Method::PUT, remote_path)
            .await?
            .header("Content-Type", "application/json; charset=utf-8");
        if let Some(etag) = expected_etag {
            request = request.header(reqwest::header::IF_MATCH, etag);
        } else if create_new {
            request = request.header(reqwest::header::IF_NONE_MATCH, "*");
        }
        let response = request
            .body(value.to_string())
            .send()
            .await
            .map_err(|error| format!("failed to write WebDAV file: {error}"))?;
        let status = response.status();
        if status == StatusCode::PRECONDITION_FAILED {
            Err("remote_index_conflict".to_string())
        } else if status.is_success() {
            Ok(())
        } else {
            Err(format!("failed to write WebDAV file: HTTP {status}"))
        }
    }

    pub async fn upload_file_create_new(
        &self,
        local_path: &Path,
        remote_path: &str,
    ) -> Result<(), String> {
        let file = tokio::fs::File::open(local_path)
            .await
            .map_err(|error| format!("failed to read local backup before upload: {error}"))?;
        let size = file
            .metadata()
            .await
            .map_err(|error| format!("failed to read local backup metadata: {error}"))?
            .len();
        if size > MAX_TRANSFER_BYTES {
            return Err("local backup exceeds the WebDAV transfer size limit".to_string());
        }
        let body = Body::wrap_stream(ReaderStream::new(file));
        let response = self
            .request(Method::PUT, remote_path)
            .await?
            .header(reqwest::header::IF_NONE_MATCH, "*")
            .header("Content-Type", "application/zip")
            .header("Content-Length", size)
            .body(body)
            .send()
            .await
            .map_err(|error| format!("failed to upload WebDAV backup: {error}"))?;
        let status = response.status();
        if status == StatusCode::PRECONDITION_FAILED {
            Err("remote_name_conflict".to_string())
        } else if status.is_success() {
            Ok(())
        } else {
            Err(format!("failed to upload WebDAV backup: HTTP {status}"))
        }
    }

    pub async fn object_metadata(
        &self,
        remote_path: &str,
    ) -> Result<Option<WebDavObjectMetadata>, String> {
        let mut response = self
            .request(Method::HEAD, remote_path)
            .await?
            .send()
            .await
            .map_err(|error| format!("failed to inspect WebDAV object: {error}"))?;
        if matches!(
            response.status(),
            StatusCode::METHOD_NOT_ALLOWED | StatusCode::NOT_IMPLEMENTED
        ) {
            response = self
                .request(Method::GET, remote_path)
                .await?
                .header(reqwest::header::RANGE, "bytes=0-0")
                .send()
                .await
                .map_err(|error| format!("failed to inspect WebDAV object: {error}"))?;
        }
        let status = response.status();
        if status == StatusCode::NOT_FOUND {
            return Ok(None);
        }
        if !status.is_success() {
            return Err(format!("failed to inspect WebDAV object: HTTP {status}"));
        }
        Ok(Some(response_metadata(&response)))
    }

    pub async fn delete_file(
        &self,
        remote_path: &str,
        expected_etag: Option<&str>,
    ) -> Result<bool, String> {
        let mut request = self.request(Method::DELETE, remote_path).await?;
        if let Some(etag) = expected_etag {
            request = request.header(reqwest::header::IF_MATCH, etag);
        }
        let response = request
            .send()
            .await
            .map_err(|error| format!("failed to delete WebDAV object: {error}"))?;
        match response.status() {
            StatusCode::NOT_FOUND => Ok(false),
            StatusCode::PRECONDITION_FAILED => Err("remote_object_conflict".to_string()),
            status if status.is_success() => Ok(true),
            status => Err(format!("failed to delete WebDAV object: HTTP {status}")),
        }
    }

    pub async fn download_file(&self, remote_path: &str, local_path: &Path) -> Result<(), String> {
        let response = self
            .request(Method::GET, remote_path)
            .await?
            .send()
            .await
            .map_err(|error| format!("failed to download WebDAV backup: {error}"))?;
        let status = response.status();
        if !status.is_success() {
            return Err(format!("failed to download WebDAV backup: HTTP {status}"));
        }
        if response
            .content_length()
            .is_some_and(|size| size > MAX_TRANSFER_BYTES)
        {
            return Err("remote backup exceeds the WebDAV transfer size limit".to_string());
        }
        if let Some(parent) = local_path.parent() {
            tokio::fs::create_dir_all(parent)
                .await
                .map_err(|error| format!("failed to create backup download dir: {error}"))?;
        }
        let partial_path = local_path.with_extension("zip.partial");
        for stale_path in [local_path, partial_path.as_path()] {
            match tokio::fs::remove_file(stale_path).await {
                Ok(()) => {}
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => {
                    return Err(format!("failed to clear stale backup download: {error}"));
                }
            }
        }
        let mut file = tokio::fs::File::create(&partial_path)
            .await
            .map_err(|error| format!("failed to create downloaded backup: {error}"))?;
        let mut received = 0_u64;
        let mut stream = response.bytes_stream();
        while let Some(chunk) = stream.next().await {
            let chunk = match chunk {
                Ok(chunk) => chunk,
                Err(error) => {
                    drop(file);
                    let _ = tokio::fs::remove_file(&partial_path).await;
                    return Err(format!("failed to read WebDAV backup response: {error}"));
                }
            };
            received = received.saturating_add(chunk.len() as u64);
            if received > MAX_TRANSFER_BYTES {
                let _ = tokio::fs::remove_file(&partial_path).await;
                return Err("remote backup exceeds the WebDAV transfer size limit".to_string());
            }
            if let Err(error) = file.write_all(&chunk).await {
                let _ = tokio::fs::remove_file(&partial_path).await;
                return Err(format!("failed to write downloaded backup: {error}"));
            }
        }
        if let Err(error) = file.flush().await {
            drop(file);
            let _ = tokio::fs::remove_file(&partial_path).await;
            return Err(format!("failed to flush downloaded backup: {error}"));
        }
        drop(file);
        tokio::fs::rename(&partial_path, local_path)
            .await
            .map_err(|error| format!("failed to publish downloaded backup: {error}"))
    }
}

#[cfg(test)]
mod tests {
    use super::{
        normalize_remote_dir, parse_base_url, WebDavClient, WebDavConfig, MAX_TEXT_RESPONSE_BYTES,
    };
    use std::path::PathBuf;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;
    use tokio::sync::oneshot;
    use uuid::Uuid;

    async fn spawn_canned_server(
        responses: Vec<String>,
    ) -> (String, oneshot::Receiver<Vec<String>>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let (sender, receiver) = oneshot::channel();
        tokio::spawn(async move {
            let mut requests = Vec::new();
            for response in responses {
                let (mut stream, _) = listener.accept().await.unwrap();
                let mut bytes = Vec::new();
                let mut buffer = [0_u8; 4096];
                let header_end = loop {
                    let read = stream.read(&mut buffer).await.unwrap();
                    if read == 0 {
                        panic!("mock WebDAV request ended before its headers");
                    }
                    bytes.extend_from_slice(&buffer[..read]);
                    if let Some(position) = bytes.windows(4).position(|value| value == b"\r\n\r\n")
                    {
                        break position + 4;
                    }
                };
                let headers = String::from_utf8_lossy(&bytes[..header_end]);
                let content_length = headers
                    .lines()
                    .find_map(|line| {
                        let (name, value) = line.split_once(':')?;
                        name.eq_ignore_ascii_case("content-length")
                            .then(|| value.trim().parse::<usize>().ok())
                            .flatten()
                    })
                    .unwrap_or_default();
                while bytes.len() < header_end + content_length {
                    let read = stream.read(&mut buffer).await.unwrap();
                    if read == 0 {
                        break;
                    }
                    bytes.extend_from_slice(&buffer[..read]);
                }
                requests.push(String::from_utf8_lossy(&bytes).into_owned());
                stream.write_all(response.as_bytes()).await.unwrap();
                stream.shutdown().await.unwrap();
            }
            let _ = sender.send(requests);
        });
        (format!("http://{address}/dav"), receiver)
    }

    fn client(url: String) -> WebDavClient {
        WebDavClient::new(
            &WebDavConfig {
                url,
                username: "alice".to_string(),
                remote_dir: "/Patina".to_string(),
            },
            "secret".to_string(),
        )
        .unwrap()
    }

    fn temp_file(contents: &[u8]) -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "patina-webdav-test-{}.zip",
            Uuid::new_v4().simple()
        ));
        std::fs::write(&path, contents).unwrap();
        path
    }

    #[test]
    fn normalize_remote_dir_applies_default_and_slashes() {
        assert_eq!(normalize_remote_dir("").unwrap(), "/Patina");
        assert_eq!(
            normalize_remote_dir("Patina/backups/").unwrap(),
            "/Patina/backups"
        );
    }

    #[test]
    fn normalize_remote_dir_rejects_unsafe_segments() {
        assert!(normalize_remote_dir("../zotero").is_err());
        assert!(normalize_remote_dir("Patina\\backups").is_err());
        assert!(normalize_remote_dir("Patina/\n/backups").is_err());
    }

    #[test]
    fn base_url_rejects_embedded_credentials_and_non_http_schemes() {
        assert!(parse_base_url("https://user:secret@example.com/dav").is_err());
        assert!(parse_base_url("file:///tmp/dav").is_err());
        assert!(parse_base_url("https://example.com/dav").is_ok());
    }

    #[test]
    fn base_url_requires_https_except_for_literal_loopback_hosts() {
        assert!(parse_base_url("http://example.com/dav").is_err());
        assert!(parse_base_url("http://localhost/dav").is_err());
        assert!(parse_base_url("http://127.0.0.1:8080/dav").is_ok());
        assert!(parse_base_url("http://127.42.0.9:8080/dav").is_ok());
        assert!(parse_base_url("http://[::1]:8080/dav").is_ok());
    }

    #[test]
    fn remote_url_rejects_untrusted_path_segments_at_the_http_boundary() {
        let client = client("https://example.com/dav".to_string());
        assert!(client.remote_url("/Patina/../outside.zip").is_err());
        assert!(client.remote_url("/Patina\\outside.zip").is_err());
        assert!(client.remote_url("/Patina/unsafe\n.zip").is_err());
        assert!(client.remote_url("Patina/missing-root.zip").is_err());
    }

    #[tokio::test]
    async fn create_new_upload_uses_precondition_and_never_overwrites() {
        let (url, captured) = spawn_canned_server(vec![
            "HTTP/1.1 412 Precondition Failed\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
                .to_string(),
        ])
        .await;
        let file = temp_file(b"complete backup");
        let error = client(url)
            .upload_file_create_new(&file, "/Patina/automatic.zip")
            .await
            .unwrap_err();
        let requests = captured.await.unwrap();
        let _ = std::fs::remove_file(file);

        assert_eq!(error, "remote_name_conflict");
        let request = requests[0].to_ascii_lowercase();
        assert!(request.starts_with("put /dav/patina/automatic.zip "));
        assert!(request.contains("\r\nif-none-match: *\r\n"));
    }

    #[tokio::test]
    async fn index_write_uses_the_observed_etag() {
        let (url, captured) = spawn_canned_server(vec![
            "HTTP/1.1 204 No Content\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".to_string(),
        ])
        .await;
        client(url)
            .write_text_conditionally(
                "/Patina/backup-index.json",
                "{\"version\":1}",
                Some("\"index-v2\""),
                false,
            )
            .await
            .unwrap();
        let request = captured.await.unwrap().remove(0).to_ascii_lowercase();
        assert!(request.contains("\r\nif-match: \"index-v2\"\r\n"));
        assert!(!request.contains("\r\nif-none-match:"));
    }

    #[tokio::test]
    async fn text_reads_stop_at_the_limit_without_content_length() {
        let oversized = "x".repeat(MAX_TEXT_RESPONSE_BYTES + 1);
        let (url, captured) = spawn_canned_server(vec![format!(
            "HTTP/1.1 200 OK\r\nConnection: close\r\n\r\n{oversized}"
        )])
        .await;
        let error = client(url)
            .read_text_snapshot("/Patina/backup-index.json")
            .await
            .unwrap_err();
        assert_eq!(error, "WebDAV text response exceeds the safe size limit");
        assert_eq!(captured.await.unwrap().len(), 1);
    }

    #[tokio::test]
    async fn metadata_and_delete_are_scoped_to_the_exact_object() {
        let (url, captured) = spawn_canned_server(vec![
            "HTTP/1.1 200 OK\r\nContent-Length: 42\r\nETag: \"object-v1\"\r\nConnection: close\r\n\r\n"
                .to_string(),
            "HTTP/1.1 204 No Content\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
                .to_string(),
        ])
        .await;
        let client = client(url);
        let metadata = client
            .object_metadata("/Patina/owned.zip")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(metadata.size_bytes, Some(42));
        assert_eq!(metadata.etag.as_deref(), Some("\"object-v1\""));
        assert!(client
            .delete_file("/Patina/owned.zip", metadata.etag.as_deref())
            .await
            .unwrap());

        let requests = captured.await.unwrap();
        assert!(requests[0]
            .to_ascii_lowercase()
            .starts_with("head /dav/patina/owned.zip "));
        let delete = requests[1].to_ascii_lowercase();
        assert!(delete.starts_with("delete /dav/patina/owned.zip "));
        assert!(delete.contains("\r\nif-match: \"object-v1\"\r\n"));
    }

    #[tokio::test]
    async fn metadata_falls_back_to_a_bounded_get_when_head_is_unsupported() {
        let (url, captured) = spawn_canned_server(vec![
            "HTTP/1.1 405 Method Not Allowed\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
                .to_string(),
            "HTTP/1.1 206 Partial Content\r\nContent-Length: 1\r\nContent-Range: bytes 0-0/42\r\nETag: \"object-v1\"\r\nConnection: close\r\n\r\nx"
                .to_string(),
        ])
        .await;
        let metadata = client(url)
            .object_metadata("/Patina/owned.zip")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(metadata.size_bytes, Some(42));
        assert_eq!(metadata.etag.as_deref(), Some("\"object-v1\""));

        let requests = captured.await.unwrap();
        assert!(requests[0]
            .to_ascii_lowercase()
            .starts_with("head /dav/patina/owned.zip "));
        let fallback = requests[1].to_ascii_lowercase();
        assert!(fallback.starts_with("get /dav/patina/owned.zip "));
        assert!(fallback.contains("\r\nrange: bytes=0-0\r\n"));
    }

    #[tokio::test]
    async fn redirect_responses_are_not_followed() {
        let (url, captured) = spawn_canned_server(vec![
            "HTTP/1.1 302 Found\r\nLocation: http://127.0.0.1:9/credential-sink\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
                .to_string(),
        ])
        .await;
        let error = client(url)
            .write_text_conditionally("/Patina/backup-index.json", "{}", None, true)
            .await
            .unwrap_err();
        assert!(error.contains("HTTP 302"));
        assert_eq!(captured.await.unwrap().len(), 1);
    }
}
