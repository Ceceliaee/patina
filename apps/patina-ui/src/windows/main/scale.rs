use crate::windows::placement::hwnd;
use gpui_kit::{Context, Window};
use patina_activity_model::AppPreferences;
use std::{cell::Cell, num::NonZeroU16};
use windows::Win32::{
    Foundation::{HWND, LPARAM, LRESULT, RECT, WPARAM},
    Graphics::Gdi::{GetMonitorInfoW, MONITOR_DEFAULTTONEAREST, MONITORINFO, MonitorFromWindow},
    UI::{
        HiDpi::GetDpiForWindow,
        Shell::{DefSubclassProc, RemoveWindowSubclass, SetWindowSubclass},
        WindowsAndMessaging::*,
    },
};

pub(crate) const WIDTH: u16 = 1080;
pub(crate) const HEIGHT: u16 = 720;
const APPLY: u32 = WM_APP + 71;

struct ScaleState {
    preferred: Cell<u16>,
    sizing: Cell<bool>,
    maximized: Cell<bool>,
    monitor: Cell<isize>,
    finished: async_channel::Sender<u16>,
}

struct Geometry {
    outer: RECT,
    work: RECT,
    frame: (i32, i32),
    dpi: f64,
}

impl Geometry {
    fn read(handle: HWND) -> windows::core::Result<Self> {
        let mut info = MONITORINFO {
            cbSize: size_of::<MONITORINFO>() as _,
            ..Default::default()
        };
        let mut outer = RECT::default();
        let mut client = RECT::default();
        unsafe {
            GetMonitorInfoW(
                MonitorFromWindow(handle, MONITOR_DEFAULTTONEAREST),
                &mut info,
            )
            .ok()?;
            GetWindowRect(handle, &mut outer)?;
            GetClientRect(handle, &mut client)?;
            Ok(Self {
                outer,
                work: info.rcWork,
                frame: (
                    outer.right - outer.left - client.right,
                    outer.bottom - outer.top - client.bottom,
                ),
                dpi: f64::from(GetDpiForWindow(handle).max(1)) / 96.,
            })
        }
    }

    fn limit(&self) -> u16 {
        let width = f64::from(self.work.right - self.work.left - self.frame.0) / f64::from(WIDTH);
        let height = f64::from(self.work.bottom - self.work.top - self.frame.1) / f64::from(HEIGHT);
        ((width.min(height) * 100. / self.dpi).floor() as u16).clamp(1, AppPreferences::MAX_SCALE)
    }

    fn size(&self, percent: f64) -> (i32, i32) {
        let factor = self.dpi * percent / 100.;
        (
            (f64::from(WIDTH) * factor).round() as i32 + self.frame.0,
            (f64::from(HEIGHT) * factor).round() as i32 + self.frame.1,
        )
    }

    fn constrain(&self, edge: u32, rect: &mut RECT) {
        let x = f64::from(rect.right - rect.left - self.frame.0) / f64::from(WIDTH);
        let y = f64::from(rect.bottom - rect.top - self.frame.1) / f64::from(HEIGHT);
        let factor = match edge {
            WMSZ_TOP | WMSZ_BOTTOM => y,
            WMSZ_LEFT | WMSZ_RIGHT => x,
            _ => {
                // Project a corner drag onto the diagonal of the design canvas.
                (x * 9. + y * 4.) / 13.
            }
        };
        let max = self.limit();
        let percent = (factor * 100. / self.dpi).clamp(
            f64::from(AppPreferences::MIN_SCALE.min(max)),
            f64::from(max),
        );
        let (width, height) = self.size(percent);
        if matches!(edge, WMSZ_LEFT | WMSZ_TOPLEFT | WMSZ_BOTTOMLEFT) {
            rect.left = rect.right - width;
        } else {
            rect.right = rect.left + width;
        }
        if matches!(edge, WMSZ_TOP | WMSZ_TOPLEFT | WMSZ_TOPRIGHT) {
            rect.top = rect.bottom - height;
        } else {
            rect.bottom = rect.top + height;
        }
    }

