use base64::Engine;
use gpui_kit::*;
use std::time::Duration;

struct FaviconClient(windows::Web::Http::HttpClient);
impl Drop for FaviconClient {
    fn drop(&mut self) {
        let _ = self.0.Close();
    }
}

pub(crate) async fn favicon(
    source: &str,
    executor: &BackgroundExecutor,
    renderer: SvgRenderer,
) -> Option<Vec<u8>> {
    let bytes = if source.starts_with("data:image/") {
        let (header, data) = source.split_once(',')?;
        if !header.ends_with(";base64") || data.len() > 6 * 1024 * 1024 {
            return None;
        }
        base64::engine::general_purpose::STANDARD
            .decode(data)
            .ok()?
    } else {
        if !(source.starts_with("https://") || source.starts_with("http://")) {
            return None;
        }
        use windows::{
            Foundation::Uri, Storage::Streams::DataReader, Web::Http::HttpClient, core::HSTRING,
        };
        // WinRT HTTP uses the user's Windows proxy configuration.
        let client = FaviconClient(HttpClient::new().ok()?);
        let uri = Uri::CreateUri(&HSTRING::from(source)).ok()?;
        use std::{
            future::{Future, IntoFuture},
            task::Poll,
        };
        let request = client.0.GetBufferAsync(&uri).ok()?;
        let mut response = std::pin::pin!(request.clone().into_future());
        let mut timeout = std::pin::pin!(executor.timer(Duration::from_secs(8)));
        let buffer = std::future::poll_fn(|cx| {
            if let Poll::Ready(result) = response.as_mut().poll(cx) {
                return Poll::Ready(result.ok());
            }
            if timeout.as_mut().poll(cx).is_ready() {
                let _ = request.Cancel();
                return Poll::Ready(None);
            }
            Poll::Pending
        })
        .await?;
        let length = buffer.Length().ok()?;
        if length > 4 * 1024 * 1024 {
            return None;
        }
        let mut bytes = vec![0; length as usize];
        DataReader::FromBuffer(&buffer)
            .ok()?
            .ReadBytes(&mut bytes)
            .ok()?;
        bytes
    };
    decode_favicon(&bytes, renderer)
}

fn decode_favicon(bytes: &[u8], renderer: SvgRenderer) -> Option<Vec<u8>> {
    if let Some(png) = patina_recorder::icon_png(bytes) {
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
    patina_recorder::icon_png_from_bgra(
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
        assert_eq!(patina_recorder::icon_color(&png), Some(0x2060c0));
        assert!(decode_favicon(b"invalid favicon", renderer).is_none());
    }
}
