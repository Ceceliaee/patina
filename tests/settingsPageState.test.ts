import assert from "node:assert/strict";
import type { BackupPreview } from "../src/features/settings/services/settingsRuntimeAdapterService.ts";
import {
  commitSettingsPatchWithDeps,
  prepareBackupRestoreWithDeps,
  SettingsRuntimeAdapterService,
} from "../src/features/settings/services/settingsRuntimeAdapterService.ts";
import {
  runBackupExportFlow,
  runBackupRestoreFlow,
  runSettingsCleanupFlow,
} from "../src/features/settings/services/settingsPageActions.ts";
import {
  normalizeSettingsRecord,
} from "../src/platform/persistence/appSettingsStore.ts";
import {
  buildLocalApiEnabledChange,
  createLocalApiToken,
} from "../src/features/settings/services/localApiTokenService.ts";

interface AppSettings {
  idleTimeoutSecs: number;
  timelineMergeGapSecs: number;
  refreshIntervalSecs: number;
  minSessionSecs: number;
  trackingPaused: boolean;
  closeBehavior: "exit" | "tray";
  minimizeBehavior: "taskbar" | "widget";
  themeMode: "light" | "dark" | "system";
  language: "zh-CN" | "en-US";
  hourlyActivityChartMode: "total" | "category";
  colorSchemeLight:
    | "default"
    | "absolutely"
    | "ayu"
    | "catppuccin"
    | "dracula"
    | "everforest"
    | "github"
    | "gruvbox"
    | "linear"
    | "lobster"
    | "material"
    | "matrix"
    | "monokai"
    | "night-owl"
    | "notion"
    | "nord"
    | "one"
    | "oscurange"
    | "proof"
    | "raycast"
    | "rose-pine"
    | "sentry"
    | "solarized"
    | "temple"
    | "tokyo-night"
    | "vercel"
    | "vscode-plus"
    | "xcode";
  colorSchemeDark:
    | "default"
    | "absolutely"
    | "ayu"
    | "catppuccin"
    | "dracula"
    | "everforest"
    | "github"
    | "gruvbox"
    | "linear"
    | "lobster"
    | "material"
    | "matrix"
    | "monokai"
    | "night-owl"
    | "notion"
    | "nord"
    | "one"
    | "oscurange"
    | "proof"
    | "raycast"
    | "rose-pine"
    | "sentry"
    | "solarized"
    | "temple"
    | "tokyo-night"
    | "vercel"
    | "vscode-plus"
    | "xcode";
  launchAtLogin: boolean;
  startMinimized: boolean;
  onboardingCompleted: boolean;
  localApiEnabled: boolean;
  localApiPort: number;
  localApiToken: string;
}

type CleanupRange = 180 | 90 | 60 | 30 | 15 | 7;

const BASE_SETTINGS: AppSettings = {
  idleTimeoutSecs: 300,
  timelineMergeGapSecs: 60,
  refreshIntervalSecs: 1,
  minSessionSecs: 60,
  trackingPaused: false,
  closeBehavior: "tray",
  minimizeBehavior: "taskbar",
  themeMode: "light",
  language: "zh-CN",
  hourlyActivityChartMode: "total",
  colorSchemeLight: "default",
  colorSchemeDark: "default",
  launchAtLogin: false,
  startMinimized: false,
  onboardingCompleted: false,
  localApiEnabled: false,
  localApiPort: 17321,
  localApiToken: "",
};

function buildSettings(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    ...BASE_SETTINGS,
    ...overrides,
  };
}

function buildPreview(overrides: Partial<BackupPreview> = {}): BackupPreview {
  return {
    version: 2,
    exportedAtMs: 1_714_000_000_000,
    schemaVersion: 7,
    appVersion: "0.3.2",
    restoreSupported: true,
    restoreMessageKey: null,
    restoreMessageArgs: [],
    restoreMessage: "Looks good",
    sessionCount: 42,
    titleSampleCount: 12,
    settingCount: 10,
    iconCacheCount: 5,
    ...overrides,
  };
}

let passed = 0;

