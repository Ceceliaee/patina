import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";


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
    [pscustomobject]@{
      rootPid = [int]$rootProcess.Id
      rootStartTicks = $rootProcess.StartTime.ToUniversalTime().Ticks.ToString()
      processCount = $measured
      workingSetBytes = $workingSet
      privateUsageBytes = $privateUsage
      cpuTimeMs = $cpuTime
      coverage = $coverage
    } | ConvertTo-Json -Compress
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
