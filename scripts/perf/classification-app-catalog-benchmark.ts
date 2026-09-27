import { spawnSync } from "node:child_process";
import { createBenchmarkMeasurement, printBenchmarkReport } from "./benchmarkUtils.ts";

const result = spawnSync("cargo", [
  "test", "--manifest-path", "src-tauri/Cargo.toml", "--locked",
  "catalog_capacity_report", "--", "--ignored", "--nocapture",
], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
if (result.error) throw result.error;
if (result.status !== 0) throw new Error(result.stdout + result.stderr);
const line = result.stdout.split(/\r?\n/).find((value) => value.startsWith("PATINA_CATALOG_BENCH="));
if (!line) throw new Error("The production catalog benchmark did not emit measurements");
const report = JSON.parse(line.slice("PATINA_CATALOG_BENCH=".length)) as {
  measurements: Array<{ name: string; durations: number[]; readPath: string; returnedRows: number;
    usesTableScan?: boolean; queryPlan?: string[]; fixtureRows?: number }>;
  metadata: Record<string, unknown>;
};
if (report.measurements.length !== 4) throw new Error("Incomplete catalog benchmark scenarios");
const measurements = report.measurements.map(({ durations, ...sample }) => {
  if (durations.length !== 12 || durations.some(value => !Number.isFinite(value) || value < 0)) {
    throw new Error("Invalid catalog timing samples: " + sample.name);
  }
  if (sample.usesTableScan) throw new Error("Unindexed catalog projection scan: " + sample.name);
  return { ...createBenchmarkMeasurement(sample.name, durations, 250), ...sample };
});
printBenchmarkReport({ benchmark: "classification-app-catalog", measuredAt: new Date().toISOString(),
  measurements, metadata: report.metadata });
