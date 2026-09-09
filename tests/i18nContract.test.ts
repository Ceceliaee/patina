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
assert.deepEqual([...SUPPORTED_LOCALES], ["zh-CN", "en-US", "ru-RU", "es"]);
const russianText = await loadLocaleText("ru-RU");
assert.equal(russianText.dashboard.tracking("Code"), "Учёт времени: Code");
for (const [count, noun, hours] of [
  [0, "объектов", "часов"], [1, "объект", "час"], [2, "объекта", "часа"],
  [4, "объекта", "часа"], [5, "объектов", "часов"], [11, "объектов", "часов"],
  [12, "объектов", "часов"], [14, "объектов", "часов"], [21, "объект", "час"],
  [22, "объекта", "часа"], [25, "объектов", "часов"], [101, "объект", "час"],
  [111, "объектов", "часов"], [1000000, "объектов", "часов"],
] as const) {
  assert.equal(russianText.data.selectedObjectCount(count), `${count} ${noun}`);
  assert.equal(russianText.destinationDetail.timelineHoursValue(count), `${count} ${hours}`);
  assert.equal(russianText.history.sessionCount(count), `Записей: ${count}`);
  assert.equal(russianText.export.exportDone(count), `Экспортировано записей: ${count}`);
}
assert.equal(formatNumber("ru-RU", 12345.67), "12\u00a0345,67");
assert.equal(russianText.date.yearMonthLabel(2026, 8), "август 2026");
assert.equal(formatDate("ru-RU", Date.UTC(2026, 7, 31), { day: "numeric", month: "short", timeZone: "UTC" }), "31 авг.");
assert.equal(formatDate("ru-RU", Date.UTC(2026, 8, 1), { day: "numeric", month: "short", timeZone: "UTC" }), "1 сент.");
assert.equal(formatDate("ru-RU", Date.UTC(2026, 7, 31), { weekday: "long", timeZone: "UTC" }), "понедельник");
assert.equal(formatDate("ru-RU", Date.UTC(2026, 8, 9), { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }), "9 сентября 2026 г.");
for (const [key, args, expected] of [
  ["backup.restore.supported", [], "Текущая версия может безопасно восстановить эту копию."],
  ["backup.restore.schemaTooNew", [], "Эта копия использует более новую структуру базы данных. Сначала обновите приложение."],
  ["backup.restore.versionTooNew", ["9"], "Эта копия имеет более новый формат (9). Сначала обновите приложение."],
  ["backup.restore.versionTooOld", [], "Срок поддержки переноса данных из этой старой копии истёк."],
  ["unknown", [], "Future reason"],
] as const) assert.equal(russianText.backup.restoreMessage(key, [...args], "Future reason"), expected);
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
