import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  DATA_EXPORT_PROTOCOL_FIELDS,
  DEFAULT_DATA_EXPORT_PROTOCOL_FIELDS,
} from "../src/platform/persistence/dataExportGateway.ts";

let passed = 0;

function runTest(name: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`PASS ${name}`);
}

function readRustFieldArray(name: string): string[] {
  const source = readFileSync("src-tauri/src/data/export/common.rs", "utf8");
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


console.log(`Passed ${passed} export field contract tests`);
