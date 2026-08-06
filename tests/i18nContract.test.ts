import assert from "node:assert/strict";
import { MESSAGES as RUSSIAN_FIXTURE } from "../locales/fixtures/ru-RU/plurals.ts";
import { cardinalPluralCategory, formatMessageDescriptor, getLocaleText } from "../src/shared/i18n/runtime.ts";

const russianCases = new Map<number, string>(
  (RUSSIAN_FIXTURE["fixture.cases"] as readonly string[]).map((entry) => {
    const [value, category] = entry.split(":");
    return [Number(value), category];
  }),
);

for (const [value, expected] of russianCases) {
  assert.equal(cardinalPluralCategory("ru-RU", value), expected);
  assert.equal(
    formatMessageDescriptor("ru-RU", RUSSIAN_FIXTURE["fixture.cardinal"], ["count"], [value]),
    `${value}:${expected}`,
  );
}

assert.equal(getLocaleText("zh-CN").dashboard.tracking("Code"), "正在追踪：Code");
assert.equal(getLocaleText("en-US").dashboard.tracking("Code"), "Tracking: Code");
assert.equal(getLocaleText("en-US").data.selectedObjectCount(1), "1 item");
assert.equal(getLocaleText("en-US").data.selectedObjectCount(2), "2 items");
assert.equal(getLocaleText("zh-CN").date.yearMonthLabel(2026, 8), "2026 年 8 月");
assert.equal(getLocaleText("en-US").date.yearMonthLabel(2026, 8), "August 2026");

console.log("Passed i18n contract and CLDR plural tests");
