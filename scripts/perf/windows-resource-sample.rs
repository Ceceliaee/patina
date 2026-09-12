//! Windows-only diagnostic: cargo run --manifest-path src-tauri/Cargo.toml
//! --example windows-resource-sample -- <PID> <new-output.jsonl> [seconds] [interval] [scenario]
use chrono::{DateTime, Utc};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    error::Error,
    fs::OpenOptions,
    io::Write,
    time::{Duration, Instant},
};
use windows::Win32::{
    Foundation::{
        CloseHandle, GetLastError, SetLastError, ERROR_NO_MORE_FILES, ERROR_SUCCESS, FILETIME,
        HANDLE,
    },
    System::{
        Diagnostics::ToolHelp::{
            CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
            TH32CS_SNAPPROCESS,
        },
        ProcessStatus::{
            GetProcessMemoryInfo, PROCESS_MEMORY_COUNTERS, PROCESS_MEMORY_COUNTERS_EX,
        },
        SystemInformation::GetSystemTimePreciseAsFileTime,
        Threading::{
            GetGuiResources, GetProcessHandleCount, GetProcessTimes, OpenProcess,
            GET_GUI_RESOURCES_FLAGS, GR_GDIOBJECTS, GR_USEROBJECTS, PROCESS_QUERY_INFORMATION,
            PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_VM_READ,
        },
    },
};

