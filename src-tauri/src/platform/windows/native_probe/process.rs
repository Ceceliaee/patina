use super::protocol::{self, ProbeKind, Request, Response};
use std::os::windows::{
    io::{AsRawHandle, FromRawHandle, OwnedHandle},
    process::CommandExt,
};
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::Arc;
mod exit;
pub(super) use exit::ExitObserver;
use std::sync::mpsc::{self, Receiver, SyncSender};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};
use windows::Win32::{
    Foundation::HANDLE,
    System::{
        JobObjects::{
            AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
            SetInformationJobObject, TerminateJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
            JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
        },
        Threading::{TerminateProcess, CREATE_NO_WINDOW},
    },
};

struct Exchange {
    request: Request,
    reply: SyncSender<Result<Response, String>>,
}

pub(super) struct ProbeProcess {
    kind: ProbeKind,
    observer: Arc<ExitObserver>,
    job: OwnedHandle,
    io_thread: Option<JoinHandle<()>>,
    startup_error: Option<&'static str>,
}

impl ProbeProcess {
    pub(super) fn start(executable: &Path, kind: ProbeKind) -> Result<Self, String> {
        let mut process = Self::spawn_owned(executable, kind)?;
        // Even partial initialization stays owned by the lane. Its ordinary
        // bounded stop path must confirm exit before a replacement is allowed.
        process.startup_error = process.initialize().err();
        if process.startup_error.is_some() {
            let observer = Arc::get_mut(&mut process.observer).unwrap();
            observer.child.stdin.take();
            observer.child.stdout.take();
        }
        process.observer.register();
        Ok(process)
    }

    fn spawn_owned(executable: &Path, kind: ProbeKind) -> Result<Self, String> {
        let job = create_job()?;
        let fault = super::fault::FaultSlot::create()?;
        let child = Command::new(executable)
            .args([super::worker::ARGUMENT, kind.argument()])
            .env(super::fault::ENVIRONMENT, fault.name())
            .creation_flags(CREATE_NO_WINDOW.0)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|_| "probe process start failed".to_owned())?;
        let process = Self {
            kind,
            observer: Arc::new(ExitObserver::new(child, kind, fault)),
            job,
            io_thread: None,
            startup_error: None,
        };
        Ok(process)
    }

    fn initialize(&mut self) -> Result<(), &'static str> {
        let observer =
            Arc::get_mut(&mut self.observer).ok_or("probe observer already published")?;
        unsafe {
            AssignProcessToJobObject(
                HANDLE(self.job.as_raw_handle()),
                HANDLE(observer.child.as_raw_handle()),
            )
        }
        .map_err(|_| "probe Job assignment failed")?;
        let mut input = observer
            .child
            .stdin
            .take()
            .ok_or("probe stdin unavailable")?;
        let mut output = observer
            .child
            .stdout
            .take()
            .ok_or("probe stdout unavailable")?;
        let (requests, receiver) = mpsc::sync_channel::<Exchange>(1);
        let io_thread = std::thread::Builder::new()
            .name(format!("patina-probe-{}", self.kind.argument()))
            .spawn(move || {
                while let Ok(exchange) = receiver.recv() {
                    let result = protocol::write_frame(
                        &mut input,
                        &exchange.request,
                        protocol::REQUEST_LIMIT,
                    )
                    .and_then(|_| protocol::read_frame(&mut output, protocol::RESPONSE_LIMIT));
                    let failed = result.is_err();
                    let _ = exchange.reply.send(result);
                    if failed {
                        break;
                    }
                }
            })
            .map_err(|_| "probe IO thread start failed")?;
        *observer
            .requests
            .get_mut()
            .unwrap_or_else(|error| error.into_inner()) = Some(requests);
        self.io_thread = Some(io_thread);
        Ok(())
    }

    pub(super) fn request(
        &self,
        request: Request,
    ) -> Result<Receiver<Result<Response, String>>, String> {
        if let Some(error) = self.startup_error {
            return Err(error.into());
        }
        let (reply, receiver) = mpsc::sync_channel(1);
        self.observer
            .requests
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .as_ref()
            .ok_or("probe is stopping")?
            .try_send(Exchange { request, reply })
            .map_err(|_| "probe pipe busy or closed".to_owned())?;
        Ok(receiver)
    }

    pub(super) fn id(&self) -> u32 {
        self.observer.child.id()
    }

    pub(super) fn observe_exit(&mut self) -> Result<bool, String> {
        self.observer.observe()
    }

    pub(super) fn finish(&mut self, budget: Duration) -> bool {
        let started = Instant::now();
        self.observer.close_requests();
        loop {
            if matches!(self.observe_exit(), Ok(true))
                && self.io_thread.as_ref().is_none_or(JoinHandle::is_finished)
            {
                if let Some(thread) = self.io_thread.take() {
                    let _ = thread.join();
                }
                self.observer
                    .record_cleanup(started.elapsed().as_millis() as u64);
                return self.observer.normal_exit();
            }
            if started.elapsed() >= budget {
                return false;
            }
            std::thread::sleep(Duration::from_millis(1));
        }
    }

    pub(super) fn stop(&mut self, budget: Duration) -> bool {
        let started = Instant::now();
        let deadline = started + budget;
        let already_exited = matches!(self.observe_exit(), Ok(true));
        if !already_exited {
            self.observer.request_termination();
        }
        self.observer.close_requests();
        if !already_exited {
            unsafe {
                let _ = TerminateJobObject(HANDLE(self.job.as_raw_handle()), 1);
            }
            unsafe {
                let _ = TerminateProcess(HANDLE(self.observer.child.as_raw_handle()), 1);
            }
        }
        loop {
            let child_exited = matches!(self.observe_exit(), Ok(true));
            let io_exited = self.io_thread.as_ref().is_none_or(JoinHandle::is_finished);
            if child_exited && io_exited {
                if let Some(thread) = self.io_thread.take() {
                    let _ = thread.join();
                }
                self.observer
                    .record_cleanup(started.elapsed().as_millis() as u64);
                return true;
            }
            if Instant::now() >= deadline {
                return false;
            }
            std::thread::sleep(Duration::from_millis(5));
        }
    }
}

