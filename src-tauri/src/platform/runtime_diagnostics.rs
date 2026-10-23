use serde_json::Value;
use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Seek, SeekFrom, Write},
    path::PathBuf,
    sync::{
        atomic::{AtomicU64, Ordering},
        mpsc::{self, SyncSender},
        Arc, Mutex,
    },
    thread::JoinHandle,
    time::{Duration, Instant},
};

const LOG_LIMIT: u64 = 2 * 1024 * 1024;
const LOG_FILES: usize = 5;
const FRAME_LIMIT: usize = 32 * 1024;

pub(crate) fn enabled_for_process() -> bool {
    diagnostics_enabled(
        cfg!(debug_assertions),
        std::env::var("PATINA_E2E").ok().as_deref(),
        std::env::var("PATINA_E2E_DISABLE_DIAGNOSTICS")
            .ok()
            .as_deref(),
    )
}

fn diagnostics_enabled(debug: bool, isolated: Option<&str>, disabled: Option<&str>) -> bool {
    // Whole-application comparisons may omit the observer only in the isolated
    // debug profile. Release and ordinary development runs retain diagnostics.
    !(debug && isolated == Some("1") && disabled == Some("1"))
}

pub(crate) struct RuntimeDiagnostics {
    stop: SyncSender<()>,
    observer: Mutex<Option<JoinHandle<()>>>,
    writer: Mutex<Option<JoinHandle<()>>>,
    counters: Arc<OutputCounters>,
}

#[derive(Default)]
struct OutputCounters {
    dropped: AtomicU64,
    write_failed: AtomicU64,
}

impl RuntimeDiagnostics {
    pub(crate) fn start(
        directory: PathBuf,
        snapshot: impl Fn() -> (bool, Value) + Send + 'static,
    ) -> std::io::Result<Self> {
        Self::start_with_writer(
            snapshot,
            move |frame| append_rotating(&directory, frame),
            Duration::from_secs(1),
        )
    }

    fn start_with_writer(
        snapshot: impl Fn() -> (bool, Value) + Send + 'static,
        mut write_frame: impl FnMut(&[u8]) -> std::io::Result<()> + Send + 'static,
        interval: Duration,
    ) -> std::io::Result<Self> {
        let (frames, receiver) = mpsc::sync_channel::<Vec<u8>>(16);
        let counters = Arc::new(OutputCounters::default());
        let writer_counters = counters.clone();
        let writer = std::thread::Builder::new()
            .name("patina-diagnostic-writer".into())
            .spawn(move || {
                while let Ok(frame) = receiver.recv() {
                    // Diagnostic I/O never shares the observer or tracker thread.
                    if write_frame(&frame).is_err() {
                        writer_counters.write_failed.fetch_add(1, Ordering::Relaxed);
                    }
                }
            })?;
        let (stop, stopped) = mpsc::sync_channel(1);
        let observer_counters = counters.clone();
        let run_id = uuid::Uuid::new_v4().to_string();
        let observer = std::thread::Builder::new()
            .name("patina-runtime-observer".into())
            .spawn(move || {
                let mut last_stalled = false;
                let mut last_written = Instant::now();
                let mut first = true;
                loop {
                    let (stalled, value) = snapshot();
                    if first
                        || stalled != last_stalled
                        || last_written.elapsed() >= Duration::from_secs(60)
                    {
                        let envelope = serde_json::json!({
                            "run_id": run_id, "app_version": env!("CARGO_PKG_VERSION"),
                            "output_dropped": observer_counters.dropped.load(Ordering::Relaxed),
                            "output_write_failed": observer_counters.write_failed.load(Ordering::Relaxed),
                            "snapshot": value,
                        });
                        if let Ok(mut frame) = serde_json::to_vec(&envelope) {
                            if frame.len() < FRAME_LIMIT {
                                frame.push(b'\n');
                                if frames.try_send(frame).is_err() {
                                    observer_counters.dropped.fetch_add(1, Ordering::Relaxed);
                                }
                            } else {
                                observer_counters.dropped.fetch_add(1, Ordering::Relaxed);
                            }
                        } else {
                            observer_counters.dropped.fetch_add(1, Ordering::Relaxed);
                        }
                        first = false;
                        last_stalled = stalled;
                        last_written = Instant::now();
                    }
                    match stopped.recv_timeout(interval) {
                        Err(mpsc::RecvTimeoutError::Timeout) => (),
                        _ => break,
                    }
                }
            })?;
        Ok(Self {
            stop,
            observer: Mutex::new(Some(observer)),
            writer: Mutex::new(Some(writer)),
            counters,
        })
    }

