import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

type ProcessSample = { pid: number; name: string; unavailable?: boolean; privateBytes: number;
  workingSetBytes: number; cpuOneCorePercent: number | null; threads: number; handles: number };
type Sample = { kind: "sample"; elapsedSeconds: number; processes: ProcessSample[] };

function p(values: number[], q: number) {
  return [...values].sort((a, b) => a - b)[Math.ceil(values.length * q) - 1];
}

function summarize(path: string) {
  const rows = readFileSync(path, "utf8").trimEnd().split("\n").map(line => JSON.parse(line));
  const meta = rows[0], end = rows.at(-1);
  assert.equal(meta.kind, "metadata");
  assert.ok(end.kind === "completed" && end.complete && end.stopReason === "duration" && !end.unavailableSamples,
    `Incomplete resource sample: ${path}`);
  const samples: Sample[] = rows.slice(1, -1);
  assert.ok(samples.length > 1 && samples.length === end.sampleCount);
  const totals = (key: "privateBytes" | "workingSetBytes" | "threads" | "handles") =>
    samples.map(s => s.processes.reduce((sum, row) => sum + row[key], 0));
  const role = (r: ProcessSample) => r.pid === meta.rootPid ? "host" : r.name.toLowerCase();
  const roles = new Set(samples.flatMap(s => s.processes.map(role)));
  const roleCpu = new Map<string, number>();
  let cpuSeconds = 0, coveredSeconds = 0;
  const intervals: number[] = [];
  for (const [i, s] of samples.entries()) {
    assert.ok(s.kind === "sample" && s.processes.some(r => r.pid === meta.rootPid));
    assert.ok(s.processes.every(r => !r.unavailable && Number.isFinite(r.privateBytes)));
    if (i === 0) continue;
    const dt = s.elapsedSeconds - samples[i - 1].elapsedSeconds;
    assert.ok(dt > 0);
    intervals.push(dt);
    // A process entering the tree has no preceding CPU delta. Keep the
    // interval out of both numerator and denominator and report coverage.
    if (s.processes.every(r => r.cpuOneCorePercent !== null) &&
      samples[i - 1].processes.every(prev => s.processes.some(r => r.pid === prev.pid))) {
      cpuSeconds += dt * s.processes.reduce((v, r) => v + r.cpuOneCorePercent!, 0) / 100;
      for (const row of s.processes) {
        const group = role(row);
        roleCpu.set(group, (roleCpu.get(group) ?? 0) + dt * row.cpuOneCorePercent! / 100);
      }
      coveredSeconds += dt;
    }
  }
  assert.ok(coveredSeconds > 0);
  return { path, scenario: meta.scenario, samples: samples.length, seconds: end.elapsedSeconds,
    cpuOneCorePercent: cpuSeconds / coveredSeconds * 100, cpuCoveredSeconds: coveredSeconds,
    intervalP50Seconds: p(intervals, .5), intervalMaxSeconds: Math.max(...intervals),
    privateP50MiB: p(totals("privateBytes"), .5) / 2 ** 20, privateP95MiB: p(totals("privateBytes"), .95) / 2 ** 20,
    workingSetP50MiB: p(totals("workingSetBytes"), .5) / 2 ** 20,
    threadsP50: p(totals("threads"), .5), handlesP50: p(totals("handles"), .5),
    roles: Object.fromEntries([...roles].map(group => {
      const rows = samples.map(s => s.processes.filter(r => role(r) === group));
      return [group, {
        countP50: p(rows.map(processes => processes.length), .5),
        privateP50MiB: p(rows.map(processes => processes.reduce((sum, r) => sum + r.privateBytes, 0)), .5) / 2 ** 20,
        cpuOneCorePercent: (roleCpu.get(group) ?? 0) / coveredSeconds * 100,
      }];
    })) };
}

const files = process.argv.slice(2);
assert.ok(files.length, "Pass one or more completed resource JSONL files");
console.log(JSON.stringify(files.map(summarize), null, 2));
