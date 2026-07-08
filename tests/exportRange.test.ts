import assert from "node:assert/strict";
import {
  countInclusiveDays,
  getPresetDateInputs,
  resolveExportTimeRange,
} from "../src/features/settings/services/settingsDataExportRange.ts";
import {
  readExportFormat,
  readExportRangeMode,
  rememberExportFormat,
  rememberExportRangeMode,
} from "../src/features/settings/services/settingsDataExportPreferences.ts";

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

console.log(`Passed ${passed} export range tests`);