async function runTest(name: string, fn: () => Promise<void> | void) {
  await fn();
  passed += 1;
  console.log(`PASS ${name}`);
}

await runTest("buildSettingsPatch only keeps changed keys", () => {
  const saved = buildSettings();
  const draft = buildSettings({
    minSessionSecs: saved.minSessionSecs + 60,
    trackingPaused: true,
    themeMode: "dark",
    language: "en-US",
    colorSchemeLight: "linear",
    colorSchemeDark: "github",
    localApiEnabled: true,
    localApiPort: 18080,
    localApiToken: "secret",
  });

  assert.deepEqual(SettingsRuntimeAdapterService.buildSettingsPatch(saved, draft), {
    minSessionSecs: draft.minSessionSecs,
    trackingPaused: true,
    themeMode: "dark",
    language: "en-US",
    colorSchemeLight: "linear",
    colorSchemeDark: "github",
    localApiEnabled: true,
    localApiPort: 18080,
    localApiToken: "secret",
  });
});

await runTest("commitSettingsPatchWithDeps returns not-needed for empty patches", async () => {
  const events: string[] = [];

  const result = await commitSettingsPatchWithDeps({}, {
    persistPatch: async () => {
      events.push("persist");
    },
    syncTimelineMergeGap: async () => {
      events.push("sync");
    },
    notifySettingsChanged: async () => {
      events.push("notify");
    },
  });

  assert.deepEqual(result, {
    persisted: true,
    runtimeSync: "not-needed",
    runtimeSyncErrors: [],
  });
  assert.deepEqual(events, []);
});

await runTest("commitSettingsPatchWithDeps persists before runtime sync", async () => {
  const events: string[] = [];

  const result = await commitSettingsPatchWithDeps({
    trackingPaused: true,
    timelineMergeGapSecs: 180,
  }, {
    persistPatch: async (patch) => {
      events.push(`persist:${Object.keys(patch).length}`);
    },
    syncTimelineMergeGap: async (seconds) => {
      events.push(`sync:${seconds}`);
    },
    notifySettingsChanged: async (patch) => {
      events.push(`notify:${Object.keys(patch).length}`);
    },
  });

  assert.deepEqual(result, {
    persisted: true,
    runtimeSync: "synced",
    runtimeSyncErrors: [],
  });
  assert.deepEqual(events, [
    "persist:2",
    "notify:2",
    "sync:180",
  ]);
});

await runTest("commitSettingsPatchWithDeps keeps persisted success when runtime sync fails", async () => {
  const events: string[] = [];

  const result = await commitSettingsPatchWithDeps({
    timelineMergeGapSecs: 120,
  }, {
    persistPatch: async () => {
      events.push("persist");
    },
    syncTimelineMergeGap: async () => {
      events.push("sync");
      throw new Error("runtime unavailable");
    },
    notifySettingsChanged: async () => {
      events.push("notify");
    },
  });

  assert.deepEqual(result, {
    persisted: true,
    runtimeSync: "failed",
    runtimeSyncErrors: ["runtime unavailable"],
  });
  assert.deepEqual(events, [
    "persist",
    "notify",
    "sync",
  ]);
});

await runTest("commitSettingsPatchWithDeps does not attempt runtime sync when persistence fails", async () => {
  const events: string[] = [];

  await assert.rejects(
    commitSettingsPatchWithDeps({
      timelineMergeGapSecs: 90,
    }, {
      persistPatch: async () => {
        events.push("persist");
        throw new Error("disk full");
      },
      syncTimelineMergeGap: async () => {
        events.push("sync");
      },
      notifySettingsChanged: async () => {
        events.push("notify");
      },
    }),
    /disk full/,
  );

  assert.deepEqual(events, ["persist"]);
});