    pub(crate) fn output_counts(&self) -> (u64, u64) {
        (
            self.counters.dropped.load(Ordering::Relaxed),
            self.counters.write_failed.load(Ordering::Relaxed),
        )
    }

    pub(crate) fn stop(&self) {
        let _ = self.stop.try_send(());
        if let Ok(mut thread) = self.observer.lock() {
            if let Some(thread) = thread.take() {
                let _ = thread.join();
            }
        }
        // A stalled filesystem must not block shutdown indefinitely. Retain the
        // handle until the writer actually exits; normal exits drain and join it.
        if let Ok(mut writer) = self.writer.lock() {
            let deadline = Instant::now() + Duration::from_millis(500);
            while writer.as_ref().is_some_and(|thread| !thread.is_finished())
                && Instant::now() < deadline
            {
                std::thread::sleep(Duration::from_millis(5));
            }
            if writer.as_ref().is_some_and(JoinHandle::is_finished) {
                if let Some(thread) = writer.take() {
                    let _ = thread.join();
                }
            }
        }
    }
}

impl Drop for RuntimeDiagnostics {
    fn drop(&mut self) {
        self.stop();
    }
}

fn append_rotating(directory: &std::path::Path, frame: &[u8]) -> std::io::Result<()> {
    fs::create_dir_all(directory)?;
    let path = directory.join("runtime.jsonl");
    let mut file = OpenOptions::new()
        .create(true)
        .read(true)
        .write(true)
        .truncate(false)
        .open(&path)?;
    discard_partial_frame(&mut file)?;
    if file.metadata()?.len() + frame.len() as u64 > LOG_LIMIT {
        drop(file);
        let oldest = directory.join(format!("runtime.{}.jsonl", LOG_FILES - 1));
        if oldest.exists() {
            fs::remove_file(oldest)?;
        }
        for index in (1..LOG_FILES - 1).rev() {
            let previous = directory.join(format!("runtime.{index}.jsonl"));
            if previous.exists() {
                fs::rename(
                    previous,
                    directory.join(format!("runtime.{}.jsonl", index + 1)),
                )?;
            }
        }
        fs::rename(&path, directory.join("runtime.1.jsonl"))?;
        file = OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(false)
            .open(path)?;
    }
    // This directory has one writer. Windows append-only handles cannot repair
    // a partial tail with set_len, so append explicitly after recovery.
    file.seek(SeekFrom::End(0))?;
    file.write_all(frame)
}

