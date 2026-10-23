//! A preallocated, process-lifetime exception record. The parent formats it only
//! after the owned child has exited; the faulting thread never writes JSON/files.
use super::super::handles::OwnedHandle;
use serde::{Deserialize, Serialize};
use std::cell::UnsafeCell;
use std::sync::atomic::{AtomicPtr, AtomicU32, AtomicU64, Ordering};
use windows::core::PCWSTR;
use windows::Win32::{
    Foundation::INVALID_HANDLE_VALUE,
    System::{
        Diagnostics::Debug::{
            SetErrorMode, SetUnhandledExceptionFilter, EXCEPTION_CONTINUE_SEARCH,
            EXCEPTION_POINTERS, SEM_NOGPFAULTERRORBOX,
        },
        Memory::{
            CreateFileMappingW, MapViewOfFile, OpenFileMappingW, UnmapViewOfFile, VirtualQuery,
            FILE_MAP_ALL_ACCESS, MEMORY_BASIC_INFORMATION, MEMORY_MAPPED_VIEW_ADDRESS, MEM_IMAGE,
            PAGE_READWRITE,
        },
        ProcessStatus::K32GetMappedFileNameW,
        Threading::{GetCurrentProcess, GetCurrentProcessId, GetCurrentThreadId},
    },
};

pub(super) const ENVIRONMENT: &str = "PATINA_NATIVE_FAULT_SLOT";
static ACTIVE: AtomicPtr<Slot> = AtomicPtr::new(std::ptr::null_mut());
#[cfg(debug_assertions)]
static STALL_AFTER_RECORD: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct NativeProbeFault {
    pub process_id: u32,
    pub thread_id: u32,
    pub code: u32,
    pub flags: u32,
    pub request_id: String,
    pub phase: String,
    pub exception_address: String,
    pub instruction_pointer: String,
    pub stack_pointer: String,
    pub parameters: Vec<String>,
    pub image_base: Option<String>,
    pub image_path: Option<String>,
    pub image_path_truncated: bool,
}

#[repr(C)]
struct Record {
    pid: u32,
    tid: u32,
    code: u32,
    flags: u32,
    request: u64,
    phase: u32,
    parameter_count: u32,
    address: u64,
    pc: u64,
    sp: u64,
    parameters: [u64; 15],
    image_base: u64,
    image_len: u32,
    image: [u16; 260],
}

#[repr(C)]
struct Slot {
    state: AtomicU32,
    phase: AtomicU32,
    request: AtomicU64,
    record: UnsafeCell<Record>,
}

pub(super) struct FaultSlot {
    name: String,
    _mapping: OwnedHandle,
    view: MEMORY_MAPPED_VIEW_ADDRESS,
}

// Ownership moves with ProbeProcess. The only concurrent writer is the child;
// published record bytes are read after its retained process handle signals exit.
unsafe impl Send for FaultSlot {}

impl FaultSlot {
    pub(super) fn create() -> Result<Self, String> {
        let name = format!("Local\\Patina.probe-fault.{}", uuid::Uuid::new_v4());
        let wide = name.encode_utf16().chain(Some(0)).collect::<Vec<_>>();
        let handle = unsafe {
            CreateFileMappingW(
                INVALID_HANDLE_VALUE,
                None,
                PAGE_READWRITE,
                0,
                std::mem::size_of::<Slot>() as u32,
                PCWSTR(wide.as_ptr()),
            )
        }
        .map_err(|_| "probe fault mapping creation failed")?;
        Self::map(
            name,
            OwnedHandle::new(handle).ok_or("probe fault mapping invalid")?,
        )
    }

    fn map(name: String, mapping: OwnedHandle) -> Result<Self, String> {
        let view = unsafe {
            MapViewOfFile(
                mapping.raw(),
                FILE_MAP_ALL_ACCESS,
                0,
                0,
                std::mem::size_of::<Slot>(),
            )
        };
        if view.Value.is_null() {
            return Err("probe fault mapping unavailable".into());
        }
        Ok(Self {
            name,
            _mapping: mapping,
            view,
        })
    }

    pub(super) fn name(&self) -> &str {
        &self.name
    }

