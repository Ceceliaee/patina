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
    Foundation::{CloseHandle, ERROR_NO_MORE_FILES, FILETIME, HANDLE},
    System::{
        Diagnostics::ToolHelp::{
            CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
            TH32CS_SNAPPROCESS,
        },
        ProcessStatus::{
            GetProcessMemoryInfo, PROCESS_MEMORY_COUNTERS, PROCESS_MEMORY_COUNTERS_EX,
        },
        Threading::{
            GetGuiResources, GetProcessHandleCount, GetProcessTimes, OpenProcess, GR_GDIOBJECTS,
            GR_USEROBJECTS, PROCESS_QUERY_INFORMATION, PROCESS_QUERY_LIMITED_INFORMATION,
            PROCESS_VM_READ,
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
struct Row {
    pid: u32,
    parent: u32,
    threads: u32,
    name: String,
    created: Option<u64>,
}
fn processes() -> windows::core::Result<Vec<Row>> {
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
            created: identity(entry.th32ProcessID).ok(),
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
    previous: &HashMap<u32, u64>,
) -> HashMap<u32, u64> {
    let mut owned = HashMap::from([(root, created)]);
    for row in rows {
        if let Some(time) = row.created {
            if previous.get(&row.pid) == Some(&time) {
                owned.insert(row.pid, time);
            }
        }
    }
    loop {
        let before = owned.len();
        for row in rows {
            if let (Some(time), Some(parent_time)) = (row.created, owned.get(&row.parent)) {
                if time >= *parent_time {
                    owned.entry(row.pid).or_insert(time);
                }
            }
        }
        if owned.len() == before {
            return owned;
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
    let nonzero = |v| if v == 0 { None } else { Some(v) };
    Ok((
        json!({"pid": row.pid, "parentPid": row.parent, "name": row.name, "startedAt": started_at(created),
        "elapsedSeconds": elapsed, "cpuSeconds": cpu, "cpuOneCorePercent": cpu_percent,
        "workingSetBytes": memory.WorkingSetSize, "privateBytes": memory.PrivateUsage,
        "handles": handles, "threads": row.threads,
        "gdiObjects": nonzero(unsafe { GetGuiResources(handle.0, GR_GDIOBJECTS) }),
        "userObjects": nonzero(unsafe { GetGuiResources(handle.0, GR_USEROBJECTS) })}),
        cpu,
    ))
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
        "guiConvention":"zero may mean no objects or API failure; reported as null"})
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
            let Some(time) = known.get(&row.pid) else {
                continue;
            };
            let elapsed = clock.elapsed().as_secs_f64();
            match sample(row, *time, elapsed, &previous) {
                Ok((value, cpu)) => {
                    samples.push(value);
                    next.insert((row.pid, *time), (elapsed, cpu));
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
