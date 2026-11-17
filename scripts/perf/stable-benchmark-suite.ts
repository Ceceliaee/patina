import { spawnSync } from "node:child_process";

const RUNS = 5;
const NODE_ARGS = ["--experimental-strip-types", "--experimental-specifier-resolution=node"];
const BENCHMARKS = [
  "dashboard-read-model-benchmark.ts",
  "sqlite-query-plan-benchmark.ts",
  "startup-bootstrap-benchmark.ts",
] as const;

interface Measurement {
  name: string;
  averageMs?: number;
  p50Ms?: number;
  p95Ms?: number;
  maxMs?: number;
  durationMs?: number;
  withinBudget?: boolean;
  usesTableScan?: boolean;
}

interface Report {
  benchmark: string;
  measurements: Measurement[];
}

function parseReport(output: string): Report {
  const start = output.indexOf("{");
  const end = output.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error(`benchmark did not emit JSON:\n${output}`);
  return JSON.parse(output.slice(start, end + 1)) as Report;
}

const reports = new Map<string, Report[]>();

for (const benchmarkFile of BENCHMARKS) {
  const benchmarkReports: Report[] = [];
  for (let run = 1; run <= RUNS; run += 1) {
    console.error(`[perf] ${benchmarkFile} run ${run}/${RUNS}`);
    const result = spawnSync(process.execPath, [
      ...NODE_ARGS,
      `scripts/perf/${benchmarkFile}`,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      throw new Error(`${benchmarkFile} run ${run} failed\n${result.stdout}\n${result.stderr}`);
    }
    const report = parseReport(result.stdout ?? "");
    if (report.measurements.length === 0) throw new Error(`${benchmarkFile} emitted no measurements`);
    if (report.measurements.some((measurement) => measurement.withinBudget === false)) {
      throw new Error(`${benchmarkFile} exceeded its average/p95/max budget on run ${run}`);
    }
    if (report.measurements.some((measurement) => measurement.usesTableScan === true)) {
      throw new Error(`${benchmarkFile} used a SQLite table scan on run ${run}`);
    }
    benchmarkReports.push(report);
  }
  reports.set(benchmarkFile, benchmarkReports);
}

const summary = [...reports.entries()].map(([file, fileReports]) => {
  const names = fileReports[0].measurements.map((measurement) => measurement.name);
  return {
    file,
    benchmark: fileReports[0].benchmark,
    runs: RUNS,
    measurements: names.map((name) => {
      const samples = fileReports
        .flatMap((report) => report.measurements)
        .filter((measurement) => measurement.name === name);
      const averages = samples.map((sample) => sample.averageMs ?? sample.durationMs ?? 0);
      const p50s = samples.map((sample) => sample.p50Ms ?? sample.durationMs ?? 0);
      const p95s = samples.map((sample) => sample.p95Ms ?? sample.durationMs ?? 0);
      const maxima = samples.map((sample) => sample.maxMs ?? sample.durationMs ?? 0);
      return {
        name,
        averageOfRunsMs: averages.reduce((sum, value) => sum + value, 0) / averages.length,
        worstP50Ms: Math.max(...p50s),
        worstP95Ms: Math.max(...p95s),
        worstMaxMs: Math.max(...maxima),
      };
    }),
  };
});

console.log(JSON.stringify({ measuredAt: new Date().toISOString(), runsPerBenchmark: RUNS, summary }, null, 2));
