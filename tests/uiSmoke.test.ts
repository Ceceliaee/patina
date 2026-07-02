import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";
import { COPY } from "../src/shared/copy/index.ts";

const EXPECTED_VIEWS = [
  "dashboard",
  "history",
  "data",
  "mapping",
  "tools",
  "settings",
  "about",
] as const;

const EXPECTED_NAV_LABELS = [
  "今天",
  "历史",
  "数据",
  "分类",
  "工具",
  "设置",
  "关于",
] as const;

let passed = 0;
const require = createRequire(import.meta.url);

async function runTest(name: string, fn: () => Promise<void> | void) {
  await fn();
  passed += 1;
  console.log(`PASS ${name}`);
}

function readUtf8(path: string) {
  return readFileSync(path, "utf8");
}

function collectCopyKeyPaths(value: unknown, prefix = ""): string[] {
  if (typeof value === "function" || value === null || typeof value !== "object") {
    return [prefix];
  }

  if (Array.isArray(value)) {
    return [prefix];
  }

  return Object.entries(value).flatMap(([key, child]) => {
    const nextPrefix = prefix ? `${prefix}.${key}` : key;
    return collectCopyKeyPaths(child, nextPrefix);
  });
}

function tauriStubFor(path: string) {
  if (path === "@tauri-apps/api/window") {
    const noop = async () => {};
    const currentWindow = {
      minimize: noop,
      toggleMaximize: noop,
      close: noop,
      startDragging: noop,
      isMaximized: async () => false,
      isVisible: async () => true,
      isFocused: async () => true,
      onFocusChanged: async () => () => {},
      onResized: async () => () => {},
    };
    return {
      getCurrentWindow: () => currentWindow,
    };
  }

  if (path === "@tauri-apps/api/webviewWindow") {
    return {
      getCurrentWebviewWindow: () => ({ label: "main" }),
    };
  }

  if (path === "@tauri-apps/api/core") {
    return {
      invoke: async () => null,
      Channel: class Channel {
        onmessage = null;
      },
    };
  }

  if (path === "@tauri-apps/api/event") {
    return {
      listen: async () => () => {},
      emit: async () => {},
    };
  }

  if (path === "@tauri-apps/api/app") {
    return {
      getVersion: async () => "0.0.0-smoke",
    };
  }

  if (path === "@tauri-apps/plugin-opener") {
    return {
      openUrl: async () => {},
    };
  }

  if (path === "@tauri-apps/plugin-sql") {
    return class Database {
      static get() {
        return new Database();
      }

      static async load() {
        return new Database();
      }

      async select() {
        return [];
      }

      async execute() {}

      async close() {}
    };
  }

  throw new Error(`Missing Tauri smoke stub for ${path}`);
}

function createMotionStub() {
  const React = require("react") as typeof import("react");
  const cache = new Map<string | symbol, unknown>();
  const ignoredMotionProps = new Set([
    "animate",
    "exit",
    "initial",
    "layout",
    "transition",
    "variants",
    "whileHover",
    "whileTap",
  ]);

  const motion = new Proxy({}, {
    get(_target, prop) {
      if (prop === "__esModule") return false;
      if (cache.has(prop)) return cache.get(prop);
      const tag = String(prop);
      const Component = React.forwardRef((props: Record<string, unknown>, ref) => {
        const domProps: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(props)) {
          if (!ignoredMotionProps.has(key)) {
            domProps[key] = value;
          }
        }
        return React.createElement(tag, { ...domProps, ref });
      });
      cache.set(prop, Component);
      return Component;
    },
  });

  return {
    AnimatePresence: ({ children }: { children?: unknown }) => (
      React.createElement(React.Fragment, null, children)
    ),
    motion,
  };
}

function createRechartsStub() {
  const React = require("react") as typeof import("react");
  const Container = ({ children }: { children?: unknown }) => (
    React.createElement("div", null, children)
  );
  const Empty = () => null;

  return {
    Area: Container,
    AreaChart: Container,
    Bar: Container,
    BarChart: Container,
    CartesianGrid: Empty,
    Cell: Empty,
    Pie: Container,
    PieChart: Container,
    Rectangle: Empty,
    ResponsiveContainer: Container,
    Tooltip: Empty,
    XAxis: Empty,
    YAxis: Empty,
  };
}

function createLucideStub() {
  const React = require("react") as typeof import("react");
  const cache = new Map<string | symbol, unknown>();

  return new Proxy({}, {
    get(_target, prop) {
      if (prop === "__esModule") return false;
      if (cache.has(prop)) return cache.get(prop);
      const Component = (props: Record<string, unknown>) => (
        React.createElement("svg", {
          ...props,
          "aria-hidden": props["aria-hidden"] ?? true,
          focusable: false,
        })
      );
      cache.set(prop, Component);
      return Component;
    },
  });
}

