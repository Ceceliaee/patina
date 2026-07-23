import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

const ASSETS_DIR = "dist/assets";
const INDEX_HTML_PATH = "dist/index.html";
const COPY_DOMAINS_DIR = "src/shared/copy/domains";
const KI_B = 1024;

const INITIAL_JS_AND_CSS_GZIP_BUDGET_KI_B = 310;
// Generic import, unified exclusion semantics, and the reviewed Web Sync store
// shortcuts add lazy-page workflows. Keep page-specific and total budgets
// unchanged; the 0.25 KiB aggregate headroom absorbs cross-runner gzip variation.
const LAZY_JS_GZIP_BUDGET_KI_B = 85.5;
const TOTAL_JS_AND_CSS_GZIP_BUDGET_KI_B = 390;

const INITIAL_CHUNK_BUDGETS = [
  { label: "index", pattern: /^index-.*\.js$/, gzipKiB: 65 },
  { label: "charts", pattern: /^charts-.*\.js$/, gzipKiB: 118 },
  { label: "react-vendor", pattern: /^react-vendor-.*\.js$/, gzipKiB: 60 },
  { label: "icons", pattern: /^icons-.*\.js$/, gzipKiB: 8 },
  { label: "tauri", pattern: /^tauri-.*\.js$/, gzipKiB: 6 },
] as const;

const LAZY_PAGE_CHUNK_BUDGETS = [
  { label: "Settings", pattern: /^Settings-.*\.js$/, gzipKiB: 24 },
  { label: "AppMapping", pattern: /^AppMapping-.*\.js$/, gzipKiB: 18 },
  { label: "History", pattern: /^History-.*\.js$/, gzipKiB: 18 },
  { label: "Tools", pattern: /^Tools-.*\.js$/, gzipKiB: 18 },
  { label: "Data", pattern: /^Data-.*\.js$/, gzipKiB: 18 },
  { label: "About", pattern: /^About-.*\.js$/, gzipKiB: 18 },
] as const;

// Stable cross-feature UI owners stay lazy and receive their own narrow budget
// instead of consuming the allowance for unowned support chunks.
const LAZY_SHARED_UI_CHUNK_BUDGETS = [
  { label: "QuietBadge", pattern: /^QuietBadge-.*\.js$/, gzipKiB: 0.3 },
  { label: "QuietCalendar", pattern: /^QuietCalendar-.*\.js$/, gzipKiB: 1.3 },
  { label: "QuietSegmentedFilter", pattern: /^QuietSegmentedFilter-.*\.js$/, gzipKiB: 0.8 },
] as const;

// Vite 8/Rolldown creates more granular shared chunks. The support allowance is
// slightly wider while every aggregate and initial-chunk budget is materially tighter.
const LAZY_SUPPORT_CHUNKS_GZIP_BUDGET_KI_B = 6.25;
const SETTINGS_COPY_GZIP_BUDGET_KI_B = 12;
// Import preview, destructuring, and batch deletion require matching bilingual copy.
const COPY_DOMAINS_GZIP_BUDGET_KI_B = 31;
const NON_SETTINGS_COPY_GZIP_REVIEW_KI_B = 4;

type AssetMeasurement = {
  file: string;
  gzipBytes: number;
  rawBytes: number;
};

type ChunkBudget = {
  gzipKiB: number;
  label: string;
  pattern: RegExp;
};

function formatKiB(bytes: number) {
  return (bytes / KI_B).toFixed(2);
}

function findBudgetAsset(measured: AssetMeasurement[], budget: ChunkBudget) {
  return measured.find((item) => budget.pattern.test(item.file));
}

function matchesAnyBudget(file: string, budgets: readonly ChunkBudget[]) {
  return budgets.some((budget) => budget.pattern.test(file));
}

function sumGzipBytes(measured: AssetMeasurement[]) {
  return measured.reduce((sum, item) => sum + item.gzipBytes, 0);
}

function readInitialAssetNames() {
  if (!existsSync(INDEX_HTML_PATH)) {
    console.error(`Bundle budget check failed. Missing ${INDEX_HTML_PATH}; run npm run build first.`);
    process.exitCode = 1;
    return null;
  }

  const html = readFileSync(INDEX_HTML_PATH, "utf8");
  const assets = new Set<string>();
  const assetPattern = /(?:src|href)=["']\/assets\/([^"']+)["']/g;
  for (const match of html.matchAll(assetPattern)) {
    assets.add(match[1]);
  }
  return assets;
}

