import assert from "node:assert/strict";
import { MESSAGES as RUSSIAN_FIXTURE } from "../locales/fixtures/ru-RU/plurals.ts";
import { SUPPORTED_LOCALES } from "../src/shared/i18n/generated/contract.ts";
import { FRONTEND_LOCALE_LOADERS } from "../src/shared/i18n/generated/resources.ts";
import {
  cardinalPluralCategory,
  formatDate,
  formatMessageDescriptor,
  formatNumber,
  getLocaleText,
  loadLocaleText,
  resolveLocaleActivation,
} from "../src/shared/i18n/runtime.ts";
import type { UiText } from "../src/shared/i18n/generated/contract.ts";

const russianCases = new Map<number, string>(
  (RUSSIAN_FIXTURE["fixture.cases"] as readonly string[]).map((entry) => {
    const [value, category] = entry.split(":");
    return [Number(value), category];
  }),
);

assert.deepEqual(Object.keys(FRONTEND_LOCALE_LOADERS), [...SUPPORTED_LOCALES]);

for (const [value, expected] of russianCases) {
  assert.equal(cardinalPluralCategory("ru-RU", value), expected);
  assert.equal(
    formatMessageDescriptor("ru-RU", RUSSIAN_FIXTURE["fixture.cardinal"], ["count"], [value]),
    `${value}:${expected}`,
  );
}

const firstEnglishRequest = loadLocaleText("en-US");
const secondEnglishRequest = loadLocaleText("en-US");
assert.strictEqual(firstEnglishRequest, secondEnglishRequest);
const englishText = await firstEnglishRequest;
const spanishText = await loadLocaleText("es");
assert.equal(spanishText.dashboard.tracking("Code"), "Registrando: Code");
for (const [count, category] of [[0, "other"], [1, "one"], [2, "other"], [21, "other"], [1000000, "many"]] as const) {
  assert.equal(cardinalPluralCategory("es", count), category);
  assert.equal(spanishText.data.selectedObjectCount(count), `${count} ${count === 1 ? "elemento" : "elementos"}`);
}
assert.equal(formatNumber("es", 12345.67), "12.345,67");
assert.equal(spanishText.date.yearMonthLabel(2026, 8), "agosto 2026");
assert.equal(spanishText.backup.restoreMessage("backup.restore.supported", [], "English fallback"), "Esta versión puede restaurar esta copia de forma segura.");
assert.equal(spanishText.backup.restoreMessage("backup.restore.schemaTooNew", [], "English fallback"), "Esta copia usa una estructura de base de datos más reciente. Actualiza primero la aplicación.");
assert.equal(spanishText.backup.restoreMessage("backup.restore.versionTooNew", ["9"], "English fallback"), "El formato de esta copia es más reciente (9). Actualiza primero la aplicación.");
assert.equal(spanishText.backup.restoreMessage("backup.restore.versionTooOld", [], "English fallback"), "Esta copia antigua está fuera del período de compatibilidad para la migración.");
assert.equal(spanishText.backup.restoreMessage("unknown", [], "Future reason"), "Future reason");
assert.equal(spanishText.export.exportDone(1), "Exportado: 1 registro");
assert.equal(spanishText.history.sessionCount(1), "1 registro");

assert.equal(getLocaleText("zh-CN").dashboard.tracking("Code"), "正在追踪：Code");
assert.strictEqual(getLocaleText("en-US"), englishText);
assert.equal(englishText.dashboard.tracking("Code"), "Tracking: Code");
assert.equal(englishText.data.selectedObjectCount(1), "1 item");
assert.equal(englishText.data.selectedObjectCount(2), "2 items");
assert.equal(getLocaleText("zh-CN").date.yearMonthLabel(2026, 8), "2026 年 8 月");
assert.equal(englishText.date.yearMonthLabel(2026, 8), "August 2026");

let activationGeneration = 1;
let finishEarlierRequest: ((text: UiText) => void) | null = null;
const earlierRequest = resolveLocaleActivation(
  "en-US",
  () => activationGeneration === 1,
  () => new Promise<UiText>((resolve) => { finishEarlierRequest = resolve; }),
);
activationGeneration = 2;
const laterRequest = resolveLocaleActivation(
  "zh-CN",
  () => activationGeneration === 2,
  async () => getLocaleText("zh-CN"),
);
assert.equal((await laterRequest).status, "ready");
finishEarlierRequest?.(englishText);
assert.deepEqual(await earlierRequest, { status: "stale", locale: "en-US" });

const activationError = new Error("locale chunk unavailable");
const failedActivation = await resolveLocaleActivation(
  "en-US",
  () => true,
  async () => { throw activationError; },
);
assert.equal(failedActivation.status, "failed");
if (failedActivation.status === "failed") assert.strictEqual(failedActivation.error, activationError);

assert.equal(formatNumber("en-US", 12_345.6), "12,345.6");
assert.equal(
  formatDate("en-US", Date.UTC(2026, 7, 1), { year: "numeric", month: "long", timeZone: "UTC" }),
  new Intl.DateTimeFormat("en-US", { year: "numeric", month: "long", timeZone: "UTC" })
    .format(Date.UTC(2026, 7, 1)),
);

console.log("Passed i18n contract and CLDR plural tests");