function installSmokeRenderHooks() {
  const Module = require("node:module") as {
    _load: (request: string, parent: unknown, isMain: boolean) => unknown;
  };
  const originalLoad = Module._load;
  const originalTs = require.extensions[".ts"];
  const originalTsx = require.extensions[".tsx"];
  const originalCss = require.extensions[".css"];
  const originalPng = require.extensions[".png"];

  const transpile = (module: NodeJS.Module, filename: string) => {
    const source = readFileSync(filename, "utf8")
      .replaceAll("import.meta.env.DEV", "false");
    const output = ts.transpileModule(source, {
      fileName: filename,
      compilerOptions: {
        allowSyntheticDefaultImports: true,
        esModuleInterop: true,
        jsx: ts.JsxEmit.ReactJSX,
        module: ts.ModuleKind.CommonJS,
        moduleResolution: ts.ModuleResolutionKind.NodeJs,
        target: ts.ScriptTarget.ES2020,
      },
    }).outputText;
    module._compile(output, filename);
  };

  require.extensions[".ts"] = transpile;
  require.extensions[".tsx"] = transpile;
  require.extensions[".css"] = (module) => {
    module._compile("module.exports = {};", "");
  };
  require.extensions[".png"] = (module) => {
    module._compile("module.exports = 'data:image/png;base64,';", "");
  };

  Module._load = function smokeLoad(request: string, parent: unknown, isMain: boolean) {
    if (request.startsWith("@tauri-apps/")) {
      return tauriStubFor(request);
    }
    if (request === "framer-motion") {
      return createMotionStub();
    }
    if (request === "lucide-react") {
      return createLucideStub();
    }
    if (request === "recharts") {
      return createRechartsStub();
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  return () => {
    Module._load = originalLoad;
    require.extensions[".ts"] = originalTs;
    require.extensions[".tsx"] = originalTsx;
    require.extensions[".css"] = originalCss;
    require.extensions[".png"] = originalPng;
  };
}

function renderAppShellForSmoke() {
  const restoreHooks = installSmokeRenderHooks();
  try {
    const React = require("react") as typeof import("react");
    const { renderToString } = require("react-dom/server") as typeof import("react-dom/server");
    const AppShellModule = require("../src/app/AppShell.tsx") as {
      default: React.ComponentType;
    };

    const originalWarn = console.warn;
    console.warn = (...args) => {
      if (String(args[0] ?? "").includes("width(-1) and height(-1) of chart")) {
        return;
      }
      originalWarn(...args);
    };
    try {
      return renderToString(React.createElement(AppShellModule.default));
    } finally {
      console.warn = originalWarn;
    }
  } finally {
    restoreHooks();
  }
}

await runTest("app shell declares every primary desktop view", () => {
  const viewType = readUtf8("src/app/types/view.ts");
  const shell = readUtf8("src/app/AppShell.tsx");
  const sidebar = readUtf8("src/app/components/AppSidebar.tsx");

  for (const view of EXPECTED_VIEWS) {
    assert.match(viewType, new RegExp(`"${view}"`));
    assert.match(shell, new RegExp(`renderedView === "${view}"`));
    assert.match(sidebar, new RegExp(`id: "${view}" as View`));
  }
});

await runTest("Chinese and English copy packages keep the same key structure", () => {
  assert.deepEqual(
    collectCopyKeyPaths(COPY["en-US"]).sort(),
    collectCopyKeyPaths(COPY["zh-CN"]).sort(),
  );
});

await runTest("app shell keeps History and Data snapshot loaders on their owning views", () => {
  const shell = readUtf8("src/app/AppShell.tsx");
  const historyBranch = shell.slice(shell.indexOf("<History"), shell.indexOf("<Data"));
  const dataBranch = shell.slice(shell.indexOf("<Data"), shell.indexOf("<Settings"));

  assert.match(historyBranch, /loadHistorySnapshot=\{loadHistoryRuntimeSnapshot\}/);
  assert.doesNotMatch(historyBranch, /loadDataTrendSnapshot=/);
  assert.match(dataBranch, /loadDataTrendSnapshot=\{loadDataTrendRuntimeSnapshot\}/);
  assert.doesNotMatch(dataBranch, /loadHistorySnapshot=/);
});

await runTest("Data regular view avoids visible loading and skeleton branches", () => {
  const data = readUtf8("src/features/data/components/Data.tsx");
  const heatmapPanel = readUtf8("src/features/data/components/DataHeatmapPanel.tsx");

  assert.doesNotMatch(data, /UI_TEXT\.history\.loading/);
  assert.doesNotMatch(data, /data-heatmap-skeleton/);
  assert.doesNotMatch(data, /aria-busy/);
  assert.doesNotMatch(heatmapPanel, /UI_TEXT\.data\.less/);
  assert.doesNotMatch(heatmapPanel, /UI_TEXT\.data\.more/);
  assert.match(heatmapPanel, /data-heatmap-granularity/);
  assert.match(heatmapPanel, /hideRecentDailyFutureCell/);
  assert.match(heatmapPanel, /isDailyFutureCell/);
  assert.match(heatmapPanel, /isWeeklyFutureCell/);
  assert.doesNotMatch(heatmapPanel, /QuietTooltip/);
  assert.match(heatmapPanel, /data-heatmap-tooltip/);
  assert.match(data, /selectedHeatmapView === "recent"/);
  assert.match(data, /freshReadModelsReady/);
  assert.match(data, /shouldDeferRuntimeReadModels/);
  assert.match(data, /shouldDeferHeatmapRows/);
  assert.match(data, /EMPTY_DATA_APP_TREND_POINTS/);
});

await runTest("History regular view avoids visible loading copy", () => {
  const history = readUtf8("src/features/history/components/History.tsx");
  const appCss = readUtf8("src/App.css");

  assert.doesNotMatch(history, /UI_TEXT\.history\.loading/);
  assert.doesNotMatch(history, /aria-busy/);
  assert.match(history, /HistoryHorizontalTimeline/);
  assert.match(history, /visibleHistoryTimelineView/);
  assert.match(history, /showEmptyMessage=\{!showQuietPlaceholder\}/);
  assert.doesNotMatch(history, /!\s*loading\s*&&\s*\(\s*<div className="qp-panel p-5 history-overview-timeline-card"/s);
  assert.match(appCss, /styles\/features\/history\.css/);
});

await runTest("History separates timeline list dialog from zoom dialog", () => {
  const history = readUtf8("src/features/history/components/History.tsx");
  const historyCopy = readUtf8("src/shared/copy/domains/historyCopy.ts");
  const historyTimeline = readUtf8("src/features/history/services/historyTimelineViewModel.ts");
  const historyCss = readUtf8("src/styles/features/history.css");

  assert.match(history, /HISTORY_TIMELINE_ZOOM_OPTIONS/);
  assert.match(history, /readHistoryTimelineZoomHours/);
  assert.match(history, /rememberHistoryTimelineZoomHours/);
  assert.match(history, /normalizeHistoryTimelineViewport/);
  assert.match(history, /normalizeHistoryTimelineViewportAroundFocus/);
  assert.match(history, /snapHistoryTimelineFocusToNearestHalfHour/);
  assert.match(history, /timelineDialogOpen/);
  assert.match(history, /timelineZoomDialogOpen/);
  assert.match(history, /timelineZoomHours/);
  assert.match(history, /timelineViewportStartMs/);
  assert.match(history, /timelineZoomTimelineView/);
  assert.match(history, /history-timeline-open/);
  assert.match(history, /history-timeline-zoom-open/);
  assert.match(history, /history-timeline-zoom-switch/);
  assert.match(history, /history-timeline-zoom-dialog-surface/);
  assert.match(historyCopy, /emptyTimelineWindow: "当前时间段暂无记录"/);
  assert.match(history, /emptyMessage=\{historyCopy\.emptyTimelineWindow\}/);
  assert.match(history, /handleTimelineViewportWheel/);
  assert.match(history, /viewportDurationMs \/ 6/);
  assert.match(history, /onWheel=\{handleTimelineViewportWheel\}/);
  assert.match(history, /variant="expanded"/);
  assert.doesNotMatch(history, /timelineViewportWasPannedRef\.current.*localStorage/s);
  assert.match(historyTimeline, /export const HISTORY_TIMELINE_ZOOM_OPTIONS = \[24, 12, 8, 4, 1\] as const/);
  assert.match(historyTimeline, /export const DEFAULT_HISTORY_TIMELINE_ZOOM_HOURS: HistoryTimelineZoomHours = 24/);
  assert.match(historyTimeline, /export function normalizeHistoryTimelineViewport/);
  assert.match(historyTimeline, /export function normalizeHistoryTimelineViewportAroundFocus/);
  assert.match(historyTimeline, /export function snapHistoryTimelineFocusToNearestHalfHour/);
  assert.match(historyCss, /\.history-timeline-zoom-dialog-timeline/);
  assert.match(historyCss, /overscroll-behavior: contain/);
});

await runTest("operation-oriented pages keep explicit busy feedback", () => {
  const settings = readUtf8("src/features/settings/components/Settings.tsx");
  const mapping = readUtf8("src/features/classification/components/AppMapping.tsx");
  const dataSafety = readUtf8("src/features/settings/components/SettingsDataSafetyPanel.tsx");
  const updateDialog = readUtf8("src/features/update/components/UpdateConfirmDialog.tsx");

  assert.match(settings, /UI_TEXT\.settings\.loading/);
  assert.match(mapping, /UI_TEXT\.mapping\.loading/);
  assert.match(dataSafety, /backupExporting|backupRestoring/);
  assert.match(updateDialog, /UpdateProgressBar/);
  assert.match(updateDialog, /UI_TEXT\.update\.processing/);
});

await runTest("settings leaves web activity connection status to the extension", () => {
  const extensionBackground = readUtf8("extensions/chromium/background.js");
  const webActivityDomain = readUtf8("src-tauri/src/domain/web_activity.rs");
  const bridgeGateway = readUtf8("src/platform/runtime/webActivityBridgeGateway.ts");
  const settings = readUtf8("src/features/settings/components/Settings.tsx");
  const settingsInterface = readUtf8("src/features/settings/components/SettingsInterfacePanel.tsx");
  const extensionPopup = readUtf8("extensions/chromium/popup.js");

  assert.doesNotMatch(extensionBackground, /statusLabel|extensionStatusLabel/);
  assert.doesNotMatch(webActivityDomain, /status_label|sanitize_status_label/);
  assert.doesNotMatch(bridgeGateway, /statusLabel/);
  assert.doesNotMatch(settings, /platform\/runtime\/webActivityBridgeGateway/);
  assert.doesNotMatch(settingsInterface, /bridgeSnapshot|formatBridgeStatus|webActivityStatus/);
  assert.match(extensionPopup, /function statusView\(settings,\s*text\)/);
});

await runTest("settings services only expose web sync and remote push controls", () => {
  const settings = readUtf8("src/features/settings/components/Settings.tsx");
  const settingsInterface = readUtf8("src/features/settings/components/SettingsInterfacePanel.tsx");
  const settingsDataSafety = readUtf8("src/features/settings/components/SettingsDataSafetyPanel.tsx");
  const settingsStyles = readUtf8("src/styles/features/settings.css");
  const appSettings = readUtf8("src/shared/settings/appSettings.ts");
  const appSettingsStore = readUtf8("src/platform/persistence/appSettingsStore.ts");
  const bridgeRuntime = readUtf8("src-tauri/src/platform/web_activity_bridge.rs");
  const settingsCopy = readUtf8("src/shared/copy/domains/settingsCopy.ts");
  const combined = [
    settings,
    settingsInterface,
    appSettings,
    appSettingsStore,
    bridgeRuntime,
  ].join("\n");
  const retiredNames = [
    ["local", "Api"].join(""),
    ["Local", "Api"].join(""),
    ["local", "_api"].join(""),
    ["LOCAL", "_API"].join(""),
  ];

  for (const name of retiredNames) {
    assert.ok(!combined.includes(name), `unexpected retired setting name: ${name}`);
  }
  assert.match(settingsInterface, /UI_TEXT\.settings\.servicesTitle/);
  assert.match(settingsInterface, /QuietDialog/);
  assert.match(settingsInterface, /settings-web-activity-subpanel/);
  assert.match(settingsInterface, /settings-web-activity-title-row/);
  assert.match(settingsInterface, /settings-inline-help-button/);
  assert.match(settingsInterface, /UI_TEXT\.accessibility\.settings\.openWebActivityHelp/);
  assert.match(settingsInterface, /UI_TEXT\.settings\.webActivityHelpTitle/);
  assert.match(settingsStyles, /\.settings-web-activity-title-row \{\s*min-height: 20px;/);
  assert.match(settingsStyles, /\.settings-inline-help-button \{\s*display: inline-flex;\s*height: 18px;/);
  assert.match(settingsDataSafety, /StoragePathPlaceholderRow/);
  assert.match(settingsDataSafety, /actions=\{\[/);
  assert.match(settingsDataSafety, /showTooltip=\{false\}/);
  assert.match(settingsDataSafety, /aria-busy=\{!storageSnapshot\}/);
  assert.match(settingsStyles, /\.settings-storage-path-row-placeholder/);
  assert.doesNotMatch(settingsStyles, /\.settings-storage-path-placeholder-action/);
  assert.match(settingsCopy, /webActivityHelpAction/);
  assert.match(settingsCopy, /webActivityHelpSteps/);
  assert.match(settingsCopy, /patina-chromium-extension-v\.\.\.zip/);
  assert.match(settingsCopy, /manifest\.json/);
  assert.match(settingsCopy, /patina-firefox-extension-v\.\.\.xpi/);
  assert.match(settingsCopy, /about:addons/);
  assert.doesNotMatch(settingsCopy, /patina-firefox-extension-v\.\.\.zip/);
  assert.doesNotMatch(settingsCopy, /about:debugging#\/runtime\/this-firefox/);
  assert.match(settingsCopy, /Patina Web Sync 启用并连接成功后：\\n• 自动同步当前活动标签页的网站地址、标题和网站图标。/);
  assert.doesNotMatch(settingsCopy, /浏览器内部页面不会写入网页记录/);
  assert.doesNotMatch(settingsCopy, /浏览历史库/);
  assert.match(settings, /draftSettings\.webActivityPort/);
  assert.match(appSettingsStore, /webActivityPort: "web_activity_port"/);
  assert.doesNotMatch(bridgeRuntime, /tungstenite|accept_async|Message::Text|browser-bridge/);

  const webActivityIndex = settingsInterface.indexOf("UI_TEXT.settings.webActivityTitle");
  const remoteBridgeIndex = settingsInterface.indexOf("UI_TEXT.settings.remoteStatusBridgeTitle");

  assert.ok(webActivityIndex >= 0);
  assert.ok(remoteBridgeIndex >= 0);
  assert.ok(webActivityIndex < remoteBridgeIndex);
});

await runTest("web activity views are gated by saved web sync setting", () => {
  const shell = readUtf8("src/app/AppShell.tsx");
  const history = readUtf8("src/features/history/components/History.tsx");
  const mapping = readUtf8("src/features/classification/components/AppMapping.tsx");
  const mappingState = readUtf8("src/features/classification/hooks/useAppMappingState.ts");
  const mappingDerivedState = readUtf8("src/features/classification/hooks/useAppMappingDerivedState.ts");
  const historyBranch = shell.slice(shell.indexOf("<History"), shell.indexOf("<Data"));
  const mappingBranch = shell.slice(shell.indexOf("<AppMapping"), shell.indexOf("</Suspense>"));

  assert.match(historyBranch, /webActivityEnabled=\{appSettings\.webActivityEnabled\}/);
  assert.match(mappingBranch, /webActivityEnabled=\{appSettings\.webActivityEnabled\}/);
  assert.match(history, /webActivityEnabled = false/);
  assert.match(history, /resolveEffectiveDayDistributionMode\(\s*dayDistributionMode,\s*webActivityEnabled,\s*\)/);
  assert.doesNotMatch(history, /const effectiveDayDistributionMode = webActivityEnabled \? dayDistributionMode : "app"/);
  assert.match(history, /const effectiveTimelineDialogMode = webActivityEnabled \? timelineDialogMode : "app"/);
  assert.match(history, /webActivityEnabled && \(/);
  assert.match(history, /if \(!webActivityEnabled\) return \[\]/);
  assert.match(mapping, /const \{ webActivityEnabled = false \} = props/);
  assert.match(mapping, /const effectiveObjectMode = webActivityEnabled \? objectMode : "app"/);
  assert.match(mapping, /webActivityEnabled && \(/);
  assert.match(mappingState, /webActivityEnabled = false/);
  assert.match(mappingDerivedState, /if \(!webActivityEnabled\) return \{\}/);
  assert.match(mappingDerivedState, /if \(!webActivityEnabled\) return \[\]/);
  assert.match(mappingDerivedState, /if \(!webActivityEnabled\) return \{ all: 0, other: 0, classified: 0, excluded: 0 \}/);
});

await runTest("classification web domain colors prefer favicon theme colors", () => {
  const mappingState = readUtf8("src/features/classification/hooks/useAppMappingState.ts");
  const mappingDerivedState = readUtf8("src/features/classification/hooks/useAppMappingDerivedState.ts");
  const iconThemeColors = readUtf8("src/shared/hooks/useIconThemeColors.ts");
  const webActivityRepository = readUtf8("src/platform/persistence/webActivityRepository.ts");
  const colorResolver = mappingDerivedState.slice(
    mappingDerivedState.indexOf("const resolveWebDomainColor = useCallback"),
    mappingDerivedState.indexOf("const resolveWebDomainEnabled = useCallback"),
  );

  assert.match(mappingDerivedState, /const webDomainIcons = useMemo/);
  assert.match(mappingDerivedState, /candidate\.faviconUrl\?\.trim\(\)/);
  assert.match(mappingState, /const mappingIcons = useRequestedAppIcons/);
  assert.match(mappingState, /const iconThemeColors = useIconThemeColors\(mappingIcons\)/);
  assert.match(mappingDerivedState, /const webDomainIconThemeColors = useIconThemeColors\(webDomainIcons\)/);
  assert.match(colorResolver, /const iconColor = webDomainIconThemeColors\[candidate\.normalizedDomain\]/);
  assert.match(colorResolver, /if \(iconColor\) return iconColor;/);
  assert.doesNotMatch(iconThemeColors, /darkPixelMode/);
  assert.doesNotMatch(iconThemeColors, /const\s+[A-Z_]*VERSION\s*=/);
  assert.match(iconThemeColors, /ICON_SAMPLE_SIZE = 48/);
  assert.match(iconThemeColors, /NEAR_WHITE_BRIGHTNESS_MIN = 235/);
  assert.match(iconThemeColors, /NEAR_WHITE_CHROMA_MAX = 20/);
  assert.match(iconThemeColors, /BACKGROUND_RAMP_BRIGHTNESS_MIN = 210/);
  assert.match(iconThemeColors, /isBackgroundRampColor/);
  assert.match(iconThemeColors, /DOMINANT_BACKGROUND_MIN_SHARE = 0\.45/);
  assert.match(iconThemeColors, /DOMINANT_BACKGROUND_MIN_CANVAS_SHARE = 0\.25/);
  assert.match(iconThemeColors, /detectDominantLightBackground/);
  assert.match(iconThemeColors, /EDGE_DARK_PROTECTION_BRIGHTNESS = 120/);
  assert.match(iconThemeColors, /BUCKET_SIZE = 24/);
  assert.match(iconThemeColors, /fallbackThemeColor/);
  assert.match(webActivityRepository, /NULL AS favicon_url/);
  assert.match(webActivityRepository, /LEFT JOIN web_favicon_cache AS favicon_cache/);
});

await runTest("app icon cache lookup is case-insensitive for Windows executable names", () => {
  const sessionReadRepository = readUtf8("src/platform/persistence/sessionReadRepository.ts");

  assert.match(sessionReadRepository, /caseInsensitiveBatchKeys = batchKeys\.map/);
  assert.match(sessionReadRepository, /WHERE LOWER\(exe_name\) IN/);
});

await runTest("app shell uses feature-owned Data prewarm and heavy cache lifecycle exits", () => {
  const shell = readUtf8("src/app/AppShell.tsx");

  assert.match(shell, /prewarmDataFirstScreen/);
  assert.match(shell, /clearDataHeavyCaches/);
  assert.match(shell, /clearDataBootstrapCache/);
  assert.doesNotMatch(shell, /clearDataBootstrapSnapshot/);
  assert.doesNotMatch(shell, /buildDataTrendViewModel/);
  assert.doesNotMatch(shell, /buildActivityHeatmap/);
});

await runTest("app shell uses feature-owned page cache lifecycle exits", () => {
  const shell = readUtf8("src/app/AppShell.tsx");
  const cleanupEffect = shell.slice(shell.indexOf("if (isForegroundReady) return undefined;"), shell.indexOf("const handleMinSessionSecsChange"));

  assert.match(shell, /clearDashboardSnapshotCache/);
  assert.match(shell, /clearHistorySnapshotCache/);
  assert.match(shell, /clearToolsPageCaches/);
  assert.match(shell, /includeDashboard: isDashboardRefreshEnabled/);
  assert.match(shell, /includeHistory: isHistoryRefreshEnabled/);
  assert.doesNotMatch(cleanupEffect, /clearDashboardSnapshotCache/);
  assert.match(cleanupEffect, /clearHistorySnapshotCache/);
  assert.match(cleanupEffect, /clearDataHeavyCaches/);
  assert.match(cleanupEffect, /clearToolsPageCaches/);
  assert.doesNotMatch(shell, /DASHBOARD_SNAPSHOT_CACHE/);
  assert.doesNotMatch(shell, /HISTORY_SNAPSHOT_CACHE/);
});

await runTest("app shell invalidates Tools page caches after app mapping changes", () => {
  const shell = readUtf8("src/app/AppShell.tsx");
  const mappingChangedHandler = shell.slice(
    shell.indexOf("onOverridesChanged={() => {"),
    shell.indexOf("onSessionsDeleted={() => {"),
  );

  assert.match(mappingChangedHandler, /clearDashboardSnapshotCache/);
  assert.match(mappingChangedHandler, /clearHistorySnapshotCache/);
  assert.match(mappingChangedHandler, /clearToolsPageCaches/);
  assert.match(mappingChangedHandler, /clearDataBootstrapCache/);
});

await runTest("Tools participates in startup warmup and renders from cached runtime snapshot", () => {
  const warmup = readUtf8("src/app/services/startupWarmupService.ts");
  const chunkPreload = readUtf8("src/app/services/viewChunkPreloadService.ts");
  const toolsState = readUtf8("src/features/tools/hooks/useToolsPageState.ts");
  const toolsStore = readUtf8("src/features/tools/services/toolsRuntimeSnapshotStore.ts");

  assert.match(warmup, /"tools-runtime-snapshot"/);
  assert.match(warmup, /prewarmToolsRuntimeSnapshot/);
  assert.match(warmup, /"history",\s*"data",\s*"tools",\s*"mapping"/);
  assert.match(chunkPreload, /"history", "data", "tools", "mapping"/);
  assert.match(toolsStore, /export function prewarmToolsRuntimeSnapshot/);
  assert.match(toolsState, /toolsRuntimeSnapshotStore\.getCurrentSnapshot\(\)/);
  assert.match(toolsState, /initialSnapshot === null/);
  assert.match(toolsState, /initialSnapshot \?\? DEFAULT_SNAPSHOT/);
});

await runTest("Tools time inputs keep editable empty drafts until submit", () => {
  const tools = readUtf8("src/features/tools/components/Tools.tsx");
  const reminder = readUtf8("src/features/tools/components/ReminderToolPanel.tsx");
  const timer = readUtf8("src/features/tools/components/TimerToolPanel.tsx");
  const pomodoro = readUtf8("src/features/tools/components/PomodoroToolPanel.tsx");
  const shell = readUtf8("src/app/AppShell.tsx");
  const toolsStyles = readUtf8("src/styles/features/tools.css");
  const durationInput = readUtf8("src/features/tools/components/ToolDurationInput.tsx");
  const numberInput = readUtf8("src/features/tools/services/toolsNumberInput.ts");
  const eventReminderPanel = reminder.slice(
    reminder.indexOf("export default function ReminderToolPanel"),
    reminder.indexOf("<SoftwareReminderPanel"),
  );

  assert.match(reminder, /setRelativeMinutes\(event\.target\.value\)/);
  assert.doesNotMatch(reminder, /setRelativeMinutes\(Math\.max/);
  assert.match(reminder, /parseBoundedMinuteInput\(relativeMinutes, 1, 1440\)/);
  assert.match(eventReminderPanel, /const canCreateReminder = scheduledAt !== null && scheduledAt > nowMs/);
  assert.match(eventReminderPanel, /disabled=\{creating \|\| !canCreateReminder\}/);
  assert.doesNotMatch(eventReminderPanel, /UI_TEXT\.tools\.reminderTimeInvalid/);
  assert.doesNotMatch(eventReminderPanel, /tools-validation-message/);

  assert.match(timer, /setCountdownMinutes\(event\.target\.value\)/);
  assert.doesNotMatch(timer, /setCountdownMinutes\(Math\.min/);
  assert.match(timer, /disabled=\{starting \|\| !canStartTimer\}/);

  assert.match(pomodoro, /formatMinuteInput\(snapshot\.settings\.pomodoroFocusMinutes\)/);
  assert.match(pomodoro, /const restoreDefaultDurations = useCallback/);
  assert.match(pomodoro, /className="tools-subpanel-title-action"/);
  assert.match(pomodoro, /aria-label=\{UI_TEXT\.accessibility\.tools\.restorePomodoroDefaults\}/);
  assert.match(pomodoro, /className="tools-ghost-icon-button"/);
  assert.doesNotMatch(pomodoro, /tools-pomodoro-default-actions/);
  assert.doesNotMatch(pomodoro, /title=\{UI_TEXT\.accessibility\.tools\.restorePomodoroDefaults\}/);
  assert.match(toolsStyles, /\.tools-ghost-icon-button \{\s*display: inline-flex;[\s\S]*color: color-mix\(in srgb, var\(--qp-text-tertiary\) 78%, var\(--qp-bg-panel\)\)/);
  assert.match(toolsStyles, /\.tools-ghost-icon-button:hover \{\s*color: var\(--qp-text-primary\);/);
  assert.match(pomodoro, /parseBoundedMinuteInput\(focusMinutes, 1, 180\)/);
  assert.match(pomodoro, /disabled=\{controlsDisabled \|\| !startInput\}/);

  assert.match(durationInput, /minutes: string/);
  assert.match(durationInput, /onMinutesChange: \(nextMinutes: string\) => void/);
  assert.match(durationInput, /onMinutesChange\(event\.target\.value\)/);
  assert.match(numberInput, /if \(!trimmed\) return null/);
  assert.match(numberInput, /if \(rounded < minMinutes \|\| rounded > maxMinutes\) return null/);
  assert.doesNotMatch(numberInput, /Math\.min\(maxMinutes, Math\.max\(minMinutes/);

  assert.match(tools, /initialTarget \? normalizeToolsSection\(initialTarget\) : readToolsSection\(\)/);
  assert.match(tools, /rememberToolsSection\(section\)/);
  assert.match(shell, /const \[toolsInitialTarget, setToolsInitialTarget\] = useState<ToolsOpenTarget \| null>\(null\)/);
  assert.match(shell, /if \(nextView === "tools"\) \{\s*setToolsInitialTarget\(null\);/);
});

await runTest("tools runtime avoids per-second snapshot broadcasts without state changes", () => {
  const runtime = readUtf8("src-tauri/src/engine/tools/mod.rs");
  const getSnapshot = runtime.slice(
    runtime.indexOf("pub async fn get_snapshot"),
    runtime.indexOf("pub fn get_alerts"),
  );
  const refreshIfChanged = runtime.slice(
    runtime.indexOf("async fn tick_and_refresh_if_changed"),
    runtime.indexOf("async fn tick_and_notify"),
  );
  const loadSnapshot = runtime.slice(
    runtime.indexOf("async fn load_snapshot"),
    runtime.indexOf("async fn refresh_snapshot"),
  );
  const refreshSnapshot = runtime.slice(
    runtime.indexOf("async fn refresh_snapshot"),
    runtime.indexOf("fn send_tool_alert"),
  );

  assert.match(runtime, /ToolsTickOutcome/);
  assert.match(refreshIfChanged, /if outcome\.state_changed/);
  assert.match(refreshIfChanged, /refresh_snapshot\(app\)\.await/);
  assert.match(getSnapshot, /load_snapshot\(app\)\.await/);
  assert.doesNotMatch(getSnapshot, /refresh_snapshot/);
  assert.doesNotMatch(loadSnapshot, /TOOLS_RUNTIME_CHANGED_EVENT/);
  assert.match(refreshSnapshot, /app\.emit\(TOOLS_RUNTIME_CHANGED_EVENT/);
});

await runTest("tools status surfaces share the feature-owned runtime snapshot store", () => {
  const pageState = readUtf8("src/features/tools/hooks/useToolsPageState.ts");
  const sidebarEntry = readUtf8("src/features/tools/components/ToolsSidebarStatusEntry.tsx");
  const store = readUtf8("src/features/tools/services/toolsRuntimeSnapshotStore.ts");

  assert.match(pageState, /toolsRuntimeSnapshotStore\.subscribe/);
  assert.match(pageState, /toolsRuntimeSnapshotStore\.publishSnapshot/);
  assert.match(sidebarEntry, /toolsRuntimeSnapshotStore\.subscribe/);
  assert.doesNotMatch(pageState, /ToolsRuntimeService\.onToolsRuntimeChanged/);
  assert.doesNotMatch(sidebarEntry, /ToolsRuntimeService\.onToolsRuntimeChanged/);
  assert.match(store, /createToolsRuntimeSnapshotStore/);
  assert.match(store, /pendingRefresh/);
  assert.doesNotMatch(store, /buildToolsStatusChipViewModels/);
  assert.doesNotMatch(store, /buildTimerViewModel/);
});

await runTest("tracker health polling is foreground gated without resubscribing runtime events", () => {
  const shell = readUtf8("src/app/AppShell.tsx");
  const hook = readUtf8("src/app/hooks/useWindowTracking.ts");
  const service = readUtf8("src/app/services/trackerHealthPollingService.ts");
  const bootstrap = readUtf8("src/app/services/appRuntimeBootstrapService.ts");
  const initEffect = hook.slice(
    hook.indexOf("const init = async"),
    hook.indexOf("if (!trackerHealthPollingEnabled) return undefined;"),
  );
  const pollingEffect = hook.slice(
    hook.indexOf("if (!trackerHealthPollingEnabled) return undefined;"),
    hook.indexOf("return {"),
  );

  assert.match(shell, /useWindowTracking\(\{ trackerHealthPollingEnabled: isForegroundReady \}\)/);
  assert.match(hook, /trackerHealthPollingEnabled = options\.trackerHealthPollingEnabled \?\? true/);
  assert.doesNotMatch(initEffect, /startTrackerHealthPolling/);
  assert.match(pollingEffect, /startTrackerHealthPolling/);
  assert.match(service, /refreshImmediately/);
  assert.match(service, /disposed/);
  assert.doesNotMatch(service, /loadTrackerHealthTimestampMs/);
  assert.doesNotMatch(service, /platform\/persistence/);
  assert.match(bootstrap, /getTrackerHealthRuntimeSnapshot/);
  assert.match(bootstrap, /loadTrackerHealthTimestampMs/);
});

await runTest("pomodoro alert dialog offers a pause action without changing other alerts", () => {
  const dialog = readUtf8("src/features/tools/components/ToolAlertDialog.tsx");

  assert.match(dialog, /activeAlert\?\.kind === "pomodoro"/);
  assert.match(dialog, /ToolsRuntimeService\.pausePomodoro/);
  assert.match(dialog, /UI_TEXT\.tools\.alertPausePomodoro/);
  assert.match(dialog, /UI_TEXT\.tools\.alertDismiss/);
});

await runTest("app shell uses one five minute threshold for long background behavior", () => {
  const policy = readUtf8("src/app/services/backgroundReturnHomePolicy.ts");
  const shell = readUtf8("src/app/AppShell.tsx");

  assert.match(policy, /LONG_BACKGROUND_DELAY_MS = 5 \* 60 \* 1000/);
  assert.doesNotMatch(shell, /15 \* 60 \* 1000/);
  assert.doesNotMatch(shell, /10 \* 60 \* 1000/);
  assert.match(shell, /const BACKGROUND_CACHE_RELEASE_DELAY_MS = LONG_BACKGROUND_DELAY_MS/);
  assert.match(shell, /resetToDashboardAfterLongBackground/);
  assert.match(shell, /backgroundEnteredAtMsRef/);
});

await runTest("Dashboard first snapshot load is not gated by foreground refresh", () => {
  const hook = readUtf8("src/features/dashboard/hooks/useDashboardStats.ts");

  const firstLoadEffect = hook.slice(
    hook.indexOf("if (!classificationReady || hasRequestedInitialSnapshotRef.current) return;"),
    hook.indexOf("if (refreshKey === 0"),
  );
  const refreshEffect = hook.slice(
    hook.indexOf("if (refreshKey === 0"),
    hook.indexOf("const hasLiveSession"),
  );

  assert.doesNotMatch(firstLoadEffect, /foregroundRefreshEnabled/);
  assert.match(firstLoadEffect, /void loadSnapshot\(\)/);
  assert.match(refreshEffect, /foregroundRefreshEnabled/);
});

await runTest("update snapshot listener disposes if subscription resolves after unmount", () => {
  const hook = readUtf8("src/app/hooks/useUpdateState.ts");

  assert.match(hook, /if \(cancelled\) \{\s*dispose\(\);\s*return;\s*\}/);
});

await runTest("window foreground watcher composes and releases Tauri listeners", () => {
  const gateway = readUtf8("src/platform/desktop/windowControlGateway.ts");

  assert.match(gateway, /readCurrentWindowForegroundState/);
  assert.match(gateway, /onFocusChanged/);
  assert.match(gateway, /onResized/);
  assert.match(gateway, /unlisteners\.splice\(0\)/);
});

await runTest("app shell renders dashboard and primary navigation without Tauri runtime", async () => {
  const html = renderAppShellForSmoke();

  for (const label of EXPECTED_NAV_LABELS) {
    assert.ok(html.includes(`aria-label="${label}"`), `missing nav label ${label}`);
  }
  assert.ok(html.includes("专注分布"));
  assert.ok(html.includes("应用排行"));
  assert.ok(html.includes(`aria-label="按分类显示"`));
});

console.log(`Passed ${passed} UI smoke tests`);
