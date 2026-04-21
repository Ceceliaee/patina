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
import { normalizeSettingsRecord } from "../src/shared/settings/appSettings.ts";

interface AppSettings {
  idle_timeout_secs: number;
  timeline_merge_gap_secs: number;
  refresh_interval_secs: number;
  min_session_secs: number;
  tracking_paused: boolean;
  close_behavior: "exit" | "tray";
  minimize_behavior: "taskbar" | "widget";
  launch_at_login: boolean;
  start_minimized: boolean;
  onboarding_completed: boolean;
}

type CleanupRange = 180 | 90 | 60 | 30 | 15 | 7;

const BASE_SETTINGS: AppSettings = {
  idle_timeout_secs: 300,
  timeline_merge_gap_secs: 60,
  refresh_interval_secs: 1,
  min_session_secs: 60,
  tracking_paused: false,
  close_behavior: "tray",
  minimize_behavior: "taskbar",
  launch_at_login: false,
  start_minimized: false,
  onboarding_completed: false,
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
    exported_at_ms: 1_714_000_000_000,
    schema_version: 7,
    app_version: "0.3.2",
    compatibility_level: "compatible",
    compatibility_message: "Looks good",
    session_count: 42,
    setting_count: 10,
    icon_cache_count: 5,
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
    min_session_secs: saved.min_session_secs + 60,
    tracking_paused: true,
  });

  assert.deepEqual(SettingsRuntimeAdapterService.buildSettingsPatch(saved, draft), {
    min_session_secs: draft.min_session_secs,
    tracking_paused: true,
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
    tracking_paused: true,
    timeline_merge_gap_secs: 180,
  }, {
    persistPatch: async (patch) => {
      events.push(`persist:${Object.keys(patch).length}`);
    },
    syncTimelineMergeGap: async (seconds) => {
      events.push(`sync:${seconds}`);
    },
  });

  assert.deepEqual(result, {
    persisted: true,
    runtimeSync: "synced",
    runtimeSyncErrors: [],
  });
  assert.deepEqual(events, [
    "persist:2",
    "sync:180",
  ]);
});

await runTest("commitSettingsPatchWithDeps keeps persisted success when runtime sync fails", async () => {
  const events: string[] = [];

  const result = await commitSettingsPatchWithDeps({
    timeline_merge_gap_secs: 120,
  }, {
    persistPatch: async () => {
      events.push("persist");
    },
    syncTimelineMergeGap: async () => {
      events.push("sync");
      throw new Error("runtime unavailable");
    },
  });

  assert.deepEqual(result, {
    persisted: true,
    runtimeSync: "failed",
    runtimeSyncErrors: ["runtime unavailable"],
  });
  assert.deepEqual(events, [
    "persist",
    "sync",
  ]);
});

await runTest("commitSettingsPatchWithDeps does not attempt runtime sync when persistence fails", async () => {
  const events: string[] = [];

  await assert.rejects(
    commitSettingsPatchWithDeps({
      timeline_merge_gap_secs: 90,
    }, {
      persistPatch: async () => {
        events.push("persist");
        throw new Error("disk full");
      },
      syncTimelineMergeGap: async () => {
        events.push("sync");
      },
    }),
    /disk full/,
  );

  assert.deepEqual(events, ["persist"]);
});

await runTest("normalizeSettingsRecord accepts widget minimize behavior and maps legacy tray to taskbar", () => {
  const widgetSettings = normalizeSettingsRecord({
    minimize_behavior: "widget",
    close_behavior: "tray",
  });
  assert.equal(widgetSettings.minimize_behavior, "widget");
  assert.equal(widgetSettings.close_behavior, "tray");

  const legacyTraySettings = normalizeSettingsRecord({
    minimize_behavior: "tray",
  });
  assert.equal(legacyTraySettings.minimize_behavior, "taskbar");

  const fallbackSettings = normalizeSettingsRecord({
    minimize_behavior: "floating-sidebar",
  });
  assert.equal(fallbackSettings.minimize_behavior, "taskbar");
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
    prepareBackupRestore: async () => ({
      path: "C:/tmp/incompatible.db",
      preview: buildPreview({ compatibility_level: "incompatible" }),
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

  const result = await runBackupRestoreFlow({
    initialPath: "restore.db",
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
    restoreBackup: async (path) => {
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
