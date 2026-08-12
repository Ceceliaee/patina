import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  aggregateTypeScriptMetrics,
  measureRustSource,
  measureTypeScriptSource,
  rustStructuralSignature,
  type RustStructuralMetrics,
  type StructuralMetrics,
  type TypeScriptStructuralMetrics,
  typeScriptStructuralSignature,
} from "./quality/structuralMetrics.ts";

type MetricLimits = Partial<Record<keyof TypeScriptStructuralMetrics | keyof RustStructuralMetrics, number>>;

interface HotspotBudget {
  maxLines: number;
  metrics?: MetricLimits;
  owner: string;
  path: string;
  reason: string;
  risk: string;
}

const HOTSPOT_BUDGETS: HotspotBudget[] = [
  {
    path: "src/styles/quiet-pro.css",
    owner: "Quiet Pro design system",
    maxLines: 2008,
    risk: "shared component rules can accumulate feature-local exceptions",
    reason: "physical lines remain the stable signal for declarative CSS",
  },
  {
    path: "src/styles/tokens.css",
    owner: "Quiet Pro design tokens",
    maxLines: 1477,
    risk: "token growth can hide duplicate visual roles",
    reason: "physical lines remain the stable signal for declarative CSS",
  },
  {
    path: "src-tauri/src/data/sqlite_pool.rs",
    owner: "Rust data/sqlite pool production",
    maxLines: 850,
    metrics: {
      branchPoints: 124,
      dependencyOwners: 5,
      functionCount: 29,
      maxFunctionBranchPoints: 21,
    },
    risk: "database lifecycle, schema, and migration behavior can converge",
    reason: "production lines plus function and branch structure guard the data boundary",
  },
  {
    path: "src-tauri/src/data/storage_migration.rs",
    owner: "Rust data/storage migration production",
    maxLines: 990,
    metrics: {
      branchPoints: 100,
      dependencyOwners: 3,
      functionCount: 41,
      maxFunctionBranchPoints: 14,
    },
    risk: "filesystem migration paths are destructive and branch-heavy",
    reason: "production lines plus function and branch structure guard recovery logic",
  },
  {
    path: "src-tauri/src/data/storage_path_safety.rs",
    owner: "Rust data/storage path safety",
    maxLines: 139,
    metrics: {
      branchPoints: 25,
      dependencyOwners: 0,
      functionCount: 11,
      maxFunctionBranchPoints: 9,
    },
    risk: "path identity and write probes are the final barrier before destructive migration cleanup",
    reason: "the extracted safety owner is locked to its post-hardening production structure",
  },
  {
    path: "src-tauri/src/data/storage_migration_cleanup.rs",
    owner: "Rust storage migration cleanup safety",
    maxLines: 53,
    metrics: {
      branchPoints: 15,
      dependencyOwners: 0,
      functionCount: 3,
      maxFunctionBranchPoints: 8,
    },
    risk: "cleanup and staging replacement can destroy data if reparse points are followed",
    reason: "the exact owner budget keeps destructive removal policy small, explicit, and fail-closed",
  },
  {
    path: "src/features/history/components/History.tsx",
    owner: "history feature UI",
    maxLines: 1244,
    metrics: {
      astNodes: 5525,
      branchPoints: 123,
      crossFeatureOwners: 0,
      effectCalls: 10,
      exportCount: 1,
      hookCalls: 52,
      importOwners: 4,
      jsxAttributes: 135,
      jsxNodes: 39,
      maxFunctionAstNodes: 1817,
      maxFunctionBranchPoints: 29,
      topLevelFunctions: 9,
    },
    risk: "timeline, navigation, and presentation state can reconverge",
    reason: "AST, hooks, JSX, imports, exports, and branch metrics resist formatting games",
  },
  {
    path: "src-tauri/src/engine/tracking/runtime.rs",
    owner: "Rust tracking engine production",
    maxLines: 350,
    metrics: {
      branchPoints: 43,
      dependencyOwners: 13,
      functionCount: 4,
      maxFunctionBranchPoints: 34,
    },
    risk: "tracking policy and runtime lifecycle can become inseparable",
    reason: "production lines plus function and branch structure guard runtime complexity",
  },
  {
    path: "src-tauri/src/data/backup.rs",
    owner: "Rust data/backup production",
    maxLines: 160,
    metrics: {
      branchPoints: 13,
      dependencyOwners: 9,
      functionCount: 4,
      maxFunctionBranchPoints: 9,
    },
    risk: "backup validation and replacement behavior is data-loss sensitive",
    reason: "production lines plus function and branch structure guard safety logic",
  },
  {
    path: "src-tauri/src/engine/tools/mod.rs",
    owner: "Rust tools engine production",
    maxLines: 650,
    metrics: {
      branchPoints: 61,
      dependencyOwners: 2,
      functionCount: 49,
      maxFunctionBranchPoints: 14,
    },
    risk: "multiple tool runtimes can collapse into one state machine",
    reason: "production lines plus function and branch structure guard engine ownership",
  },
  {
    path: "src-tauri/src/data/repositories/tools.rs",
    owner: "Rust tools repository production",
    maxLines: 600,
    metrics: {
      branchPoints: 28,
      dependencyOwners: 4,
      functionCount: 20,
      maxFunctionBranchPoints: 14,
    },
    risk: "unrelated timer and reminder persistence can become coupled",
    reason: "production lines plus function and branch structure guard repository ownership",
  },
  {
    path: "src/features/data/services/dataReadModel.ts",
    owner: "data feature read model",
    maxLines: 903,
    metrics: {
      astNodes: 4176,
      branchPoints: 94,
      crossFeatureOwners: 0,
      effectCalls: 0,
      exportCount: 33,
      hookCalls: 0,
      importOwners: 3,
      jsxAttributes: 0,
      jsxNodes: 0,
      maxFunctionAstNodes: 347,
      maxFunctionBranchPoints: 12,
      topLevelFunctions: 40,
    },
    risk: "query orchestration, caching, and view-model policy can converge",
    reason: "AST, imports, exports, and branch metrics guard the read-model boundary",
  },
  {
    path: "src/features/data/components/Data.tsx",
    owner: "data feature page orchestration",
    maxLines: 1680,
    metrics: {
      astNodes: 7556,
      branchPoints: 294,
      crossFeatureOwners: 0,
      effectCalls: 20,
      exportCount: 1,
      hookCalls: 121,
      importOwners: 4,
      jsxAttributes: 112,
      jsxNodes: 12,
      maxFunctionAstNodes: 3625,
      maxFunctionBranchPoints: 143,
      topLevelFunctions: 8,
    },
    risk: "heatmap, trend, destination, cache, and retry state can reconverge in one page owner",
    reason: "the exact post-reliability-fix structure prevents any unbudgeted hotspot growth",
  },
  {
    path: "src/app/services/startupWarmupService.ts",
    owner: "app startup warmup lifecycle",
    maxLines: 564,
    metrics: {
      astNodes: 2044,
      branchPoints: 56,
      crossFeatureOwners: 5,
      effectCalls: 0,
      exportCount: 4,
      hookCalls: 0,
      importOwners: 7,
      jsxAttributes: 0,
      jsxNodes: 0,
      maxFunctionAstNodes: 247,
      maxFunctionBranchPoints: 9,
      topLevelFunctions: 10,
    },
    risk: "global controller ownership and cross-feature prewarm sequencing are race-sensitive",
    reason: "the exact post-race-fix structure prevents lifecycle responsibility from regrowing",
  },
  {
    path: "src/features/settings/services/scheduledTaskPresentation.ts",
    owner: "settings scheduled task presentation primitives",
    maxLines: 26,
    metrics: {
      astNodes: 189,
      branchPoints: 4,
      crossFeatureOwners: 0,
      effectCalls: 0,
      exportCount: 4,
      hookCalls: 0,
      importOwners: 0,
      jsxAttributes: 0,
      jsxNodes: 0,
      maxFunctionAstNodes: 60,
      maxFunctionBranchPoints: 3,
      topLevelFunctions: 4,
    },
    risk: "shared backup and export presentation helpers could absorb business state machines",
    reason: "an exact small-owner budget keeps the abstraction limited to display primitives",
  },
  {
    path: "src/app/AppShell.tsx",
    owner: "frontend app shell",
    maxLines: 394,
    metrics: {
      astNodes: 1607,
      branchPoints: 20,
      crossFeatureOwners: 7,
      effectCalls: 1,
      exportCount: 1,
      hookCalls: 27,
      importOwners: 10,
      jsxAttributes: 79,
      jsxNodes: 17,
      maxFunctionAstNodes: 924,
      maxFunctionBranchPoints: 15,
      topLevelFunctions: 2,
    },
    risk: "cross-feature composition can regrow feature behavior and lifecycle ownership",
    reason: "AST, hooks, JSX, imports, exports, and branch metrics reject line compression",
  },
];

