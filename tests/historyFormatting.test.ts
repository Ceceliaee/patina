import assert from "node:assert/strict";
import { formatTime } from "../src/features/history/services/historyFormatting.ts";
import { setUiTextLanguage } from "../src/shared/copy/uiText.ts";

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
  setUiTextLanguage("en-US");

  assert.equal(formatTime(localTimeMs(8, 5)), "08:05");
  assert.equal(formatTime(localTimeMs(17, 30)), "17:30");
});

await runTest("history time formatting uses midnight as 00:00", () => {
  setUiTextLanguage("en-US");

  assert.equal(formatTime(localTimeMs(0, 0)), "00:00");
});

setUiTextLanguage("zh-CN");

console.log(`Passed ${passed} history formatting tests`);
