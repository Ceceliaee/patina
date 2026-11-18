pub fn enable_monitor_dpi() -> windows::core::Result<()> {
    use windows::Win32::UI::HiDpi::{
        AreDpiAwarenessContextsEqual, GetThreadDpiAwarenessContext, SetProcessDpiAwarenessContext,
        DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2,
    };
    unsafe {
        let context = DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2;
        if !AreDpiAwarenessContextsEqual(GetThreadDpiAwarenessContext(), context).as_bool() {
            // Windows can pin the process to its user-selected compatibility DPI.
            if let Err(e) = SetProcessDpiAwarenessContext(context) {
                if e.code() != windows::Win32::Foundation::E_ACCESSDENIED {
                    return Err(e);
                }
            }
        }
    }
    Ok(())
}
