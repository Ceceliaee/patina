use std::{ffi::c_void, ptr};
use windows::Win32::System::{
    LibraryLoader::{LOAD_LIBRARY_SEARCH_SYSTEM32, LoadLibraryExA},
    WindowsProgramming::DELAYLOAD_INFO,
};

// MSVC delayimp calls this hook before its default LoadLibraryEx call.
#[used]
#[unsafe(no_mangle)]
static __pfnDliNotifyHook2: unsafe extern "system" fn(u32, *const DELAYLOAD_INFO) -> *mut c_void =
    load_system_dll;

unsafe extern "system" fn load_system_dll(reason: u32, info: *const DELAYLOAD_INFO) -> *mut c_void {
    const BEFORE_LOAD_LIBRARY: u32 = 1;
    if reason != BEFORE_LOAD_LIBRARY {
        return ptr::null_mut();
    }
    // The import name comes from the executable's delay-import table. A null
    // result would let delayimp retry the same file using the default search path.
    let name = unsafe { (*info).TargetDllName };
    match unsafe { LoadLibraryExA(name, None, LOAD_LIBRARY_SEARCH_SYSTEM32) } {
        Ok(module) => module.0,
        Err(_) => std::process::abort(),
    }
}
