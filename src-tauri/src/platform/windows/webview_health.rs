use tauri::{Runtime, WebviewWindow};
use webview2_com::{Microsoft::Web::WebView2::Win32::*, ProcessFailedEventHandler};

#[derive(Clone, Copy, Debug, serde::Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum FailureKind {
    BrowserExited,
    RendererExited,
    Unresponsive,
    Recoverable,
}

pub(crate) enum Signal {
    Subscribed,
    EngineVersion(String),
    AvailableVersion(String),
    BrowserProcess(u32),
    Responsive,
    Failed(FailureKind),
    SubscriptionFailed,
}

pub(crate) fn observe<R: Runtime>(
    window: &WebviewWindow<R>,
    notify: impl Fn(Signal) + Send + Sync + 'static,
) -> tauri::Result<()> {
    window.with_webview(move |platform| unsafe {
        let environment = platform.environment();
        let mut version = Default::default();
        if environment.BrowserVersionString(&mut version).is_ok() {
            notify(Signal::EngineVersion(webview2_com::take_pwstr(version)));
        }
        let mut available = Default::default();
        if GetAvailableCoreWebView2BrowserVersionString(None, &mut available).is_ok() {
            notify(Signal::AvailableVersion(webview2_com::take_pwstr(
                available,
            )));
        }
        let Ok(webview) = platform.controller().CoreWebView2() else {
            notify(Signal::SubscriptionFailed);
            return;
        };
        let mut process_id = 0;
        if webview.BrowserProcessId(&mut process_id).is_ok() && process_id != 0 {
            notify(Signal::BrowserProcess(process_id));
        }
        // The handler owns only a bounded sender. COM objects, windows and the
        // application manager are not captured in their own event handler.
        let notify = std::sync::Arc::new(notify);
        let handler_notify = notify.clone();
        let handler = ProcessFailedEventHandler::create(Box::new(move |_, args| {
            if let Some(args) = args {
                let mut kind = COREWEBVIEW2_PROCESS_FAILED_KIND::default();
                args.ProcessFailedKind(&mut kind)?;
                handler_notify(Signal::Failed(classify(kind)));
            }
            Ok(())
        }));
        let mut token = 0;
        if webview.add_ProcessFailed(&handler, &mut token).is_err() {
            notify(Signal::SubscriptionFailed);
        } else {
            notify(Signal::Subscribed);
        }
        // ProcessFailed is scoped to this WebView. Closing its controller
        // releases the handler; no environment-wide listener survives a window.
    })
}

fn classify(kind: COREWEBVIEW2_PROCESS_FAILED_KIND) -> FailureKind {
    match kind {
        COREWEBVIEW2_PROCESS_FAILED_KIND_BROWSER_PROCESS_EXITED => FailureKind::BrowserExited,
        COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_EXITED => FailureKind::RendererExited,
        COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_UNRESPONSIVE => FailureKind::Unresponsive,
        _ => FailureKind::Recoverable,
    }
}