await runTest("normalizeSettingsRecord accepts current minimize behavior values", () => {
  const defaultSettings = normalizeSettingsRecord({});
  assert.equal(defaultSettings.minimizeBehavior, "widget");
  assert.equal(defaultSettings.closeBehavior, "tray");
  assert.equal(defaultSettings.themeMode, "light");
  assert.equal(defaultSettings.language, "zh-CN");
  assert.equal(defaultSettings.colorSchemeLight, "default");
  assert.equal(defaultSettings.colorSchemeDark, "default");
  assert.equal(defaultSettings.minSessionSecs, 300);
  assert.equal(defaultSettings.localApiEnabled, false);
  assert.equal(defaultSettings.localApiPort, 17321);
  assert.equal(defaultSettings.localApiToken, "");

  const localApiSettings = normalizeSettingsRecord({
    local_api_enabled: "1",
    local_api_port: "18080",
    local_api_token: "secret",
  });
  assert.equal(localApiSettings.localApiEnabled, true);
  assert.equal(localApiSettings.localApiPort, 18080);
  assert.equal(localApiSettings.localApiToken, "secret");

  const invalidLocalApiSettings = normalizeSettingsRecord({
    local_api_enabled: "no",
    local_api_port: "80",
  });
  assert.equal(invalidLocalApiSettings.localApiEnabled, false);
  assert.equal(invalidLocalApiSettings.localApiPort, 17321);

  const missingTokenSettings = normalizeSettingsRecord({
    local_api_enabled: "1",
    local_api_token: "   ",
  });
  assert.equal(missingTokenSettings.localApiEnabled, false);
  assert.equal(missingTokenSettings.localApiToken, "");

  const widgetSettings = normalizeSettingsRecord({
    minimize_behavior: "widget",
    close_behavior: "tray",
  });
  assert.equal(widgetSettings.minimizeBehavior, "widget");
  assert.equal(widgetSettings.closeBehavior, "tray");

  const retiredTraySettings = normalizeSettingsRecord({
    minimize_behavior: "tray",
  });
  assert.equal(retiredTraySettings.minimizeBehavior, "widget");

  const fallbackSettings = normalizeSettingsRecord({
    minimize_behavior: "floating-sidebar",
  });
  assert.equal(fallbackSettings.minimizeBehavior, "widget");
});

await runTest("normalizeSettingsRecord accepts theme modes and falls back to light", () => {
  assert.equal(normalizeSettingsRecord({ theme_mode: "light" }).themeMode, "light");
  assert.equal(normalizeSettingsRecord({ theme_mode: "dark" }).themeMode, "dark");
  assert.equal(normalizeSettingsRecord({ theme_mode: "system" }).themeMode, "system");
  assert.equal(normalizeSettingsRecord({ theme_mode: "SYSTEM" }).themeMode, "system");
  assert.equal(normalizeSettingsRecord({ theme_mode: "midnight" }).themeMode, "light");
});

await runTest("normalizeSettingsRecord accepts UI language and falls back to Chinese", () => {
  assert.equal(normalizeSettingsRecord({ language: "zh-CN" }).language, "zh-CN");
  assert.equal(normalizeSettingsRecord({ language: "en-US" }).language, "en-US");
  assert.equal(normalizeSettingsRecord({ language: "EN-us" }).language, "en-US");
  assert.equal(normalizeSettingsRecord({ language: "fr-FR" }).language, "zh-CN");
});

await runTest("normalizeSettingsRecord accepts hourly activity chart modes and falls back to total", () => {
  assert.equal(normalizeSettingsRecord({ hourly_activity_chart_mode: "total" }).hourlyActivityChartMode, "total");
  assert.equal(normalizeSettingsRecord({ hourly_activity_chart_mode: "category" }).hourlyActivityChartMode, "category");
  assert.equal(normalizeSettingsRecord({ hourly_activity_chart_mode: "CATEGORY" }).hourlyActivityChartMode, "category");
  assert.equal(normalizeSettingsRecord({ hourly_activity_chart_mode: "stacked" }).hourlyActivityChartMode, "total");
});

