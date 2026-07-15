import { readFileSync } from "node:fs";

interface HotspotBudget {
  path: string;
  owner: string;
  maxLines: number;
}

const HOTSPOT_BUDGETS: HotspotBudget[] = [
  // Includes shared Quiet Pro controls that previously lived in unowned feature/shared CSS.
  { path: "src/styles/quiet-pro.css", owner: "Quiet Pro design system", maxLines: 2147 },
  { path: "src/styles/tokens.css", owner: "Quiet Pro design tokens", maxLines: 1491 },
  { path: "src-tauri/src/data/sqlite_pool.rs", owner: "Rust data/sqlite pool", maxLines: 1488 },
  { path: "src-tauri/src/data/storage_migration.rs", owner: "Rust data/storage migration", maxLines: 1426 },
  { path: "src/features/history/components/History.tsx", owner: "history feature UI", maxLines: 1282 },
  { path: "src-tauri/src/engine/tracking/runtime.rs", owner: "Rust tracking engine", maxLines: 1272 },
  { path: "src-tauri/src/data/backup.rs", owner: "Rust data/backup", maxLines: 1114 },
  { path: "src-tauri/src/data/repositories/tools.rs", owner: "Rust tools repository", maxLines: 1083 },
  { path: "src/features/data/services/dataReadModel.ts", owner: "data feature read model", maxLines: 979 },
  { path: "src/app/AppShell.tsx", owner: "frontend app shell", maxLines: 692 },
];

function countLines(path: string): number {
  return readFileSync(path, "utf8").split(/\r?\n/).length;
}

const failures: string[] = [];

for (const budget of HOTSPOT_BUDGETS) {
  const actualLines = countLines(budget.path);
  if (actualLines > budget.maxLines) {
    failures.push(
      `${budget.path}: ${actualLines} lines exceeds ${budget.maxLines} (${budget.owner})`,
    );
  }
}

if (failures.length > 0) {
  console.error("Quality hotspot growth guard failed.");
  for (const failure of failures) {
    console.error(failure);
  }
  console.error("Split by owner or deliberately update the hotspot budget with justification.");
  process.exitCode = 1;
} else {
  console.log("Quality hotspot growth guard passed");
}
