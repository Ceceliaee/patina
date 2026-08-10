import { readFileSync } from "node:fs";

type CoverageMetricName = "statements" | "branches" | "functions" | "lines";

interface CoverageMetric {
  total: number;
  covered: number;
  skipped: number;
  pct: number;
}

interface FileCoverage {
  statements: CoverageMetric;
  branches: CoverageMetric;
  functions: CoverageMetric;
  lines: CoverageMetric;
}

interface CoverageThreshold {
  path: string;
  minimum: Record<CoverageMetricName, number>;
}

const COVERAGE_SUMMARY_PATH = "artifacts/coverage/coverage-summary.json";
const HIGH_RISK_THRESHOLDS: CoverageThreshold[] = [
  {
    path: "src/app/services/startupWarmupService.ts",
    minimum: { statements: 90, branches: 85, functions: 90, lines: 90 },
  },
  {
    path: "src/features/data/services/dataHeatmapSnapshot.ts",
    minimum: { statements: 90, branches: 85, functions: 90, lines: 90 },
  },
  {
    path: "src/features/data/services/dataWebActivityReadModel.ts",
    minimum: { statements: 90, branches: 85, functions: 90, lines: 90 },
  },
  {
    path: "src/features/data/services/dataWebHeatmapRequestState.ts",
    minimum: { statements: 90, branches: 85, functions: 90, lines: 90 },
  },
  {
    path: "src/platform/persistence/webActivityAnalysisGateway.ts",
    minimum: { statements: 90, branches: 85, functions: 90, lines: 90 },
  },
];
const METRICS: CoverageMetricName[] = ["statements", "branches", "functions", "lines"];

function normalizePath(path: string) {
  return path.replaceAll("\\", "/");
}

function findFileCoverage(
  summary: Record<string, unknown>,
  expectedPath: string,
): FileCoverage | null {
  const normalizedExpected = `/${normalizePath(expectedPath)}`;
  for (const [path, coverage] of Object.entries(summary)) {
    if (path === "total") continue;
    if (normalizePath(path).endsWith(normalizedExpected)) {
      return coverage as FileCoverage;
    }
  }
  return null;
}

function auditCoverage(
  summary: Record<string, unknown>,
  thresholds = HIGH_RISK_THRESHOLDS,
) {
  const failures: string[] = [];
  for (const threshold of thresholds) {
    const coverage = findFileCoverage(summary, threshold.path);
    if (!coverage) {
      failures.push(`${threshold.path}: missing from coverage summary`);
      continue;
    }
    for (const metric of METRICS) {
      const actual = coverage[metric]?.pct;
      const minimum = threshold.minimum[metric];
      if (typeof actual !== "number" || !Number.isFinite(actual)) {
        failures.push(`${threshold.path}: ${metric} coverage is invalid`);
      } else if (actual < minimum) {
        failures.push(
          `${threshold.path}: ${metric} ${actual.toFixed(2)}% is below ${minimum.toFixed(2)}%`,
        );
      }
    }
  }
  return failures;
}

function metric(pct: number): CoverageMetric {
  return { total: 100, covered: pct, skipped: 0, pct };
}

function runSelfTest() {
  const validCoverage: FileCoverage = {
    statements: metric(90),
    branches: metric(85),
    functions: metric(90),
    lines: metric(90),
  };
  const threshold = HIGH_RISK_THRESHOLDS[0];
  const valid = {
    [`C:\\repo\\${threshold.path.replaceAll("/", "\\")}`]: validCoverage,
  };
  if (auditCoverage(valid, [threshold]).length > 0) {
    throw new Error("coverage threshold self-test rejected a valid Windows path");
  }

  const lowBranches = {
    [`/repo/${threshold.path}`]: {
      ...validCoverage,
      branches: metric(84.99),
    },
  };
  const lowFailures = auditCoverage(lowBranches, [threshold]);
  if (!lowFailures.some((failure) => failure.includes("branches 84.99%"))) {
    throw new Error("coverage threshold self-test did not reject a low per-file branch result");
  }

  const missingFailures = auditCoverage({}, [threshold]);
  if (!missingFailures.some((failure) => failure.includes("missing from coverage summary"))) {
    throw new Error("coverage threshold self-test did not reject a missing high-risk owner");
  }

  console.log("Coverage threshold self-test passed");
}

if (process.argv.includes("--self-test")) {
  runSelfTest();
} else {
  const summary = JSON.parse(readFileSync(COVERAGE_SUMMARY_PATH, "utf8")) as Record<string, unknown>;
  const failures = auditCoverage(summary);
  if (failures.length > 0) {
    console.error("High-risk per-file coverage gate failed:");
    for (const failure of failures) console.error(`- ${failure}`);
    process.exitCode = 1;
  } else {
    console.log(
      `High-risk per-file coverage gate passed (${HIGH_RISK_THRESHOLDS.length} owners, 90/85/90/90 minimums)`,
    );
  }
}
