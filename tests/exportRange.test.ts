import assert from "node:assert/strict";
import {
  countInclusiveDays,
  getPresetDateInputs,
  resolveExportTimeRange,
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

await runTest("current month preset resolves to visible date inputs", () => {
  assert.deepEqual(getPresetDateInputs("thisMonth", nowMs), {
    startDateKey: "2026-07-01",
    endDateKey: "2026-07-07",
  });
});

await runTest("preset export range uses exclusive next-day end", () => {
  const range = resolveExportTimeRange({
    preset: "thisMonth",
    customStart: "",
    customEnd: "",
    nowMs,
  });

  assert.equal(range.startTime, new Date(2026, 6, 1).getTime());
  assert.equal(range.endTime, new Date(2026, 6, 8).getTime());
  assert.equal(range.error, null);
  assert.equal(range.startDateKey, "2026-07-01");
  assert.equal(range.endDateKey, "2026-07-07");
  assert.equal(range.dayCount, 7);
});

await runTest("custom range rejects missing and reversed dates", () => {
  assert.equal(
    resolveExportTimeRange({
      preset: "custom",
      customStart: "2026-07-01",
      customEnd: "",
      nowMs,
    }).error,
    "missingCustomRange",
  );
  assert.equal(
    resolveExportTimeRange({
      preset: "custom",
      customStart: "2026-07-08",
      customEnd: "2026-07-07",
      nowMs,
    }).error,
    "invalidCustomRange",
  );
});

await runTest("inclusive day counts match custom range length", () => {
  assert.equal(countInclusiveDays("2026-07-01", "2026-07-01"), 1);
  assert.equal(countInclusiveDays("2026-07-01", "2026-07-03"), 3);
  assert.equal(countInclusiveDays("2026-07-03", "2026-07-01"), null);
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
