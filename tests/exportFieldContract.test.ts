import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  DATA_EXPORT_PROTOCOL_FIELDS,
  DEFAULT_DATA_EXPORT_PROTOCOL_FIELDS,
} from "../src/platform/persistence/dataExportGateway.ts";
import { SETTINGS_DATA_EXPORT_FIELD_GROUPS } from "../src/features/settings/services/settingsDataExportFields.ts";

let passed = 0;

function runTest(name: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`PASS ${name}`);
}

function readRustFieldArray(name: string): string[] {
  const source = readFileSync("src-tauri/src/engine/export/common.rs", "utf8");
  const pattern = new RegExp(`pub const ${name}: &\\[&str\\] = &\\[([\\s\\S]*?)\\];`);
  const match = pattern.exec(source);
  assert.ok(match, `missing Rust field array ${name}`);
  return [...match[1].matchAll(/"([^"]+)"/g)].map((item) => item[1]);
}

runTest("frontend default export protocol fields match Rust defaults", () => {
  assert.deepEqual([...DEFAULT_DATA_EXPORT_PROTOCOL_FIELDS], readRustFieldArray("DEFAULT_EXPORT_FIELDS"));
});

runTest("frontend export protocol fields match Rust allowed fields", () => {
  assert.deepEqual([...DATA_EXPORT_PROTOCOL_FIELDS], readRustFieldArray("ALL_EXPORT_FIELDS"));
});

runTest("six export field groups cover all 32 fields exactly once", () => {
  assert.equal(SETTINGS_DATA_EXPORT_FIELD_GROUPS.length, 6);
  const grouped = SETTINGS_DATA_EXPORT_FIELD_GROUPS.flatMap((group) => group.fields);
  assert.equal(grouped.length, 32);
  assert.equal(new Set(grouped).size, 32);
  assert.deepEqual(new Set(grouped), new Set(DATA_EXPORT_PROTOCOL_FIELDS));
});

console.log(`Passed ${passed} export field contract tests`);
