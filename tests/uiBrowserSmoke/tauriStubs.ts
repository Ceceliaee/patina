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
      globalThis.__PATINA_INVOKED_COMMANDS ??= [];
      globalThis.__PATINA_MAIN_WINDOW_GENERATION__ ??= 1;

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
        globalThis.__PATINA_INVOKED_COMMANDS.push({ command, payload });
        if (command === "cmd_mark_main_window_ready") {
          globalThis.__PATINA_MAIN_WINDOW_READY_EVIDENCE = {
            generation: Number(payload.generation),
            themeMode: document.documentElement.dataset.themeMode ?? null,
            theme: document.documentElement.dataset.theme ?? null,
            colorScheme: document.documentElement.dataset.colorScheme ?? null,
            cssColorScheme: document.documentElement.style.colorScheme || null,
            frameConnected: Boolean(document.querySelector(".qp-app-frame")?.isConnected),
          };
          return { outcome: "hidden", generation: Number(payload.generation) };
        }
        if (command === "cmd_get_recorded_app_catalog_page") {
          const queryDelayMs = Math.max(
            Number(
              globalThis.__TIME_TRACKER_CLASSIFICATION_QUERY_DELAY_MS
                ?? localStorage.getItem("__time_tracker_classification_query_delay_ms")
                ?? 0
            ),
            Number(
              globalThis.__TIME_TRACKER_CLASSIFICATION_CATALOG_QUERY_DELAY_MS
                ?? localStorage.getItem("__time_tracker_classification_catalog_query_delay_ms")
                ?? 0
            ),
          );
          if (queryDelayMs > 0) {
            await new Promise((resolve) => setTimeout(resolve, queryDelayMs));
          }
          if (localStorage.getItem("__time_tracker_reject_classification_query") === "1") {
            throw new Error("classification query rejected by browser smoke fixture");
          }
          const fixtureEnabled = globalThis.__TIME_TRACKER_ENABLE_CLASSIFICATION_CATALOG_FIXTURE
            || localStorage.getItem("__time_tracker_enable_classification_catalog_fixture") === "1";
          const baseRows = fixtureEnabled
            ? Array.from({ length: 130 }, (_, index) => ({
                rawExeName: "catalog-" + String(index).padStart(3, "0") + ".exe",
                appName: index === 129 ? "一年以前的应用" : "Catalog App " + index,
                lastSeenMs: 1767229200000 - index * 24 * 60 * 60 * 1000,
                hasNativeRecords: index % 2 === 0,
                hasImportExactRecords: index % 2 !== 0,
                hasImportBucketRecords: false,
              }))
            : [
            {
              rawExeName: "cursor.exe",
              appName: "Cursor",
              lastSeenMs: 1767229200000,
              hasNativeRecords: true,
              hasImportExactRecords: false,
              hasImportBucketRecords: false,
            },
            {
              rawExeName: "deep-research-workbench.exe",
              appName: "Deep Research Workbench",
              lastSeenMs: 1767225600000,
              hasNativeRecords: true,
              hasImportExactRecords: true,
              hasImportBucketRecords: false,
            },
          ];
          const searchQuery = String(payload.searchQuery ?? "").trim().toLowerCase();
          const cursor = payload.cursor ?? null;
          const limit = Math.max(1, Math.min(120, Number(payload.limit ?? 120)));
          const filteredRows = baseRows
            .filter((row) => !searchQuery
              || (row.rawExeName + " " + row.appName).toLowerCase().includes(searchQuery))
            .filter((row) => !cursor
              || row.lastSeenMs < Number(cursor.lastSeenMs)
              || (
                row.lastSeenMs === Number(cursor.lastSeenMs)
                && row.rawExeName > String(cursor.rawExeName)
              ));
          const rows = filteredRows.slice(0, limit);
          const hasMore = filteredRows.length > rows.length;
          return {
            rows,
            nextCursor: hasMore && rows.length > 0
              ? { lastSeenMs: rows.at(-1).lastSeenMs, rawExeName: rows.at(-1).rawExeName }
              : null,
            hasMore,
            readPath: "projection",
            fallbackReason: null,
            sourceRevision: 4,
          };
        }
        if (command === "cmd_get_activity_aggregate_range") {
          const historyQueryDelayMs = Number(
            globalThis.__TIME_TRACKER_HISTORY_QUERY_DELAY_MS
              ?? localStorage.getItem("__time_tracker_history_query_delay_ms")
              ?? 0
          );
          if (historyQueryDelayMs > 0) {
            await new Promise((resolve) => setTimeout(resolve, historyQueryDelayMs));
          }
          const start = Number(payload.startMs ?? 0);
          const end = Number(payload.endMs ?? start);
          const duration = Math.max(0, Math.min(30 * 60 * 1000, end - start));
          return {
            records: duration > 0 ? [
              { appName: "Cursor", exeName: "cursor.exe", startTime: start, endTime: start + duration },
              { appName: "Extremely Long Research Workbench Application Name", exeName: "deep-research-workbench.exe", startTime: start + duration, endTime: start + duration * 2 },
            ].filter((record) => record.startTime < end).map((record) => ({
              ...record,
              endTime: Math.min(record.endTime, end),
            })) : [],
            readPath: "projection",
            fallbackReason: null,
            sourceRevision: 4,
            projectionRowCount: duration > 0 ? 2 : 0,
            factRowCount: 0,
            hasActiveSession: false,
          };
        }
        if (command === "cmd_get_activity_read_model_status") {
          return {
            sourceRevision: 4,
            appCatalogState: "ready",
            activityHourlyState: "ready",
            activityCoverageStartMs: 0,
            activityCoverageEndMs: Date.now(),
            dirtyAppCount: 0,
            dirtyRangeCount: 0,
          };
        }
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
            categoryCandidates: [
              { exeName: "code.exe", categories: ["开发"] },
              { exeName: "chrome.exe", categories: ["工作", "娱乐"] },
            ],
            errors: [],
          };
        }
        if (command === "cmd_commit_canonical_import") {
          globalThis.__PATINA_LAST_IMPORT_PAYLOAD = payload;
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

      function classificationCatalogRows(params) {
        const enabled = globalThis.__TIME_TRACKER_ENABLE_CLASSIFICATION_CATALOG_FIXTURE
          || localStorage.getItem("__time_tracker_enable_classification_catalog_fixture") === "1";
        const timing = smokeSessionTiming();
        const baseRows = enabled
          ? Array.from({ length: 130 }, (_, index) => ({
              exe_name: "catalog-" + String(index).padStart(3, "0") + ".exe",
              app_name: index === 129 ? "一年以前的应用" : "Catalog App " + index,
              last_seen_ms: timing.end - index * 24 * 60 * 60 * 1000,
              has_native_records: index % 2 === 0 ? 1 : 0,
            }))
          : historySessionRows().map((row) => ({
              exe_name: row.exe_name,
              app_name: row.app_name,
              last_seen_ms: row.start_time,
              has_native_records: 1,
            }));
        const hasSearch = Number(params[0] ?? 0) === 1;
        const escapedPattern = String(params[1] ?? "");
        const search = escapedPattern
          .replace(/^%|%$/g, "")
          .replace(/\\\\([\\\\%_])/g, "$1")
          .toLowerCase();
        const hasCursor = Number(params[3] ?? 0) === 1;
        const cursorTime = Number(params[4] ?? 0);
        const cursorExe = String(params[6] ?? "");
        const limit = Math.max(1, Number(params[7] ?? 120));
        return baseRows
          .filter((row) => !hasSearch || (row.exe_name + " " + row.app_name).toLowerCase().includes(search))
          .filter((row) => !hasCursor
            || row.last_seen_ms < cursorTime
            || (row.last_seen_ms === cursorTime && row.exe_name > cursorExe))
          .sort((left, right) => right.last_seen_ms - left.last_seen_ms || left.exe_name.localeCompare(right.exe_name))
          .slice(0, limit);
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
          const isObservedClassificationQuery = (
            normalizedQuery.includes("max(coalesce(app_name")
            && normalizedQuery.includes("group by exe_name")
          ) || (
            normalizedQuery.includes("select record_id, origin")
            && normalizedQuery.includes("from import_exact_sessions")
            && !normalizedQuery.includes("window_title")
          );
          const isRecordedCatalogQuery = normalizedQuery.includes("raw_observed_apps as")
            && normalizedQuery.includes("grouped_apps");
          const classificationCatalogQueryDelayMs = Number(
            globalThis.__TIME_TRACKER_CLASSIFICATION_CATALOG_QUERY_DELAY_MS
              ?? localStorage.getItem("__time_tracker_classification_catalog_query_delay_ms")
              ?? 0
          );
          if (
            classificationQueryDelayMs > 0
            && (isObservedClassificationQuery || isRecordedCatalogQuery)
          ) {
            await new Promise((resolve) => setTimeout(resolve, classificationQueryDelayMs));
          }
          if (classificationCatalogQueryDelayMs > 0 && isRecordedCatalogQuery) {
            await new Promise((resolve) => setTimeout(resolve, classificationCatalogQueryDelayMs));
          }
          if (
            localStorage.getItem("__time_tracker_reject_classification_query") === "1"
            && (isObservedClassificationQuery || isRecordedCatalogQuery)
          ) {
            throw new Error("classification query rejected by browser smoke fixture");
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
          if (isRecordedCatalogQuery) {
            return classificationCatalogRows(params);
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
            globalThis.__TIME_TRACKER_WEB_FAVICON_QUERY_DOMAINS = params.map((value) => String(value));
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
            if (normalizedQuery.includes("effective_end_time")) {
              return historySessionRows().map((row) => ({
                record_id: row.id,
                origin: "native",
                app_name: row.app_name,
                exe_name: row.exe_name,
                window_title: row.window_title,
                start_time: row.start_time,
                effective_end_time: row.end_time,
                capacity_end_time: null,
              }));
            }
            return historySessionRows().map((row) => ({ ...row, origin: "native" }));
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
