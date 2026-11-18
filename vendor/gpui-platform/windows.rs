use std::rc::Rc;

pub use gpui::Platform;

#[cfg(not(windows))]
compile_error!("The Patina desktop platform builds for Windows only.");

pub fn current_platform(headless: bool) -> Rc<dyn Platform> {
    Rc::new(gpui_windows::WindowsPlatform::new(headless).expect("failed to initialize Windows platform"))
}

pub fn background_executor() -> gpui::BackgroundExecutor {
    current_platform(true).background_executor()
}

pub fn application() -> gpui::Application {
    gpui::Application::with_platform(current_platform(false))
}

pub fn headless() -> gpui::Application {
    gpui::Application::with_platform(current_platform(true))
}

#[cfg(feature = "bench-support")]
pub fn bench_text_system() -> std::sync::Arc<dyn gpui::PlatformTextSystem> {
    thread_local! {
        static TEXT_SYSTEM: std::sync::Arc<dyn gpui::PlatformTextSystem> =
            current_platform(true).text_system();
    }
    TEXT_SYSTEM.with(Clone::clone)
}

#[cfg(any(feature = "bench-support", feature = "test-support"))]
pub fn current_headless_renderer() -> anyhow::Result<Option<Box<dyn gpui::PlatformHeadlessRenderer>>> {
    Ok(None)
}
