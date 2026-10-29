import type { MiniActivityPage } from "../../src/platform/desktop/miniActivityRuntimeGateway.ts";

export function miniActivityFixture(kind: MiniActivityPage, bootstrap: unknown) {
  const date = new Date(); date.setHours(12, 0, 0, 0);
  const sampled_at_ms = date.getTime();
  const day = new Date(date); day.setHours(0, 0, 0, 0);
  const tomorrow = new Date(day); tomorrow.setDate(day.getDate() + 1);
  const minute = 60_000;
  const origin = sampled_at_ms - 60 * minute;
  const sessions = [
    ["editor.exe", "Editor", 0, 36],
    ["browser.exe", "Browser", 36, 45],
    ["chat.exe", "Chat", 49, 60],
  ].map(([exe, app, start, end], index) => ({ id: index + 1, origin: "native", app_name: app,
    exe_name: exe, window_title: "", start_time: origin + Number(start) * minute,
    end_time: origin + Number(end) * minute, duration: (Number(end) - Number(start)) * minute,
    continuity_group_start_time: origin + Number(start) * minute }));
  const records = [118, 46, 28, 14].map((minutes, index) => {
    const startTime = sampled_at_ms - [206, 88, 42, 14][index] * minute;
    return { appName: ["Editor", "Browser", "Chat", "Other"][index], exeName: ["editor.exe", "browser.exe", "chat.exe", "other.exe"][index],
      startTime, endTime: startTime + minutes * minute };
  });
  const settings = (bootstrap as { settings: Record<string, unknown> }).settings;
  const webMode = kind === "activity" && settings.history_timeline_mode === "web" && settings.web_activity_available === true;
  const web = webMode ? { domains: ["a.example.test", "b.example.test"], roots: { "a.example.test": "example.test", "b.example.test": "example.test" },
    rules: { "example.test": { version: 2, exceptions: [], displayName: "Grouped site" } }, overrides: {}, totals: {}, favicons: {},
    segments: ["a", "b"].map((prefix, index) => ({ id: index + 1, domain: `${prefix}.example.test`, normalizedDomain: `${prefix}.example.test`,
      browserClientId: "fixture", browserKind: "chromium", browserExeName: "browser.exe", url: null, title: null,
      startTime: origin + index * 600_000, endTime: origin + (index + 1) * 600_000, duration: 600_000 })) } : null;
  return { kind, sampled_at_ms, start_ms: kind === "today" ? day.getTime() : origin,
    end_ms: kind === "today" ? tomorrow.getTime() : sampled_at_ms, bootstrap, icons: {},
    aggregate: kind === "today" ? { records, readPath: "facts", sourceRevision: 1, fallbackReason: null,
      projectionRowCount: 0, factRowCount: records.length, hasActiveSession: false } : null,
    sessions: kind === "today" || webMode ? [] : sessions, web };
}