    pub(super) fn install() -> Result<(), String> {
        let name = std::env::var(ENVIRONMENT).map_err(|_| "probe fault mapping missing")?;
        let wide = name.encode_utf16().chain(Some(0)).collect::<Vec<_>>();
        let handle =
            unsafe { OpenFileMappingW(FILE_MAP_ALL_ACCESS.0, false, PCWSTR(wide.as_ptr())) }
                .map_err(|_| "probe fault mapping open failed")?;
        let slot = Self::map(
            name,
            OwnedHandle::new(handle).ok_or("probe fault mapping invalid")?,
        )?;
        ACTIVE.store(slot.view.Value.cast(), Ordering::Release);
        unsafe {
            // Process-local only. Do not block an isolated helper on an error UI.
            let previous = SetErrorMode(SEM_NOGPFAULTERRORBOX);
            SetErrorMode(previous | SEM_NOGPFAULTERRORBOX);
            SetUnhandledExceptionFilter(Some(record_exception));
        }
        // The filter can run on any native thread through ExitProcess. Keep
        // exactly one mapping until the OS tears down this helper; unmapping it
        // on the pipe thread could race a fault on a Shell/COM worker thread.
        std::mem::forget(slot);
        Ok(())
    }

    pub(super) fn read_after_exit(&self, pid: u32) -> Option<NativeProbeFault> {
        let slot = unsafe { &*self.view.Value.cast::<Slot>() };
        if slot.state.load(Ordering::Acquire) != 2 {
            return None;
        }
        let record = unsafe { &*slot.record.get() };
        if record.pid != pid {
            return None;
        }
        let hex = |value: u64| format!("0x{value:x}");
        let image_len = (record.image_len as usize).min(record.image.len());
        Some(NativeProbeFault {
            process_id: pid,
            thread_id: record.tid,
            code: record.code,
            flags: record.flags,
            request_id: record.request.to_string(),
            phase: match record.phase {
                1 => "waiting-for-request",
                2 => "executing-request",
                3 => "writing-response",
                _ => "initializing",
            }
            .into(),
            exception_address: hex(record.address),
            instruction_pointer: hex(record.pc),
            stack_pointer: hex(record.sp),
            parameters: record
                .parameters
                .iter()
                .take((record.parameter_count as usize).min(15))
                .map(|value| hex(*value))
                .collect(),
            image_base: (record.image_base != 0).then(|| hex(record.image_base)),
            image_path: (image_len != 0).then(|| {
                String::from_utf16_lossy(&record.image[..image_len])
                    .trim_end_matches('\0')
                    .to_owned()
            }),
            image_path_truncated: image_len == record.image.len(),
        })
    }
}

impl Drop for FaultSlot {
    fn drop(&mut self) {
        unsafe {
            let _ = UnmapViewOfFile(self.view);
        }
    }
}

pub(super) fn phase(request: u64, phase: u32) {
    let pointer = ACTIVE.load(Ordering::Acquire);
    if !pointer.is_null() {
        let slot = unsafe { &*pointer };
        slot.request.store(request, Ordering::Relaxed);
        slot.phase.store(phase, Ordering::Release);
    }
}

