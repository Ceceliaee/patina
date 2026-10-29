import assert from "node:assert/strict";
import { parseMiniActivitySnapshot } from "../src/platform/desktop/miniActivityRuntimeGateway.ts";
import { buildMiniActivityViewModel, miniActivityIcons } from "../src/app/mini/miniActivityViewModel.ts";
import { getLocaleText } from "../src/shared/i18n/runtime.ts";
import { ANONYMOUS_ACTIVITY_KEY } from "../src/shared/classification/anonymousActivity.ts";
import { startHistoryTimelinePreference } from "../src/features/history/services/historyTimelinePreferenceService.ts";
import type { ActivityTimelineMode } from "../src/shared/settings/activityDisplaySettings.ts";
import { miniActivityFixture } from "./uiBrowserSmoke/miniActivityFixture.ts";
import { CategoryColorRegistry } from "../src/shared/classification/categoryColorRegistry.ts";

const text = getLocaleText("zh-CN");
const mainColors = new CategoryColorRegistry();
const miniColors = new CategoryColorRegistry();
const originalRandom = Math.random;
try {
  Math.random = () => 0;
  mainColors.getCategoryColor("custom:first");
  const mainColor = mainColors.getCategoryColor("custom:second");
  Math.random = () => 0.99;
  const miniColor = miniColors.getCategoryColor("custom:second");
  assert.equal(miniColor, mainColor, "unassigned categories agree across window read order");
  miniColors.setCategoryDefaultColorAssignments({});
  Math.random = () => 0.5;
  assert.equal(miniColors.getCategoryColor("custom:second"), miniColor, "refresh must not randomize an unassigned color");
  miniColors.setCategoryDefaultColorAssignments({ "custom:second": "#4F5FD7" });
  assert.equal(miniColors.getCategoryColor("custom:second"), "#4F5FD7", "saved assignments retain their released color");
  miniColors.setCategoryColorOverride("custom:second", "#123456");
  assert.equal(miniColors.getCategoryColor("custom:second"), "#123456");
} finally { Math.random = originalRandom; }
console.log("PASS independent Mini and main category colors stay stable before persistence");
const health = { status: "healthy" as const, lastHeartbeatMs: 1, checkedAtMs: 1, staleAfterMs: 10_000 };
const bootstrap = {
  settings: { tracking_paused: "0", theme_mode: "light", language: "zh-CN", color_scheme_light: null,
    color_scheme_dark: null, hourly_activity_chart_mode: "category", history_timeline_mode: "app",
    refresh_interval_secs: "5", timeline_merge_gap_secs: "0", dynamic_effects: "1", web_activity_available: false },
  app_overrides: ["development", "utility", "communication", "other"].map((category, index) => ({
    key: `__app_override::${["editor", "browser", "chat", "other"][index]}.exe`, value: JSON.stringify({ category }),
  })), app_links: [], category_settings: [],
};
const today = parseMiniActivitySnapshot(miniActivityFixture("today", bootstrap), "today");
const todayView = buildMiniActivityViewModel(today, health, text);
assert.equal(todayView.kind, "today");
assert.equal(todayView.total, 206 * 60_000);
if (todayView.kind !== "today") throw new Error("Unexpected page");
assert.deepEqual(todayView.categories.map(item => item.duration / 60_000), [118, 46, 28, 14]);
assert.equal(todayView.hourly.points.reduce((sum, point) => sum + point.minutes, 0), 206);
assert.equal(buildMiniActivityViewModel({ ...today, records: [] }, health, text).total, 0);
for (const invalid of [null, {}, { ...miniActivityFixture("today", bootstrap), sampled_at_ms: NaN },
  { ...miniActivityFixture("today", bootstrap), kind: "activity" },
  { ...miniActivityFixture("today", bootstrap), aggregate: null }]) {
  assert.throws(() => parseMiniActivitySnapshot(invalid, "today"));
}
console.log("PASS Mini today preserves exact category totals, hourly totals and rejects invalid snapshots");

const recent = parseMiniActivitySnapshot(miniActivityFixture("activity", bootstrap), "activity");
for (const invalidRow of [{ end_time: 0 }, { duration: -1 }, { origin: { toString: () => "native" } }]) {
  const raw = miniActivityFixture("activity", bootstrap);
  assert.throws(() => parseMiniActivitySnapshot({ ...raw, sessions: [{ ...raw.sessions[0], ...invalidRow }] }, "activity"));
}
const recentView = buildMiniActivityViewModel(recent, health, text);
if (recentView.kind !== "activity") throw new Error("Unexpected page");
assert.equal(recentView.total, 56 * 60_000);
assert.deepEqual(recentView.leaders.map(item => item.duration / 60_000), [36, 11, 9]);
for (const mode of ["app", "category"] as const) {
  const fullRanking = buildMiniActivityViewModel({ ...recent,
    bootstrap: { ...recent.bootstrap, timelineMode: mode },
    sessions: [...recent.sessions, { ...recent.sessions[0], id: 4, exeName: "other.exe", appName: "Other",
      startTime: recent.startMs + 45 * 60_000, endTime: recent.startMs + 49 * 60_000, duration: 4 * 60_000,
      continuityGroupStartTime: recent.startMs + 45 * 60_000 }] }, health, text);
  if (fullRanking.kind !== "activity") throw new Error("Unexpected page");
  assert.deepEqual(fullRanking.leaders.map(item => item.duration / 60_000), [36, 11, 9, 4], `${mode} preserves every ranked item`);
  assert.equal(fullRanking.leaders.reduce((total, item) => total + item.duration, 0), fullRanking.total);
}
assert.ok(recentView.timeline.segments.some((item, index, items) => index > 0 && item.startTime - items[index - 1].endTime === 4 * 60_000));
const midnight = new Date(2026, 9, 28, 0, 15).getTime();
const cross = buildMiniActivityViewModel({ ...recent, sampledAtMs: midnight, startMs: midnight - 3_600_000, endMs: midnight,
  sessions: recent.sessions.map(row => ({ ...row, startTime: row.startTime + midnight - recent.sampledAtMs,
    endTime: row.endTime! + midnight - recent.sampledAtMs })) }, health, text);
