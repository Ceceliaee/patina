use super::favicon;
use futures::{
    FutureExt, StreamExt,
    channel::oneshot,
    future::{Shared, join_all, select},
    stream,
};
use gpui_kit::{BackgroundExecutor, Image, ImageFormat, RenderImage, SvgRenderer, Task};
use std::{
    collections::HashMap,
    sync::Arc,
    time::{Duration, Instant},
};

#[derive(Clone)]
pub(crate) struct SourceIcon {
    pub(crate) image: Arc<Image>,
    raster: Arc<std::sync::OnceLock<Option<IconRaster>>>,
    renderer: SvgRenderer,
}

pub(crate) struct IconRaster {
    pub(crate) pixels: Arc<RenderImage>,
    pub(crate) color: Option<u32>,
}

pub(crate) struct RetainedIcons {
    remaining: usize,
    bytes: usize,
}

impl Default for RetainedIcons {
    fn default() -> Self {
        Self {
            remaining: 256,
            bytes: 8 * 1024 * 1024,
        }
    }
}

impl RetainedIcons {
    pub(crate) fn admit(&mut self, key: &str, icon: Option<&SourceIcon>) -> bool {
        let bytes = key.len()
            + icon.map_or(0, |i| {
                i.image.bytes.len()
                    + i.prepared()
                        .and_then(|r| r.pixels.as_bytes(0))
                        .map_or(0, |b| b.len())
            });
        if self.remaining == 0 || bytes > self.bytes {
            return false;
        }
        self.bytes -= bytes;
        self.remaining -= 1;
        true
    }
}

impl SourceIcon {
    pub(crate) fn from_png(bytes: Vec<u8>, renderer: SvgRenderer) -> Option<Self> {
        let image = Arc::new(Image::from_bytes(ImageFormat::Png, bytes));
        let icon = Self::encoded(image, renderer);
        icon.raster()?;
        Some(icon)
    }

    fn encoded(image: Arc<Image>, renderer: SvgRenderer) -> Self {
        Self {
            image,
            renderer,
            raster: Default::default(),
        }
    }

    pub(crate) fn prepared(&self) -> Option<&IconRaster> {
        self.raster.get()?.as_ref()
    }

    pub(crate) fn raster(&self) -> Option<&IconRaster> {
        self.raster.get_or_init(|| self.decode()).as_ref()
    }

    fn decode(&self) -> Option<IconRaster> {
        let image = &self.image;
        let pixels = image.to_image_data(self.renderer.clone()).ok()?;
        let size = pixels.size(0);
        let color = if image.bytes.get(24) == Some(&16) {
            patina_activity_model::icon_color(&image.bytes)
        } else {
            patina_activity_model::icon_color_from_bgra(
                pixels.as_bytes(0)?,
                size.width.0 as u32,
                size.height.0 as u32,
            )
        };
        Some(IconRaster { pixels, color })
    }
}

pub(crate) async fn read_apps(
    client: std::rc::Rc<crate::client::Client>,
    keys: Vec<String>,
    first_screen: std::collections::HashSet<String>,
    known: Vec<SourceIcon>,
    executor: BackgroundExecutor,
    renderer: SvgRenderer,
) -> Result<Vec<(String, Option<SourceIcon>)>, patina_desktop_protocol::RequestError> {
    let images = client.icons(keys.clone()).await?;
    Ok(executor
        .spawn(async move {
            let mut by_content = HashMap::<u64, Vec<SourceIcon>>::new();
            for icon in known {
                let bucket = by_content.entry(icon.image.id()).or_default();
                if !bucket
                    .iter()
                    .any(|other| Arc::ptr_eq(&other.image, &icon.image))
                {
                    bucket.push(icon);
                }
            }
            let prepared: HashMap<_, _> = images
                .into_iter()
                .filter_map(|(name, bytes)| {
                    let image = Arc::new(Image::from_bytes(ImageFormat::Png, bytes));
                    let bucket = by_content.entry(image.id()).or_default();
                    let icon = match bucket.iter().find(|i| i.image.bytes == image.bytes) {
                        Some(icon) => icon.clone(),
                        None => {
                            let icon = SourceIcon::encoded(image, renderer.clone());
                            bucket.push(icon.clone());
                            icon
                        }
                    };
                    let name = name.to_lowercase();
                    if first_screen.contains(&name) {
                        icon.raster()?;
                    }
                    Some((name, icon))
                })
                .collect();
            keys.into_iter()
                .map(|key| {
                    let icon = prepared.get(&key.to_lowercase()).cloned();
                    (key, icon)
                })
                .collect()
        })
        .await)
}

