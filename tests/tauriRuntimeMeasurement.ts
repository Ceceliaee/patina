import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

export interface RuntimeThreadSnapshot {
  id: number;
  name: string | null;
  module: string | null;
  startAddress: string;
  startedAt: string | null;
  state: string;
}

export function threadInventoryDelta(before: readonly RuntimeThreadSnapshot[], after: readonly RuntimeThreadSnapshot[]) {
  const identity = (thread: RuntimeThreadSnapshot) => `${thread.id}:${thread.startedAt}`;
  const beforeIds = new Set(before.map(identity));
  const afterIds = new Set(after.map(identity));
  return {
    added: after.filter(thread => !beforeIds.has(identity(thread))),
    removed: before.filter(thread => !afterIds.has(identity(thread))),
  };
}

export function createProcessMeasurement(RUNTIME_BINARY_PATH: string) {
  function runRuntimeBinaryProcessCommand(command: string) {
    if(process.platform !== "win32") return null;
    // A root-only PowerShell query can exceed ten seconds on hosted Windows.
    // Keep startup and execution bounded without changing UI wait deadlines.
    const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], {
      encoding: "utf8", windowsHide: true, timeout: 30_000,
      env: {
        ...process.env,
        PATINA_RUNTIME_SMOKE_BINARY: RUNTIME_BINARY_PATH,
      },
    });
    if(result.error || result.status !== 0) {
      throw new Error(`runtime-smoke process command failed (exit ${result.status}, signal ${result.signal}): ${result.error?.message || result.stderr || result.stdout}`, { cause: result.error });
    }
    return result;
  }

  type RuntimeProcessMeasurement = {
    rootPid: number;
    rootStartTicks: string;
    processCount: number;
    workingSetBytes: number;
    privateUsageBytes: number;
    cpuTimeMs: number;
    coverage: "root_only" | "root_and_descendants" | "incomplete_tree";
    rootThreads: RuntimeThreadSnapshot[];
  };

  const measuredRootStarts = new Map<number, string>();

  function measureRuntimeProcessTree(
    rootPid: number,
    runCommand = runRuntimeBinaryProcessCommand,
    includeDescendants = true,
  ): RuntimeProcessMeasurement {
    assert.ok(Number.isSafeInteger(rootPid) && rootPid > 0, "main-process identity must come from the application");
    let result;
    try {
      result = runCommand(`
    $target = [IO.Path]::GetFullPath($env:PATINA_RUNTIME_SMOKE_BINARY)
    $rootProcess = Get-Process -Id ${rootPid} -ErrorAction Stop
    if (-not $rootProcess.Path -or [IO.Path]::GetFullPath($rootProcess.Path) -ine $target) {
      throw 'runtime smoke root process identity mismatch'
    }
    $ids = [Collections.Generic.HashSet[int]]::new()
    [void]$ids.Add([int]$rootProcess.Id)
    $coverage = 'root_only'
    ${includeDescendants ? `try {
      $processRows = @(Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,CreationDate -ErrorAction Stop)
      $created = @{}
      foreach ($row in $processRows) { $created[[int]$row.ProcessId] = $row.CreationDate }
      do {
        $added = $false
        foreach ($row in $processRows) {
          if ($ids.Contains([int]$row.ParentProcessId) -and $row.CreationDate -ge $created[[int]$row.ParentProcessId] -and $ids.Add([int]$row.ProcessId)) {
            $added = $true
          }
        }
      } while ($added)
      $coverage = 'root_and_descendants'
    } catch {
      # Process-tree enumeration is a diagnostic enhancement. Some Windows
      # sessions stop CIM while the test is running; retain the exact root
      # measurement instead of failing unrelated runtime assertions.
    }` : ""}
    $workingSet = 0L
    $privateUsage = 0L
    $cpuTime = 0.0
    $measured = 0
    foreach ($id in $ids) {
      try {
        $process = Get-Process -Id $id -ErrorAction Stop
        if ($id -ne $rootProcess.Id -and $created -and [Math]::Abs($process.StartTime.ToUniversalTime().Ticks - $created[$id].ToUniversalTime().Ticks) -gt 10) { continue }
        $workingSet += [long]$process.WorkingSet64
        $privateUsage += [long]$process.PrivateMemorySize64
        $cpuTime += $process.TotalProcessorTime.TotalMilliseconds
        $measured += 1
      } catch {}
    }
    if ($coverage -eq 'root_and_descendants' -and $measured -ne $ids.Count) { $coverage = 'incomplete_tree' }
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class RuntimeThreadDetails {
  [DllImport("kernel32.dll", SetLastError=true)] public static extern IntPtr OpenThread(uint access, bool inherit, uint id);
  [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr handle);
  [DllImport("kernel32.dll")] public static extern int GetThreadDescription(IntPtr thread, out IntPtr description);
  [DllImport("kernel32.dll")] public static extern IntPtr LocalFree(IntPtr memory);
  [DllImport("ntdll.dll")] public static extern int NtQueryInformationThread(IntPtr thread, int infoClass, out IntPtr address, uint size, IntPtr returned);
}
'@
    $rootProcess.Refresh()
    $modules = @($rootProcess.Modules)
    $threads = @(foreach ($thread in $rootProcess.Threads) {
      $handle = [RuntimeThreadDetails]::OpenThread(0x840, $false, $thread.Id)
      $name = $null
      $address = [IntPtr]::Zero
      $startedAt = $null
      try {
        if ($handle -ne [IntPtr]::Zero) {
          $description = [IntPtr]::Zero
          if ([RuntimeThreadDetails]::GetThreadDescription($handle, [ref]$description) -ge 0) {
            try { $name = [Runtime.InteropServices.Marshal]::PtrToStringUni($description) }
            finally { [void][RuntimeThreadDetails]::LocalFree($description) }
          }
          [void][RuntimeThreadDetails]::NtQueryInformationThread($handle, 9, [ref]$address, [IntPtr]::Size, [IntPtr]::Zero)
        }
        try { $startedAt = $thread.StartTime.ToUniversalTime().ToString('o') } catch {}
        $module = $modules | Where-Object { $address.ToInt64() -ge $_.BaseAddress.ToInt64() -and $address.ToInt64() -lt ($_.BaseAddress.ToInt64() + $_.ModuleMemorySize) } | Select-Object -First 1
        [pscustomobject]@{ id = $thread.Id; name = $name; module = $module.ModuleName; startAddress = $address.ToInt64().ToString('x'); startedAt = $startedAt; state = $thread.ThreadState.ToString() }
      } finally { if ($handle -ne [IntPtr]::Zero) { [void][RuntimeThreadDetails]::CloseHandle($handle) } }
    })
    [pscustomobject]@{
      rootPid = [int]$rootProcess.Id
      rootStartTicks = $rootProcess.StartTime.ToUniversalTime().Ticks.ToString()
      processCount = $measured
      workingSetBytes = $workingSet
      privateUsageBytes = $privateUsage
      cpuTimeMs = $cpuTime
      coverage = $coverage
      rootThreads = $threads
    } | ConvertTo-Json -Compress -Depth 4
    `);
    } catch(error) {
      if(includeDescendants && error instanceof Error
        && (error.cause as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT") {
        // A hung CIM query cannot reach the PowerShell catch above. Retry only
        // the root measurement, without enumerating descendants; keep failures
        // of that measurement fatal and report its reduced coverage explicitly.
        return measureRuntimeProcessTree(rootPid, runCommand, false);
      }
      throw error;
    }
    assert.ok(result, "runtime process measurement requires Windows");
    const measurement = JSON.parse(result.stdout.trim()) as RuntimeProcessMeasurement;
    assert.equal(measurement.rootPid, rootPid);
    assert.match(measurement.rootStartTicks, /^\d+$/);
    const previous = measuredRootStarts.get(rootPid);
    if(previous) assert.equal(measurement.rootStartTicks, previous, "root PID was reused during measurement");
    measuredRootStarts.set(rootPid, measurement.rootStartTicks);
    return measurement;
  }


  return { measureRuntimeProcessTree, runRuntimeBinaryProcessCommand };
}
