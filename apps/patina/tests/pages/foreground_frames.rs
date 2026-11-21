use super::*;
use serde_json::json;
use std::{
    io::Write,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    thread,
    time::{Duration, Instant},
};
use windows::Win32::Graphics::Gdi::*;

// PrintWindow can return an unpainted surface on a private desktop. Log the colour
// distribution as a positive control before interpreting any low-contrast frame.
#[link(name = "user32")]
unsafe extern "system" {
    fn PrintWindow(hwnd: HWND, dc: HDC, flags: u32) -> i32;
}

pub(super) struct Capture {
    running: Arc<AtomicBool>,
    thread: Option<thread::JoinHandle<std::io::Result<()>>>,
}

impl Capture {
    pub(super) fn start(
        hwnd: HWND,
        path: &Path,
        start: Instant,
        navigation: Vec<(&'static str, i32, i32)>,
    ) -> Result<Self, Error> {
        let mut file = fs::File::create_new(path)?;
        let handle = hwnd.0 as usize;
        let running = Arc::new(AtomicBool::new(true));
        let active = running.clone();
        let thread = thread::spawn(move || {
            let hwnd = HWND(handle as _);
            let mut rect = RECT::default();
            unsafe {
                GetClientRect(hwnd, &mut rect)?;
            }
            let width = rect.right;
            let height = rect.bottom;
            let len = usize::try_from(width)
                .ok()
                .and_then(|w| w.checked_mul(usize::try_from(height).ok()?))
                .filter(|n| *n > 0 && *n <= isize::MAX as usize / 4)
                .ok_or_else(|| std::io::Error::other("invalid window dimensions"))?;
            let description = BITMAPINFO {
                bmiHeader: BITMAPINFOHEADER {
                    biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                    biWidth: width,
                    biHeight: -height,
                    biPlanes: 1,
                    biBitCount: 32,
                    biCompression: BI_RGB.0,
                    ..Default::default()
                },
                ..Default::default()
            };
            unsafe {
                let dc = CreateCompatibleDC(None);
                if dc.is_invalid() {
                    return Err(std::io::Error::last_os_error());
                }
                let mut bits = std::ptr::null_mut();
                let bitmap = match CreateDIBSection(
                    Some(dc),
                    &description,
                    DIB_RGB_COLORS,
                    &mut bits,
                    None,
                    0,
                ) {
                    Ok(bitmap) => bitmap,
                    Err(error) => {
                        let _ = DeleteDC(dc);
                        return Err(error.into());
                    }
                };
                let previous = SelectObject(dc, bitmap.into());
                let result = (|| -> std::io::Result<()> {
                    if previous.is_invalid() || bits.is_null() {
                        return Err(std::io::Error::other("invalid capture surface"));
                    }
                    bits.cast::<u32>().write_bytes(0, len);
                    let mut first_content_hash = None;
                    let mut content_changed = false;
                    let tile_columns = (width as usize).div_ceil(16);
                    let mut icon_tiles = vec![0_u8; tile_columns * (height as usize).div_ceil(16)];
                    while active.load(Ordering::Relaxed) {
                        icon_tiles.fill(0);
                        let began = start.elapsed().as_millis();
                        let ok = PrintWindow(hwnd, dc, 3) != 0;
                        let _ = GdiFlush();
                        let pixels = std::slice::from_raw_parts(bits.cast::<u32>(), len);
                        let mut dark = 0;
                        let mut light = 0;
                        let mut chromatic = 0;
                        let mut count = 0;
                        let mut hash = 2166136261u32;
                        for y in (height / 5..height * 93 / 100).step_by(4) {
                            for x in (width * 16 / 100..width * 95 / 100).step_by(4) {
                                let word = pixels[(y * width + x) as usize] & 0xffffff;
                                let channels = [(word >> 16) as u8, (word >> 8) as u8, word as u8];
                                let [r, g, b] = channels;
                                if r.abs_diff(32) <= 1 {
                                    let tile = y as usize / 16 * tile_columns + x as usize / 16;
                                    if g.abs_diff(96) <= 1 && b.abs_diff(192) <= 1 {
                                        icon_tiles[tile] |= 1;
                                    } else if g.abs_diff(80) <= 1 && b <= 48 {
                                        icon_tiles[tile] |= 2;
                                    }
                                }
                                let min = *channels.iter().min().unwrap();
                                let max = *channels.iter().max().unwrap();
                                dark += i32::from(max < 175);
                                light += i32::from(min > 235);
                                chromatic += i32::from(max - min > 25);
                                count += 1;
                                hash = (hash ^ word).wrapping_mul(16777619);
                            }
                        }
                        if ok && dark > 30 && light > 30 {
                            content_changed |= *first_content_hash.get_or_insert(hash) != hash;
                        }
                        let sidebar: serde_json::Map<_, _> = navigation
                            .iter()
                            .filter(|(_, x, y)| *x >= 0 && *x < width && *y >= 0 && *y < height)
                            .map(|&(label, x, y)| {
                                (
                                    label.to_owned(),
                                    json!(pixels[(y * width + x) as usize] & 0xffffff),
                                )
                            })
                            .collect();
                        let marked: Vec<_> = icon_tiles
                            .iter()
                            .enumerate()
                            .filter(|(_, v)| **v != 0)
                            .collect();
                        writeln!(
                            file,
                            "{}",
                            json!({"startMs":began,"endMs":start.elapsed().as_millis(),"ok":ok,"dark":dark,"light":light,"color":chromatic,"count":count,"hash":hash,"sidebar":sidebar,"tileColumns":tile_columns,"iconTiles":marked})
                        )?;
                        thread::sleep(Duration::from_millis(8));
                    }
                    if !content_changed {
                        return Err(std::io::Error::other(
                            "window capture did not resolve two distinct page contents",
                        ));
                    }
                    Ok(())
                })();
                SelectObject(dc, previous);
                let _ = DeleteObject(bitmap.into());
                let _ = DeleteDC(dc);
                result
            }
        });
        Ok(Self {
            running,
            thread: Some(thread),
        })
    }

    pub(super) fn finish(mut self) -> Result<(), Error> {
        self.running.store(false, Ordering::Relaxed);
        self.thread
            .take()
            .unwrap()
            .join()
            .map_err(|_| "frame capture thread panicked")??;
        Ok(())
    }
}

impl Drop for Capture {
    fn drop(&mut self) {
        self.running.store(false, Ordering::Relaxed);
        if let Some(worker) = self.thread.take() {
            let _ = worker.join();
        }
    }
}