type Result<T> = std::result::Result<T, Box<dyn Error>>;
struct OwnedHandle(HANDLE);
impl Drop for OwnedHandle {
    fn drop(&mut self) {
        unsafe {
            let _ = CloseHandle(self.0);
        }
    }
}
fn ticks(t: FILETIME) -> u64 {
    (u64::from(t.dwHighDateTime) << 32) | u64::from(t.dwLowDateTime)
}
fn times(handle: HANDLE) -> windows::core::Result<(u64, f64)> {
    let (mut created, mut exit, mut kernel, mut user) = Default::default();
    unsafe {
        GetProcessTimes(handle, &mut created, &mut exit, &mut kernel, &mut user)?;
    }
    Ok((
        ticks(created),
        (ticks(kernel) + ticks(user)) as f64 / 10_000_000.0,
    ))
}
fn started_at(t: u64) -> String {
    DateTime::from_timestamp(
        (t / 10_000_000) as i64 - 11_644_473_600,
        ((t % 10_000_000) * 100) as u32,
    )
    .expect("Windows process creation time")
    .to_rfc3339()
}
fn identity(pid: u32) -> windows::core::Result<u64> {
    let handle =
        OwnedHandle(unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid)? });
    Ok(times(handle.0)?.0)
}
fn identity_at_snapshot(created: Option<u64>, capture_start: u64) -> Option<u64> {
    // A newer process may have reused a PID whose parent belongs to the snapshot's old process.
    created.filter(|time| *time <= capture_start)
}
struct Row {
    pid: u32,
    parent: u32,
    threads: u32,
    name: String,
    created: Option<u64>,
}
fn processes() -> windows::core::Result<Vec<Row>> {
    let capture_start = ticks(unsafe { GetSystemTimePreciseAsFileTime() });
    let snapshot = OwnedHandle(unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0)? });
    let mut entry = PROCESSENTRY32W {
        dwSize: size_of::<PROCESSENTRY32W>() as u32,
        ..Default::default()
    };
    let mut status = unsafe { Process32FirstW(snapshot.0, &mut entry) };
    let mut rows = Vec::new();
    while status.is_ok() {
        let end = entry
            .szExeFile
            .iter()
            .position(|c| *c == 0)
            .unwrap_or(entry.szExeFile.len());
        rows.push(Row {
            pid: entry.th32ProcessID,
            parent: entry.th32ParentProcessID,
            threads: entry.cntThreads,
            name: String::from_utf16_lossy(&entry.szExeFile[..end]),
            created: identity_at_snapshot(identity(entry.th32ProcessID).ok(), capture_start),
        });
        status = unsafe { Process32NextW(snapshot.0, &mut entry) };
    }
    if let Err(error) = status {
        if error.code() != ERROR_NO_MORE_FILES.to_hresult() {
            return Err(error);
        }
    }
    Ok(rows)
}
fn owned_processes(
    rows: &[Row],
    root: u32,
    created: u64,
    previous: &HashMap<u32, ProcessIdentity>,
) -> HashMap<u32, ProcessIdentity> {
    let mut owned = HashMap::from([(root, ProcessIdentity::confirmed(created))]);
    for row in rows {
        if let Some(previous_identity) = previous.get(&row.pid) {
            match (row.created, previous_identity.last_confirmed) {
                (Some(time), Some(previous_time)) if time == previous_time => {
                    owned.insert(row.pid, ProcessIdentity::confirmed(time));
                }
                (None, _) | (_, None) => {
                    owned.insert(
                        row.pid,
                        ProcessIdentity {
                            last_confirmed: previous_identity.last_confirmed,
                            current: None,
                        },
                    );
                }
                _ => {}
            }
        }
    }
    loop {
        let mut changed = false;
        for row in rows {
            if let Some(parent_identity) = owned.get(&row.parent) {
                match (row.created, parent_identity.current) {
                    (Some(time), Some(parent_time)) if time >= parent_time => {
                        let identity = ProcessIdentity::confirmed(time);
                        if owned.get(&row.pid) != Some(&identity) {
                            owned.insert(row.pid, identity);
                            changed = true;
                        }
                    }
                    (None, _) | (_, None) => {
                        if let std::collections::hash_map::Entry::Vacant(entry) =
                            owned.entry(row.pid)
                        {
                            entry.insert(ProcessIdentity {
                                last_confirmed: None,
                                current: None,
                            });
                            changed = true;
                        }
                    }
                    _ => {}
                }
            }
        }
        if !changed {
            return owned;
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct ProcessIdentity {
    last_confirmed: Option<u64>,
    current: Option<u64>,
}

impl ProcessIdentity {
    fn confirmed(created: u64) -> Self {
        Self {
            last_confirmed: Some(created),
            current: Some(created),
        }
    }
}
fn sample(
    row: &Row,
    expected: u64,
    elapsed: f64,
    previous: &HashMap<(u32, u64), (f64, f64)>,
) -> Result<(Value, f64)> {
    let handle = OwnedHandle(unsafe {
        OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, false, row.pid)?
    });
    let (created, cpu) = times(handle.0)?;
    if created != expected {
        return Err("process identity changed".into());
    }
    let mut memory = PROCESS_MEMORY_COUNTERS_EX {
        cb: size_of::<PROCESS_MEMORY_COUNTERS_EX>() as u32,
        ..Default::default()
    };
    let mut handles = 0;
    unsafe {
        GetProcessMemoryInfo(
            handle.0,
            (&mut memory as *mut PROCESS_MEMORY_COUNTERS_EX).cast::<PROCESS_MEMORY_COUNTERS>(),
            size_of::<PROCESS_MEMORY_COUNTERS_EX>() as u32,
        )?;
        GetProcessHandleCount(handle.0, &mut handles)?;
    }
    let cpu_percent = previous.get(&(row.pid, created)).and_then(|(time, value)| {
        (elapsed > *time).then(|| 100.0 * (cpu - value) / (elapsed - time))
    });
    Ok((
        json!({"pid": row.pid, "parentPid": row.parent, "name": row.name, "startedAt": started_at(created),
        "elapsedSeconds": elapsed, "cpuSeconds": cpu, "cpuOneCorePercent": cpu_percent,
        "workingSetBytes": memory.WorkingSetSize, "privateBytes": memory.PrivateUsage,
        "handles": handles, "threads": row.threads,
        "gdiObjects": gui_objects(handle.0, GR_GDIOBJECTS),
        "userObjects": gui_objects(handle.0, GR_USEROBJECTS)}),
        cpu,
    ))
}
fn gui_objects(handle: HANDLE, flags: GET_GUI_RESOURCES_FLAGS) -> Option<u32> {
    unsafe {
        SetLastError(ERROR_SUCCESS);
        let count = GetGuiResources(handle, flags);
        (count > 0 || GetLastError() == ERROR_SUCCESS).then_some(count)
    }
}
fn number(value: Option<&String>, default: u64, max: u64) -> Result<u64> {
    let n = value.map(|s| s.parse()).transpose()?.unwrap_or(default);
    if n == 0 || n > max {
        return Err(format!("value must be in 1..={max}").into());
    }
    Ok(n)
}
fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.len() < 2 || args.len() > 5 {
        return Err("Usage: windows-resource-sample <PID> <new-output.jsonl> [seconds=600] [interval=5] [scenario]".into());
    }
    let root = number(args.first(), 0, i32::MAX as u64)? as u32;
    let duration = Duration::from_secs(number(args.get(2), 600, 28800)?);
    let interval = Duration::from_secs(number(args.get(3), 5, 60)?);
    let created = identity(root)?;
    let mut output = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&args[1])?;
    let clock = Instant::now();
    writeln!(
        output,
        "{}",
        json!({"kind":"metadata", "rootPid":root, "rootStartedAt":started_at(created),
        "scenario":args.get(4).map(String::as_str).unwrap_or("unspecified"),
        "logicalProcessors":std::thread::available_parallelism()?.get(),
        "durationSeconds":duration.as_secs(), "intervalSeconds":interval.as_secs(),
        "cpuConvention":"one core = 100%; null on first sample or unavailable",
        "memoryConvention":"working-set sum double-counts shared pages",
        "guiConvention":"zero with no Win32 error is a valid count; failures are null"})
    )?;
    let mut known = HashMap::new();
    let mut previous = HashMap::new();
    let reason = loop {
        let start = clock.elapsed();
        let rows = processes()?;
        let Some(root_row) = rows.iter().find(|r| r.pid == root) else {
            break "root-exited";
        };
        match root_row.created {
            Some(time) if time == created => (),
            Some(_) => break "root-identity-changed",
            None => return Err("root identity unavailable; measurement incomplete".into()),
        }
        known = owned_processes(&rows, root, created, &known);
        let mut next = HashMap::new();
        let mut samples = Vec::new();
        for row in &rows {
            let Some(identity) = known.get(&row.pid) else {
                continue;
            };
            let Some(time) = identity.current else {
                samples.push(
                    json!({"pid":row.pid, "parentPid":row.parent, "name":row.name,
                    "unavailable":true, "error":"possible descendant identity unavailable"}),
                );
                continue;
            };
            let elapsed = clock.elapsed().as_secs_f64();
            match sample(row, time, elapsed, &previous) {
                Ok((value, cpu)) => {
                    samples.push(value);
                    next.insert((row.pid, time), (elapsed, cpu));
                }
                Err(error) => samples
                    .push(json!({"pid":row.pid,"unavailable":true,"error":error.to_string()})),
            }
        }
        previous = next;
        writeln!(
            output,
            "{}",
            json!({"kind":"sample", "utc":Utc::now().to_rfc3339(),
            "elapsedSeconds":clock.elapsed().as_secs_f64(), "collectionSeconds":(clock.elapsed()-start).as_secs_f64(), "processes":samples})
        )?;
        if clock.elapsed() >= duration {
            break "duration";
        }
        // Cadence only; this delay does not assert application readiness.
        std::thread::sleep(interval.min(duration.saturating_sub(clock.elapsed())));
    };
    writeln!(
        output,
        "{}",
        json!({"kind":"completed", "stopReason":reason,"elapsedSeconds":clock.elapsed().as_secs_f64()})
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(pid: u32, parent: u32, created: Option<u64>) -> Row {
        Row {
            pid,
            parent,
            created,
            threads: 1,
            name: "synthetic.exe".into(),
        }
    }

    #[test]
    fn unreadable_child_and_its_descendant_remain_missing_measurements() {
        let rows = [row(1, 0, Some(10)), row(2, 1, None), row(3, 2, Some(30))];
        let selected = owned_processes(&rows, 1, 10, &HashMap::new());
        assert_eq!(
            selected,
            HashMap::from([
                (1, ProcessIdentity::confirmed(10)),
                (
                    2,
                    ProcessIdentity {
                        last_confirmed: None,
                        current: None
                    }
                ),
                (
                    3,
                    ProcessIdentity {
                        last_confirmed: None,
                        current: None
                    }
                ),
            ])
        );
    }

    #[test]
    fn known_orphan_with_unreadable_identity_cannot_silently_disappear() {
        let previous = HashMap::from([
            (1, ProcessIdentity::confirmed(10)),
            (2, ProcessIdentity::confirmed(20)),
        ]);
        let rows = [row(1, 0, Some(10)), row(2, 9, None)];
        let selected = owned_processes(&rows, 1, 10, &previous);
        assert_eq!(
            selected.get(&2),
            Some(&ProcessIdentity {
                last_confirmed: Some(20),
                current: None
            })
        );
        let recovered = owned_processes(
            &[row(1, 0, Some(10)), row(2, 9, Some(20))],
            1,
            10,
            &selected,
        );
        assert_eq!(recovered.get(&2), Some(&ProcessIdentity::confirmed(20)));
        let reused = owned_processes(
            &[row(1, 0, Some(10)), row(2, 9, Some(40))],
            1,
            10,
            &selected,
        );
        assert_eq!(reused, HashMap::from([(1, ProcessIdentity::confirmed(10))]));
    }

    #[test]
    fn reused_pid_and_process_older_than_its_apparent_parent_are_excluded() {
        let previous = HashMap::from([
            (1, ProcessIdentity::confirmed(10)),
            (2, ProcessIdentity::confirmed(20)),
        ]);
        let rows = [row(1, 0, Some(10)), row(2, 9, Some(40)), row(3, 1, Some(5))];
        assert_eq!(
            owned_processes(&rows, 1, 10, &previous),
            HashMap::from([(1, ProcessIdentity::confirmed(10))])
        );
    }

    #[test]
    fn uncertain_parent_chain_recovers_even_when_rows_are_in_child_first_order() {
        let first = owned_processes(
            &[row(1, 0, Some(10)), row(2, 1, None), row(3, 2, Some(30))],
            1,
            10,
            &HashMap::new(),
        );
        let recovered = owned_processes(
            &[
                row(3, 2, Some(30)),
                row(2, 1, Some(20)),
                row(1, 0, Some(10)),
            ],
            1,
            10,
            &first,
        );
        assert_eq!(
            recovered,
            HashMap::from([
                (1, ProcessIdentity::confirmed(10)),
                (2, ProcessIdentity::confirmed(20)),
                (3, ProcessIdentity::confirmed(30)),
            ])
        );
        let orphaned = owned_processes(&[row(1, 0, Some(10)), row(3, 9, Some(30))], 1, 10, &first);
        assert_eq!(
            orphaned.get(&3),
            Some(&ProcessIdentity {
                last_confirmed: None,
                current: None
            })
        );
    }

    #[test]
    fn snapshot_parent_cannot_attribute_a_process_created_after_capture_started() {
        let previous = HashMap::from([
            (1, ProcessIdentity::confirmed(10)),
            (2, ProcessIdentity::confirmed(20)),
        ]);
        let captured = owned_processes(
            &[
                row(1, 0, identity_at_snapshot(Some(10), 25)),
                row(2, 1, identity_at_snapshot(Some(40), 25)),
            ],
            1,
            10,
            &previous,
        );
        assert_eq!(
            captured.get(&2),
            Some(&ProcessIdentity {
                last_confirmed: Some(20),
                current: None
            })
        );
        let next_snapshot = owned_processes(
            &[
                row(1, 0, identity_at_snapshot(Some(10), 60)),
                row(2, 9, identity_at_snapshot(Some(40), 60)),
            ],
            1,
            10,
            &captured,
        );
        assert_eq!(
            next_snapshot,
            HashMap::from([(1, ProcessIdentity::confirmed(10))])
        );

        let new_child = owned_processes(
            &[
                row(1, 0, Some(10)),
                row(3, 1, identity_at_snapshot(Some(40), 25)),
            ],
            1,
            10,
            &HashMap::new(),
        );
        assert_eq!(new_child.get(&3).unwrap().current, None);
        let next_snapshot = owned_processes(
            &[
                row(1, 0, Some(10)),
                row(3, 1, identity_at_snapshot(Some(40), 60)),
            ],
            1,
            10,
            &new_child,
        );
        assert_eq!(next_snapshot.get(&3), Some(&ProcessIdentity::confirmed(40)));
    }

    #[test]
    fn gui_counts_distinguish_valid_processes_from_invalid_handles() {
        let current = unsafe { windows::Win32::System::Threading::GetCurrentProcess() };
        unsafe { SetLastError(windows::Win32::Foundation::ERROR_INVALID_DATA) };
        let gdi = gui_objects(current, GR_GDIOBJECTS);
        let user = gui_objects(current, GR_USEROBJECTS);
        assert!(gdi.is_some() && user.is_some());
        assert_eq!(gui_objects(HANDLE::default(), GR_GDIOBJECTS), None);
        println!("RESOURCE_GUI_API_OBSERVATION gdi={gdi:?} user={user:?} invalid_handle=None");
    }
}
