import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { extname, join, relative } from "node:path";

const ARBITRARY_RADIUS_BASELINE: Record<string, number> = {
  "src/app/components/AppSidebar.tsx": 2,
  "src/features/update/components/UpdateStatusPanel.tsx": 0,
  "src/shared/components/QuietStepperSlider.tsx": 0,
  "src/features/dashboard/components/Dashboard.tsx": 2,
  "src/features/classification/components/WebDomainMappingCard.tsx": 4,
  "src/features/classification/components/AppMappingCandidateCard.tsx": 4,
  "src/features/classification/components/AppMapping.tsx": 4,
  "src/features/classification/components/CategoryColorControls.tsx": 1,
  "src/features/settings/components/Settings.tsx": 3,
  "src/features/history/components/History.tsx": 2,
  "src/features/settings/components/SettingsDataSafetyPanel.tsx": 6,
  "src/features/settings/components/SettingsRemoteBackupPanel.tsx": 9,
  "src/features/history/components/HistoryTimelineDialogDateControls.tsx": 2,
  "src/features/history/components/HistoryTimelineLists.tsx": 2,
};

const CANONICAL_SCROLL_REGION_PATH = "src/styles/components/quiet-scroll-region.css";
const SOURCE_EXTENSIONS = new Set([".css", ".js", ".jsx", ".ts", ".tsx"]);

type SourceFile = {
  path: string;
  content: string;
};

function normalizePath(path: string) {
  return path.replaceAll("\\", "/");
}

function collectSourceFiles(root: string): SourceFile[] {
  const files: SourceFile[] = [];
  const visit = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(path);
      } else if (SOURCE_EXTENSIONS.has(extname(entry.name))) {
        files.push({
          path: normalizePath(relative(process.cwd(), path)),
          content: readFileSync(path, "utf8"),
        });
      }
    }
  };
  visit(root);
  return files;
}

export function findScrollRegionStyleDebt(sources: readonly SourceFile[]) {
  const failures: string[] = [];
  for (const source of sources) {
    const path = normalizePath(source.path);
    const canonical = path === CANONICAL_SCROLL_REGION_PATH;
    if (/\bcustom-scrollbar\b/.test(source.content)) {
      failures.push(`${path}: legacy custom-scrollbar class is forbidden`);
    }
    if (!canonical && /scrollbar-gutter\s*:/.test(source.content)) {
      failures.push(`${path}: scrollbar-gutter belongs to ${CANONICAL_SCROLL_REGION_PATH}`);
    }
    if (!canonical && /::?-webkit-scrollbar(?:-[a-z-]+)?/.test(source.content)) {
      failures.push(`${path}: scrollbar pseudo rules belong to ${CANONICAL_SCROLL_REGION_PATH}`);
    }
    if (canonical && /scrollbar-button:single-button(?!:vertical)/.test(source.content)) {
      failures.push(`${path}: scrollbar buttons must remain vertical-only`);
    }
    if (!canonical && /qp-scroll-region-stable/.test(source.content)) {
      const stableIndex = source.content.indexOf("qp-scroll-region-stable");
      const classContext = source.content.slice(
        Math.max(0, stableIndex - 160),
        stableIndex + "qp-scroll-region-stable".length + 160,
      );
      if (!/[\s"'`]qp-scroll-region(?:[\s"'`]|$)/.test(classContext)) {
        failures.push(`${path}: qp-scroll-region-stable must include the qp-scroll-region base class`);
      }
    }
  }
  return failures;
}

function runSelfTest() {
  assert.deepEqual(findScrollRegionStyleDebt([
    { path: "src/features/example/Example.tsx", content: '<div className="custom-scrollbar" />' },
  ]), ["src/features/example/Example.tsx: legacy custom-scrollbar class is forbidden"]);
  assert.deepEqual(findScrollRegionStyleDebt([
    { path: "src/styles/features/example.css", content: ".list { scrollbar-gutter: stable; }" },
  ]), [
    `src/styles/features/example.css: scrollbar-gutter belongs to ${CANONICAL_SCROLL_REGION_PATH}`,
  ]);
  assert.deepEqual(findScrollRegionStyleDebt([
    { path: "src/styles/features/example.css", content: ".list::-webkit-scrollbar { width: 8px; }" },
  ]), [
    `src/styles/features/example.css: scrollbar pseudo rules belong to ${CANONICAL_SCROLL_REGION_PATH}`,
  ]);
  assert.deepEqual(findScrollRegionStyleDebt([
    { path: "src/features/example/Example.tsx", content: '<div className="qp-scroll-region-stable" />' },
  ]), [
    "src/features/example/Example.tsx: qp-scroll-region-stable must include the qp-scroll-region base class",
  ]);
  assert.deepEqual(findScrollRegionStyleDebt([
    {
      path: CANONICAL_SCROLL_REGION_PATH,
      content: ".qp-scroll-region::-webkit-scrollbar-button:single-button { display: block; }",
    },
  ]), [
    `${CANONICAL_SCROLL_REGION_PATH}: scrollbar buttons must remain vertical-only`,
  ]);
  assert.deepEqual(findScrollRegionStyleDebt([
    {
      path: CANONICAL_SCROLL_REGION_PATH,
      content: ".qp-scroll-region { scrollbar-gutter: auto; }\n.qp-scroll-region::-webkit-scrollbar { width: 10px; }",
    },
    { path: "src/styles/features/example.css", content: ".list { overflow-y: auto; }" },
  ]), []);
  console.log("Quiet Pro scroll-region style debt self-test passed (7 adversarial cases)");
}

if (process.argv.includes("--self-test")) {
  runSelfTest();
  process.exit(0);
}

const failures: string[] = [];
for (const [path, budget] of Object.entries(ARBITRARY_RADIUS_BASELINE)) {
  const count = readFileSync(path, "utf8").match(/rounded-\[/g)?.length ?? 0;
  if (count > budget) failures.push(`${path}: ${count} arbitrary radii exceeds debt baseline ${budget}`);
  if (count < budget) failures.push(`${path}: debt shrank to ${count}; tighten baseline ${budget}`);
}
failures.push(...findScrollRegionStyleDebt(collectSourceFiles("src")));

if (failures.length > 0) {
  console.error("Quiet Pro style debt guard failed.");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exitCode = 1;
} else {
  const totalBaseline = Object.values(ARBITRARY_RADIUS_BASELINE)
    .reduce((total, count) => total + count, 0);
  console.log(
    `Quiet Pro style debt guard passed (${totalBaseline} exact historical radius occurrences; scroll-region owner clean)`,
  );
}
