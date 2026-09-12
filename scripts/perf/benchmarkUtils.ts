import { performance } from "node:perf_hooks";

export interface BenchmarkMeasurement {
  name: string;
  iterations: number;
  elapsedMs: number;
  averageMs: number;
  minMs: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
  budgetAverageMs: number;
  budgetP95Ms: number;
  budgetMaxMs: number;
  withinBudget: boolean;
}

export interface BenchmarkReport {
  benchmark: string;
  measuredAt: string;
  measurements: BenchmarkMeasurement[];
  metadata?: Record<string, unknown>;
}

interface BenchmarkBudget {
  averageMs: number;
  p95Ms: number;
  maxMs: number;
}

export function createBenchmarkMeasurement(
  name: string,
  durations: number[],
  budget: number | BenchmarkBudget,
): BenchmarkMeasurement {
  const elapsedMs = durations.reduce((sum, duration) => sum + duration, 0);
  const averageMs = durations.length > 0 ? elapsedMs / durations.length : 0;
  const distribution = summarizeDurations(durations);
  const budgetAverageMs = typeof budget === "number" ? budget : budget.averageMs;
  const p95Multiplier = durations.length < 50 ? 2 : 1.5;
  const budgetP95Ms = typeof budget === "number"
    ? Math.max(budgetAverageMs * p95Multiplier, budgetAverageMs + 5)
    : budget.p95Ms;
  // Max captures one-off GC/scheduler stalls and is intentionally wider than
  // p95, while still turning pathological spikes into a hard failure.
  const budgetMaxMs = typeof budget === "number" ? budgetAverageMs * 4 : budget.maxMs;

  return {
    name,
    iterations: durations.length,
    elapsedMs,
    averageMs,
    ...distribution,
    budgetAverageMs,
    budgetP95Ms,
    budgetMaxMs,
    withinBudget: averageMs <= budgetAverageMs
      && distribution.p95Ms <= budgetP95Ms
      && distribution.maxMs <= budgetMaxMs,
  };
}

export function measureBenchmark(
  name: string,
  iterations: number,
  budget: number | BenchmarkBudget,
  run: () => void,
): BenchmarkMeasurement {
  const durations: number[] = [];
  for (let index = 0; index < iterations; index += 1) {
    const iterationStartedAt = performance.now();
    run();
    durations.push(performance.now() - iterationStartedAt);
  }
  return createBenchmarkMeasurement(name, durations, budget);
}

export async function measureAsyncBenchmark(
  name: string,
  iterations: number,
  budget: number | BenchmarkBudget,
  run: () => Promise<void>,
): Promise<BenchmarkMeasurement> {
  const durations: number[] = [];
  for (let index = 0; index < iterations; index += 1) {
    const iterationStartedAt = performance.now();
    await run();
    durations.push(performance.now() - iterationStartedAt);
  }
  return createBenchmarkMeasurement(name, durations, budget);
}

function percentile(sortedDurations: number[], percentileValue: number): number {
  if (sortedDurations.length === 0) return 0;
  const index = Math.min(
    sortedDurations.length - 1,
    Math.max(0, Math.ceil(sortedDurations.length * percentileValue) - 1),
  );
  return sortedDurations[index];
}

function summarizeDurations(durations: number[]) {
  const sortedDurations = durations.slice().sort((left, right) => left - right);

  return {
    minMs: sortedDurations[0] ?? 0,
    p50Ms: percentile(sortedDurations, 0.5),
    p95Ms: percentile(sortedDurations, 0.95),
    maxMs: sortedDurations.at(-1) ?? 0,
  };
}

export function printBenchmarkReport(report: BenchmarkReport) {
  console.log(JSON.stringify(report, null, 2));
  if (report.measurements.some((measurement) => !measurement.withinBudget)) {
    process.exitCode = 1;
  }
}
