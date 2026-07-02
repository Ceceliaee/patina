import assert from "node:assert/strict";
import {
  dedupeDataAppOptions,
  filterDataAppOptionsForQuery,
  resolveDataAppSearchSelection,
} from "../src/features/data/services/dataAppSearch.ts";
import type { DataAppOption } from "../src/features/data/services/dataReadModel.ts";

let passed = 0;

function runTest(name: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`PASS ${name}`);
}

function makeAppOption(overrides: Partial<DataAppOption>): DataAppOption {
  return {
    appKey: "cursor.exe",
    appName: "Cursor",
    exeName: "cursor.exe",
    totalDuration: 60_000,
    percentage: 10,
    averageDuration: 30_000,
    activeDayCount: 1,
    ...overrides,
  };
}

runTest("dedupeDataAppOptions merges duplicate display options", () => {
  const rows = dedupeDataAppOptions([
    makeAppOption({
      appKey: "antigravity.exe",
      appName: "Antigravity",
      exeName: "antigravity.exe",
      totalDuration: 20_000,
      percentage: 5,
      averageDuration: 10_000,
      activeDayCount: 1,
    }),
    makeAppOption({
      appKey: "Antigravity.exe",
      appName: " Antigravity ",
      exeName: "Antigravity.exe",
      totalDuration: 30_000,
      percentage: 6,
      averageDuration: 15_000,
      activeDayCount: 3,
    }),
  ]);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].totalDuration, 50_000);
  assert.equal(rows[0].percentage, 11);
  assert.equal(rows[0].averageDuration, 25_000);
  assert.equal(rows[0].activeDayCount, 3);
});

runTest("filterDataAppOptionsForQuery returns deduped options for empty query", () => {
  const options = [
    makeAppOption({ appKey: "cursor.exe", totalDuration: 20_000 }),
    makeAppOption({ appKey: "blender.exe", appName: "Blender", exeName: "blender.exe", totalDuration: 10_000 }),
  ];

  assert.equal(filterDataAppOptionsForQuery(options, "   "), options);
});

runTest("filterDataAppOptionsForQuery matches app name and executable", () => {
  const options = [
    makeAppOption({ appKey: "cursor.exe", appName: "Cursor", exeName: "cursor.exe" }),
    makeAppOption({ appKey: "blender.exe", appName: "Blender", exeName: "blender.exe" }),
  ];

  assert.deepEqual(
    filterDataAppOptionsForQuery(options, "blend").map((app) => app.appKey),
    ["blender.exe"],
  );
  assert.deepEqual(
    filterDataAppOptionsForQuery(options, "cursor.exe").map((app) => app.appKey),
    ["cursor.exe"],
  );
});

runTest("resolveDataAppSearchSelection selects first match when selected app is hidden", () => {
  const filteredOptions = [
    makeAppOption({ appKey: "blender.exe", appName: "Blender", exeName: "blender.exe" }),
  ];

  assert.equal(resolveDataAppSearchSelection({
    wasSearching: false,
    isSearching: true,
    selectedAppKey: "cursor.exe",
    selectedApp: makeAppOption({ appKey: "cursor.exe" }),
    filteredOptions,
  }), "blender.exe");
});

runTest("resolveDataAppSearchSelection clears explicit selection when search is cleared", () => {
  assert.equal(resolveDataAppSearchSelection({
    wasSearching: true,
    isSearching: false,
    selectedAppKey: "cursor.exe",
    selectedApp: makeAppOption({ appKey: "cursor.exe" }),
    filteredOptions: [],
  }), null);
});

console.log(`Passed ${passed} data app search tests`);