assert.equal(cross.total, recentView.total);
if (cross.kind !== "activity") throw new Error("Unexpected page");
assert.ok(cross.timeline.segments[0].startTime < new Date(2026, 9, 28).getTime());
console.log("PASS Mini rolling hour preserves real gaps and includes the previous local day");

const privateView = buildMiniActivityViewModel({ ...recent, sessions: [
  { ...recent.sessions[0], exeName: ANONYMOUS_ACTIVITY_KEY, appName: "", windowTitle: "" },
  { ...recent.sessions[1], exeName: "excluded.exe", appName: "Secret" },
], bootstrap: { ...recent.bootstrap, appOverrides: [...recent.bootstrap.appOverrides,
  { key: "__app_override::excluded.exe", value: JSON.stringify({ track: false }) }] } }, health, text);
assert.equal(privateView.total, 36 * 60_000);
assert.equal(JSON.stringify(privateView).includes("Secret"), false);
assert.equal(JSON.stringify(privateView).includes("excluded.exe"), false);
assert.deepEqual(miniActivityIcons({ ...recent, icons: {
  remote: "https://example.invalid/icon.png", spaced: "  https://example.invalid/icon.png  ",
  local: "data:image/png;base64,eA==",
} }), { local: "data:image/png;base64,eA==" });
console.log("PASS Mini excludes hidden identities and does not request remote icons");

const webRaw = { ...miniActivityFixture("activity", bootstrap), sessions: [], bootstrap: {
  ...bootstrap, settings: { ...bootstrap.settings, history_timeline_mode: "web", web_activity_available: true },
}, web: { domains: ["a.example.test", "b.example.test"], roots: { "a.example.test": "example.test", "b.example.test": "example.test" },
  rules: { "example.test": { version: 2, exceptions: [], displayName: "Grouped site" } }, overrides: {}, totals: {}, favicons: {},
  segments: ["a", "b"].map((prefix, index) => ({ id: index + 1, domain: `${prefix}.example.test`, normalizedDomain: `${prefix}.example.test`,
    browserClientId: "fixture", browserKind: "chromium", browserExeName: "browser.exe", url: null, title: null,
    startTime: recent.startMs + index * 600_000, endTime: recent.startMs + (index + 1) * 600_000, duration: 600_000 })) } };
const webView = buildMiniActivityViewModel(parseMiniActivitySnapshot(webRaw, "activity"), health, text);
if (webView.kind !== "activity") throw new Error("Unexpected page");
assert.equal(webView.total, 1_200_000);
assert.equal(webView.leaders.length, 1);
assert.equal(webView.leaders[0].label, "Grouped site");
assert.equal(webView.leaders[0].duration, webView.total);
assert.throws(() => parseMiniActivitySnapshot({ ...webRaw, sessions: miniActivityFixture("activity", bootstrap).sessions }, "activity"));
console.log("PASS Mini website ranking follows grouping without mixing browser application time");

let saved: ActivityTimelineMode = "app";
const accepted: ActivityTimelineMode[] = [];
const failures: unknown[] = [];
let listener: () => void | Promise<void> = () => {};
let unlisteners = 0;
const runtime = startHistoryTimelinePreference({ webEnabled: true, accept: mode => accepted.push(mode), failed: error => failures.push(error) }, {
  load: async () => saved, migrate: async () => saved,
  save: async mode => { saved = mode; void listener(); },
  subscribe: async handler => { listener = () => handler({}); return () => { unlisteners++; }; },
});
await runtime.ready;
await Promise.all([runtime.toggle(), runtime.toggle(), runtime.toggle(), runtime.toggle()]);
await listener();
assert.equal(saved, "category");
assert.equal(accepted.at(-1), "category");
assert.deepEqual(failures, []);
runtime.dispose();
assert.equal(unlisteners, 1);
await runtime.toggle();
assert.equal(saved, "category");
const disabled = startHistoryTimelinePreference({ webEnabled: false, accept: mode => accepted.push(mode), failed: error => failures.push(error) }, {
  load: async () => "web", migrate: async () => "web", save: async mode => { saved = mode; }, subscribe: async () => () => {},
});
await disabled.ready;
assert.equal(saved, "app");
disabled.dispose();
console.log("PASS serialized History preferences preserve rapid toggles, event order, disposal and website fallback");
