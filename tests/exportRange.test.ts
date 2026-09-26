import assert from "node:assert/strict";
import {
  buildExportRangeSelection,
  getAdjacentExportRangeSelection,
  resolveExportRangeSelection,
} from "../src/features/settings/services/settingsDataExportRange.ts";
import {
  readExportFormat,
  readExportFields,
  normalizeExportFields,
  readExportRangeMode,
  rememberExportFormat,
  rememberExportFields,
  rememberExportRangeMode,
} from "../src/features/settings/services/settingsDataExportPreferences.ts";
import {
  SETTINGS_DATA_EXPORT_DEFAULT_FIELDS_BY_FORMAT,
  SETTINGS_DATA_EXPORT_FIELD_KEYS,
} from "../src/features/settings/services/settingsDataExportFields.ts";

let passed = 0;

async function runTest(name: string, fn: () => Promise<void> | void) {
  await fn();
  passed += 1;
  console.log(`PASS ${name}`);
}

const nowMs = new Date(2026, 6, 7, 12, 0, 0).getTime();

await runTest("preset export range uses exclusive next-day end", () => {
  const range = resolveExportRangeSelection(buildExportRangeSelection("month", nowMs), nowMs);
  assert.equal(range.startTime, new Date(2026, 6, 1).getTime());
  assert.equal(range.endTime, new Date(2026, 6, 8).getTime());
  assert.equal(range.error, null);
  assert.equal(range.dayCount, 7);
});

await runTest("custom ranges validate dates and normalize reversed calendar picks", () => {
  const resolve = (startDateKey: string, endDateKey: string) =>
    resolveExportRangeSelection({ kind: "custom", startDateKey, endDateKey }, nowMs);
  assert.equal(resolve("2026-07-01", "").error, "missingCustomRange");
  assert.equal(resolve("invalid", "2026-07-07").error, "invalidCustomRange");
  assert.equal(resolve("2026-07-03", "2026-07-01").dayCount, 3);
  assert.equal(resolve("2026-07-01", "2026-07-01").dayCount, 1);
});

await runTest("custom export navigation preserves its span across month and year boundaries", () => {
  const selected = { kind: "custom", startDateKey: "2026-01-01", endDateKey: "2026-01-03" } as const;
  const previous = getAdjacentExportRangeSelection(selected, -1, nowMs);
  assert.deepEqual(previous, { kind: "custom", startDateKey: "2025-12-29", endDateKey: "2025-12-31" });
  assert.deepEqual(getAdjacentExportRangeSelection(previous!, 1, nowMs), selected);
});

await runTest("custom navigation refuses future windows and invalid selections", () => {
  assert.equal(getAdjacentExportRangeSelection({ kind: "custom", startDateKey: "2026-07-04", endDateKey: "2026-07-06" }, 1, nowMs), null);
  assert.deepEqual(getAdjacentExportRangeSelection({ kind: "custom", startDateKey: "2026-07-01", endDateKey: "2026-07-03" }, 1, nowMs),
    { kind: "custom", startDateKey: "2026-07-04", endDateKey: "2026-07-06" });
  assert.equal(getAdjacentExportRangeSelection({ kind: "custom", startDateKey: "", endDateKey: "" }, -1, nowMs), null);
});

await runTest("preset navigation retains its day week month year sequence", () => {
  assert.equal(getAdjacentExportRangeSelection(buildExportRangeSelection("day", nowMs), -1, nowMs), null);
  assert.deepEqual(getAdjacentExportRangeSelection(buildExportRangeSelection("week", nowMs), 1, nowMs), buildExportRangeSelection("month", nowMs));
  assert.equal(getAdjacentExportRangeSelection(buildExportRangeSelection("year", nowMs), 1, nowMs), null);
});

await runTest("calendar weeks months and years move by their own periods", () => {
  for (const [kind, anchorDateKey, expected] of [
    ["week", "2026-07-07", "2026-06-29"],
    ["month", "2026-01-31", "2025-12-01"],
    ["year", "2026-07-07", "2025-01-01"],
  ] as const) {
    assert.deepEqual(getAdjacentExportRangeSelection({ kind, anchorDateKey }, -1, nowMs, true),
      { kind, anchorDateKey: expected });
    assert.equal(getAdjacentExportRangeSelection({ kind, anchorDateKey: "2026-07-07" }, 1, nowMs, true), null);
  }
  const february = getAdjacentExportRangeSelection({ kind: "month", anchorDateKey: "2024-01-31" }, 1, nowMs, true)!;
  const resolved = resolveExportRangeSelection(february, nowMs);
  assert.equal(resolved.startDateKey, "2024-02-01");
  assert.equal(resolved.endDateKey, "2024-02-29");
});

await runTest("export preferences default to month and csv, then persist valid choices", () => {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => {
          store.set(key, value);
        },
      },
    },
  });

  assert.equal(readExportRangeMode(), "month");
  assert.equal(readExportFormat(), "csv");

  rememberExportRangeMode("week");
  rememberExportFormat("parquet");
  assert.equal(readExportRangeMode(), "week");
  assert.equal(readExportFormat(), "parquet");
});

await runTest("export field preferences stay independent per format", () => {
  rememberExportFields("csv", ["record_type", "start_time"]);
  rememberExportFields("markdown", ["source_name", "duration_minutes"]);
  assert.deepEqual(
    readExportFields("csv", SETTINGS_DATA_EXPORT_DEFAULT_FIELDS_BY_FORMAT.csv),
    ["record_type", "start_time"],
  );
  assert.deepEqual(
    readExportFields("markdown", SETTINGS_DATA_EXPORT_DEFAULT_FIELDS_BY_FORMAT.markdown),
    ["duration_minutes", "source_name"],
  );
});

await runTest("export field preferences remove unknown and duplicate fields and enforce canonical order", () => {
  assert.deepEqual(
    normalizeExportFields(["start_time", "unknown", "start_time", "category"], SETTINGS_DATA_EXPORT_DEFAULT_FIELDS_BY_FORMAT.csv),
    ["category", "start_time"],
  );
  assert.deepEqual(
    normalizeExportFields([], SETTINGS_DATA_EXPORT_DEFAULT_FIELDS_BY_FORMAT.markdown),
    SETTINGS_DATA_EXPORT_FIELD_KEYS.filter((field) => (
      SETTINGS_DATA_EXPORT_DEFAULT_FIELDS_BY_FORMAT.markdown as readonly string[]
    ).includes(field)),
  );
});

console.log(`Passed ${passed} export range tests`);
