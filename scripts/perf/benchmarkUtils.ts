import { performance } from "node:perf_hooks";

export interface BenchmarkMeasurement {
  name: string;
  iterations: number;
  elapsedMs: number;
  averageMs: number;
  budgetAverageMs: number;
  withinBudget: boolean;
}

export interface BenchmarkReport {
  benchmark: string;
  measuredAt: string;
  measurements: BenchmarkMeasurement[];
  metadata?: Record<string, unknown>;
}

export function measureBenchmark(
  name: string,
  iterations: number,
  budgetAverageMs: number,
  run: () => void,
): BenchmarkMeasurement {
  const startedAt = performance.now();
  for (let index = 0; index < iterations; index += 1) {
    run();
  }
  const elapsedMs = performance.now() - startedAt;
  const averageMs = elapsedMs / iterations;

  return {
    name,
    iterations,
    elapsedMs,
    averageMs,
    budgetAverageMs,
    withinBudget: averageMs <= budgetAverageMs,
  };
}

export async function measureAsyncBenchmark(
  name: string,
  iterations: number,
  budgetAverageMs: number,
  run: () => Promise<void>,
): Promise<BenchmarkMeasurement> {
  const startedAt = performance.now();
  for (let index = 0; index < iterations; index += 1) {
    await run();
  }
  const elapsedMs = performance.now() - startedAt;
  const averageMs = elapsedMs / iterations;

  return {
    name,
    iterations,
    elapsedMs,
    averageMs,
    budgetAverageMs,
    withinBudget: averageMs <= budgetAverageMs,
  };
}

export function printBenchmarkReport(report: BenchmarkReport) {
  console.log(JSON.stringify(report, null, 2));
  if (report.measurements.some((measurement) => !measurement.withinBudget)) {
    process.exitCode = 1;
  }
}
