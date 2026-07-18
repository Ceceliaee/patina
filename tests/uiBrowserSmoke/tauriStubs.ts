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
      globalThis.__TIME_TRACKER_CLASSIFICATION_MUTATIONS ??= [];
      globalThis.__PATINA_IMPORT_BATCHES ??= [];

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

      function storeSettings(settings) {
        localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
      }

      export async function invoke(command, payload = {}) {
        if (command === "cmd_list_import_batches") {
          return [...globalThis.__PATINA_IMPORT_BATCHES];
        }
        if (command === "cmd_pick_canonical_import_file") {
          return "C:\\Smoke\\tai.patina.csv";
        }
        if (command === "cmd_preview_canonical_import") {
          return {
            filePath: payload.filePath,
            fileName: "tai.patina.csv",
            fileFingerprint: "smoke-fingerprint",
            validRecords: 3,
            duplicateRecords: 1,
            errorRecords: 0,
            exactSessions: 0,
            hourBuckets: 3,
            errors: [],
          };
        }
        if (command === "cmd_commit_canonical_import") {
          globalThis.__PATINA_IMPORT_BATCHES = [{
            id: "smoke-batch",
            importedAt: 1767225600000,
            sourceName: "tai.patina.csv",
            sourceKind: "patina-csv",
            exactSessions: 0,
            hourBuckets: 2,
            totalRecords: 2,
          }];
          return {
            batchId: "smoke-batch",
            importedRecords: 2,
            duplicateRecords: 1,
            errorRecords: 0,
            exactSessions: 0,
            hourBuckets: 2,
          };
        }
        if (command === "cmd_delete_import_batch") {
          globalThis.__PATINA_IMPORT_BATCHES = globalThis.__PATINA_IMPORT_BATCHES
            .filter((batch) => batch.id !== payload.batchId);
          return { deletedExactSessions: 0, deletedHourBuckets: 2 };
        }
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
              lastTrimAtMs: null,
              entries: [],
            },
            maintenance: {
              lastError: null,
            },
          };
        }
        if (command === "cmd_commit_app_settings") {
          const settings = loadStoredSettings();
          for (const mutation of payload.mutations ?? []) {
            settings[mutation.key] = mutation.value;
          }
          storeSettings(settings);
        }
        if (command === "cmd_commit_classification_settings") {
          const settings = loadStoredSettings();
          for (const mutation of payload.mutations ?? []) {
            globalThis.__TIME_TRACKER_CLASSIFICATION_MUTATIONS.push(mutation);
            if (mutation.value === null) {
              delete settings[mutation.key];
            } else {
              settings[mutation.key] = mutation.value;
            }
          }
          storeSettings(settings);
        }
        if (command === "cmd_save_history_bootstrap_snapshot_payload") {
          const settings = loadStoredSettings();
          settings["history.bootstrap_snapshot.v1"] = String(payload.payload ?? "");
          storeSettings(settings);
        }
        if (command === "cmd_clear_history_bootstrap_snapshot_payload") {
          const settings = loadStoredSettings();
          delete settings["history.bootstrap_snapshot.v1"];
          storeSettings(settings);
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
      globalThis.__TIME_TRACKER_OPENED_URLS ??= [];
      export async function openUrl(url) {
        if (globalThis.__TIME_TRACKER_REJECT_OPEN_URL) {
          throw new Error("browser smoke opener failure");
        }
        globalThis.__TIME_TRACKER_OPENED_URLS.push(url);
      }
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

      function historyWebActivityRows() {
        if (!globalThis.__TIME_TRACKER_ENABLE_WEB_FIXTURE) return [];
        const timing = smokeSessionTiming();
        const firstDuration = Math.max(60 * 1000, Math.floor(timing.duration * 0.6));
        return [
          {
            id: 1901,
            browser_client_id: "smoke-browser",
            browser_kind: "chrome",
            browser_exe_name: "chrome.exe",
            domain: "stable.example",
            normalized_domain: "stable.example",
            url: "https://stable.example/work",
            title: "Stable work",
            favicon_url: null,
            start_time: timing.start,
            end_time: timing.start + firstDuration,
            duration: firstDuration,
          },
          {
            id: 1902,
            browser_client_id: "smoke-browser",
            browser_kind: "chrome",
            browser_exe_name: "chrome.exe",
            domain: "docs.example",
            normalized_domain: "docs.example",
            url: "https://docs.example/guide",
            title: "Stable docs",
            favicon_url: null,
            start_time: timing.start + firstDuration,
            end_time: timing.end,
            duration: Math.max(60 * 1000, timing.end - timing.start - firstDuration),
          },
        ];
      }

      function historyWebFaviconRows(params) {
        if (!globalThis.__TIME_TRACKER_ENABLE_WEB_FIXTURE) return [];
        const requestedDomains = new Set(params.map((value) => String(value).toLowerCase()));
        return [
          {
            normalized_domain: "stable.example",
            favicon_url: "data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2248%22%20height%3D%2248%22%3E%3Crect%20width%3D%2248%22%20height%3D%2248%22%20fill%3D%22%23236CC7%22%2F%3E%3C%2Fsvg%3E",
          },
          {
            normalized_domain: "docs.example",
            favicon_url: "data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2248%22%20height%3D%2248%22%3E%3Crect%20width%3D%2248%22%20height%3D%2248%22%20fill%3D%22%23C94F63%22%2F%3E%3C%2Fsvg%3E",
          },
        ].filter((row) => requestedDomains.size === 0 || requestedDomains.has(row.normalized_domain));
      }

      export default class Database {
        static get() {
          return new Database();
        }

        static async load() {
          return new Database();
        }

        async select(query, params = []) {
          const normalizedQuery = String(query ?? "").toLowerCase();
          const classificationQueryDelayMs = Number(
            globalThis.__TIME_TRACKER_CLASSIFICATION_QUERY_DELAY_MS
              ?? localStorage.getItem("__time_tracker_classification_query_delay_ms")
              ?? 0
          );
          if (
            classificationQueryDelayMs > 0
            && normalizedQuery.includes("max(coalesce(app_name")
            && normalizedQuery.includes("group by exe_name")
          ) {
            await new Promise((resolve) => setTimeout(resolve, classificationQueryDelayMs));
          }
          if (normalizedQuery.includes("from settings")) {
            const settings = loadStoredSettings();
            const language = globalThis.__TIME_TRACKER_SMOKE_LANGUAGE;
            if (language) settings.language = language;
            const keyPrefix = normalizedQuery.includes("key like")
              ? String(params[0] ?? "").replace(/%$/, "")
              : "";
            const exactKey = normalizedQuery.includes("where key = ?")
              ? String(params[0] ?? "")
              : "";
            return Object.entries(settings)
              .filter(([key]) => (!keyPrefix || key.startsWith(keyPrefix)) && (!exactKey || key === exactKey))
              .map(([key, value]) => ({ key, value: String(value) }));
          }
          if (normalizedQuery.includes("from icon_cache")) {
            const requestedExecutables = new Set(params.map((value) => String(value).toLowerCase()));
            return [
              {
                exe_name: "cursor.exe",
                icon_base64: "data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2248%22%20height%3D%2248%22%3E%3Crect%20width%3D%2248%22%20height%3D%2248%22%20fill%3D%22%23E34A3A%22%2F%3E%3C%2Fsvg%3E",
              },
              {
                exe_name: "deep-research-workbench.exe",
                icon_base64: "data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2248%22%20height%3D%2248%22%3E%3Crect%20width%3D%2248%22%20height%3D%2248%22%20fill%3D%22%23257F62%22%2F%3E%3C%2Fsvg%3E",
              },
            ].filter((row) => (
              requestedExecutables.size === 0 || requestedExecutables.has(row.exe_name)
            ));
          }
          const historyQueryDelayMs = Number(
            globalThis.__TIME_TRACKER_HISTORY_QUERY_DELAY_MS
              ?? localStorage.getItem("__time_tracker_history_query_delay_ms")
              ?? 0
          );
          if (
            historyQueryDelayMs > 0
            && (
              normalizedQuery.includes("from sessions")
              || normalizedQuery.includes("from session_title_samples")
              || normalizedQuery.includes("from web_activity_segments")
            )
          ) {
            await new Promise((resolve) => setTimeout(resolve, historyQueryDelayMs));
          }
          if (normalizedQuery.includes("from web_favicon_cache")) {
            globalThis.__TIME_TRACKER_WEB_FAVICON_QUERY_COUNT =
              (globalThis.__TIME_TRACKER_WEB_FAVICON_QUERY_COUNT ?? 0) + 1;
            const faviconDelayMs = Number(globalThis.__TIME_TRACKER_WEB_FAVICON_QUERY_DELAY_MS ?? 0);
            if (faviconDelayMs > 0) {
              await new Promise((resolve) => setTimeout(resolve, faviconDelayMs));
            }
            return historyWebFaviconRows(params);
          }
          if (normalizedQuery.includes("from web_activity_segments")) {
            return historyWebActivityRows();
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
