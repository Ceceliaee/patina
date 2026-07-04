import assert from "node:assert/strict";
import type { BackupPreview } from "../src/features/settings/services/settingsRuntimeAdapterService.ts";
import {
  commitSettingsPatchWithDeps,
  prepareBackupRestoreWithDeps,
  SettingsRuntimeAdapterService,
} from "../src/features/settings/services/settingsRuntimeAdapterService.ts";
import {
  saveSettingsPageStateWithDeps,
} from "../src/features/settings/hooks/settingsPageStateInteractions.ts";
import {
  runBackupExportFlow,
  runBackupRestoreFlow,
  runSettingsCleanupFlow,
} from "../src/features/settings/services/settingsPageActions.ts";
import {
  normalizeSettingsRecord,
} from "../src/platform/persistence/appSettingsStore.ts";
import {
  remoteBackupSettingsInternals,
} from "../src/platform/persistence/remoteBackupSettingsStore.ts";
import {
  createSettingsToken,
} from "../src/features/settings/services/settingsTokenService.ts";
import {
  shouldShowWebActivityHelp,
} from "../src/features/settings/services/webActivitySetupState.ts";

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
  dynamicEffects: boolean;
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
  backgroundOptimization: boolean;
  onboardingCompleted: boolean;
  webActivityEnabled: boolean;
  webActivityPort: number;
  webActivityToken: string;
  remoteStatusBridgeEnabled: boolean;
  remoteStatusBridgeUrl: string;
  remoteStatusBridgeToken: string;
  remoteStatusBridgeMachineId: string;
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
  dynamicEffects: true,
  colorSchemeLight: "default",
  colorSchemeDark: "default",
  launchAtLogin: false,
  startMinimized: false,
  backgroundOptimization: false,
  onboardingCompleted: false,
  webActivityEnabled: false,
  webActivityPort: 12345,
  webActivityToken: "",
  remoteStatusBridgeEnabled: false,
  remoteStatusBridgeUrl: "",
  remoteStatusBridgeToken: "",
  remoteStatusBridgeMachineId: "",
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
    schemaVersion: 8,
    appVersion: "0.3.2",
    restoreSupported: true,
    restoreMessageKey: null,
    restoreMessageArgs: [],
    restoreMessage: "Looks good",
    sessionCount: 42,
    titleSampleCount: 12,
    webActivitySegmentCount: 0,
    settingCount: 10,
    iconCacheCount: 5,
    toolReminderCount: 0,
    toolTimerCount: 0,
    toolTimerLapCount: 0,
    toolPomodoroRunCount: 0,
    toolDailyStatsCount: 0,
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
    dynamicEffects: false,
    webActivityEnabled: true,
    webActivityPort: 18080,
    webActivityToken: "secret",
    backgroundOptimization: true,
  });

  assert.deepEqual(SettingsRuntimeAdapterService.buildSettingsPatch(saved, draft), {
    minSessionSecs: draft.minSessionSecs,
    trackingPaused: true,
    themeMode: "dark",
    language: "en-US",
    colorSchemeLight: "linear",
    colorSchemeDark: "github",
    dynamicEffects: false,
    webActivityEnabled: true,
    webActivityPort: 18080,
    webActivityToken: "secret",
    backgroundOptimization: true,
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

await runTest("saveSettingsPageStateWithDeps normalizes service settings", async () => {
  let committedPatch: Partial<AppSettings> | null = null;
  const savedSettings = buildSettings();
  const draftSettings = buildSettings({
    webActivityEnabled: true,
    webActivityToken: "  web-token  ",
    remoteStatusBridgeEnabled: true,
    remoteStatusBridgeUrl: "  wss://worker.example/ws  ",
    remoteStatusBridgeToken: "  remote-token  ",
    remoteStatusBridgeMachineId: "  machine-1  ",
  });

  const result = await saveSettingsPageStateWithDeps({
    savedSettings,
    draftSettings,
    appVersion: "1.2.0",
    hasUnsavedChanges: true,
    saveStatus: "idle",
  }, {
    buildPatch: SettingsRuntimeAdapterService.buildSettingsPatch,
    commitPatch: async (patch) => {
      committedPatch = patch;
      return {
        persisted: true,
        runtimeSync: "not-needed",
        runtimeSyncErrors: [],
      };
    },
  });

  assert.equal(result.accepted, true);
  assert.equal(result.nextSavedSettings?.webActivityEnabled, true);
  assert.equal(result.nextSavedSettings?.webActivityToken, "web-token");
  assert.equal(result.nextSavedSettings?.remoteStatusBridgeEnabled, true);
  assert.equal(result.nextSavedSettings?.remoteStatusBridgeUrl, "wss://worker.example/ws");
  assert.equal(result.nextSavedSettings?.remoteStatusBridgeToken, "remote-token");
  assert.equal(result.nextSavedSettings?.remoteStatusBridgeMachineId, "machine-1");
  assert.equal(result.nextDraftSettings?.webActivityToken, "web-token");
  assert.equal(result.nextBootstrap?.settings.webActivityToken, "web-token");
  assert.deepEqual(committedPatch, {
    webActivityEnabled: true,
    webActivityToken: "web-token",
    remoteStatusBridgeEnabled: true,
    remoteStatusBridgeUrl: "wss://worker.example/ws",
    remoteStatusBridgeToken: "remote-token",
    remoteStatusBridgeMachineId: "machine-1",
  });
});

await runTest("saveSettingsPageStateWithDeps preserves remote push switch while endpoint is empty", async () => {
  let committedPatch: Partial<AppSettings> | null = null;
  const savedSettings = buildSettings();
  const draftSettings = buildSettings({
    remoteStatusBridgeEnabled: true,
    remoteStatusBridgeUrl: "",
    remoteStatusBridgeToken: "  remote-token  ",
  });

  const result = await saveSettingsPageStateWithDeps({
    savedSettings,
    draftSettings,
    appVersion: "1.2.0",
    hasUnsavedChanges: true,
    saveStatus: "idle",
  }, {
    buildPatch: SettingsRuntimeAdapterService.buildSettingsPatch,
    commitPatch: async (patch) => {
      committedPatch = patch;
      return {
        persisted: true,
        runtimeSync: "not-needed",
        runtimeSyncErrors: [],
      };
    },
  });

  assert.equal(result.accepted, true);
  assert.equal(result.nextSavedSettings?.remoteStatusBridgeEnabled, true);
  assert.equal(result.nextDraftSettings?.remoteStatusBridgeEnabled, true);
  assert.deepEqual(committedPatch, {
    remoteStatusBridgeEnabled: true,
    remoteStatusBridgeToken: "remote-token",
  });
});

await runTest("normalizeSettingsRecord accepts current minimize behavior values", () => {
  const defaultSettings = normalizeSettingsRecord({});
  assert.equal(defaultSettings.minimizeBehavior, "widget");
  assert.equal(defaultSettings.closeBehavior, "tray");
  assert.equal(defaultSettings.backgroundOptimization, false);
  assert.equal(defaultSettings.themeMode, "light");
  assert.equal(defaultSettings.language, "zh-CN");
  assert.equal(defaultSettings.dynamicEffects, false);
  assert.equal(defaultSettings.colorSchemeLight, "default");
  assert.equal(defaultSettings.colorSchemeDark, "default");
  assert.equal(defaultSettings.minSessionSecs, 300);
  assert.equal(defaultSettings.webActivityEnabled, false);
  assert.equal(defaultSettings.webActivityPort, 12345);
  assert.equal(defaultSettings.webActivityToken, "");
  assert.equal(defaultSettings.remoteStatusBridgeEnabled, false);
  assert.equal(defaultSettings.remoteStatusBridgeUrl, "");
  assert.equal(defaultSettings.remoteStatusBridgeToken, "");
  assert.equal(defaultSettings.remoteStatusBridgeMachineId, "");
  const webActivitySettings = normalizeSettingsRecord({
    web_activity_enabled: "1",
    web_activity_port: "18080",
    web_activity_token: "secret",
  });
  assert.equal(webActivitySettings.webActivityEnabled, true);
  assert.equal(webActivitySettings.webActivityPort, 18080);
  assert.equal(webActivitySettings.webActivityToken, "secret");

  const invalidWebActivitySettings = normalizeSettingsRecord({
    web_activity_enabled: "1",
    web_activity_port: "80",
    web_activity_token: "secret",
  });
  assert.equal(invalidWebActivitySettings.webActivityEnabled, true);
  assert.equal(invalidWebActivitySettings.webActivityPort, 12345);

  const missingTokenSettings = normalizeSettingsRecord({
    web_activity_enabled: "1",
    web_activity_token: "   ",
  });
  assert.equal(missingTokenSettings.webActivityEnabled, false);
  assert.equal(missingTokenSettings.webActivityToken, "");

  const remoteBridgeSettings = normalizeSettingsRecord({
    remote_status_bridge_enabled: "1",
    remote_status_bridge_url: "wss://worker.example/ws",
    remote_status_bridge_token: "secret",
    remote_status_bridge_machine_id: "machine-1",
  });
  assert.equal(remoteBridgeSettings.remoteStatusBridgeEnabled, true);
  assert.equal(remoteBridgeSettings.remoteStatusBridgeUrl, "wss://worker.example/ws");
  assert.equal(remoteBridgeSettings.remoteStatusBridgeToken, "secret");
  assert.equal(remoteBridgeSettings.remoteStatusBridgeMachineId, "machine-1");

  const remoteBridgeMissingToken = normalizeSettingsRecord({
    remote_status_bridge_enabled: "1",
    remote_status_bridge_url: "wss://worker.example/ws",
    remote_status_bridge_token: "   ",
  });
  assert.equal(remoteBridgeMissingToken.remoteStatusBridgeEnabled, true);

  const remoteBridgeMissingUrl = normalizeSettingsRecord({
    remote_status_bridge_enabled: "1",
    remote_status_bridge_url: "",
    remote_status_bridge_token: "secret",
  });
  assert.equal(remoteBridgeMissingUrl.remoteStatusBridgeEnabled, true);

  const widgetSettings = normalizeSettingsRecord({
    minimize_behavior: "widget",
    close_behavior: "tray",
    background_optimization: "yes",
  });
  assert.equal(widgetSettings.minimizeBehavior, "widget");
  assert.equal(widgetSettings.closeBehavior, "tray");
  assert.equal(widgetSettings.backgroundOptimization, true);

  const retiredTraySettings = normalizeSettingsRecord({
    minimize_behavior: "tray",
  });
  assert.equal(retiredTraySettings.minimizeBehavior, "widget");

  const fallbackSettings = normalizeSettingsRecord({
    minimize_behavior: "floating-sidebar",
  });
  assert.equal(fallbackSettings.minimizeBehavior, "widget");
});

await runTest("remote backup settings normalize WebDAV directory and timestamps", () => {
  assert.equal(remoteBackupSettingsInternals.normalizeRemoteDir(""), "/Patina");
  assert.equal(remoteBackupSettingsInternals.normalizeRemoteDir("/TimeTracker"), "/TimeTracker");
  assert.equal(remoteBackupSettingsInternals.normalizeRemoteDir("TimeTracker"), "/TimeTracker");
  assert.equal(remoteBackupSettingsInternals.normalizeRemoteDir("Patina/backups/"), "/Patina/backups");
  assert.equal(remoteBackupSettingsInternals.normalizeRemoteDir("/Custom/backups"), "/Custom/backups");
  assert.equal(remoteBackupSettingsInternals.parseTimestamp(undefined), null);
  assert.equal(remoteBackupSettingsInternals.parseTimestamp(""), null);
  assert.equal(remoteBackupSettingsInternals.parseTimestamp("0"), null);
  assert.equal(remoteBackupSettingsInternals.parseTimestamp("1780493400000"), 1780493400000);
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

await runTest("normalizeSettingsRecord accepts dynamic effects and falls back to off", () => {
  assert.equal(normalizeSettingsRecord({ dynamic_effects: "1" }).dynamicEffects, true);
  assert.equal(normalizeSettingsRecord({ dynamic_effects: "0" }).dynamicEffects, false);
  assert.equal(normalizeSettingsRecord({ dynamic_effects: "off" }).dynamicEffects, false);
  assert.equal(normalizeSettingsRecord({ dynamic_effects: "broken" }).dynamicEffects, false);
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

await runTest("settings token generation creates hex tokens", () => {
  const token = createSettingsToken((bytes) => {
    bytes.fill(10);
    return bytes;
  });
  assert.equal(token, "0a".repeat(24));
});

await runTest("web activity help visibility follows setup state", () => {
  const baseInput = {
    draftEnabled: true,
    draftPort: 12345,
    draftToken: "secret",
    savedEnabled: true,
    savedPort: 12345,
    savedToken: "secret",
    snapshot: {
      enabled: true,
      connected: true,
    },
  };

  assert.equal(shouldShowWebActivityHelp({
    ...baseInput,
    draftEnabled: false,
  }), false);
  assert.equal(shouldShowWebActivityHelp({
    ...baseInput,
    snapshot: null,
  }), true);
  assert.equal(shouldShowWebActivityHelp(baseInput), false);
  assert.equal(shouldShowWebActivityHelp({
    ...baseInput,
    snapshot: {
      enabled: false,
      connected: true,
    },
  }), true);
  assert.equal(shouldShowWebActivityHelp({
    ...baseInput,
    draftToken: "   ",
  }), true);
  assert.equal(shouldShowWebActivityHelp({
    ...baseInput,
    draftToken: "next-secret",
  }), true);
  assert.equal(shouldShowWebActivityHelp({
    ...baseInput,
    draftPort: 12346,
  }), true);
  assert.equal(shouldShowWebActivityHelp({
    ...baseInput,
    draftToken: "  secret  ",
    savedToken: "secret",
  }), false);
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
  assert.ok(preparation?.previewSummary.includes("Schema 8"));
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
