use super::{Exchange, ProbeKind};
use std::os::windows::io::AsRawHandle;
use std::process::Child;
use std::sync::{mpsc::SyncSender, Arc, Mutex};
use windows::Win32::{
    Foundation::{FILETIME, HANDLE, WAIT_OBJECT_0, WAIT_TIMEOUT},
    System::Threading::{GetExitCodeProcess, GetProcessTimes, WaitForSingleObject},
};

#[derive(Default)]
struct ExitState {
    exit: Option<super::super::NativeProbeExit>,
    published: bool,
    termination_requested: bool,
}

// The retained Child handle identifies one generation even after its PID is reused.
// Only startup mutates Child; observation never owns request admission or joins IO.
pub(in super::super) struct ExitObserver {
    pub(super) child: Child,
    kind: ProbeKind,
    fault: Mutex<super::super::fault::FaultSlot>,
    pub(super) requests: Mutex<Option<SyncSender<Exchange>>>,
    state: Mutex<ExitState>,
}

impl ExitObserver {
    pub(super) fn new(
        child: Child,
        kind: ProbeKind,
        fault: super::super::fault::FaultSlot,
    ) -> Self {
        Self {
            child,
            kind,
            fault: Mutex::new(fault),
            requests: Mutex::new(None),
            state: Mutex::new(ExitState::default()),
        }
    }

    pub(super) fn register(self: &Arc<Self>) {
        let stats = &super::super::counters()[self.kind as usize];
        let mut current = stats
            .observer
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        *current = Some(self.clone());
        stats
            .process_id
            .store(self.child.id(), super::super::Ordering::Relaxed);
    }

    pub(in super::super) fn observe(&self) -> Result<bool, String> {
        #[cfg(debug_assertions)]
        super::pause_observation_for_test();
        let handle = HANDLE(self.child.as_raw_handle());
        match unsafe { WaitForSingleObject(handle, 0) } {
            WAIT_TIMEOUT => return Ok(false),
            WAIT_OBJECT_0 => {}
            _ => return Err("probe exit query failed".into()),
        }
        let mut state = self.state.lock().unwrap_or_else(|error| error.into_inner());
        if state.exit.is_none() {
            let mut code = 0;
            unsafe { GetExitCodeProcess(handle, &mut code) }
                .map_err(|_| "probe exit query failed")?;
            let (mut created, mut exited, mut kernel, mut user): (
                FILETIME,
                FILETIME,
                FILETIME,
                FILETIME,
            ) = Default::default();
            let times = unsafe {
                GetProcessTimes(handle, &mut created, &mut exited, &mut kernel, &mut user)
            }
            .is_ok();
            let filetime = |value: FILETIME| {
                ((u64::from(value.dwHighDateTime) << 32) | u64::from(value.dwLowDateTime))
                    .to_string()
            };
            state.exit = Some(super::super::NativeProbeExit {
                process_id: self.child.id(),
                code,
                observed_at_ms: crate::platform::clock::unix_timestamp_millis_u64(),
                created_filetime: times.then(|| filetime(created)),
                exited_filetime: times.then(|| filetime(exited)),
                termination_requested: state.termination_requested,
                cleanup_elapsed_ms: None,
                fault: self
                    .fault
                    .lock()
                    .unwrap_or_else(|error| error.into_inner())
                    .read_after_exit(self.child.id()),
            });
            // Drop the sole sender so an idle IO owner can release its pipes.
            self.close_requests();
        }
        self.publish(&mut state, false);
        Ok(true)
    }

    fn publish(&self, state: &mut ExitState, wait: bool) {
        let stats = &super::super::counters()[self.kind as usize];
        let current = if wait {
            stats.observer.lock().ok()
        } else {
            stats.observer.try_lock().ok()
        };
        let Some(current) = current else { return };
        if !current
            .as_ref()
            .is_some_and(|current| std::ptr::eq(current.as_ref(), self))
        {
            return;
        }
        stats.process_id.store(0, super::super::Ordering::Relaxed);
        stats
            .last_response_at
            .store(0, super::super::Ordering::Release);
        let last = if wait {
            stats.last_exit.lock().ok()
        } else {
            stats.last_exit.try_lock().ok()
        };
        let Some(mut last) = last else { return };
        let abnormal = if wait {
            stats.last_abnormal_exit.lock().ok()
        } else {
            stats.last_abnormal_exit.try_lock().ok()
        };
        let Some(mut abnormal) = abnormal else { return };
        if !state.published {
            *last = state.exit.clone();
            if state
                .exit
                .as_ref()
                .is_some_and(super::super::NativeProbeExit::is_abnormal)
            {
                *abnormal = state.exit.clone();
            }
            stats.exits.fetch_add(1, super::super::Ordering::Relaxed);
            state.published = true;
        }
        for target in [&mut *last, &mut *abnormal] {
            if let Some(target) = target.as_mut().filter(|exit| {
                state.exit.as_ref().is_some_and(|fact| {
                    exit.process_id == fact.process_id
                        && exit.created_filetime == fact.created_filetime
                })
            }) {
                target.cleanup_elapsed_ms =
                    state.exit.as_ref().and_then(|exit| exit.cleanup_elapsed_ms);
            }
        }
    }

    pub(super) fn request_termination(&self) {
        let mut state = self.state.lock().unwrap_or_else(|error| error.into_inner());
        if state.exit.is_none() {
            state.termination_requested = true;
        }
    }

    pub(super) fn close_requests(&self) {
        self.requests
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .take();
    }

    pub(super) fn normal_exit(&self) -> bool {
        self.state
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .exit
            .as_ref()
            .is_some_and(|exit| exit.code == 0 && !exit.is_abnormal())
    }

    pub(super) fn record_cleanup(&self, elapsed_ms: u64) {
        let mut state = self.state.lock().unwrap_or_else(|error| error.into_inner());
        if let Some(exit) = &mut state.exit {
            exit.cleanup_elapsed_ms = Some(elapsed_ms);
        }
        self.publish(&mut state, true);
    }

    pub(super) fn unregister(&self) {
        let stats = &super::super::counters()[self.kind as usize];
        let mut current = stats
            .observer
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        if current
            .as_ref()
            .is_some_and(|current| std::ptr::eq(current.as_ref(), self))
        {
            current.take();
        }
    }
}