await runTest("normalizeSettingsRecord accepts color schemes and falls back to default", () => {
  assert.equal(normalizeSettingsRecord({ color_scheme_light: "default" }).colorSchemeLight, "default");
  assert.equal(normalizeSettingsRecord({ color_scheme_light: "absolutely" }).colorSchemeLight, "absolutely");
  assert.equal(normalizeSettingsRecord({ color_scheme_light: "catppuccin" }).colorSchemeLight, "catppuccin");
  assert.equal(normalizeSettingsRecord({ color_scheme_light: "everforest" }).colorSchemeLight, "everforest");
  assert.equal(normalizeSettingsRecord({ color_scheme_light: "github" }).colorSchemeLight, "github");
  assert.equal(normalizeSettingsRecord({ color_scheme_light: "gruvbox" }).colorSchemeLight, "gruvbox");
  assert.equal(normalizeSettingsRecord({ color_scheme_light: "linear" }).colorSchemeLight, "linear");
  assert.equal(normalizeSettingsRecord({ color_scheme_light: "notion" }).colorSchemeLight, "notion");
  assert.equal(normalizeSettingsRecord({ color_scheme_light: "one" }).colorSchemeLight, "one");
  assert.equal(normalizeSettingsRecord({ color_scheme_light: "proof" }).colorSchemeLight, "proof");
  assert.equal(normalizeSettingsRecord({ color_scheme_light: "raycast" }).colorSchemeLight, "raycast");
  assert.equal(normalizeSettingsRecord({ color_scheme_light: "rose-pine" }).colorSchemeLight, "rose-pine");
  assert.equal(normalizeSettingsRecord({ color_scheme_light: "solarized" }).colorSchemeLight, "solarized");
  assert.equal(normalizeSettingsRecord({ color_scheme_light: "vercel" }).colorSchemeLight, "vercel");
  assert.equal(normalizeSettingsRecord({ color_scheme_light: "vscode-plus" }).colorSchemeLight, "vscode-plus");
  assert.equal(normalizeSettingsRecord({ color_scheme_light: "xcode" }).colorSchemeLight, "xcode");
  assert.equal(normalizeSettingsRecord({ color_scheme_light: "nord" }).colorSchemeLight, "default");
  assert.equal(normalizeSettingsRecord({ color_scheme_dark: "absolutely" }).colorSchemeDark, "absolutely");
  assert.equal(normalizeSettingsRecord({ color_scheme_dark: "ayu" }).colorSchemeDark, "ayu");
  assert.equal(normalizeSettingsRecord({ color_scheme_dark: "catppuccin" }).colorSchemeDark, "catppuccin");
  assert.equal(normalizeSettingsRecord({ color_scheme_dark: "dracula" }).colorSchemeDark, "dracula");
  assert.equal(normalizeSettingsRecord({ color_scheme_dark: "everforest" }).colorSchemeDark, "everforest");
  assert.equal(normalizeSettingsRecord({ color_scheme_dark: "gruvbox" }).colorSchemeDark, "gruvbox");
  assert.equal(normalizeSettingsRecord({ color_scheme_dark: "linear" }).colorSchemeDark, "linear");
  assert.equal(normalizeSettingsRecord({ color_scheme_dark: "lobster" }).colorSchemeDark, "lobster");
  assert.equal(normalizeSettingsRecord({ color_scheme_dark: "material" }).colorSchemeDark, "material");
  assert.equal(normalizeSettingsRecord({ color_scheme_dark: "matrix" }).colorSchemeDark, "matrix");
  assert.equal(normalizeSettingsRecord({ color_scheme_dark: "monokai" }).colorSchemeDark, "monokai");
  assert.equal(normalizeSettingsRecord({ color_scheme_dark: "night-owl" }).colorSchemeDark, "night-owl");
  assert.equal(normalizeSettingsRecord({ color_scheme_dark: "notion" }).colorSchemeDark, "notion");
  assert.equal(normalizeSettingsRecord({ color_scheme_dark: "one" }).colorSchemeDark, "one");
  assert.equal(normalizeSettingsRecord({ color_scheme_dark: "oscurange" }).colorSchemeDark, "oscurange");
  assert.equal(normalizeSettingsRecord({ color_scheme_dark: "raycast" }).colorSchemeDark, "raycast");
  assert.equal(normalizeSettingsRecord({ color_scheme_dark: "rose-pine" }).colorSchemeDark, "rose-pine");
  assert.equal(normalizeSettingsRecord({ color_scheme_dark: "sentry" }).colorSchemeDark, "sentry");
  assert.equal(normalizeSettingsRecord({ color_scheme_dark: "solarized" }).colorSchemeDark, "solarized");
  assert.equal(normalizeSettingsRecord({ color_scheme_dark: "temple" }).colorSchemeDark, "temple");
  assert.equal(normalizeSettingsRecord({ color_scheme_dark: "tokyo-night" }).colorSchemeDark, "tokyo-night");
  assert.equal(normalizeSettingsRecord({ color_scheme_dark: "vercel" }).colorSchemeDark, "vercel");
  assert.equal(normalizeSettingsRecord({ color_scheme_dark: "vscode-plus" }).colorSchemeDark, "vscode-plus");
  assert.equal(normalizeSettingsRecord({ color_scheme_dark: "xcode" }).colorSchemeDark, "xcode");
  assert.equal(normalizeSettingsRecord({ color_scheme_dark: "kanagawa" }).colorSchemeDark, "default");
  assert.equal(normalizeSettingsRecord({ color_scheme_dark: "vitesse" }).colorSchemeDark, "default");
  assert.equal(normalizeSettingsRecord({ color_scheme_dark: "NORD" }).colorSchemeDark, "nord");
  assert.equal(normalizeSettingsRecord({ color_scheme_light: "marketplace" }).colorSchemeLight, "default");
  assert.equal(normalizeSettingsRecord({ color_scheme: "github" }).colorSchemeLight, "default");
  assert.equal(normalizeSettingsRecord({ color_scheme: "github" }).colorSchemeDark, "default");
});