type SiteResult = Shared<oneshot::Receiver<Option<SourceIcon>>>;

#[cfg(test)]
mod measurements {
    use super::*;
    #[test]
    #[ignore = "paired CPU timings of distinct display icons"]
    fn png_decode_and_color() {
        let renderer = SvgRenderer::new(Arc::new(()));
        let fixtures: Vec<_> = (0_u8..48)
            .map(|id| {
                let bgra: Vec<_> = (0_u8..64)
                    .flat_map(|y| {
                        (0_u8..64).flat_map(move |x| {
                            [
                                x.wrapping_mul(5),
                                y.wrapping_mul(7),
                                id.wrapping_mul(11),
                                [0, 64, 128, 255][usize::from((x ^ y) % 4)],
                            ]
                        })
                    })
                    .collect();
                patina_activity_model::icon_png_from_bgra(&bgra, 64, 64).unwrap()
            })
            .collect();
        for variant in ["baseline", "shared", "shared", "baseline"] {
            let start = Instant::now();
            let mut colors = Vec::new();
            for bytes in &fixtures {
                let color = if variant == "shared" {
                    SourceIcon::from_png(bytes.clone(), renderer.clone())
                        .unwrap()
                        .raster()
                        .unwrap()
                        .color
                } else {
                    let color = patina_activity_model::icon_color(bytes);
                    let image = Image::from_bytes(ImageFormat::Png, bytes.clone());
                    std::hint::black_box(image.to_image_data(renderer.clone()).unwrap());
                    color
                };
                colors.push(color);
            }
            eprintln!("png {variant} 48 icons {} us", start.elapsed().as_micros());
            assert!(colors.iter().all(Option::is_some));
            let digest = colors.iter().fold(0xcbf29ce484222325_u64, |hash, color| {
                (hash ^ u64::from(color.unwrap())).wrapping_mul(0x100000001b3)
            });
            assert_eq!(
                digest, 0x1f7744a99c4c3f21,
                "frozen palette for 48 alpha gradients"
            );
            for (bytes, actual) in fixtures.iter().zip(colors) {
                assert_eq!(actual, patina_activity_model::icon_color(bytes));
            }
        }
        assert!(SourceIcon::from_png(vec![0, 1, 2, 3], renderer).is_none());
    }
}

struct SiteRead {
    result: SiteResult,
    started: Instant,
}

