import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";
import { COPY } from "../src/shared/copy/index.ts";
import { resolveQuietMotionMode } from "../src/shared/motion/quietMotion.ts";

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

function createRechartsStub() {
  const React = require("react") as typeof import("react");
  const Container = ({ children }: { children?: import("react").ReactNode }) => (
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

  const compileModule = (module: NodeJS.Module, code: string, filename: string) => {
    (module as NodeJS.Module & {
      _compile: (code: string, filename: string) => void;
    })._compile(code, filename);
  };

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
    compileModule(module, output, filename);
  };

  require.extensions[".ts"] = transpile;
  require.extensions[".tsx"] = transpile;
  require.extensions[".css"] = (module) => {
    compileModule(module, "module.exports = {};", "");
  };
  require.extensions[".png"] = (module) => {
    compileModule(module, "module.exports = 'data:image/png;base64,';", "");
  };

  Module._load = function smokeLoad(request: string, parent: unknown, isMain: boolean) {
    if (request.startsWith("@tauri-apps/")) {
      return tauriStubFor(request);
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
  const motionCss = readUtf8("src/styles/motion.css");

  for (const view of EXPECTED_VIEWS) {
    assert.match(viewType, new RegExp(`"${view}"`));
    assert.match(shell, new RegExp(`renderedView === "${view}"`));
    assert.match(sidebar, new RegExp(`id: "${view}" as View`));
  }
  assert.match(shell, /useQuietMotionPreference/);
  assert.match(shell, /data-qp-motion=\{quietMotionMode\}/);
  assert.doesNotMatch(shell, /VIEW_ORDER/);
  assert.doesNotMatch(shell, /viewTransitionStyle/);
  assert.match(motionCss, /--qp-motion-enhanced-nav-bounce-ease/);
  assert.doesNotMatch(shell, /qp-main-view-enter/);
  assert.doesNotMatch(shell, /qp-motion-view-enter/);
  assert.doesNotMatch(shell, /qp-dynamic-effects-off/);
  assert.doesNotMatch(sidebar, /requestAnimationFrame|setTimeout/);
  assert.match(sidebar, /runNavigate\(\);/);
});

await runTest("motion preference keeps reduced motion above enhanced motion", () => {
  assert.equal(resolveQuietMotionMode({
    enhancedMotionEnabled: true,
    prefersReducedMotion: true,
  }), "reduced");
  assert.equal(resolveQuietMotionMode({
    enhancedMotionEnabled: false,
    prefersReducedMotion: true,
  }), "reduced");
  assert.equal(resolveQuietMotionMode({
    enhancedMotionEnabled: false,
    prefersReducedMotion: false,
  }), "baseline");
});

await runTest("Chinese and English copy packages keep the same key structure", () => {
  assert.deepEqual(
    collectCopyKeyPaths(COPY["en-US"]).sort(),
    collectCopyKeyPaths(COPY["zh-CN"]).sort(),
  );
});

await runTest("settings describes silent launch independently in both languages", () => {
  assert.equal(COPY["zh-CN"].settings.startMinimizedLabel, "静默启动");
  assert.equal(COPY["zh-CN"].settings.startMinimizedHint, "启动后隐藏主窗口进入托盘。");
  assert.equal(COPY["zh-CN"].accessibility.settings.toggleStartMinimized, "切换静默启动");
  assert.equal(COPY["en-US"].settings.startMinimizedLabel, "Launch silently");
  assert.equal(COPY["en-US"].settings.startMinimizedHint, "Hide the main window in the system tray after startup.");
  assert.equal(COPY["en-US"].accessibility.settings.toggleStartMinimized, "Toggle silent launch");

  const settings = readUtf8("src/features/settings/components/Settings.tsx");
  const residentPanel = readUtf8("src/features/settings/components/SettingsResidentPanel.tsx");
  assert.doesNotMatch(settings, /startMinimizedDisabled/);
  assert.doesNotMatch(residentPanel, /startMinimizedDisabled|disabled=\{startMinimized/);
});

await runTest("desktop behavior sync waits for persisted settings", () => {
  const trackingHook = readUtf8("src/app/hooks/useWindowTracking.ts");

  assert.match(trackingHook, /const \[appSettingsLoaded, setAppSettingsLoaded\] = useState\(false\)/);
  assert.match(
    trackingHook,
    /shouldSyncDesktopLaunchBehavior && appSettingsLoaded/,
  );
  assert.match(
    trackingHook,
    /setAppSettings\(bootstrap\.settings\);\s*setAppSettingsLoaded\(true\)/,
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
  const trendPanel = readUtf8("src/features/data/components/DataTrendPanel.tsx");
  const heatmapPanel = readUtf8("src/features/data/components/DataHeatmapPanel.tsx");

  assert.doesNotMatch(data, /UI_TEXT\.history\.loading/);
  assert.doesNotMatch(data, /data-heatmap-skeleton/);
  assert.doesNotMatch(data, /aria-busy/);
  assert.doesNotMatch(data, /renderStage/);
  assert.doesNotMatch(trendPanel, /Loader2|qp-spin/);
  assert.doesNotMatch(trendPanel, /qp-content-fade-in/);
  assert.doesNotMatch(heatmapPanel, /qp-content-fade-in/);
  assert.match(heatmapPanel, /data-heatmap-loading-state|loading\?: boolean/);
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
});

await runTest("History regular view avoids visible loading copy", () => {
  const history = readUtf8("src/features/history/components/History.tsx");
  const appCss = readUtf8("src/App.css");

  assert.doesNotMatch(history, /UI_TEXT\.history\.loading/);
  assert.doesNotMatch(history, /historyCopy\.loading/);
  assert.doesNotMatch(history, /aria-busy/);
  assert.match(history, /HistoryHorizontalTimeline/);
  assert.match(history, /visibleHistoryTimelineView/);
  assert.match(history, /showEmptyMessage=\{!showQuietPlaceholder\}/);
  assert.doesNotMatch(history, /!\s*loading\s*&&\s*\(\s*<div className="qp-panel p-5 history-overview-timeline-card"/s);
  assert.match(appCss, /styles\/features\/history\.css/);
});

await runTest("single-date surfaces share QuietCalendar while range rules stay independent", () => {
  const calendar = readUtf8("src/shared/components/QuietCalendar.tsx");
  const datePicker = readUtf8("src/shared/components/QuietDatePicker.tsx");
  const dateRangePicker = readUtf8("src/shared/components/QuietDateRangePicker.tsx");
  const historyCalendar = readUtf8("src/features/history/components/HistoryCalendarPopover.tsx");
  const historyDateNavigator = readUtf8("src/features/history/components/HistoryDateNavigator.tsx");
  const quietProCss = readUtf8("src/styles/quiet-pro.css");

  assert.match(calendar, /export default function QuietCalendar/);
  assert.match(calendar, /export function QuietCalendarMonthFrame/);
  assert.match(calendar, /qp-calendar-header/);
  assert.match(calendar, /qp-calendar-weekdays/);
  assert.match(calendar, /data-in-range/);
  assert.match(datePicker, /import QuietCalendar from/);
  assert.doesNotMatch(datePicker, /QuietCalendarMonthFrame/);
  assert.match(dateRangePicker, /QuietCalendarMonthFrame/);
  assert.match(historyCalendar, /import QuietCalendar from/);
  assert.doesNotMatch(historyCalendar, /QuietCalendarMonthFrame/);
  assert.doesNotMatch(historyCalendar, /calendarDays|getDay/);
  assert.match(calendar, /previousMonthIcon/);
  assert.match(calendar, /nextMonthIcon/);
  assert.match(datePicker, /minDateValue/);
  assert.match(calendar, /handleDayKeyDown/);
  assert.match(dateRangePicker, /selectDraftDate/);
  assert.match(historyCalendar, /maxDate=\{today\}/);
  assert.match(historyDateNavigator, /<span\s+role="button"\s+tabIndex=\{0\}/);
  assert.doesNotMatch(
    historyDateNavigator,
    /<button(?:(?!<\/button>)[\s\S])*?className="qp-status history-date-label/,
  );
  assert.doesNotMatch(quietProCss, /\.history-calendar-(?:header|title|nav|grid|weekdays|day)/);
  assert.doesNotMatch(quietProCss, /\.qp-range-picker-(?:month|arrow|grid|weekdays|day)/);
});

await runTest("color field reuses the segmented control and exposes a native hue range", () => {
  const colorField = readUtf8("src/shared/components/QuietColorField.tsx");
  const segmentedFilter = readUtf8("src/shared/components/QuietSegmentedFilter.tsx");
  const appShellCss = readUtf8("src/styles/app-shell.css");

  assert.match(colorField, /import QuietSegmentedFilter/);
  assert.match(colorField, /semantics="tabs"/);
  assert.match(colorField, /className="qp-color-hue-slider"/);
  assert.match(colorField, /type="range"/);
  assert.match(segmentedFilter, /role=\{tabs \? "tablist" : undefined\}/);
  assert.match(segmentedFilter, /role=\{tabs \? "tab" : undefined\}/);
  assert.doesNotMatch(colorField, /qp-color-format-segment/);
  assert.doesNotMatch(appShellCss, /\.qp-color-format-segment/);
});

await runTest("dialog initial focus is semantic instead of DOM-order driven", () => {
  const quietDialog = readUtf8("src/shared/components/QuietDialog.tsx");
  const quietButton = readUtf8("src/shared/components/QuietButton.tsx");
  const quietConfirm = readUtf8("src/shared/components/QuietConfirmDialog.tsx");
  const quietPrompt = readUtf8("src/shared/components/QuietPromptDialog.tsx");
  const segmentedFilter = readUtf8("src/shared/components/QuietSegmentedFilter.tsx");
  const fieldConfig = readUtf8("src/features/settings/components/SettingsDataExportFieldConfigDialog.tsx");
  const dataSafety = readUtf8("src/features/settings/components/SettingsDataSafetyPanel.tsx");
  const colorField = readUtf8("src/shared/components/QuietColorField.tsx");
  const rangePicker = readUtf8("src/shared/components/QuietDateRangePicker.tsx");
  const historyCalendar = readUtf8("src/features/history/components/HistoryCalendarPopover.tsx");
  const quietProCss = readUtf8("src/styles/quiet-pro.css");

  assert.doesNotMatch(quietDialog, /initialFocus\??:/);
  assert.match(quietDialog, /aria-labelledby=\{titleId\}/);
  assert.match(quietDialog, /ref=\{headingRef\}[\s\S]*?tabIndex=\{-1\}/);
  assert.match(quietDialog, /isAvailableFocusTarget/);
  assert.match(quietDialog, /initialFocusRefRef/);
  assert.match(quietDialog, /restoreAncestors/);
  assert.doesNotMatch(quietDialog, /"surface"/);
  assert.match(quietProCss, /\.qp-dialog-title:focus \{[\s\S]*?outline: none;/);
  assert.match(quietButton, /forwardRef<HTMLButtonElement/);
  assert.match(quietConfirm, /initialFocusRef=\{cancelButtonRef\}/);
  assert.match(quietPrompt, /initialFocusRef=\{inputRef\}/);
  assert.doesNotMatch(quietPrompt, /autoFocus/);
  assert.match(segmentedFilter, /selectedOptionRef/);
  assert.doesNotMatch(fieldConfig, /initialFocus="surface"/);
  assert.doesNotMatch(dataSafety, /initialFocus="surface"/);
  assert.match(colorField, /aria-labelledby=\{titleId\}/);
  assert.match(colorField, /titleRef\.current\?\.focus\(\)/);
  assert.match(colorField, /event\.stopPropagation\(\)/);
  assert.match(rangePicker, /titleRef\.current\?\.focus\(\)/);
  assert.match(rangePicker, /event\.stopPropagation\(\)/);
  assert.match(historyCalendar, /role="dialog"/);
  assert.match(historyCalendar, /data-calendar-date/);
  assert.match(historyCalendar, /\.focus\(\)/);
});

await runTest("Toast separates failure semantics and uses the Quiet Pro radius token", () => {
  const quietToast = readUtf8("src/shared/components/QuietToast.tsx");
  const quietToastStack = readUtf8("src/shared/components/QuietToastStack.tsx");
  const toastTypes = readUtf8("src/shared/types/toast.ts");
  const appShellCss = readUtf8("src/styles/app-shell.css");

  assert.match(toastTypes, /"success" \| "warning" \| "error" \| "info"/);
  assert.match(quietToast, /tone === "error" \? "alert" : "status"/);
  assert.match(quietToast, /aria-atomic="true"/);
  assert.doesNotMatch(quietToastStack, /role="status"|aria-live=/);
  assert.match(appShellCss, /\.qp-toast \{[\s\S]*?border-radius: var\(--qp-radius-control\);/);
  assert.match(appShellCss, /\.qp-toast-error \{/);
});

await runTest("History separates timeline list dialog from zoom dialog", () => {
  const history = readUtf8("src/features/history/components/History.tsx");
  const historyCopy = readUtf8("src/shared/copy/domains/historyCopy.ts");
  const historyDetailsPopover = readUtf8("src/features/history/components/HistoryTimelineDetailsPopover.tsx");
  const historyTimelineDateControls = readUtf8("src/features/history/components/HistoryTimelineDialogDateControls.tsx");
  const historyTimeline = readUtf8("src/features/history/services/historyTimelineViewModel.ts");
  const historyTimelineInteraction = readUtf8("src/features/history/hooks/useHistoryTimelineViewportInteraction.ts");
  const historyTimelineComponent = readUtf8("src/features/history/components/HistoryHorizontalTimeline.tsx");
  const historyTimelineZoomDialog = readUtf8("src/features/history/components/HistoryTimelineZoomDialog.tsx");
  const quietStepperSlider = readUtf8("src/shared/components/QuietStepperSlider.tsx");
  const quietTooltip = readUtf8("src/shared/components/QuietTooltip.tsx");
  const historyTimelineLaneList = readUtf8("src/features/history/components/HistoryTimelineLaneList.tsx");
  const historyLayoutStorage = readUtf8("src/features/history/services/historyLayoutPreferenceStorage.ts");
  const historyCss = readUtf8("src/styles/features/history.css");
  const quietProCss = readUtf8("src/styles/quiet-pro.css");
  const selectedDateEffect = history.match(
    /useEffect\(\(\) => \{\s*timelineDetailsTriggerRef\.current = null;[\s\S]*?\}, \[resetTimelineViewportForDate, selectedDate\]\);/,
  )?.[0] ?? "";
  const timelineSegmentMarkup = historyTimelineComponent.match(
    /<QuietTooltip\s+key=\{segment\.id\}[\s\S]*?<\/QuietTooltip>/,
  )?.[0] ?? "";

  assert.doesNotMatch(history, /HISTORY_TIMELINE_ZOOM_OPTIONS/);
  assert.match(history, /readHistoryTimelineZoomHours/);
  assert.match(history, /rememberHistoryTimelineZoomHours/);
  assert.match(history, /normalizeHistoryTimelineViewport/);
  assert.match(history, /normalizeHistoryTimelineViewportAroundFocus/);
  assert.match(history, /snapHistoryTimelineFocusToNearestHalfHour/);
  assert.match(history, /timelineDialogOpen/);
  assert.match(history, /timelineZoomDialogOpen/);
  assert.match(history, /useState<HistoryTimelineViewport>/);
  assert.match(history, /useHistoryTimelineViewportInteraction/);
  assert.match(history, /timelineViewportInteractionProps/);
  assert.match(history, /timelineViewportIsDragging/);
  assert.match(history, /timelineZoomTimelineView/);
  assert.match(history, /history-timeline-open/);
  assert.match(history, /history-timeline-zoom-open/);
  assert.match(history, /HistoryTimelineDialogDateControls/);
  assert.match(historyTimelineDateControls, /history-timeline-dialog-date-switch/);
  assert.match(historyTimelineDateControls, /qp-button-secondary inline-flex h-6 w-6 items-center justify-center rounded-\[6px\] p-0/);
  assert.match(historyTimelineDateControls, /onClick=\{\(\) => onChangeDate\(-1\)\}/);
  assert.match(historyTimelineDateControls, /onClick=\{\(\) => onChangeDate\(1\)\}/);
  assert.match(historyTimelineDateControls, /disabled=\{isToday\}/);
  assert.match(historyTimelineZoomDialog, /QuietStepperSlider/);
  assert.match(historyTimelineZoomDialog, /className="history-timeline-hour-slider"/);
  assert.match(historyTimelineZoomDialog, /min=\{1\}/);
  assert.match(historyTimelineZoomDialog, /max=\{24\}/);
  assert.match(quietStepperSlider, /type="range"/);
  assert.match(quietStepperSlider, /decreaseAriaLabel/);
  assert.match(quietStepperSlider, /increaseAriaLabel/);
  assert.doesNotMatch(historyTimelineZoomDialog, /history-timeline-overview-selection/);
  assert.match(history, /HistoryTimelineZoomDialog/);
  assert.match(historyTimelineZoomDialog, /history-timeline-zoom-dialog-surface/);
  assert.match(historyTimelineZoomDialog, /HistoryTimelineLaneList/);
  assert.match(historyTimelineZoomDialog, /appIcons=\{appIcons\}/);
  assert.match(historyTimelineLaneList, /viewModel\.lanes\.map/);
  assert.match(historyTimelineLaneList, /history-timeline-lanes-scroll custom-scrollbar/);
  assert.match(historyTimelineLaneList, /variant="lane"/);
  assert.match(historyTimelineLaneList, /showAxis=\{false\}/);
  assert.match(historyCopy, /timelineAppLanes: "应用分轨"/);
  assert.match(historyCopy, /timelineCategoryLanes: "分类分轨"/);
  assert.match(historyCopy, /emptyTimelineWindow: "当前时间段暂无记录"/);
  assert.match(historyCopy, /timelineInteractionHint: "滚轮每次缩放 0\.2 小时，拖动或横向滚动平移时间轴"/);
  assert.match(historyTimelineZoomDialog, /step=\{0\.2\}/);
  assert.match(historyTimelineZoomDialog, /integerButtons/);
  assert.match(quietStepperSlider, /Math\.ceil\(safeValue\) - 1/);
  assert.match(quietStepperSlider, /Math\.floor\(safeValue\) \+ 1/);
  assert.match(history, /emptyMessage=\{historyCopy\.emptyTimelineWindow\}/);
  assert.match(history, /interactionProps=\{timelineViewportInteractionProps\}/);
  assert.match(historyTimelineZoomDialog, /\.\.\.interactionProps/);
  assert.match(historyTimelineZoomDialog, /interactionActive=\{isDragging\}/);
  assert.doesNotMatch(historyTimelineZoomDialog, /history-timeline-viewport-reset|RotateCcw|onReset/);
  assert.doesNotMatch(history, /handleTimelineViewportWheel/);
  assert.match(historyTimelineInteraction, /zoomHistoryTimelineViewportAroundAnchor/);
  assert.match(historyTimelineInteraction, /panHistoryTimelineViewportByPixels/);
  assert.match(historyTimelineInteraction, /setPointerCapture/);
  assert.match(historyTimelineInteraction, /onPointerDownCapture: handlePointerDown/);
  assert.match(historyTimelineInteraction, /DRAG_THRESHOLD_PX = 5/);
  assert.match(historyTimelineInteraction, /requestAnimationFrame/);
  assert.doesNotMatch(historyTimelineInteraction, /suppressClick|onClickCapture|activeElement\.blur/);
  assert.match(historyTimelineInteraction, /pendingChangeRef\.current = null;/);
  assert.match(historyTimelineInteraction, /handlePointerCancel[\s\S]*?cancelInteraction\(\)/);
  assert.match(historyTimelineInteraction, /handleLostPointerCapture[\s\S]*?hasPointerCapture\(event\.pointerId\)[\s\S]*?cancelInteraction\(\)/);
  assert.match(historyTimelineInteraction, /addEventListener\("wheel", handleWheel, \{ passive: false \}\)/);
  assert.match(historyTimelineComponent, /interactionActive/);
  assert.ok(timelineSegmentMarkup);
  assert.doesNotMatch(timelineSegmentMarkup, /tabIndex|onFocus|onBlur|onClick/);
  assert.match(timelineSegmentMarkup, /tooltipClassName="history-horizontal-timeline-tooltip"/);
  assert.match(timelineSegmentMarkup, /style=\{segmentStyle\}/);
  assert.match(historyTimelineComponent, /disabled=\{interactionActive\}/);
  assert.match(quietTooltip, /createPortal/);
  assert.doesNotMatch(historyCss, /history-horizontal-timeline-segment:(?:active|focus-visible)|history-horizontal-timeline-segment:hover::before/);
  assert.match(historyTimelineComponent, /hideOnPointerDown=\{variant !== "expanded"\}/);
  assert.match(quietTooltip, /hideOnPointerDown \? hideTooltipAfterPointerDown : undefined/);
  assert.match(history, /if \(timelineDialogOpen\) return;\s*setTimelineDialogSyncedHeight\(null\);/s);
  assert.ok(selectedDateEffect);
  assert.doesNotMatch(selectedDateEffect, /setTimelineDialogSyncedHeight\(null\)/);
  assert.match(historyTimelineZoomDialog, /variant="expanded"/);
  assert.doesNotMatch(history, /timelineViewportWasPannedRef\.current.*localStorage/s);
  assert.doesNotMatch(historyTimeline, /HISTORY_TIMELINE_ZOOM_OPTIONS/);
  assert.match(historyTimeline, /export const DEFAULT_HISTORY_TIMELINE_ZOOM_HOURS: HistoryTimelineZoomHours = 4/);
  assert.match(historyTimeline, /export function normalizeHistoryTimelineViewport/);
  assert.match(historyTimeline, /export function normalizeHistoryTimelineViewportAroundFocus/);
  assert.match(historyTimeline, /export function zoomHistoryTimelineViewportAroundAnchor/);
  assert.match(historyTimeline, /export function panHistoryTimelineViewportByPixels/);
  assert.match(historyTimeline, /export function snapHistoryTimelineFocusToNearestHalfHour/);
  assert.match(historyLayoutStorage, /numericValue >= 1 && numericValue <= 24/);
  assert.doesNotMatch(historyLayoutStorage, /viewport-start/);
  assert.match(historyCss, /grid-template-columns: minmax\(0, 1fr\) auto minmax\(0, 1fr\)/);
  assert.match(historyCss, /\.history-timeline-dialog-date-switch/);
  assert.match(historyCss, /\.history-timeline-dialog-date-label/);
  assert.match(historyCss, /\.history-timeline-zoom-dialog-timeline/);
  assert.match(historyCss, /overscroll-behavior: contain/);
  assert.match(historyCss, /cursor: grab/);
  assert.match(historyCss, /cursor: grabbing/);
  assert.match(historyCss, /user-select: none/);
  assert.match(historyCss, /\.history-timeline-lanes-scroll/);
  assert.doesNotMatch(historyCss, /\.history-timeline-zoom-dialog-surface\s*\{[^}]*height:/);
  assert.match(historyCss, /\.history-timeline-lanes-scroll\s*\{[\s\S]*height:\s*250px/);
  assert.match(historyCss, /overflow-y: auto/);
  assert.match(historyDetailsPopover, /formatDuration\(getTitleDetailDuration\(sample, nowMs\)\)/);
  assert.match(historyDetailsPopover, /history-activity-popover-item-duration/);
  assert.match(historyDetailsPopover, /history-activity-popover-item-range/);
  assert.match(quietProCss, /\.history-activity-popover-item-duration/);
  assert.match(quietProCss, /\.history-activity-popover-item-range/);
});

await runTest("shared hourly chart resolves responsive category density before paint", () => {
  const hourlyChart = readUtf8("src/shared/charts/HourlyActivityChart.tsx");

  assert.match(hourlyChart, /import \{ useLayoutEffect,/);
  assert.match(hourlyChart, /useLayoutEffect\(\(\) => \{/);
  assert.doesNotMatch(hourlyChart, /import \{ useEffect,/);
});

await runTest("operation-oriented pages keep action feedback without cold-page loading copy", () => {
  const settings = readUtf8("src/features/settings/components/Settings.tsx");
  const mapping = readUtf8("src/features/classification/components/AppMapping.tsx");
  const mappingState = readUtf8("src/features/classification/hooks/useAppMappingState.ts");
  const dataSafety = readUtf8("src/features/settings/components/SettingsDataSafetyPanel.tsx");
  const updateDialog = readUtf8("src/features/update/components/UpdateConfirmDialog.tsx");

  assert.match(settings, /UI_TEXT\.settings\.loading/);
  assert.doesNotMatch(mapping, /UI_TEXT\.mapping\.loading/);
  assert.match(mapping, /data-classification-content-state/);
  assert.match(mapping, /UI_TEXT\.mapping\.loadFailed/);
  assert.match(mapping, /UI_TEXT\.mapping\.retry/);
  assert.match(mappingState, /setLoadError/);
  assert.match(mappingState, /retryLoading/);
  assert.match(mappingState, /setSaveStatus\("saving"\)/);
  assert.match(mappingState, /setDeletingSessionsExe/);
  assert.match(dataSafety, /backupExporting|backupRestoring/);
  assert.match(updateDialog, /UpdateProgressBar/);
  assert.match(updateDialog, /UI_TEXT\.update\.processing/);
});

await runTest("storage restart commands yield before the runtime exits", () => {
  const storageCommands = readUtf8("src-tauri/src/commands/storage.rs");

  assert.match(storageCommands, /app\.request_restart\(\);\s*Ok\(\(\)\)/);
  assert.doesNotMatch(storageCommands, /app\.restart\(\)/);
});

await runTest("storage restarts explicitly restore the main window", () => {
  const bootstrap = readUtf8("src-tauri/src/app/bootstrap.rs");
  const runtime = readUtf8("src-tauri/src/app/runtime.rs");
  const desktopBehavior = readUtf8("src-tauri/src/app/desktop_behavior.rs");

  assert.match(
    bootstrap,
    /load_desktop_behavior_startup_state[\s\S]*resolve_startup_source\([\s\S]*handled_storage_restart/,
  );
  assert.match(
    bootstrap,
    /if handled_storage_restart \{\s*StartupSource::StorageRestart/,
  );
  assert.match(
    runtime,
    /ensure_main_window\(&app_handle\)[\s\S]*apply_startup_desktop_behavior/,
  );
  assert.match(
    desktopBehavior,
    /StartupUiStrategy::Show[\s\S]*?show_main_window\([\s\S]*?MainWindowShowReason::Startup\(source\)/,
  );
});

await runTest("startup recovery keeps external autostart and tray access safe", () => {
  const bootstrap = readUtf8("src-tauri/src/app/bootstrap.rs");
  const desktopBehavior = readUtf8("src-tauri/src/app/desktop_behavior.rs");
  const tray = readUtf8("src-tauri/src/app/tray.rs");
  const tools = readUtf8("src-tauri/src/app/tools.rs");
  const settingsService = readUtf8("src-tauri/src/data/app_settings_service.rs");
  const updateState = readUtf8("src-tauri/src/data/repositories/update_state.rs");

  assert.match(desktopBehavior, /source != StartupSource::SettingsRecovery/);
  assert.match(bootstrap, /TraySafetyState/);
  assert.match(bootstrap, /should_keep_app_running_without_windows/);
  assert.match(tray, /TraySafetyState/);
  assert.match(
    tray,
    /on_main_window_revealed[\s\S]*state::<TraySafetyState>\(\)\.clear_forced_visibility\(\)/,
  );
  assert.match(tools, /crate::app::tray::show_main_window/);
  assert.match(readUtf8("src-tauri/src/app/main_window.rs"), /crate::app::tray::show_main_window/);
  assert.match(settingsService, /load_post_install_reopen_main_window/);
  assert.doesNotMatch(settingsService, /take_post_install_reopen_main_window/);
  assert.match(updateState, /load_post_install_reopen_main_window/);
  assert.match(bootstrap, /runtime::setup[\s\S]*clear_post_install_reopen_main_window/);
});

await runTest("main window first visibility is gated by themed frontend readiness", () => {
  const mainWindow = readUtf8("src-tauri/src/app/main_window.rs");
  const lifecycle = readUtf8("src-tauri/src/app/state.rs");
  const commands = readUtf8("src-tauri/src/commands/window.rs");
  const bootstrap = readUtf8("src-tauri/src/app/bootstrap.rs");
  const appShell = readUtf8("src/app/AppShell.tsx");
  const tracking = readUtf8("src/app/hooks/useWindowTracking.ts");
  const theme = readUtf8("src/app/hooks/useAppThemeMode.ts");
  const readiness = readUtf8("src/app/hooks/useMainWindowReady.ts");
  const widgetShell = readUtf8("src/app/widget/WidgetShell.tsx");

  assert.match(mainWindow, /\.visible\(false\)/);
  assert.doesNotMatch(mainWindow, /\.visible\(true\)/);
  assert.match(mainWindow, /\.initialization_script\(initialization_script\)/);
  assert.match(mainWindow, /schedule_main_window_ready_timeout/);
  assert.match(lifecycle, /MainWindowRenderState::Waiting/);
  assert.match(lifecycle, /window_generation/);
  assert.match(commands, /cmd_mark_main_window_ready/);
  assert.match(commands, /window\.label\(\) != main_window::MAIN_WINDOW_LABEL/);
  assert.match(bootstrap, /commands::window::cmd_mark_main_window_ready/);
  assert.match(tracking, /appearanceResolved/);
  assert.match(theme, /useLayoutEffect/);
  assert.match(appShell, /useMainWindowReady/);
  assert.match(appShell, /ref=\{appFrameRef\}/);
  assert.match(readiness, /requestAnimationFrame/);
  assert.match(readiness, /isDocumentThemeApplied/);
  assert.doesNotMatch(widgetShell, /useMainWindowReady/);
});

await runTest("cache directory migration preserves persistent WebView state", () => {
  const storageMigration = readUtf8("src-tauri/src/data/storage_migration.rs");
  const webviewCache = readUtf8("src-tauri/src/platform/webview_cache.rs");

  assert.match(storageMigration, /migrate_persistent_profile_state/);
  assert.match(webviewCache, /"Default", "Local Storage"/);
  assert.match(webviewCache, /"Default", "IndexedDB"/);
  const persistentPaths = webviewCache.match(
    /const PERSISTENT_PROFILE_PATHS:[\s\S]*?=([\s\S]*?);/,
  )?.[1] ?? "";
  assert.doesNotMatch(persistentPaths, /Cache/);
});

await runTest("settings appearance keeps dynamic effects as the fourth option", () => {
  const appearance = readUtf8("src/features/settings/components/SettingsAppearancePanel.tsx");
  const themeModeIndex = appearance.indexOf("UI_TEXT.settings.themeModeLabel");
  const colorSchemeIndex = appearance.indexOf("UI_TEXT.settings.colorSchemeLabel");
  const languageIndex = appearance.indexOf("UI_TEXT.settings.languageLabel");
  const dynamicEffectsIndex = appearance.indexOf("UI_TEXT.settings.dynamicEffectsLabel");

  assert.ok(themeModeIndex >= 0);
  assert.ok(colorSchemeIndex > themeModeIndex);
  assert.ok(languageIndex > colorSchemeIndex);
  assert.ok(dynamicEffectsIndex > languageIndex);
  assert.match(appearance, /<QuietBadge variant="beta" size="compact">/);
  assert.match(appearance, /UI_TEXT\.settings\.betaLabel/);
});

await runTest("badges share one Quiet Pro owner and protect long labels", () => {
  const badge = readUtf8("src/shared/components/QuietBadge.tsx");
  const quietProStyles = readUtf8("src/styles/quiet-pro.css");
  const appShellStyles = readUtf8("src/styles/app-shell.css");
  const settingsStyles = readUtf8("src/styles/features/settings.css");
  const consumers = [
    readUtf8("src/features/tools/components/Tools.tsx"),
    readUtf8("src/features/settings/components/SettingsAppearancePanel.tsx"),
    readUtf8("src/features/settings/components/SettingsDataSafetyPanel.tsx"),
  ];

  assert.match(badge, /type QuietBadgeSize = "compact" \| "regular"/);
  assert.match(badge, /type QuietBadgeVariant = "default" \| "beta"/);
  assert.match(badge, /className="qp-badge-label"/);
  assert.match(quietProStyles, /\.qp-badge \{[\s\S]*?border-radius: var\(--qp-radius-chip\);/);
  assert.match(quietProStyles, /\.qp-badge-label \{[\s\S]*?text-overflow: ellipsis;[\s\S]*?white-space: nowrap;/);
  assert.match(quietProStyles, /\.qp-badge-compact \{/);
  assert.match(quietProStyles, /\.qp-badge-regular \{/);
  assert.match(quietProStyles, /\.qp-badge-beta \{/);
  assert.doesNotMatch(appShellStyles, /\.qp-badge(?:-|\s|\{)/);
  assert.doesNotMatch(settingsStyles, /settings-(?:beta-badge|local-paths-beta)/);
  for (const consumer of consumers) {
    assert.match(consumer, /<QuietBadge variant="beta"/);
  }
});

await runTest("settings leaves web activity connection status to the extension", () => {
  const webActivityDomain = readUtf8("src-tauri/src/domain/web_activity.rs");
  const bridgeGateway = readUtf8("src/platform/runtime/webActivityBridgeGateway.ts");
  const settings = readUtf8("src/features/settings/components/Settings.tsx");
  const settingsInterface = readUtf8("src/features/settings/components/SettingsInterfacePanel.tsx");
  const protocol = readUtf8("docs/web-activity-protocol.md");

  assert.doesNotMatch(webActivityDomain, /status_label|sanitize_status_label/);
  assert.doesNotMatch(bridgeGateway, /statusLabel/);
  assert.doesNotMatch(settings, /platform\/runtime\/webActivityBridgeGateway/);
  assert.doesNotMatch(settingsInterface, /bridgeSnapshot|formatBridgeStatus|webActivityStatus/);
  assert.match(protocol, /Patina Web Sync 拥有浏览器扩展客户端/);
  assert.match(protocol, /patina-web-sync/);
});

await runTest("settings services only expose web sync and remote push controls", () => {
  const settings = readUtf8("src/features/settings/components/Settings.tsx");
  const settingsState = readUtf8("src/features/settings/hooks/useSettingsPageState.ts");
  const settingsInterface = readUtf8("src/features/settings/components/SettingsInterfacePanel.tsx");
  const settingsDataSafety = readUtf8("src/features/settings/components/SettingsDataSafetyPanel.tsx");
  const settingsRuntimeAdapter = readUtf8("src/features/settings/services/settingsRuntimeAdapterService.ts");
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
  assert.match(settingsDataSafety, /settings-storage-path-placeholder-meta" aria-hidden="true"/);
  assert.match(settingsDataSafety, /actions=\{\[/);
  assert.match(settingsDataSafety, /showTooltip=\{false\}/);
  assert.doesNotMatch(settingsDataSafety, /storageSnapshotUnchecked/);
  assert.match(settingsDataSafety, /storageSnapshotRefreshAction/);
  assert.match(settingsDataSafety, /aria-busy=\{isStorageBusy\}/);
  assert.doesNotMatch(settingsDataSafety, /aria-busy=\{!storageSnapshot\}/);
  assert.match(settingsState, /handleRefreshStorageSnapshot/);
  assert.match(settingsState, /let cachedStorageSnapshot: StorageSnapshot \| null = null/);
  assert.match(settingsState, /const loadInitialStorageSnapshotOnce = \(\) =>/);
  assert.match(settingsState, /useState<StorageSnapshot \| null>\(\(\) => cachedStorageSnapshot\)/);
  assert.match(settingsState, /void loadInitialStorageSnapshotOnce\(\)/);
  assert.match(settingsState, /cachedStorageSnapshot = nextSnapshot/);
  assert.doesNotMatch(settingsState, /void refreshStorageSnapshot\(\);\s*\}, \[refreshStorageSnapshot\]\)/);
  assert.match(settingsState, /restartAndClearWebviewCache\(\)/);
  assert.match(settingsState, /restartAndApplyStorageMigration\(selectedPath\)/);
  assert.match(settingsState, /restartAndApplyWebviewCacheMigration\(selectedPath\)/);
  assert.doesNotMatch(settingsState, /scheduleStorageMigration|cancelPendingStorageMigration/);
  assert.match(settingsDataSafety, /restartAndApplyAction/);
  assert.doesNotMatch(settingsDataSafety, /pendingMigration|pendingClear|稍后重启/);
  assert.match(settingsCopy, /restartAndApplyAction: "重启并应用"/);
  assert.doesNotMatch(settingsCopy, /下次启动|稍后重启|next launch|Restart later/);
  assert.match(settingsStyles, /\.settings-storage-path-row-placeholder/);
  assert.doesNotMatch(settingsStyles, /\.settings-storage-path-placeholder-action/);
  assert.match(settingsCopy, /webActivityHelpAction/);
  assert.match(settingsCopy, /webActivityHelpSteps/);
  assert.match(settingsCopy, /选择浏览器，从对应商店安装 Patina Web Sync。/);
  assert.match(settingsCopy, /商店不可用时，可从 Patina Web Sync 发布页手动安装。/);
  assert.match(settingsCopy, /patina-web-sync\/releases\/latest/);
  assert.match(settingsRuntimeAdapter, /url\.startsWith\("https:\/\/"\)/);
  assert.match(settingsInterface, /chromewebstore\.google\.com\/detail\/patina-web-sync\/gimdckblhckibmeklhemgccabmbnoemd/);
  assert.match(settingsInterface, /addons\.mozilla\.org\/firefox\/addon\/patina-web-sync/);
  assert.match(settingsInterface, /microsoftedge\.microsoft\.com\/addons\/detail\/gogmlpjhbfjghilmpcciedplifdiibai/);
  assert.match(settingsInterface, /settings-web-activity-store-badge-row/);
  assert.match(settingsStyles, /settings-web-activity-store-badge\.chrome[\s\S]*?chrome-web-store\.png/);
  assert.match(settingsStyles, /settings-web-activity-store-badge\.firefox[\s\S]*?firefox-add-ons\.svg/);
  assert.match(settingsStyles, /settings-web-activity-store-badge\.edge[\s\S]*?edge-add-ons\.png/);
  assert.match(settingsStyles, /\.settings-web-activity-store-badge \{[\s\S]*?height: 36px;/);
  assert.doesNotMatch(settingsCopy, /storageSnapshotUnchecked/);
  assert.doesNotMatch(settingsCopy, /patina-chromium-extension-v\.\.\.zip/);
  assert.doesNotMatch(settingsCopy, /manifest\.json/);
  assert.doesNotMatch(settingsCopy, /patina-firefox-extension-v\.\.\.xpi/);
  assert.doesNotMatch(settingsCopy, /about:addons/);
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
  const historyTimelineLists = readUtf8("src/features/history/components/HistoryTimelineLists.tsx");
  const mapping = readUtf8("src/features/classification/components/AppMapping.tsx");
  const mappingState = readUtf8("src/features/classification/hooks/useAppMappingState.ts");
  const mappingDerivedState = readUtf8("src/features/classification/hooks/useAppMappingDerivedState.ts");
  const historyBranch = shell.slice(shell.indexOf("<History"), shell.indexOf("<Data"));
  const mappingBranch = shell.slice(shell.indexOf("<AppMapping"), shell.indexOf("</Suspense>"));
  const webTimelineListBranch = historyTimelineLists.slice(
    historyTimelineLists.indexOf("export function HistoryWebTimelineList"),
  );

  assert.match(historyBranch, /webActivityEnabled=\{appSettings\.webActivityEnabled\}/);
  assert.match(mappingBranch, /webActivityEnabled=\{appSettings\.webActivityEnabled\}/);
  assert.match(history, /webActivityEnabled = false/);
  assert.match(history, /resolveEffectiveDayDistributionMode\(\s*dayDistributionMode,\s*webActivityEnabled,\s*\)/);
  assert.doesNotMatch(history, /const effectiveDayDistributionMode = webActivityEnabled \? dayDistributionMode : "app"/);
  assert.match(history, /const effectiveTimelineDialogMode = webActivityEnabled \? timelineDialogMode : "app"/);
  assert.match(history, /webActivityEnabled && \(/);
  assert.match(history, /if \(!webActivityEnabled\) return \[\]/);
  assert.doesNotMatch(webTimelineListBranch, /activitySegmentCount\(item\.mergedCount\)/);
  assert.match(webTimelineListBranch, /const titleCount = item\.titleSamples\.length/);
  assert.match(webTimelineListBranch, /titleRowCount\(titleCount\)/);
  assert.match(mapping, /const \{ webActivityEnabled = false, titleRecordingEnabled = true \} = props/);
  assert.match(mapping, /globalTitleEnabled=\{titleRecordingEnabled\}/);
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
  const cleanupEffect = shell.slice(
    shell.indexOf("if (isForegroundReady || !appSettings.backgroundOptimization) return undefined;"),
    shell.indexOf("const handleMinSessionSecsChange"),
  );

  assert.match(shell, /clearDashboardSnapshotCache/);
  assert.match(shell, /clearHistorySnapshotCache/);
  assert.match(shell, /clearToolsPageCaches/);
  assert.match(shell, /includeDashboard: isDashboardRefreshEnabled/);
  assert.match(shell, /includeHistory: isHistoryRefreshEnabled/);
  assert.doesNotMatch(cleanupEffect, /clearDashboardSnapshotCache/);
  assert.match(cleanupEffect, /clearHistorySnapshotCache/);
  assert.doesNotMatch(cleanupEffect, /clearHistoryBootstrapSnapshot/);
  assert.match(cleanupEffect, /clearDataHeavyCaches/);
  assert.match(cleanupEffect, /clearToolsPageCaches/);
  assert.match(cleanupEffect, /appSettings\.backgroundOptimization/);
  assert.doesNotMatch(shell, /DASHBOARD_SNAPSHOT_CACHE/);
  assert.doesNotMatch(shell, /HISTORY_SNAPSHOT_CACHE/);
});

await runTest("app shell restores the last active primary view on startup", () => {
  const navigation = readUtf8("src/app/hooks/useAppShellNavigation.ts");
  const viewStorage = readUtf8("src/app/services/updateRelaunchViewStorage.ts");

  assert.match(navigation, /consumePendingUpdateRelaunchView\(\) \?\? readLastActiveView\(\) \?\? "dashboard"/);
  assert.match(navigation, /rememberLastActiveView\(currentView\)/);
  assert.match(viewStorage, /export function readLastActiveView/);
});

await runTest("app shell invalidates Tools page caches after app mapping changes", () => {
  const shell = readUtf8("src/app/AppShell.tsx");
  const mappingChangedHandler = shell.slice(
    shell.indexOf("onOverridesChanged={() => {"),
    shell.indexOf("onSessionsDeleted={() => {"),
  );

  assert.match(mappingChangedHandler, /clearDashboardSnapshotCache/);
  assert.match(mappingChangedHandler, /clearHistoryCachesAfterDataChange/);
  assert.match(mappingChangedHandler, /clearToolsPageCaches/);
  assert.match(mappingChangedHandler, /clearDataBootstrapCache/);
});

await runTest("History bootstrap lifecycle keeps background reuse and invalidates changed data", () => {
  const shell = readUtf8("src/app/AppShell.tsx");
  const tracking = readUtf8("src/app/hooks/useWindowTracking.ts");
  const warmup = readUtf8("src/app/services/startupWarmupService.ts");
  const store = readUtf8("src/platform/persistence/historyBootstrapSnapshotStore.ts");
  const history = readUtf8("src/features/history/components/History.tsx");
  const sessionsDeletedStart = shell.indexOf("onSessionsDeleted={() => {");
  const sessionsDeletedHandler = shell.slice(
    sessionsDeletedStart,
    shell.indexOf("webActivityEnabled={appSettings.webActivityEnabled}", sessionsDeletedStart),
  );

  assert.match(sessionsDeletedHandler, /clearHistoryCachesAfterDataChange/);
  assert.match(tracking, /shouldInvalidateDataCaches\(payload\.reason\)[\s\S]*clearHistoryCachesAfterDataChange/);
  assert.match(tracking, /shouldInvalidateDataCaches\(payload\.reason\)[\s\S]*clearDataHeavyCaches/);
  assert.match(warmup, /"history-bootstrap-snapshot-cache"/);
  assert.match(warmup, /historyBootstrapSnapshotCache: true/);
  assert.match(warmup, /historyTodaySnapshot: false/);
  assert.match(store, /SELECT value FROM settings WHERE key = \? LIMIT 1/);
  assert.match(history, /data-history-content-state=\{contentState\}/);
  assert.match(history, /contentState === "cold-loading"/);
  assert.match(history, /activeDurationLabel: DAY_SUMMARY_EMPTY_MARK/);
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
  assert.match(refreshIfChanged, /refresh_snapshot\(app, store\)\.await/);
  assert.match(getSnapshot, /load_snapshot\(app, store\)\.await/);
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

await runTest("app shell keeps long background navigation persistent", () => {
  const policy = readUtf8("src/app/services/backgroundReturnHomePolicy.ts");
  const shell = readUtf8("src/app/AppShell.tsx");
  const navigation = readUtf8("src/app/hooks/useAppShellNavigation.ts");
  const mainWindow = readUtf8("src-tauri/src/app/main_window.rs");
  const widgetWindow = readUtf8("src-tauri/src/app/widget.rs");

  assert.match(policy, /LONG_BACKGROUND_DELAY_MS = 3 \* 60 \* 1000/);
  assert.match(mainWindow, /MAIN_WINDOW_DESTROY_AFTER_BACKGROUND_SECS: u64 = 3 \* 60/);
  assert.match(widgetWindow, /WIDGET_DESTROY_AFTER_IDLE_SECS: u64 = 3 \* 60/);
  assert.doesNotMatch(shell, /15 \* 60 \* 1000/);
  assert.doesNotMatch(shell, /10 \* 60 \* 1000/);
  assert.match(shell, /const BACKGROUND_CACHE_RELEASE_DELAY_MS = LONG_BACKGROUND_DELAY_MS/);
  assert.doesNotMatch(shell, /resetToDashboardAfterLongBackground/);
  assert.doesNotMatch(shell, /backgroundEnteredAtMsRef/);
  assert.doesNotMatch(navigation, /shouldReturnHomeAfterBackground/);
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

await runTest("data export chooses among four explained formats before configuring fields", () => {
  const dialog = readUtf8("src/features/settings/components/SettingsDataExportDialog.tsx");
  const fields = readUtf8("src/features/settings/services/settingsDataExportFields.ts");
  assert.match(dialog, /value: "markdown"/);
  assert.match(dialog, /settings-data-export-format-grid/);
  assert.ok(dialog.indexOf("settings-data-export-format-grid") < dialog.indexOf("configFieldsCount"));
  for (const group of ["activity", "apps", "web", "classification", "analysis", "audit"]) {
    assert.match(fields, new RegExp(`id: "${group}"`));
  }
});

await runTest("search fields share one visual and accessibility owner", () => {
  const sharedSearchField = readUtf8("src/shared/components/QuietSearchField.tsx");
  const consumers = [
    readUtf8("src/features/classification/components/AppMapping.tsx"),

    readUtf8("src/features/tools/components/ReminderToolPanel.tsx"),
  ];

  assert.match(sharedSearchField, /data-app-search qp-search-field/);
  assert.match(sharedSearchField, /<Search size=\{14\} aria-hidden \/>/);
  assert.match(sharedSearchField, /type="text"/);
  for (const consumer of consumers) {
    assert.match(consumer, /<QuietSearchField/);
    assert.doesNotMatch(consumer, /<label className="data-app-search/);
  }
});

await runTest("tooltips keep one shared visual owner", () => {
  const tooltip = readUtf8("src/shared/components/QuietTooltip.tsx");
  const quietProStyles = readUtf8("src/styles/quiet-pro.css");
  const appShellStyles = readUtf8("src/styles/app-shell.css");

  assert.match(tooltip, /onKeyDownCapture=\{hideTooltipFromKeyboard\}/);
  assert.match(tooltip, /new ResizeObserver\(updatePosition\)/);
  assert.match(tooltip, /const POINTER_SHOW_DELAY_MS = 300/);
  assert.match(tooltip, /"aria-describedby": visible && canShow/);
  assert.match(quietProStyles, /\.qp-tooltip-anchor \{/);
  assert.match(quietProStyles, /\.qp-tooltip \{/);
  assert.doesNotMatch(appShellStyles, /\.qp-tooltip(?:-anchor)? \{/);
});

await runTest("chart tooltips use Recharts contracts and the Quiet Pro visual owner", () => {
  const chartTooltip = readUtf8("src/shared/components/QuietChartTooltip.tsx");
  const appStyles = readUtf8("src/App.css");
  const chartTooltipStyles = readUtf8("src/styles/components/quiet-chart-tooltip.css");
  const appShellStyles = readUtf8("src/styles/app-shell.css");

  assert.match(chartTooltip, /type TooltipContentProps/);
  assert.match(chartTooltip, /type TooltipPayloadEntry/);
  assert.match(chartTooltip, /type TooltipProps/);
  assert.match(chartTooltip, /type TooltipValueType/);
  assert.doesNotMatch(chartTooltip, /cursor as never/);
  assert.match(chartTooltip, /function isZeroTooltipValue/);
  assert.match(chartTooltip, /typeof value === "string" && value\.trim\(\) === ""/);
  assert.match(chartTooltip, /!isZeroTooltipValue\(item\.value\)/);
  assert.match(chartTooltip, /role="tooltip"/);
  assert.match(chartTooltip, /className="qp-chart-tooltip-name"/);
  assert.match(appStyles, /styles\/components\/quiet-chart-tooltip\.css/);
  assert.match(chartTooltipStyles, /\.qp-chart-tooltip \{/);
  assert.match(chartTooltipStyles, /max-width: min\(260px, calc\(100vw - 16px\)\)/);
  assert.match(chartTooltipStyles, /\.qp-chart-tooltip-name \{[\s\S]*?text-overflow: ellipsis/);
  assert.match(chartTooltipStyles, /border-radius: var\(--qp-radius-control\)/);
  assert.doesNotMatch(appShellStyles, /\.qp-chart-tooltip(?:-[a-z-]+)? \{/);
});

await runTest("ordinary inputs share the Quiet Pro CSS contract without a wrapper component", () => {
  const quietProStyles = readUtf8("src/styles/quiet-pro.css");
  const consumers = [
    "src/features/classification/components/AppMappingCandidateCard.tsx",
    "src/features/classification/components/WebDomainMappingCard.tsx",
    "src/features/tools/components/TimerToolPanel.tsx",
    "src/features/tools/components/ToolDurationInput.tsx",
    "src/features/tools/components/ReminderToolPanel.tsx",
    "src/features/settings/components/SettingsRemoteBackupPanel.tsx",
    "src/features/settings/components/SettingsInterfacePanel.tsx",
    "src/shared/components/QuietPromptDialog.tsx",
  ].map(readUtf8);

  assert.match(quietProStyles, /\.qp-input \{/);
  assert.match(quietProStyles, /\.qp-input:focus/);
  assert.match(quietProStyles, /\.qp-input:disabled/);
  assert.match(quietProStyles, /\.qp-input\[aria-invalid="true"\]/);
  for (const consumer of consumers) {
    assert.match(consumer, /className=(?:"qp-input|\{`qp-input)/);
    assert.doesNotMatch(consumer, /<QuietInput/);
  }
});

await runTest("remaining Quiet Pro component families keep one owner and explicit semantics", () => {
  const appStyles = readUtf8("src/App.css");
  const appShellStyles = readUtf8("src/styles/app-shell.css");
  const actionStyles = readUtf8("src/styles/components/quiet-actions.css");
  const containerStyles = readUtf8("src/styles/components/quiet-containers.css");
  const dataStyles = readUtf8("src/styles/features/data.css");
  const quietProStyles = readUtf8("src/styles/quiet-pro.css");
  const actionRow = readUtf8("src/shared/components/QuietActionRow.tsx");
  const subpanel = readUtf8("src/shared/components/QuietSubpanel.tsx");
  const iconAction = readUtf8("src/shared/components/QuietIconAction.tsx");
  const inlineAction = readUtf8("src/shared/components/QuietInlineAction.tsx");
  const rangeControl = readUtf8("src/shared/components/QuietRangeControl.tsx");
  const stepperSlider = readUtf8("src/shared/components/QuietStepperSlider.tsx");
  const dataHeatmap = readUtf8("src/features/data/components/DataHeatmapPanel.tsx");
  const settingsDataSafety = readUtf8("src/features/settings/components/SettingsDataSafetyPanel.tsx");
  const pageHeaderConsumers = [
    "src/features/about/components/About.tsx",
    "src/features/classification/components/AppMapping.tsx",
    "src/features/dashboard/components/Dashboard.tsx",
    "src/features/data/components/Data.tsx",
    "src/features/history/components/History.tsx",
    "src/features/settings/components/Settings.tsx",
    "src/features/tools/components/Tools.tsx",
  ].map(readUtf8);

  assert.match(appStyles, /styles\/components\/quiet-actions\.css/);
  assert.match(appStyles, /styles\/components\/quiet-containers\.css/);
  assert.match(actionStyles, /\.qp-inline-action \{/);
  assert.match(actionStyles, /\.qp-icon-action \{/);
  assert.match(actionStyles, /:active:not\(:disabled\)/);
  assert.match(actionStyles, /border-radius: var\(--qp-radius-button\)/);
  assert.match(containerStyles, /\.qp-subpanel \{[\s\S]*?border-radius: var\(--qp-radius-panel\)/);
  assert.match(containerStyles, /\.qp-action-row \{[\s\S]*?border-radius: var\(--qp-radius-control\)/);
  assert.doesNotMatch(appShellStyles, /^\.qp-(?:inline-action|icon-action|subpanel|action-row)\s*\{/m);

  assert.match(actionRow, /<div className=\{`qp-action-row/);
  assert.match(subpanel, /<div className=\{`qp-subpanel/);
  assert.doesNotMatch(subpanel, /<section/);
  assert.doesNotMatch(subpanel, /QuietSubpanelTone|tone\??:/);
  assert.doesNotMatch(containerStyles, /\.qp-subpanel-danger/);
  assert.match(iconAction, /aria-pressed=\{pressed\}/);
  assert.match(inlineAction, /qp-inline-action-\$\{tone\}/);

  assert.match(rangeControl, /role="group"/);
  assert.match(rangeControl, /onLabelClick \? \(/);
  assert.match(rangeControl, /aria-haspopup="dialog"/);
  assert.doesNotMatch(rangeControl, /labelDisabled/);
  assert.doesNotMatch(dataHeatmap, /labelDisabled/);
  assert.doesNotMatch(quietProStyles, /\.data-heatmap-range-(?:arrow|label)/);
  assert.match(dataStyles, /\.data-trend-header \.data-trend-range-control/);

  assert.match(stepperSlider, /displayValue: string/);
  assert.match(stepperSlider, /aria-valuetext=\{displayValue\}/);
  assert.doesNotMatch(stepperSlider, /rounded-\[6px\]/);
  assert.match(quietProStyles, /\.qp-page-header-icon \{[\s\S]*?border-radius: var\(--qp-radius-control\)/);
  assert.match(settingsDataSafety, /<QuietButton[\s\S]*?tone="danger"/);
  assert.doesNotMatch(settingsDataSafety, /QuietDangerAction/);

  for (const consumer of pageHeaderConsumers) {
    assert.match(consumer, /<QuietPageHeader/);
  }
});

console.log(`Passed ${passed} UI smoke tests`);
