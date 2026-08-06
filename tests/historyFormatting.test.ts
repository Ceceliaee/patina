import assert from "node:assert/strict";
import { formatDuration, formatTime } from "../src/features/history/services/historyFormatting.ts";

let passed = 0;

async function runTest(name: string, fn: () => Promise<void> | void) {
  await fn();
  passed += 1;
  console.log(`PASS ${name}`);
}

function localTimeMs(hour: number, minute: number) {
  return new Date(2026, 0, 2, hour, minute, 0).getTime();
}

await runTest("history time formatting stays 24-hour in English", () => {
  assert.equal(formatTime(localTimeMs(8, 5), "en-US"), "08:05");
  assert.equal(formatTime(localTimeMs(17, 30), "en-US"), "17:30");
});

await runTest("history time formatting uses midnight as 00:00", () => {
  assert.equal(formatTime(localTimeMs(0, 0), "en-US"), "00:00");
});

await runTest("shared duration formatting keeps compact history labels", () => {
  assert.equal(formatDuration(-1), "0s");
  assert.equal(formatDuration(999), "0s");
  assert.equal(formatDuration(1_000), "1s");
  assert.equal(formatDuration(60_000), "1m");
  assert.equal(formatDuration(3_900_000), "1h 5m");
});

console.log(`Passed ${passed} history formatting tests`);
