use crate::{main_window::MainWindow, mini::Mini};
use gpui_kit::{
    AnyWindowHandle, App, AsyncApp, GraphicalEnvironment, WeakEntity, WindowingRequest,
};

use std::rc::Rc;

#[derive(Default)]
pub(super) struct AppWindows {
    today: Option<(AnyWindowHandle, WeakEntity<MainWindow>)>,
    mini: Option<(AnyWindowHandle, WeakEntity<Mini>)>,
    notice: Option<(AnyWindowHandle, WeakEntity<crate::tool_notice::ToolNotice>)>,
}

impl AppWindows {
    pub(super) fn refresh_tools(&self, cx: &mut App) {
        if let Some((_, view)) = &self.today {
            let _ = view.update(cx, |w, cx| w.refresh_tools(cx));
        }
    }
    pub(super) async fn show_dialog(
        &mut self,
        client: &Rc<crate::windows_host::Client>,
        cx: &AsyncApp,
    ) -> bool {
        if self
            .today
            .as_ref()
            .is_none_or(|(_, v)| cx.update(|_| v.upgrade().is_none()))
        {
            self.open_main(client, None, cx).await;
        }
        if let Some((w, v)) = &self.today {
            return cx.update(|cx| {
                w.update(cx, |_, win, cx| {
                    v.update(cx, |v, cx| v.show_notice(win, cx))
                })
                .is_ok()
            });
        }
        false
    }
    pub(super) fn refresh_notices(&self, cx: &mut App) {
        if let Some((_, n)) = &self.notice {
            let _ = n.update(cx, |n, cx| n.refresh(cx));
        }
        if let Some((_, v)) = &self.today {
            let _ = v.update(cx, |v, cx| v.refresh_notice(cx));
        }
    }
    pub(super) async fn show_notice(
        &mut self,
        client: &Rc<crate::windows_host::Client>,
        cx: &AsyncApp,
    ) -> bool {
        if let Some((_, view)) = &self.notice
            && cx.update(|cx| view.update(cx, |notice, cx| notice.refresh(cx)).is_ok())
        {
            return true;
        }
        if attach_graphics(cx).await {
            self.notice = cx.update(|cx| {
                crate::tool_notice::ToolNotice::open(client.clone(), cx)
                    .map_err(|e| eprintln!("Open tool notification: {e}"))
                    .ok()
            });
        }
        self.notice
            .as_ref()
            .is_some_and(|(_, v)| cx.update(|_| v.upgrade().is_some()))
    }
    pub(super) async fn open_mini(
        &mut self,
        focus: bool,
        client: &Rc<crate::windows_host::Client>,
        cx: &AsyncApp,
    ) {
        if let Some((handle, entity)) = &self.mini {
            let reopened = cx.update(|cx| {
                handle
                    .update(cx, |_, window, cx| {
                        let Some(view) = entity.upgrade() else {
                            return false;
                        };
                        view.update(cx, |mini, cx| mini.reopen(focus, window, cx));
                        true
                    })
                    .unwrap_or(false)
            });
            if reopened {
                return;
            }
        }
        if !attach_graphics(cx).await {
            return;
        }
        cx.update(|cx| {
            self.mini = match Mini::open(cx, client.clone(), focus) {
                Ok(window) => Some(window),
                Err(error) => {
                    eprintln!("open Mini: {error:#}");

                    None
                }
            };
        });
    }

    pub(super) async fn open_main(
        &mut self,
        client: &Rc<crate::windows_host::Client>,
        target: Option<patina_recorder::ToolTarget>,
        cx: &AsyncApp,
    ) {
        if let Some((handle, view)) = &self.today
            && cx
                .update(|cx| {
                    handle.update(cx, |_, window, cx| {
                        window.activate_window();
                        let _ = view.update(cx, |v, cx| v.navigate(target, window, cx));
                    })
                })
                .is_ok()
        {
            return;
        }
        if !attach_graphics(cx).await {
            return;
        }
        self.today = cx.update(|cx| match MainWindow::open(cx, client.clone()) {
            Ok((handle, view)) => {
                if target.is_some() {
                    let _ = handle.update(cx, |_, win, cx| {
                        view.update(cx, |v, cx| v.navigate(target, win, cx))
                    });
                }
                Some((handle, view))
            }
            Err(error) => {
                eprintln!("open Today: {error:#}");

                None
            }
        });
    }

    pub(super) fn pause_changed(&self, cx: &mut App) {
        if let Some((handle, view)) = &self.today {
            let _ = handle.update(cx, |_, window, cx| {
                if window.is_window_active() {
                    let _ = view.update(cx, |today, cx| today.refresh(cx));
                }
            });
        }
        self.recording_changed(cx);
    }

    pub(super) fn recording_changed(&self, cx: &mut App) {
        if let Some((_, view)) = &self.mini {
            let _ = view.update(cx, |mini, cx| mini.recording_changed(cx));
        }
    }
}

pub(super) fn handle_close(window: &gpui_kit::Window, cx: &App) {
    // GPUI revokes its OLE drop target during teardown. Let it do so before Win32 destroys the HWND.
    window.on_window_should_close(cx, |window, _| {
        window.remove_window();
        false
    });
}

async fn attach_graphics(cx: &AsyncApp) -> bool {
    let attach = cx.update(|cx| {
        cx.graphical_environment().is_none().then(|| {
            cx.request_windowing(WindowingRequest::Windowed(GraphicalEnvironment::detect()))
        })
    });
    if let Some(task) = attach
        && let Err(error) = task.await
    {
        eprintln!("attach graphics: {error:#}");
        return false;
    }
    true
}
