import type { Plugin } from "vite";
import { HISTORY_TITLE_DETAIL_COUNT } from "./constants.ts";

function tauriStubFor(path: string) {
  if (path === "@tauri-apps/api/window") {
    return `
      const noop = async () => {};
      const foregroundListeners = new Set();
      const resizeListeners = new Set();
      let foregroundState = { visible: true, focused: false };
      globalThis.__TIME_TRACKER_SET_FOREGROUND_STATE = (nextState) => {
        foregroundState = { ...foregroundState, ...nextState };
        for (const listener of foregroundListeners) listener();
        for (const listener of resizeListeners) listener();
      };
      const currentWindow = {
        label: "main",
        minimize: noop,
        toggleMaximize: noop,
        close: noop,
        startDragging: noop,
        setFocusable: noop,
        isMaximized: async () => false,
        isVisible: async () => foregroundState.visible,
        isFocused: async () => foregroundState.focused,
        outerPosition: async () => ({ x: 0, y: 0 }),
        outerSize: async () => ({ width: 1280, height: 800 }),
        onMoved: async () => () => {},
        onFocusChanged: async (listener) => {
          foregroundListeners.add(listener);
          return () => foregroundListeners.delete(listener);
        },
        onResized: async (listener) => {
          resizeListeners.add(listener);
          return () => resizeListeners.delete(listener);
        },
      };
      export function getCurrentWindow() {
        return currentWindow;
      }
      export async function availableMonitors() {
        return [];
      }
      export async function currentMonitor() {
        return null;
      }
      export async function primaryMonitor() {
        return null;
      }
      export async function cursorPosition() {
        return { x: 0, y: 0 };
      }
    `;
  }

  if (path === "@tauri-apps/api/webviewWindow") {
    return `
      export function getCurrentWebviewWindow() {
        return { label: "main" };
      }
    `;
  }

  if (path === "@tauri-apps/api/core") {
    return `
      const SETTINGS_STORAGE_KEY = "__time_tracker_smoke_settings";

      function loadStoredSettings() {
        try {
          return {
            "__app_override::cursor.exe": JSON.stringify({ category: "development", enabled: true }),
            "__app_override::deep-research-workbench.exe": JSON.stringify({ category: "office", enabled: true }),
            "web_activity_enabled": "1",
            "web_activity_token": "smoke-token",
            ...JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) ?? "{}"),
          };
        } catch {
          return {};
        }
      }

      export async function invoke(command, payload = {}) {
        if (command === "cmd_get_web_activity_bridge_snapshot") {
          return globalThis.__TIME_TRACKER_WEB_ACTIVITY_BRIDGE_SNAPSHOT ?? {
            enabled: true,
            connected: false,
            browserClientId: null,
            browserKind: null,
            extensionVersion: null,
            lastActivityAtMs: null,
          };
        }
        if (command === "cmd_get_storage_snapshot") {
          return {
            paths: {
              installDir: "C:\\\\Smoke\\\\Patina Install",
              anchorDir: "C:\\\\Smoke\\\\Patina Anchor",
              dataRoot: "C:\\\\Smoke\\\\Patina",
              databasePath: "C:\\\\Smoke\\\\Patina\\\\patina.db",
              backupDir: "C:\\\\Smoke\\\\Patina\\\\backups",
              remoteBackupTempDir: "C:\\\\Smoke\\\\Patina\\\\remote-backup-temp",
              webviewRoot: "C:\\\\Smoke\\\\PatinaWebView",
              isCustomDataRoot: false,
              isCustomWebviewRoot: false,
            },
            sizes: {
              installDirSizeBytes: 10485760,
              dataSizeBytes: 4096,
              backupDirSizeBytes: 0,
            },
            webviewCache: {
              webviewRoot: "C:\\\\Smoke\\\\PatinaWebView",
              ebwebviewPath: "C:\\\\Smoke\\\\PatinaWebView\\\\EBWebView",
              totalSizeBytes: 0,
              reclaimableSizeBytes: 0,
              pendingClear: false,
              lastTrimAtMs: null,
              entries: [],
            },
            maintenance: {
              lastError: null,
              lastMigrationStatus: null,
            },
            pendingMigration: null,
          };
        }
        if (command === "cmd_commit_app_settings") {
          const settings = loadStoredSettings();
          for (const mutation of payload.mutations ?? []) {
            settings[mutation.key] = mutation.value;
          }
          localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
        }
        return null;
      }
      export class Channel {
        onmessage = null;
        constructor() {}
      }
    `;
  }

  if (path === "@tauri-apps/api/event") {
    return `
      export async function listen() {
        return () => {};
      }
      export async function emit() {}
    `;
  }

  if (path === "@tauri-apps/api/app") {
    return `
      export async function getVersion() {
        return "0.0.0-browser-smoke";
      }
    `;
  }

  if (path === "@tauri-apps/plugin-opener") {
    return `
      export async function openUrl() {}
    `;
  }

  if (path === "@tauri-apps/plugin-sql") {
    return `
      const SETTINGS_STORAGE_KEY = "__time_tracker_smoke_settings";

      function loadStoredSettings() {
        try {
          return {
            "__app_override::cursor.exe": JSON.stringify({ category: "development", enabled: true }),
            "__app_override::deep-research-workbench.exe": JSON.stringify({ category: "office", enabled: true }),
            "web_activity_enabled": "1",
            "web_activity_token": "smoke-token",
            ...JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) ?? "{}"),
          };
        } catch {
          return {};
        }
      }

      function smokeSessionTiming() {
        const now = new Date();
        const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0).getTime();
        const latestEnd = Math.max(dayStart + 70 * 1000, now.getTime() - 60 * 1000);
        const duration = Math.min(
          40 * 60 * 1000,
          Math.max(60 * 1000, latestEnd - dayStart - 1000),
        );

        return {
          start: Math.max(dayStart, latestEnd - duration),
          end: latestEnd,
          duration,
        };
      }

      function historySessionRows() {
        const timing = smokeSessionTiming();
        const earlierEnd = timing.start;
        const earlierStart = Math.max(
          new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate(), 0, 0, 0, 0).getTime(),
          earlierEnd - 10 * 60 * 1000,
        );
        return [
          {
            id: 901,
            app_name: "Extremely Long Research Workbench Application Name",
            exe_name: "deep-research-workbench.exe",
            window_title: "Extremely detailed project brief",
            start_time: timing.start,
            end_time: timing.end,
            duration: timing.duration,
            continuity_group_start_time: timing.start,
          },
          {
            id: 902,
            app_name: "Cursor",
            exe_name: "cursor.exe",
            window_title: "Implement chart mode",
            start_time: earlierStart,
            end_time: earlierEnd,
            duration: Math.max(0, earlierEnd - earlierStart),
            continuity_group_start_time: earlierStart,
          },
        ];
      }

      function historyTitleSampleRows() {
        const timing = smokeSessionTiming();
        const sampleDuration = Math.max(1, Math.floor(timing.duration / ${HISTORY_TITLE_DETAIL_COUNT}));
        return Array.from({ length: ${HISTORY_TITLE_DETAIL_COUNT} }, (_, index) => {
          const sampleStart = timing.start + index * sampleDuration;
          return {
            session_id: 901,
            title: "Detailed document title " + (index + 1) + " for a very long research workflow",
            start_time: sampleStart,
            end_time: index === ${HISTORY_TITLE_DETAIL_COUNT} - 1
              ? timing.end
              : Math.min(timing.end, sampleStart + sampleDuration),
          };
        });
      }

      export default class Database {
        static get() {
          return new Database();
        }

        static async load() {
          return new Database();
        }

        async select(query) {
          const normalizedQuery = String(query ?? "").toLowerCase();
          if (normalizedQuery.includes("from settings")) {
            const settings = loadStoredSettings();
            const language = globalThis.__TIME_TRACKER_SMOKE_LANGUAGE;
            if (language) settings.language = language;
            return Object.entries(settings).map(([key, value]) => ({ key, value: String(value) }));
          }
          if (normalizedQuery.includes("min(start_time)")) {
            return [{ earliest_start_time: historySessionRows()[0].start_time }];
          }
          if (normalizedQuery.includes("from session_title_samples")) {
            return historyTitleSampleRows();
          }
          if (normalizedQuery.includes("from sessions")) {
            return historySessionRows();
          }
          return [];
        }

        async execute() {}
        async close() {}
      }
    `;
  }

  throw new Error(`Missing Tauri browser smoke stub for ${path}`);
}

export function tauriBrowserSmokeStubPlugin(): Plugin {
  return {
    name: "tauri-browser-smoke-stubs",
    enforce: "pre",
    resolveId(source) {
      if (source.startsWith("@tauri-apps/")) {
        return `\0tauri-browser-smoke:${source}`;
      }
      return null;
    },
    load(id) {
      const prefix = "\0tauri-browser-smoke:";
      if (id.startsWith(prefix)) {
        return tauriStubFor(id.slice(prefix.length));
      }
      return null;
    },
  };
}