function measureDistAssets() {
  if (!existsSync(ASSETS_DIR)) {
    console.error(`Bundle budget check failed. Missing ${ASSETS_DIR}; run npm run build first.`);
    process.exitCode = 1;
    return null;
  }

  return readdirSync(ASSETS_DIR)
    .filter((file) => file.endsWith(".js") || file.endsWith(".css"))
    .map((file) => {
      const bytes = readFileSync(join(ASSETS_DIR, file));
      return {
        file,
        rawBytes: bytes.length,
        gzipBytes: gzipSync(bytes).length,
      };
    });
}

function checkChunkBudgets(
  label: string,
  measured: AssetMeasurement[],
  budgets: readonly ChunkBudget[],
  violations: string[],
) {
  for (const budget of budgets) {
    const asset = findBudgetAsset(measured, budget);
    if (!asset) {
      violations.push(`missing expected ${label} ${budget.label} chunk`);
      continue;
    }

    const budgetBytes = budget.gzipKiB * KI_B;
    if (asset.gzipBytes > budgetBytes) {
      violations.push(
        `${label} ${budget.label} gzip ${formatKiB(asset.gzipBytes)} KiB exceeds ${budget.gzipKiB} KiB`,
      );
    }
  }
}

function measureCopyDomains() {
  if (!existsSync(COPY_DOMAINS_DIR)) {
    return null;
  }

  return readdirSync(COPY_DOMAINS_DIR)
    .filter((file) => file.endsWith(".ts"))
    .map((file) => {
      const bytes = readFileSync(join(COPY_DOMAINS_DIR, file));
      return {
        file,
        rawBytes: bytes.length,
        gzipBytes: gzipSync(bytes).length,
      };
    });
}

