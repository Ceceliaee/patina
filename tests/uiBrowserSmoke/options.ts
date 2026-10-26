import assert from "node:assert/strict";

export const browserGroups = [
  "startup", "anonymous", "typography", "locale", "content", "read-failure",
  "settings", "theme", "category-filter", "classification", "scroll-region", "mini",
  "data", "data-loading-layout", "history-web-timeline", "about", "tools",
  "navigation", "dashboard", "history", "data-full",
] as const;
export type BrowserGroup = typeof browserGroups[number];

// Existing --<group>-only callers and the explicit --group form share one contract.
export function parseBrowserGroup(args: string[]): BrowserGroup | null {
  let group: BrowserGroup | null = null;
  for (let index = 0; index < args.length; index++) {
    assert.equal(group, null, "Select exactly one browser group; duplicate or conflicting options are invalid");
    const argument = args[index];
    const value = argument === "--group" ? args[++index] : /^--(.+)-only$/.exec(argument)?.[1];
    assert.ok(browserGroups.includes(value as BrowserGroup), `Unknown browser option or group: ${value ?? argument}; groups: ${browserGroups.join(", ")}`);
    group = value as BrowserGroup;
  }
  return group;
}

export function assertBrowserSelection(group: BrowserGroup | null, passed: number, startupPassed: number) {
  assert.ok(passed > 0, "Browser selection ran zero tests");
  if (group && group !== "startup") {
    assert.ok(passed > startupPassed, `Browser group ${group} ran zero selected tests (startup does not count)`);
  }
}
