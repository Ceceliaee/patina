pub(crate) mod cache;
use base64::Engine;
use futures::{
    Future, FutureExt,
    future::{Either, select},
};
use gpui_kit::*;
use std::time::Duration;

struct FaviconClient(windows::Web::Http::HttpClient);
impl Drop for FaviconClient {
    fn drop(&mut self) {
        let _ = self.0.Close();
    }
}

fn embedded_favicon(source: &str, renderer: SvgRenderer) -> Option<Vec<u8>> {
    let (header, data) = source.strip_prefix("data:image/")?.split_once(',')?;
    if !header.ends_with(";base64") || data.len() > 6 * 1024 * 1024 {
        return None;
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data)
        .ok()?;
    decode_favicon(&bytes, renderer)
}

pub(crate) async fn favicon(
    source: &str,
    executor: &BackgroundExecutor,
    renderer: SvgRenderer,
    canceled: impl Future<Output = ()>,
) -> Option<Vec<u8>> {
    static LOCAL: async_lock::Semaphore = async_lock::Semaphore::new(2);
    static REMOTE: async_lock::Semaphore = async_lock::Semaphore::new(4);
    let local = source.starts_with("data:image/");
    let mut canceled = std::pin::pin!(canceled.fuse());
    let acquire = std::pin::pin!((if local { &LOCAL } else { &REMOTE }).acquire());
    let _running = match select(canceled.as_mut(), acquire).await {
        Either::Left(_) => return None,
        Either::Right((slot, _)) => slot,
    };
    if local {
        return embedded_favicon(source, renderer);
    }
    let bytes = {
        if !(source.starts_with("https://") || source.starts_with("http://")) {
            return None;
        }
        use std::future::IntoFuture;
        use windows::{
            Foundation::Uri,
            Storage::Streams::{Buffer, DataReader, InputStreamOptions},
            Web::Http::{HttpClient, HttpCompletionOption},
            core::{AgileReference, HSTRING},
        };
        const MAX_BYTES: usize = 4 * 1024 * 1024;
        const CHUNK: u32 = 64 * 1024;
        let client = FaviconClient(HttpClient::new().ok()?);
        let uri = Uri::CreateUri(&HSTRING::from(source)).ok()?;
        let deadline = std::time::Instant::now() + Duration::from_secs(8);
        let request = client
            .0
            .GetWithOptionAsync(&uri, HttpCompletionOption::ResponseHeadersRead)
            .ok()?;
        let response = timed_read(
            request.clone().into_future(),
            || {
                let _ = request.Cancel();
            },
            deadline,
            executor,
            canceled.as_mut(),
        )
        .await?;
        if !response.IsSuccessStatusCode().ok()? {
            return None;
        }
        let request = response.Content().ok()?.ReadAsInputStreamAsync().ok()?;
        let stream = AgileReference::new(
            &timed_read(
                request.clone().into_future(),
                || {
                    let _ = request.Cancel();
                },
                deadline,
                executor,
                canceled.as_mut(),
            )
            .await?,
        )
        .ok()?;
        let buffer = Buffer::Create(CHUNK).ok()?;
        let mut bytes = Vec::new();
        loop {
            let count = CHUNK.min((MAX_BYTES + 1 - bytes.len()) as u32);
            let request = stream
                .resolve()
                .ok()?
                .ReadAsync(&buffer, count, InputStreamOptions::Partial)
                .ok()?;
            let block = timed_read(
                request.clone().into_future(),
                || {
                    let _ = request.Cancel();
                },
                deadline,
                executor,
                canceled.as_mut(),
            )
            .await?;
            let n = block.Length().ok()? as usize;
            if n == 0 {
                break;
            }
            if n > MAX_BYTES - bytes.len() {
                return None;
            }
            let start = bytes.len();
            bytes.resize(start + n, 0);
            DataReader::FromBuffer(&block)
                .ok()?
                .ReadBytes(&mut bytes[start..])
                .ok()?;
        }
        bytes
    };
    decode_favicon(&bytes, renderer)
}