function main() {
  const initialAssetNames = readInitialAssetNames();
  const measured = measureDistAssets();
  if (!initialAssetNames || !measured) {
    return;
  }

  const jsAssets = measured.filter((item) => item.file.endsWith(".js"));
  const cssAssets = measured.filter((item) => item.file.endsWith(".css"));
  const initialJsAssets = jsAssets.filter((item) => initialAssetNames.has(item.file));
  const initialCssAssets = cssAssets.filter((item) => initialAssetNames.has(item.file));
  const lazyJsAssets = jsAssets.filter((item) => !initialAssetNames.has(item.file));
  const lazySupportAssets = lazyJsAssets.filter((item) => (
    !matchesAnyBudget(item.file, LAZY_PAGE_CHUNK_BUDGETS)
    && !matchesAnyBudget(item.file, LAZY_SHARED_UI_CHUNK_BUDGETS)
  ));

  const violations: string[] = [];
  const copyDomains = measureCopyDomains();

  const initialJsCssGzipBytes = sumGzipBytes(initialJsAssets) + sumGzipBytes(initialCssAssets);
  if (initialJsCssGzipBytes > INITIAL_JS_AND_CSS_GZIP_BUDGET_KI_B * KI_B) {
    violations.push(
      `initial JS+CSS gzip ${formatKiB(initialJsCssGzipBytes)} KiB exceeds ${INITIAL_JS_AND_CSS_GZIP_BUDGET_KI_B} KiB`,
    );
  }

  const lazyJsGzipBytes = sumGzipBytes(lazyJsAssets);
  if (lazyJsGzipBytes > LAZY_JS_GZIP_BUDGET_KI_B * KI_B) {
    violations.push(
      `lazy JS gzip ${formatKiB(lazyJsGzipBytes)} KiB exceeds ${LAZY_JS_GZIP_BUDGET_KI_B} KiB`,
    );
  }

  const totalJsCssGzipBytes = sumGzipBytes(jsAssets) + sumGzipBytes(cssAssets);
  if (totalJsCssGzipBytes > TOTAL_JS_AND_CSS_GZIP_BUDGET_KI_B * KI_B) {
    violations.push(
      `total JS+CSS gzip ${formatKiB(totalJsCssGzipBytes)} KiB exceeds ${TOTAL_JS_AND_CSS_GZIP_BUDGET_KI_B} KiB`,
    );
  }

  checkChunkBudgets("initial", jsAssets, INITIAL_CHUNK_BUDGETS, violations);
  checkChunkBudgets("lazy page", lazyJsAssets, LAZY_PAGE_CHUNK_BUDGETS, violations);
  checkChunkBudgets("lazy shared UI", lazyJsAssets, LAZY_SHARED_UI_CHUNK_BUDGETS, violations);

  const lazySupportGzipBytes = sumGzipBytes(lazySupportAssets);
  if (lazySupportGzipBytes > LAZY_SUPPORT_CHUNKS_GZIP_BUDGET_KI_B * KI_B) {
    violations.push(
      `lazy support chunks gzip ${formatKiB(lazySupportGzipBytes)} KiB exceeds ${LAZY_SUPPORT_CHUNKS_GZIP_BUDGET_KI_B} KiB`,
    );
  }

  if (copyDomains) {
    const copyDomainsGzipBytes = sumGzipBytes(copyDomains);
    const settingsCopy = copyDomains.find((item) => item.file === "settingsCopy.ts");
    if (settingsCopy && settingsCopy.gzipBytes > SETTINGS_COPY_GZIP_BUDGET_KI_B * KI_B) {
      violations.push(
        `settingsCopy source gzip ${formatKiB(settingsCopy.gzipBytes)} KiB exceeds ${SETTINGS_COPY_GZIP_BUDGET_KI_B} KiB`,
      );
    }

    if (copyDomainsGzipBytes > COPY_DOMAINS_GZIP_BUDGET_KI_B * KI_B) {
      violations.push(
        `copy domains source gzip ${formatKiB(copyDomainsGzipBytes)} KiB exceeds ${COPY_DOMAINS_GZIP_BUDGET_KI_B} KiB`,
      );
    }

    for (const item of copyDomains) {
      if (item.file !== "settingsCopy.ts" && item.gzipBytes > NON_SETTINGS_COPY_GZIP_REVIEW_KI_B * KI_B) {
        violations.push(
          `${item.file} source gzip ${formatKiB(item.gzipBytes)} KiB exceeds ${NON_SETTINGS_COPY_GZIP_REVIEW_KI_B} KiB`,
        );
      }
    }
  }

  if (violations.length > 0) {
    console.error("Bundle budget check failed.");
    for (const violation of violations) {
      console.error(`- ${violation}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log("Bundle budget check passed.");
  console.log(`initial JS+CSS: ${formatKiB(initialJsCssGzipBytes)} KiB gzip`);
  console.log(`lazy JS: ${formatKiB(lazyJsGzipBytes)} KiB gzip`);
  console.log(`total JS+CSS: ${formatKiB(totalJsCssGzipBytes)} KiB gzip`);

  console.log("initial chunks:");
  for (const budget of INITIAL_CHUNK_BUDGETS) {
    const asset = findBudgetAsset(jsAssets, budget);
    if (asset) {
      console.log(`- ${budget.label}: ${formatKiB(asset.gzipBytes)} KiB gzip`);
    }
  }

  console.log("lazy page chunks:");
  for (const budget of LAZY_PAGE_CHUNK_BUDGETS) {
    const asset = findBudgetAsset(lazyJsAssets, budget);
    if (asset) {
      console.log(`- ${budget.label}: ${formatKiB(asset.gzipBytes)} KiB gzip`);
    }
  }
  console.log("lazy shared UI chunks:");
  for (const budget of LAZY_SHARED_UI_CHUNK_BUDGETS) {
    const asset = findBudgetAsset(lazyJsAssets, budget);
    if (asset) {
      console.log(`- ${budget.label}: ${formatKiB(asset.gzipBytes)} KiB gzip`);
    }
  }
  console.log(`lazy support chunks: ${formatKiB(lazySupportGzipBytes)} KiB gzip`);

  if (copyDomains) {
    const copyDomainsGzipBytes = sumGzipBytes(copyDomains);
    const settingsCopy = copyDomains.find((item) => item.file === "settingsCopy.ts");
    console.log(`copy domains source attribution: ${formatKiB(copyDomainsGzipBytes)} KiB gzip`);
    if (settingsCopy) {
      console.log(`settingsCopy source attribution: ${formatKiB(settingsCopy.gzipBytes)} KiB gzip`);
    }
  }

}

main();