function runSelfTest(): void {
  const jsxPretty = `
    export function Card() {
      return (
        <Panel
          title="Today"
          tone="quiet"
        >
          <span>Ready</span>
          <button type="button">Open</button>
        </Panel>
      );
    }
  `;
  const jsxCompressed = `export function Card(){return (<Panel title="Today" tone="quiet"><span>Ready</span><button type="button">Open</button></Panel>);}`;
  assert.equal(
    typeScriptStructuralSignature(measureTypeScriptSource(jsxPretty, "Card.tsx")),
    typeScriptStructuralSignature(measureTypeScriptSource(jsxCompressed, "Card.tsx")),
    "compressing JSX props and children must not reduce structural metrics",
  );

  const statementsPretty = `
    export function choose(value: number) {
      const positive = value > 0;
      const bounded = positive && value < 10;
      return bounded ? value : 0;
    }
  `;
  const statementsCompressed = "export function choose(value:number){const positive=value>0;const bounded=positive&&value<10;return bounded?value:0;}";
  assert.equal(
    typeScriptStructuralSignature(measureTypeScriptSource(statementsPretty, "choose.ts")),
    typeScriptStructuralSignature(measureTypeScriptSource(statementsCompressed, "choose.ts")),
    "compressing statements must not reduce structural metrics",
  );

  const unsplit = [{
    fileName: "owner.ts",
    content: "export function load(){if(ready()){return run();}return null;}",
  }];
  const forwardingSplit = [
    {
      fileName: "implementation.ts",
      content: "export function load(){if(ready()){return run();}return null;}",
    },
    {
      fileName: "owner.ts",
      content: "export { load } from './implementation.ts';",
    },
  ];
  const unsplitMetrics = aggregateTypeScriptMetrics(unsplit);
  const forwardingMetrics = aggregateTypeScriptMetrics(forwardingSplit);
  assert.ok(
    forwardingMetrics.astNodes >= unsplitMetrics.astNodes
      && forwardingMetrics.forwardingExports > unsplitMetrics.forwardingExports,
    "splitting into ownerless forwarding files must not look like a structural improvement",
  );

  const rustPretty = `
    fn choose(value: i32) -> i32 {
      if value > 0 {
        value
      } else {
        0
      }
    }
  `;
  const rustCompressed = "fn choose(value:i32)->i32{if value>0{value}else{0}}";
  const rustWithTests = `${rustPretty}
    #[cfg(test)]
    mod tests {
      fn helper() {
        if true { assert!(true); }
      }
    }
  `;
  const rustSignature = rustStructuralSignature(measureRustSource(rustPretty));
  assert.equal(
    rustStructuralSignature(measureRustSource(rustCompressed)),
    rustSignature,
    "Rust formatting must not change structural metrics",
  );
  assert.equal(
    rustStructuralSignature(measureRustSource(rustWithTests)),
    rustSignature,
    "cfg(test) modules must not change Rust production structural metrics",
  );
}