    fn apply(&self, handle: HWND, percent: u16) -> windows::core::Result<()> {
        let (w, h) = self.size(f64::from(percent.min(self.limit())));
        let x = self
            .outer
            .left
            .clamp(self.work.left, (self.work.right - w).max(self.work.left));
        let y = self
            .outer
            .top
            .clamp(self.work.top, (self.work.bottom - h).max(self.work.top));
        if (x, y, x + w, y + h)
            != (
                self.outer.left,
                self.outer.top,
                self.outer.right,
                self.outer.bottom,
            )
        {
            unsafe { SetWindowPos(handle, None, x, y, w, h, SWP_NOZORDER | SWP_NOACTIVATE)? };
        }
        Ok(())
    }
}

pub(crate) fn limit(window: &Window) -> u16 {
    hwnd(window)
        .ok()
        .and_then(|h| Geometry::read(h).ok())
        .map_or(AppPreferences::MAX_SCALE, |g| g.limit())
}

pub(crate) fn preview(window: &Window, percent: u16) {
    if let Ok(handle) = hwnd(window) {
        let _ =
            unsafe { PostMessageW(Some(handle), APPLY, WPARAM(usize::from(percent)), LPARAM(0)) };
    }
}

impl super::MainWindow {
    pub(super) fn observe_window_scale(
        &self,
        window: &Window,
        cx: &mut Context<Self>,
    ) -> windows::core::Result<()> {
        if let Some(changes) = install(window, self.client.window_scale.get())? {
            cx.spawn_in(window, async move |main, cx| {
                while let Ok(percent) = changes.recv().await {
                    let _ = main.update_in(cx, |main, win, cx| {
                        if let super::Page::Settings(settings) = &main.page {
                            settings.update(cx, |s, cx| s.window_resized(percent, win, cx));
                        } else {
                            main.client.remember_window_scale(percent);
                        }
                    });
                }
            })
            .detach();
        }
        Ok(())
    }
}

fn install(
    window: &Window,
    percent: u16,
) -> windows::core::Result<Option<async_channel::Receiver<u16>>> {
    let Ok(handle) = hwnd(window) else {
        return Ok(None);
    };
    gpui_kit::platform::set_windowed_layout_width(handle, NonZeroU16::new(WIDTH).unwrap())?;
    let (finished, changes) = async_channel::unbounded();
    let state = Box::new(ScaleState {
        preferred: Cell::new(percent),
        sizing: Cell::default(),
        maximized: Cell::default(),
        monitor: Cell::new(
            unsafe { MonitorFromWindow(handle, MONITOR_DEFAULTTONEAREST) }.0 as isize,
        ),
        finished,
    });
    let state = Box::into_raw(state);
    if let Err(e) = unsafe { SetWindowSubclass(handle, Some(procedure), 1, state as usize) }.ok() {
        unsafe { drop(Box::from_raw(state)) };
        return Err(e);
    }
    preview(window, percent);
    Ok(Some(changes))
}