#[cfg(all(test, feature = "test-support"))]
#[gpui_kit::test]
fn embedded_icons_work_on_first_scroll_without_preparing_the_entire_catalog(
    cx: &mut gpui_kit::TestAppContext,
) {
    use base64::Engine;
    let (executor, renderer) =
        cx.update(|cx| (cx.background_executor().clone(), cx.svg_renderer()));
    let urls: Vec<_> = (0..64).map(|i| {
        let svg = format!(r##"<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="#2060{i:02x}"/></svg>"##);
        format!("data:image/svg+xml;base64,{}", base64::engine::general_purpose::STANDARD.encode(svg))
    }).collect();
    let mut sites = SiteIcons::default();
    let visible = urls[..2].iter().map(String::as_str).collect();
    let ready = sites.prepare(
        urls.iter().map(String::as_str),
        &visible,
        &executor,
        renderer,
    );
    cx.run_until_parked();
    assert!(ready.now_or_never().is_some());
    assert_eq!(sites.entries.len(), 2);
    assert_eq!(
        sites.get(&urls[63]).unwrap().prepared().unwrap().color,
        Some(0x20603f)
    );
    assert!(sites.get("data:image/png;base64,broken").is_none());
    assert!(sites.get("https://uncached.example/icon").is_none());
}

#[cfg(all(test, feature = "test-support"))]
#[gpui_kit::test]
fn hidden_slow_site_does_not_delay_ready_icons_and_departure_cancels_it(
    cx: &mut gpui_kit::TestAppContext,
) {
    let (worker, renderer) = cx.update(|cx| (cx.background_executor().clone(), cx.svg_renderer()));
    let mut sites = SiteIcons::default();
    let hidden = "https://hidden.example/icon";
    let shown = "https://visible.example/icon";
    let slow = sites.pending(hidden);
    sites.pending(shown).send(None).ok().unwrap();
    let read = sites.prepare(
        [shown, hidden].into_iter(),
        &[shown].into_iter().collect(),
        &worker,
        renderer,
    );
    cx.run_until_parked();
    assert!(read.now_or_never().is_some());
    assert!(sites.ready(shown) && !sites.ready(hidden));
    sites.trim(&mut RetainedIcons::default());
    assert!(slow.is_canceled());
    for n in 0..1024 {
        sites.pending(&format!("site-{n}")).send(None).ok().unwrap();
    }
    sites.trim(&mut RetainedIcons::default());
    assert_eq!(sites.entries.len(), 256);
    let mut budget = RetainedIcons::default();
    assert!(!budget.admit(&"x".repeat(8 * 1024 * 1024 + 1), None));
    assert!(budget.admit("normal", None));
}

#[cfg(all(test, feature = "test-support"))]
#[gpui_kit::test]
fn new_site_keys_share_a_bounded_queue_and_release_it_on_exit(cx: &mut gpui_kit::TestAppContext) {
    let (executor, renderer) =
        cx.update(|cx| (cx.background_executor().clone(), cx.svg_renderer()));
    let mut sites = SiteIcons::default();
    let visible = Default::default();
    let mut peak = 0;
    for round in 0..16 {
        let urls: Vec<_> = (0..128)
            .map(|i| format!("invalid:fixture-{round}-{i}"))
            .collect();
        let read = sites.prepare(
            urls.iter().map(String::as_str),
            &visible,
            &executor,
            renderer.clone(),
        );
        let queued = sites.entries.len();
        assert!((1..=48).contains(&queued));
        peak = peak.max(queued);
        drop(read);
        sites.trim(&mut RetainedIcons::default());
        assert!(sites.entries.is_empty());
        cx.run_until_parked();
    }
    assert_eq!(peak, 48);
    let retry_key = "invalid:cached";
    sites.pending(retry_key).send(None).ok().unwrap();
    assert!(sites.ready(retry_key));
    sites.entries.get_mut(retry_key).unwrap().started -= Duration::from_secs(61);
    assert!(!sites.ready(retry_key));
}

impl SiteRead {
    fn expired(&self) -> bool {
        self.started.elapsed() > Duration::from_secs(60)
            && matches!(self.result.clone().now_or_never(), Some(Ok(None) | Err(_)))
    }
}

#[derive(Default)]
pub(crate) struct SiteIcons {
    entries: HashMap<String, SiteRead>,
    renderer: Option<SvgRenderer>,
}

impl SiteIcons {
    pub(crate) fn trim(&mut self, budget: &mut RetainedIcons) {
        self.entries.retain(|source, read| {
            let Some(Ok(icon)) = read.result.clone().now_or_never() else {
                return false;
            };
            budget.admit(source, icon.as_ref())
        });
    }
    pub(crate) fn ready(&self, source: &str) -> bool {
        self.entries
            .get(source)
            .is_some_and(|read| !read.expired() && read.result.clone().now_or_never().is_some())
    }

    pub(crate) fn get(&self, source: &str) -> Option<SourceIcon> {
        if let Some(entry) = self.entries.get(source) {
            return entry.result.clone().now_or_never()?.ok()?;
        }
        // The presented row pins this result when scrolling directly to a new local icon.
        let renderer = self.renderer.as_ref()?;
        let bytes = super::embedded_favicon(source, renderer.clone())?;
        SourceIcon::from_png(bytes, renderer.clone())
    }

    pub(crate) fn retain(&mut self, keep: impl Fn(&str) -> bool) {
        self.entries.retain(|source, _| keep(source));
    }

    #[cfg(all(test, feature = "test-support"))]
    pub(crate) fn pending(&mut self, source: &str) -> oneshot::Sender<Option<SourceIcon>> {
        let (send, recv) = oneshot::channel();
        self.entries.insert(
            source.to_owned(),
            SiteRead {
                result: recv.shared(),
                started: Instant::now(),
            },
        );
        send
    }

    pub(crate) fn prepare<'a>(
        &mut self,
        sources: impl Iterator<Item = &'a str>,
        visible: &std::collections::HashSet<&str>,
        executor: &BackgroundExecutor,
        renderer: SvgRenderer,
    ) -> Task<()> {
        self.renderer = Some(renderer.clone());
        let (local, mut remote) = sources
            .filter(|src| !src.starts_with("data:image/") || visible.contains(src))
            .partition::<Vec<_>, _>(|src| src.starts_with("data:image/"));
        remote.sort_by_key(|src| !visible.contains(src));
        let local = self.start_sites(local, None, executor, renderer.clone());
        let remote = self.start_sites(remote, Some(visible), executor, renderer);
        let budget = executor.timer(Duration::from_millis(150));
        executor.spawn(async move {
            join_all(local).await;
            if !remote.is_empty() {
                let _ = select(join_all(remote), budget).await;
            }
        })
    }

    fn start_sites(
        &mut self,
        sources: Vec<&str>,
        visible: Option<&std::collections::HashSet<&str>>,
        executor: &BackgroundExecutor,
        renderer: SvgRenderer,
    ) -> Vec<SiteResult> {
        let mut jobs = Vec::new();
        let mut pending = Vec::new();
        static REMOTE_QUEUE: async_lock::Semaphore = async_lock::Semaphore::new(48);
        for source in sources {
            if self.entries.get(source).is_none_or(SiteRead::expired) {
                let ticket = if source.starts_with("data:image/") {
                    None
                } else if let Some(ticket) = REMOTE_QUEUE.try_acquire() {
                    Some(ticket)
                } else {
                    continue;
                };
                let (send, recv) = oneshot::channel();
                self.entries.insert(
                    source.to_owned(),
                    SiteRead {
                        result: recv.shared(),
                        started: Instant::now(),
                    },
                );
                jobs.push((source.to_owned(), send, ticket));
            }
            let result = &self.entries[source].result;
            if visible.is_none_or(|keys| keys.contains(source))
                && result.clone().now_or_never().is_none()
            {
                pending.push(result.clone());
            }
        }
        if !jobs.is_empty() {
            let worker = executor.clone();
            executor
                .spawn(async move {
                    stream::iter(jobs)
                        .for_each_concurrent(6, |(source, mut send, ticket)| {
                            let renderer = renderer.clone();
                            let worker = &worker;
                            async move {
                                let _ticket = ticket;
                                if !send.is_canceled() {
                                    let icon = favicon(
                                        &source,
                                        worker,
                                        renderer.clone(),
                                        send.cancellation(),
                                    )
                                    .await
                                    .and_then(|bytes| SourceIcon::from_png(bytes, renderer));
                                    let _ = send.send(icon);
                                }
                            }
                        })
                        .await;
                })
                .detach();
        }
        pending
    }
}