await runTest("local API token is generated before enabling", () => {
  const token = createLocalApiToken((bytes) => {
    bytes.fill(10);
    return bytes;
  });
  assert.equal(token, "0a".repeat(24));

  assert.deepEqual(buildLocalApiEnabledChange(true, "", () => "generated-token"), {
    enabled: true,
    token: "generated-token",
  });
  assert.deepEqual(buildLocalApiEnabledChange(true, " existing-token "), {
    enabled: true,
    token: "existing-token",
  });
  assert.deepEqual(buildLocalApiEnabledChange(false, "existing-token"), {
    enabled: false,
    token: null,
  });
});

await runTest("runSettingsCleanupFlow executes confirmed cleanup and reloads", async () => {
  const events: string[] = [];
  const cleanupRange: CleanupRange = 30;

  const result = await runSettingsCleanupFlow({
    cleanupRange,
    cleanupRangeLabel: "30 days",
    confirm: async (options) => {
      assert.equal(options.danger, true);
      events.push("confirm");
      return true;
    },
    clearSessionsByRange: async (range) => {
      events.push(`clear:${range}`);
    },
    notify: (_message, tone) => {
      events.push(`notify:${tone}`);
    },
    reload: () => {
      events.push("reload");
    },
    onExecutionStart: () => {
      events.push("start");
    },
    onExecutionEnd: () => {
      events.push("end");
    },
  });

  assert.equal(result, true);
  assert.deepEqual(events, [
    "confirm",
    "start",
    "clear:30",
    "notify:success",
    "reload",
    "end",
  ]);
});

await runTest("runSettingsCleanupFlow reports failures and still clears busy state", async () => {
  const events: string[] = [];
  const errors: string[] = [];

  const result = await runSettingsCleanupFlow({
    cleanupRange: 7,
    cleanupRangeLabel: "7 days",
    confirm: async () => true,
    clearSessionsByRange: async () => {
      throw new Error("db busy");
    },
    notify: (_message, tone) => {
      events.push(`notify:${tone}`);
    },
    reload: () => {
      events.push("reload");
    },
    onExecutionStart: () => {
      events.push("start");
    },
    onExecutionEnd: () => {
      events.push("end");
    },
    reportError: (message, error) => {
      errors.push(`${message}:${error instanceof Error ? error.message : String(error)}`);
    },
  });

  assert.equal(result, false);
  assert.deepEqual(events, ["start", "notify:warning", "end"]);
  assert.deepEqual(errors, ["cleanup failed:db busy"]);
});