#[cfg(debug_assertions)]
thread_local! {
    static OBSERVATION_GATE: std::cell::RefCell<Option<(SyncSender<()>, Receiver<()>)>> = const { std::cell::RefCell::new(None) };
}

#[cfg(debug_assertions)]
pub(super) fn gate_next_observation(entered: SyncSender<()>, resume: Receiver<()>) {
    OBSERVATION_GATE.with(|gate| *gate.borrow_mut() = Some((entered, resume)));
}

#[cfg(debug_assertions)]
fn pause_observation_for_test() {
    OBSERVATION_GATE.with(|gate| {
        if let Some((entered, resume)) = gate.borrow_mut().take() {
            entered.send(()).unwrap();
            resume.recv_timeout(Duration::from_secs(10)).unwrap();
        }
    });
}

#[cfg(debug_assertions)]
pub(super) fn verify_partial_startup(executable: &Path) -> Result<(), String> {
    for invalid_job in [true, false] {
        let mut process = ProbeProcess::spawn_owned(executable, ProbeKind::Name)?;
        if invalid_job {
            // A real owned file handle is invalid for AssignProcessToJobObject.
            // This exercises the fallback without fabricating or double-closing a HANDLE.
            process.job = std::fs::File::open(executable)
                .map_err(|error| error.to_string())?
                .into();
        } else {
            drop(
                Arc::get_mut(&mut process.observer)
                    .unwrap()
                    .child
                    .stdout
                    .take(),
            );
        }
        process.startup_error = process.initialize().err();
        assert_eq!(
            process.startup_error,
            Some(if invalid_job {
                "probe Job assignment failed"
            } else {
                "probe stdout unavailable"
            })
        );
        assert!(process
            .request(Request {
                version: protocol::VERSION,
                id: 1,
                body: protocol::RequestBody::Test(protocol::TestAction::Echo(1)),
            })
            .is_err());
        assert!(
            process.stop(super::CLEANUP_BUDGET),
            "partial startup left a process or IO thread"
        );
    }
    Ok(())
}

impl Drop for ProbeProcess {
    fn drop(&mut self) {
        self.observer.close_requests();
        unsafe {
            let _ = TerminateJobObject(HANDLE(self.job.as_raw_handle()), 1);
        }
        unsafe {
            let _ = TerminateProcess(HANDLE(self.observer.child.as_raw_handle()), 1);
        }
        self.observer.unregister();
        // Job ownership closes even if the OS could not confirm termination.
        // The lane retains an unconfirmed process instead of spawning another.
    }
}

fn create_job() -> Result<OwnedHandle, String> {
    let handle =
        unsafe { CreateJobObjectW(None, None) }.map_err(|_| "probe Job creation failed")?;
    let job = unsafe { OwnedHandle::from_raw_handle(handle.0) };
    let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
    limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    unsafe {
        SetInformationJobObject(
            handle,
            JobObjectExtendedLimitInformation,
            (&limits as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(),
            std::mem::size_of_val(&limits) as u32,
        )
    }
    .map_err(|_| "probe Job configuration failed")?;
    Ok(job)
}