unsafe extern "system" fn procedure(
    handle: HWND,
    msg: u32,
    wp: WPARAM,
    lp: LPARAM,
    id: usize,
    data: usize,
) -> LRESULT {
    let state = unsafe { &*(data as *const ScaleState) };
    let refit = || unsafe {
        let _ = PostMessageW(Some(handle), APPLY, WPARAM(0), LPARAM(0));
    };
    match msg {
        APPLY => {
            if wp.0 != 0 {
                state
                    .preferred
                    .set((wp.0 as u16).clamp(AppPreferences::MIN_SCALE, AppPreferences::MAX_SCALE));
            }
            if !unsafe { IsZoomed(handle).as_bool() || IsIconic(handle).as_bool() }
                && let Ok(g) = Geometry::read(handle)
                && let Err(e) = g.apply(handle, state.preferred.get())
            {
                eprintln!("Resize main window: {e}");
            }
            return LRESULT(0);
        }
        WM_SIZING if lp.0 != 0 => {
            if let Ok(g) = Geometry::read(handle) {
                g.constrain(wp.0 as u32, unsafe { &mut *(lp.0 as *mut RECT) });
                state.sizing.set(true);
                return LRESULT(1);
            }
        }
        WM_EXITSIZEMOVE if state.sizing.replace(false) => {
            if let Ok(g) = Geometry::read(handle) {
                let width = g.outer.right - g.outer.left - g.frame.0;
                let value = (100. * f64::from(width) / (f64::from(WIDTH) * g.dpi)).round() as u16;
                if value >= AppPreferences::MIN_SCALE {
                    let value = value.min(g.limit());
                    state.preferred.set(value);
                    let _ = state.finished.try_send(value);
                    refit();
                }
            }
        }
        WM_SIZE if wp.0 == SIZE_MAXIMIZED as usize => state.maximized.set(true),
        WM_SIZE if wp.0 == SIZE_RESTORED as usize => {
            let width = (lp.0 as u32 & 0xffff) as i32;
            let height = ((lp.0 as u32) >> 16) as i32;
            if state.maximized.replace(false) || (2 * width - 3 * height).abs() > 3 {
                refit();
            }
        }
        WM_DPICHANGED | WM_DISPLAYCHANGE | WM_SETTINGCHANGE => refit(),
        WM_MOVE => {
            let monitor = unsafe { MonitorFromWindow(handle, MONITOR_DEFAULTTONEAREST) }.0 as isize;
            if state.monitor.replace(monitor) != monitor {
                refit();
            }
        }
        WM_NCDESTROY => unsafe {
            let _ = RemoveWindowSubclass(handle, Some(procedure), id);
            drop(Box::from_raw(data as *mut ScaleState));
        },
        _ => {}
    }
    unsafe { DefSubclassProc(handle, msg, wp, lp) }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn large_work_area_allows_the_full_range_and_stops_at_both_ends() {
        let geometry = Geometry {
            outer: RECT::default(),
            work: RECT {
                left: 0,
                top: 0,
                right: 2560,
                bottom: 1440,
            },
            frame: (0, 0),
            dpi: 1.,
        };
        assert_eq!(geometry.limit(), 150);
        for (dragged_width, expected) in [(120, (540, 360)), (2400, (1620, 1080))] {
            let mut rect = RECT {
                right: dragged_width,
                ..Default::default()
            };
            geometry.constrain(WMSZ_RIGHT, &mut rect);
            assert_eq!((rect.right, rect.bottom), expected);
        }
    }

    #[test]
    fn all_resize_edges_preserve_the_canvas_and_the_opposite_corner() {
        let geometry = Geometry {
            outer: RECT::default(),
            work: RECT {
                left: -1920,
                top: 0,
                right: 0,
                bottom: 1040,
            },
            frame: (16, 8),
            dpi: 1.25,
        };
        assert_eq!(geometry.limit(), 114);
        for edge in [
            WMSZ_LEFT,
            WMSZ_RIGHT,
            WMSZ_TOP,
            WMSZ_BOTTOM,
            WMSZ_TOPLEFT,
            WMSZ_TOPRIGHT,
            WMSZ_BOTTOMLEFT,
            WMSZ_BOTTOMRIGHT,
        ] {
            let proposed = RECT {
                left: -1715,
                top: 71,
                right: -435,
                bottom: 936,
            };
            let mut r = proposed;
            geometry.constrain(edge, &mut r);
            let w = r.right - r.left - geometry.frame.0;
            let h = r.bottom - r.top - geometry.frame.1;
            assert!((2 * w - 3 * h).abs() <= 2);
            if matches!(edge, WMSZ_LEFT | WMSZ_TOPLEFT | WMSZ_BOTTOMLEFT) {
                assert_eq!(r.right, proposed.right);
            } else {
                assert_eq!(r.left, proposed.left);
            }
            if matches!(edge, WMSZ_TOP | WMSZ_TOPLEFT | WMSZ_TOPRIGHT) {
                assert_eq!(r.bottom, proposed.bottom);
            } else {
                assert_eq!(r.top, proposed.top);
            }
        }
    }
}