await runTest("prepareBackupRestoreWithDeps builds a summary for compatible previews", async () => {
  const preview = buildPreview();
  let receivedInitialPath: string | undefined;

  const preparation = await prepareBackupRestoreWithDeps("backup.db", {
    pickBackupFile: async (initialPath) => {
      receivedInitialPath = initialPath;
      return "C:/tmp/backup.db";
    },
    previewBackup: async () => preview,
  });

  assert.equal(receivedInitialPath, "backup.db");
  assert.equal(preparation?.compatible, true);
  assert.equal(preparation?.path, "C:/tmp/backup.db");
  assert.ok(preparation?.previewSummary.includes("Schema 7"));
  assert.ok(preparation?.previewSummary.includes("42"));
});

await runTest("runBackupExportFlow normalizes the initial path and stores the exported path", async () => {
  let receivedInitialPath: string | undefined;
  let storedPath = "";
  const events: string[] = [];

  const exportedPath = await runBackupExportFlow({
    initialPath: "  C:/tmp/previous.db  ",
    exportBackupWithPicker: async (initialPath) => {
      receivedInitialPath = initialPath;
      return "C:/tmp/exported.db";
    },
    setExportPath: (path) => {
      storedPath = path;
    },
    notify: (_message, tone) => {
      events.push(`notify:${tone}`);
    },
    onExecutionStart: () => {
      events.push("start");
    },
    onExecutionEnd: () => {
      events.push("end");
    },
  });

  assert.equal(receivedInitialPath, "C:/tmp/previous.db");
  assert.equal(exportedPath, "C:/tmp/exported.db");
  assert.equal(storedPath, "C:/tmp/exported.db");
  assert.deepEqual(events, ["start", "notify:success", "end"]);
});

await runTest("runBackupRestoreFlow blocks incompatible backups before confirmation", async () => {
  let confirmCalls = 0;
  let restoreCalls = 0;
  let storedPath = "";
  const tones: string[] = [];

  const result = await runBackupRestoreFlow({
    initialPath: "restore.db",
    restoreStrategy: "replace",
    prepareBackupRestore: async () => ({
      path: "C:/tmp/incompatible.db",
      preview: buildPreview({ restoreSupported: false }),
      previewSummary: "",
      compatible: false,
      incompatibilityMessage: "schema mismatch",
    }),
    setRestorePath: (path) => {
      storedPath = path;
    },
    confirm: async () => {
      confirmCalls += 1;
      return true;
    },
    restoreBackup: async () => {
      restoreCalls += 1;
    },
    notify: (_message, tone) => {
      tones.push(tone ?? "info");
    },
    reload: () => {
      throw new Error("reload should not be called");
    },
  });

  assert.equal(result, false);
  assert.equal(storedPath, "C:/tmp/incompatible.db");
  assert.equal(confirmCalls, 0);
  assert.equal(restoreCalls, 0);
  assert.deepEqual(tones, ["warning"]);
});

await runTest("runBackupRestoreFlow restores and reloads after confirmation", async () => {
  const events: string[] = [];
  let receivedStrategy = "";

  const result = await runBackupRestoreFlow({
    initialPath: "restore.db",
    restoreStrategy: "merge",
    prepareBackupRestore: async () => ({
      path: "C:/tmp/restore.db",
      preview: buildPreview(),
      previewSummary: "summary",
      compatible: true,
    }),
    setRestorePath: (path) => {
      events.push(`path:${path}`);
    },
    confirm: async () => {
      events.push("confirm");
      return true;
    },
    restoreBackup: async (path, strategy) => {
      receivedStrategy = strategy;
      events.push(`restore:${path}`);
    },
    notify: (_message, tone) => {
      events.push(`notify:${tone}`);
    },
    reload: () => {
      events.push("reload");
    },
    onExecutionStart: () => {
      events.push("start");
    },
    onExecutionEnd: () => {
      events.push("end");
    },
  });

  assert.equal(result, true);
  assert.equal(receivedStrategy, "merge");
  assert.deepEqual(events, [
    "path:C:/tmp/restore.db",
    "confirm",
    "start",
    "restore:C:/tmp/restore.db",
    "notify:success",
    "reload",
    "end",
  ]);
});

console.log(`Passed ${passed} settings page state tests`);