fn discard_partial_frame(file: &mut File) -> std::io::Result<()> {
    let mut end = file.metadata()?.len();
    // Files produced here are bounded. An externally oversized file goes
    // straight to rotation without an unbounded recovery scan.
    if end == 0 || end > LOG_LIMIT {
        return Ok(());
    }
    file.seek(SeekFrom::End(-1))?;
    let mut last = [0];
    file.read_exact(&mut last)?;
    if last[0] == b'\n' {
        return Ok(());
    }
    // A failed write or process exit may leave even a partial UTF-8 sequence.
    // Preserve every newline-terminated frame and discard only the suffix.
    let mut buffer = vec![0; FRAME_LIMIT];
    while end > 0 {
        let start = end.saturating_sub(FRAME_LIMIT as u64);
        let bytes = &mut buffer[..(end - start) as usize];
        file.seek(SeekFrom::Start(start))?;
        file.read_exact(bytes)?;
        if let Some(newline) = bytes.iter().rposition(|byte| *byte == b'\n') {
            return file.set_len(start + newline as u64 + 1);
        }
        end = start;
    }
    file.set_len(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bounded_native_exception_history_is_written_without_truncation() {
        use crate::platform::windows::native_probe::{self, NativeProbeExit, NativeProbeFault};
        let fault = NativeProbeFault {
            process_id: u32::MAX,
            thread_id: u32::MAX,
            code: u32::MAX,
            flags: u32::MAX,
            request_id: u64::MAX.to_string(),
            phase: "waiting-for-request".into(),
            exception_address: "0xffffffffffffffff".into(),
            instruction_pointer: "0xffffffffffffffff".into(),
            stack_pointer: "0xffffffffffffffff".into(),
            parameters: vec!["0xffffffffffffffff".into(); 15],
            image_base: Some("0xffffffffffffffff".into()),
            image_path: Some("测".repeat(260)),
            image_path_truncated: true,
        };
        let exit = NativeProbeExit {
            process_id: u32::MAX,
            code: u32::MAX,
            observed_at_ms: u64::MAX,
            created_filetime: Some(u64::MAX.to_string()),
            exited_filetime: Some(u64::MAX.to_string()),
            termination_requested: false,
            cleanup_elapsed_ms: Some(u64::MAX),
            fault: Some(fault),
        };
        let mut native = serde_json::to_value(native_probe::diagnostics()).unwrap();
        for (index, value) in native.as_array_mut().unwrap().iter_mut().enumerate() {
            value["last_exit"] = serde_json::to_value(&exit).unwrap();
            value["last_abnormal_exit"] = serde_json::to_value(&exit).unwrap();
            if index == 1 || index == 2 {
                value["shell"] = serde_json::json!({
                    "requests":u64::MAX, "failed":u64::MAX,
                    "last_exit":exit, "last_abnormal_exit":exit,
                });
            }
        }
        let snapshot =
            serde_json::json!({"native":native, "other_tracking_fields":"x".repeat(4096)});
        assert!(serde_json::to_vec(&snapshot).unwrap().len() > 16 * 1024);
        let expected = snapshot.clone();
        let (sent, received) = mpsc::sync_channel(1);
        let observer = RuntimeDiagnostics::start_with_writer(
            move || (false, snapshot.clone()),
            move |bytes| {
                assert!(bytes.len() <= FRAME_LIMIT);
                let _ = sent.try_send(serde_json::from_slice::<Value>(bytes).unwrap());
                Ok(())
            },
            Duration::from_millis(5),
        )
        .unwrap();
        let frame = received.recv_timeout(Duration::from_secs(3)).unwrap();
        assert_eq!(frame["snapshot"], expected);
        assert_eq!(observer.output_counts(), (0, 0));
        observer.stop();
    }
    #[test]
    fn diagnostic_comparison_switch_requires_isolated_debug_profile() {
        for debug in [false, true] {
            for isolated in [None, Some("0"), Some("1"), Some("true")] {
                for disabled in [None, Some("0"), Some("1"), Some("true")] {
                    assert_eq!(
                        diagnostics_enabled(debug, isolated, disabled),
                        !(debug && isolated == Some("1") && disabled == Some("1")),
                        "diagnostic comparison profile: debug={debug} isolated={isolated:?} disabled={disabled:?}"
                    );
                }
            }
        }
    }

    #[test]
    fn observer_and_writer_panics_are_joined_without_hanging_shutdown() {
        for panic_in_observer in [true, false] {
            let (entered, received) = mpsc::sync_channel(1);
            let observer_entered = entered.clone();
            let observer = RuntimeDiagnostics::start_with_writer(
                move || {
                    if panic_in_observer {
                        let _ = observer_entered.try_send(());
                        panic!("controlled diagnostic observer panic");
                    }
                    (true, serde_json::json!({"stage": "foreground"}))
                },
                move |_| {
                    let _ = entered.try_send(());
                    panic!("controlled diagnostic writer panic");
                },
                Duration::from_millis(5),
            )
            .unwrap();
            received.recv_timeout(Duration::from_secs(3)).unwrap();
            observer.stop();
            assert!(observer.observer.lock().unwrap().is_none());
            assert!(observer.writer.lock().unwrap().is_none());
            observer.stop();
        }
    }

    #[test]
    fn shutdown_does_not_wait_indefinitely_for_a_blocked_writer() {
        let (entered, received) = mpsc::sync_channel(1);
        let (release, blocked) = mpsc::sync_channel(1);
        let observer = RuntimeDiagnostics::start_with_writer(
            || (false, serde_json::json!({"stage": "waiting"})),
            move |_| {
                let _ = entered.try_send(());
                let _ = blocked.recv_timeout(Duration::from_secs(5));
                Ok(())
            },
            Duration::from_millis(5),
        )
        .unwrap();
        received.recv_timeout(Duration::from_secs(3)).unwrap();
        let started = Instant::now();
        observer.stop();
        assert!(started.elapsed() < Duration::from_secs(2));
        assert!(observer.observer.lock().unwrap().is_none());
        assert!(
            observer.writer.lock().unwrap().is_some(),
            "retain the blocked writer handle until it exits"
        );
        release.send(()).unwrap();
        observer.stop();
        assert!(observer.writer.lock().unwrap().is_none());
    }

    #[test]
    fn full_diagnostic_queue_and_busy_executor_do_not_stop_observation() {
        let calls = Arc::new(AtomicU64::new(0));
        let observed = calls.clone();
        let (release, held) = mpsc::channel();
        let mut held = Some(held);
        let observer = RuntimeDiagnostics::start_with_writer(
            move || {
                let n = observed.fetch_add(1, Ordering::Relaxed);
                (n % 2 == 0, serde_json::json!({"stage":"foreground"}))
            },
            move |_| {
                if let Some(held) = held.take() {
                    let _ = held.recv_timeout(Duration::from_secs(5));
                }
                Ok(())
            },
            Duration::from_millis(5),
        )
        .unwrap();
        let executor = tokio::runtime::Builder::new_current_thread()
            .build()
            .unwrap();
        executor.block_on(async {
            let deadline = Instant::now() + Duration::from_secs(3);
            // Deliberately do not yield this runtime's sole worker.
            while observer.output_counts().0 == 0 && Instant::now() < deadline {
                std::hint::spin_loop();
            }
        });
        release.send(()).unwrap();
        observer.stop();
        assert!(calls.load(Ordering::Relaxed) > 17);
        assert!(
            observer.output_counts().0 > 0,
            "full writer queue must drop diagnostics, not block observation"
        );
        assert!(observer.writer.lock().unwrap().is_none());
    }
    #[test]
    fn observer_runs_without_tokio_and_unwritable_logs_do_not_block_it() {
        let directory =
            std::env::temp_dir().join(format!("patina-observer-{}", uuid::Uuid::new_v4()));
        fs::write(&directory, b"not a directory").unwrap();
        let (observed, receiver) = mpsc::sync_channel(1);
        let observer = RuntimeDiagnostics::start(directory.clone(), move || {
            let _ = observed.try_send(());
            (true, serde_json::json!({ "stage": "foreground" }))
        })
        .unwrap();
        receiver.recv_timeout(Duration::from_secs(3)).unwrap();
        observer.stop();
        assert!(observer.observer.lock().unwrap().is_none());
        assert!(observer.writer.lock().unwrap().is_none());
        assert_eq!(observer.output_counts(), (0, 1));
        fs::remove_file(directory).unwrap();
    }

    #[test]
    fn oversized_diagnostics_are_counted_and_never_written() {
        let directory = std::env::temp_dir().join(format!("patina-log-{}", uuid::Uuid::new_v4()));
        let (sent, received) = mpsc::sync_channel(1);
        let observer = RuntimeDiagnostics::start(directory.clone(), move || {
            let _ = sent.try_send(());
            (
                false,
                serde_json::json!({"payload": "x".repeat(FRAME_LIMIT)}),
            )
        })
        .unwrap();
        received.recv_timeout(Duration::from_secs(3)).unwrap();
        observer.stop();
        assert_eq!(observer.output_counts(), (1, 0));
        assert!(!directory.exists());
    }

    #[test]
    fn diagnostic_partial_frame_recovery_preserves_complete_lines_at_every_cut() {
        let directory =
            std::env::temp_dir().join(format!("patina-partial-log-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&directory).unwrap();
        let file = directory.join("runtime.jsonl");
        let previous = b"{\"sequence\":1}\n";
        let interrupted = "{\"sequence\":2,\"text\":\"部分写入\"}\n".as_bytes();
        let recovered = b"{\"sequence\":3}\n";
        for cut in 0..interrupted.len() {
            let mut bytes = previous.to_vec();
            bytes.extend_from_slice(&interrupted[..cut]);
            fs::write(&file, bytes).unwrap();
            append_rotating(&directory, recovered).unwrap();
            let actual = fs::read(&file).unwrap();
            let expected = [previous.as_slice(), recovered.as_slice()].concat();
            assert_eq!(actual, expected, "incomplete diagnostic prefix of {cut} bytes must not corrupt the first recovered frame");
        }
        fs::remove_file(file).unwrap();
        fs::remove_dir(directory).unwrap();
    }

    #[test]
    fn diagnostic_partial_tail_is_removed_before_rotation_decision() {
        let directory =
            std::env::temp_dir().join(format!("patina-partial-limit-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&directory).unwrap();
        let file = directory.join("runtime.jsonl");
        let recovered = b"{\"sequence\":3}\n";
        let mut complete = vec![b' '; LOG_LIMIT as usize - recovered.len()];
        complete[0] = b'0';
        *complete.last_mut().unwrap() = b'\n';
        let mut interrupted = complete.clone();
        interrupted.extend_from_slice(b"{\"sequence\":");
        fs::write(&file, interrupted).unwrap();
        append_rotating(&directory, recovered).unwrap();
        assert_eq!(
            fs::read(&file).unwrap(),
            [complete, recovered.to_vec()].concat()
        );
        assert!(!directory.join("runtime.1.jsonl").exists());
        fs::remove_file(file).unwrap();
        fs::remove_dir(directory).unwrap();
    }

    #[test]
    fn diagnostic_partial_write_failure_is_counted_and_next_frame_recovers() {
        let directory =
            std::env::temp_dir().join(format!("patina-partial-writer-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&directory).unwrap();
        let output = directory.clone();
        let calls = Arc::new(AtomicU64::new(0));
        let sampled = calls.clone();
        let recovered = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let next_snapshot = recovered.clone();
        let mut first = true;
        let (written, received) = mpsc::sync_channel(1);
        let observer = RuntimeDiagnostics::start_with_writer(
            move || {
                let sequence = sampled.fetch_add(1, Ordering::Relaxed);
                (
                    next_snapshot.load(Ordering::Acquire),
                    serde_json::json!({"sequence": sequence}),
                )
            },
            move |frame| {
                if first {
                    first = false;
                    // A real file retains the prefix; the injected error models
                    // a write that fails after accepting some bytes.
                    fs::write(output.join("runtime.jsonl"), &frame[..frame.len() / 2])?;
                    return Err(std::io::Error::other("controlled partial write"));
                }
                append_rotating(&output, frame)?;
                let _ = written.try_send(());
                Ok(())
            },
            Duration::from_millis(5),
        )
        .unwrap();
        let deadline = Instant::now() + Duration::from_secs(3);
        while observer.output_counts().1 == 0 && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(5));
        }
        assert_eq!(observer.output_counts().1, 1);
        recovered.store(true, Ordering::Release);
        received.recv_timeout(Duration::from_secs(3)).unwrap();
        observer.stop();
        assert!(calls.load(Ordering::Relaxed) >= 2);
        assert_eq!(observer.output_counts(), (0, 1));
        assert!(observer.observer.lock().unwrap().is_none());
        assert!(observer.writer.lock().unwrap().is_none());
        let contents = fs::read_to_string(directory.join("runtime.jsonl")).unwrap();
        let frames = contents
            .lines()
            .map(|line| serde_json::from_str::<Value>(line).unwrap())
            .collect::<Vec<_>>();
        assert!(!frames.is_empty());
        assert!(frames[0]["snapshot"]["sequence"].as_u64().unwrap() >= 1);
        assert_eq!(frames[0]["output_write_failed"], 1);
        fs::remove_file(directory.join("runtime.jsonl")).unwrap();
        fs::remove_dir(directory).unwrap();
    }

    #[test]
    fn diagnostic_rotation_has_a_fixed_file_and_byte_bound() {
        let directory = std::env::temp_dir().join(format!("patina-log-{}", uuid::Uuid::new_v4()));
        let mut frame = vec![b'x'; LOG_LIMIT as usize];
        *frame.last_mut().unwrap() = b'\n';
        for _ in 0..8 {
            append_rotating(&directory, &frame).unwrap();
        }
        let files = fs::read_dir(&directory)
            .unwrap()
            .map(Result::unwrap)
            .collect::<Vec<_>>();
        assert_eq!(files.len(), LOG_FILES);
        assert!(files
            .iter()
            .all(|file| file.metadata().unwrap().len() <= LOG_LIMIT));
        for file in files {
            fs::remove_file(file.path()).unwrap();
        }
        fs::remove_dir(directory).unwrap();
    }
}