unsafe extern "system" fn record_exception(pointers: *const EXCEPTION_POINTERS) -> i32 {
    let pointer = ACTIVE.load(Ordering::Acquire);
    if pointer.is_null() || pointers.is_null() {
        return EXCEPTION_CONTINUE_SEARCH;
    }
    let slot = unsafe { &*pointer };
    if slot
        .state
        .compare_exchange(0, 1, Ordering::AcqRel, Ordering::Relaxed)
        .is_err()
    {
        return EXCEPTION_CONTINUE_SEARCH;
    }
    let pointers = unsafe { &*pointers };
    if pointers.ExceptionRecord.is_null() || pointers.ContextRecord.is_null() {
        return EXCEPTION_CONTINUE_SEARCH;
    }
    let exception = unsafe { &*pointers.ExceptionRecord };
    let context = unsafe { &*pointers.ContextRecord };
    let record = unsafe { &mut *slot.record.get() };
    record.pid = unsafe { GetCurrentProcessId() };
    record.tid = unsafe { GetCurrentThreadId() };
    record.code = exception.ExceptionCode.0 as u32;
    record.flags = exception.ExceptionFlags;
    record.request = slot.request.load(Ordering::Acquire);
    record.phase = slot.phase.load(Ordering::Acquire);
    record.address = exception.ExceptionAddress as u64;
    record.parameter_count = exception.NumberParameters.min(15);
    for index in 0..record.parameter_count as usize {
        record.parameters[index] = exception.ExceptionInformation[index] as u64;
    }
    #[cfg(target_arch = "x86_64")]
    {
        record.pc = context.Rip;
        record.sp = context.Rsp;
    }
    #[cfg(target_arch = "aarch64")]
    {
        record.pc = context.Pc;
        record.sp = context.Sp;
    }
    // Publish essential facts before optional image queries. A secondary fault
    // or stalled OS query must not erase the original exception record.
    slot.state.store(2, Ordering::Release);
    let mut memory = MEMORY_BASIC_INFORMATION::default();
    if unsafe {
        VirtualQuery(
            Some(exception.ExceptionAddress),
            &mut memory,
            std::mem::size_of_val(&memory),
        )
    } != 0
        && memory.Type == MEM_IMAGE
    {
        record.image_base = memory.AllocationBase as u64;
    }
    record.image_len = unsafe {
        K32GetMappedFileNameW(
            GetCurrentProcess(),
            exception.ExceptionAddress,
            &mut record.image,
        )
    };
    #[cfg(debug_assertions)]
    while STALL_AFTER_RECORD.load(Ordering::Relaxed) {
        std::hint::spin_loop();
    }
    // Never consume the exception, pretend recovery, or change the exit status.
    EXCEPTION_CONTINUE_SEARCH
}

#[cfg(debug_assertions)]
pub(super) fn stall_after_exception_record() {
    STALL_AFTER_RECORD.store(true, Ordering::Relaxed);
}

#[cfg(debug_assertions)]
pub(super) fn access_violation() -> ! {
    use windows::core::{s, w};
    use windows::Win32::System::{
        LibraryLoader::{GetModuleHandleW, GetProcAddress},
        Memory::{VirtualAlloc, MEM_COMMIT, MEM_RESERVE, PAGE_NOACCESS},
    };
    // Invoke a native routine on an owned inaccessible page. This exercises a
    // real SEH access violation without Rust dereferencing an invalid pointer.
    let page = unsafe { VirtualAlloc(None, 4096, MEM_COMMIT | MEM_RESERVE, PAGE_NOACCESS) };
    assert!(!page.is_null());
    let copy = unsafe {
        GetProcAddress(GetModuleHandleW(w!("ntdll.dll")).unwrap(), s!("memcpy")).unwrap()
    };
    let copy: unsafe extern "C" fn(*mut u8, *const u8, usize) -> *mut u8 =
        unsafe { std::mem::transmute(copy) };
    let mut target = [0u8; 8];
    unsafe {
        copy(target.as_mut_ptr(), page.cast(), target.len());
    }
    panic!("native access violation unexpectedly returned");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fault_record_requires_complete_publication_and_matching_process() {
        let mapping = FaultSlot::create().unwrap();
        assert!(std::mem::size_of::<Slot>() <= 1024);
        let slot = unsafe { &*mapping.view.Value.cast::<Slot>() };
        let record = unsafe { &mut *slot.record.get() };
        record.pid = 42;
        record.parameter_count = u32::MAX;
        record.parameters = [u64::MAX; 15];
        record.image_len = u32::MAX;
        record.image = ['测' as u16; 260];
        assert!(mapping.read_after_exit(42).is_none());
        slot.state.store(1, Ordering::Release);
        assert!(mapping.read_after_exit(42).is_none());
        slot.state.store(2, Ordering::Release);
        assert!(mapping.read_after_exit(43).is_none());
        let fault = mapping.read_after_exit(42).unwrap();
        assert_eq!(fault.parameters.len(), 15);
        assert!(fault.image_path_truncated);
        assert!(serde_json::to_vec(&fault).unwrap().len() < 2000);
    }
}