function measure(path: string): StructuralMetrics | { physicalLines: number } {
  const content = readFileSync(path, "utf8");
  if (path.endsWith(".rs")) {
    return measureRustSource(content);
  }
  if (path.endsWith(".ts") || path.endsWith(".tsx")) {
    return measureTypeScriptSource(content, path);
  }
  return { physicalLines: content.split(/\r?\n/).length };
}

function readLineMetric(metrics: StructuralMetrics | { physicalLines: number }): number {
  return "nonEmptyProductionLines" in metrics
    ? metrics.nonEmptyProductionLines
    : metrics.physicalLines;
}

function formatMetrics(metrics: StructuralMetrics | { physicalLines: number }): string {
  if ("astNodes" in metrics) {
    return [
      `lines=${metrics.physicalLines}`,
      `ast=${metrics.astNodes}`,
      `functions=${metrics.topLevelFunctions}`,
      `hooks=${metrics.hookCalls}`,
      `effects=${metrics.effectCalls}`,
      `jsx=${metrics.jsxNodes}/${metrics.jsxAttributes}`,
      `owners=${metrics.importOwners}`,
      `crossFeatures=${metrics.crossFeatureOwners}`,
      `exports=${metrics.exportCount}`,
      `branches=${metrics.branchPoints}`,
      `maxFnAst=${metrics.maxFunctionAstNodes}`,
      `maxFnBranches=${metrics.maxFunctionBranchPoints}`,
    ].join(" ");
  }
  if ("functionCount" in metrics) {
    return [
      `productionLines=${metrics.nonEmptyProductionLines}`,
      `functions=${metrics.functionCount}`,
      `branches=${metrics.branchPoints}`,
      `maxFnBranches=${metrics.maxFunctionBranchPoints}`,
      `owners=${metrics.dependencyOwners}`,
    ].join(" ");
  }
  return `lines=${metrics.physicalLines}`;
}

runSelfTest();
if (process.argv.includes("--self-test")) {
  console.log("Quality hotspot guard self-test passed");
  process.exit(0);
}

const failures: string[] = [];
for (const budget of HOTSPOT_BUDGETS) {
  const actual = measure(budget.path);
  const actualLines = readLineMetric(actual);
  const limits = budget.metrics ?? {};

  if (actualLines > budget.maxLines) {
    failures.push(
      `${budget.path}: lines ${actualLines} > ${budget.maxLines} (${budget.owner})`,
    );
  }
  for (const [metric, max] of Object.entries(limits)) {
    const actualMetric = metric in actual
      ? (actual as unknown as Record<string, number>)[metric]
      : undefined;
    if (actualMetric !== undefined && max !== undefined && actualMetric > max) {
      failures.push(
        `${budget.path}: ${metric} ${actualMetric} > ${max} (${budget.owner})`,
      );
    }
  }

  console.log(
    `${budget.path} | owner=${budget.owner} | ${formatMetrics(actual)} | lineBudget=${budget.maxLines}`,
  );
}

if (failures.length > 0) {
  console.error("Quality hotspot growth guard failed.");
  failures.forEach((failure) => console.error(failure));
  console.error("Split by the suggested owner; do not compress formatting or add forwarding shells.");
  process.exitCode = 1;
} else {
  console.log("Quality hotspot growth guard passed");
}