async fn timed_read<T, E>(
    request: impl std::future::Future<Output = Result<T, E>>,
    cancel: impl FnOnce(),
    deadline: std::time::Instant,
    executor: &BackgroundExecutor,
    mut abandoned: std::pin::Pin<&mut impl Future<Output = ()>>,
) -> Option<T> {
    use std::task::Poll;
    let mut request = std::pin::pin!(request);
    let mut timeout = std::pin::pin!(
        executor.timer(deadline.saturating_duration_since(std::time::Instant::now()))
    );
    let mut cancel = Some(cancel);
    std::future::poll_fn(|cx| {
        if cancel.is_some()
            && (abandoned.as_mut().poll(cx).is_ready() || timeout.as_mut().poll(cx).is_ready())
        {
            cancel.take().unwrap()();
        }
        if let Poll::Ready(result) = request.as_mut().poll(cx) {
            return Poll::Ready(if cancel.is_some() { result.ok() } else { None });
        }
        Poll::Pending
    })
    .await
}

fn decode_favicon(bytes: &[u8], renderer: SvgRenderer) -> Option<Vec<u8>> {
    if let Some(png) = patina_activity_model::icon_png(bytes) {
        return Some(png);
    }
    if bytes.len() > 4 * 1024 * 1024 {
        return None;
    }
    let svg = renderer.parse_svg(bytes).ok()?;
    let raster = renderer
        .render_parsed(
            &svg,
            SvgSize::Size(size(DevicePixels(64), DevicePixels(64))),
        )
        .ok()?;
    patina_activity_model::icon_png_from_bgra(
        raster.as_bytes(0)?,
        raster.size(0).width.0 as u32,
        raster.size(0).height.0 as u32,
    )
}

#[cfg(test)]
mod tests {
    use super::decode_favicon;
    use gpui_kit::SvgRenderer;
    use std::sync::Arc;

    #[test]
    fn svg_favicon_preserves_color_and_rejects_invalid_data() {
        let renderer = SvgRenderer::new(Arc::new(()));
        let png = decode_favicon(br##"<svg xmlns="http://www.w3.org/2000/svg" width="32" height="16"><path fill="#2060c0" d="M0 0h32v16H0z"/></svg>"##, renderer.clone()).unwrap();
        assert_eq!(patina_activity_model::icon_color(&png), Some(0x2060c0));
        assert!(decode_favicon(b"invalid favicon", renderer).is_none());
    }

    #[cfg(feature = "test-support")]
    #[gpui_kit::test]
    fn a_timed_out_or_abandoned_read_waits_for_transport_completion(
        cx: &mut gpui_kit::TestAppContext,
    ) {
        use futures::{FutureExt, channel::oneshot};
        use std::{
            sync::atomic::{AtomicUsize, Ordering},
            time::{Duration, Instant},
        };
        for timeout in [false, true] {
            let executor = cx.update(|cx| cx.background_executor().clone());
            let (finish, operation) = oneshot::channel::<u8>();
            let (leave, abandoned) = oneshot::channel::<()>();
            let calls = Arc::new(AtomicUsize::new(0));
            let canceled = calls.clone();
            let worker = executor.clone();
            let mut result = executor.spawn(async move {
                let signal = std::pin::pin!(async {
                    let _ = abandoned.await;
                });
                super::timed_read(
                    operation,
                    || {
                        canceled.fetch_add(1, Ordering::Relaxed);
                    },
                    Instant::now() + Duration::from_secs(8),
                    &worker,
                    signal,
                )
                .await
            });
            cx.run_until_parked();
            assert_eq!(calls.load(Ordering::Relaxed), 0);
            if timeout {
                cx.executor().advance_clock(Duration::from_secs(9));
            } else {
                leave.send(()).unwrap();
            }
            cx.run_until_parked();
            assert_eq!(calls.load(Ordering::Relaxed), 1);
            assert!((&mut result).now_or_never().is_none());
            finish.send(42).unwrap();
            cx.run_until_parked();
            assert_eq!(result.now_or_never(), Some(None));
            assert_eq!(calls.load(Ordering::Relaxed), 1);
        }
    }
}
