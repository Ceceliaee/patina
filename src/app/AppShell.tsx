import { Suspense, useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { getUiText, setUiTextLanguage } from "../shared/copy/index.ts";
import AppSidebar from "./components/AppSidebar";
import AppTitleBar from "./components/AppTitleBar";
import type { View } from "./types/view";
import Dashboard from "../features/dashboard/components/Dashboard";
import QuietToastStack from "../shared/components/QuietToastStack";
import type {
  AppLanguage,
  AppSettings,
  HourlyActivityChartMode,
  ThemeMode,
} from "../shared/settings/appSettings.ts";
import type { ColorSchemePreview } from "../features/settings/types.ts";
import { useDashboardStats } from "../features/dashboard/hooks/useDashboardStats";
import { useWindowTracking } from "./hooks/useWindowTracking";
import {
  applyMappingOverridesReadModelRefresh,
  applySessionDeletionReadModelRefresh,
  INITIAL_READ_MODEL_REFRESH_STATE,
  resolveReadModelRefreshSignal,
} from "./services/readModelRefreshState.ts";
import {
  loadDashboardRuntimeSnapshot,
  loadDataTrendRuntimeSnapshot,
  loadHistoryRuntimeSnapshot,
} from "./services/readModelRuntimeService";
import {
  scheduleStartupWarmupRefresh,
  startStartupWarmup,
} from "./services/startupWarmupService";
import { LONG_BACKGROUND_DELAY_MS } from "./services/backgroundReturnHomePolicy.ts";
import {
  clearDashboardSnapshotCache,
} from "../features/dashboard/services/dashboardSnapshotCache.ts";
import {
  clearDataBootstrapCache,
  clearDataHeavyCaches,
} from "../features/data/services/dataCacheLifecycle.ts";
import { prewarmDataFirstScreen } from "../features/data/services/dataFirstScreenPrewarm.ts";
import { clearHistorySnapshotCache } from "../features/history/services/historySnapshotCache.ts";
import { clearToolsPageCaches } from "../features/tools/services/toolsCacheLifecycle.ts";
import { AppClassification } from "../shared/classification/appClassification.ts";
import { useQuietDialogs } from "../shared/hooks/useQuietDialogs";
import UpdateDialogProvider from "./providers/UpdateDialogProvider";
import { useAppShellNavigation } from "./hooks/useAppShellNavigation";
import { useAppShellToasts } from "./hooks/useAppShellToasts";
import { useAppShellUpdateEntry } from "./hooks/useAppShellUpdateEntry";
import { useAppThemeMode } from "./hooks/useAppThemeMode.ts";
import { useQuietMotionPreference } from "../shared/motion/useQuietMotionPreference.ts";
import {
  saveHourlyActivityChartModeSetting,
  saveMinSessionSecsSetting,
} from "./services/appSettingsRuntimeService.ts";
import {
  createPreloadableViewComponent,
  getPreloadableViewChunkStatus,
  preloadLazyViewChunk,
  type PreloadableView,
} from "./services/viewChunkPreloadService";
import {
  readCurrentWindowForegroundState,
  watchCurrentWindowForegroundState,
  watchCurrentWindowMaximized,
} from "../platform/desktop/windowControlGateway";
import ToolsSidebarStatusEntry from "../features/tools/components/ToolsSidebarStatusEntry.tsx";
import ToolAlertDialog from "../features/tools/components/ToolAlertDialog.tsx";
import type { ToolsOpenTarget } from "../features/tools/types.ts";
import {
  parseLocalDateKey,
  startOfLocalDay,
} from "../shared/lib/localDate.ts";

const DATA_FOREGROUND_PREWARM_DELAY_MS = 1_200;
const BACKGROUND_CACHE_RELEASE_DELAY_MS = LONG_BACKGROUND_DELAY_MS;

const History = createPreloadableViewComponent("history");
const Data = createPreloadableViewComponent("data");
const Settings = createPreloadableViewComponent("settings");
const About = createPreloadableViewComponent("about");
const AppMapping = createPreloadableViewComponent("mapping");
const Tools = createPreloadableViewComponent("tools");

function getPreloadableNavigationView(view: View): PreloadableView | null {
  switch (view) {
    case "about":
    case "data":
    case "history":
    case "mapping":
    case "settings":
    case "tools":
      return view;
    case "dashboard":
      return null;
  }
}

type HistoryDateRequest = {
  dateKey: string;
  requestId: number;
};

const VIEW_ORDER: View[] = ["dashboard", "history", "data", "mapping", "tools", "settings", "about"];

export default function AppShell() {
  return (
    <UpdateDialogProvider>
      <AppShellContent />
    </UpdateDialogProvider>
  );
}

function AppShellContent() {
  const { confirm, dialogs } = useQuietDialogs();
  const { sidebarUpdateEntry, settingsUpdateEntry } = useAppShellUpdateEntry();
  const {
    currentView,
    handleNavigate,
    registerSettingsSaveHandler,
    registerMappingSaveHandler,
    resetToDashboardAfterLongBackground,
    setSettingsDirty,
    setMappingDirty,
  } = useAppShellNavigation({ confirm });
  const { toasts, pushToast } = useAppShellToasts();
  const [readModelRefreshState, setReadModelRefreshState] = useState(INITIAL_READ_MODEL_REFRESH_STATE);
  const [isWindowMaximized, setIsWindowMaximized] = useState(false);
  const [settingsThemeModePreview, setSettingsThemeModePreview] = useState<ThemeMode | null>(null);
  const [settingsColorSchemePreview, setSettingsColorSchemePreview] = useState<ColorSchemePreview | null>(null);
  const [settingsLanguagePreview, setSettingsLanguagePreview] = useState<AppLanguage | null>(null);
  const [isDocumentVisible, setIsDocumentVisible] = useState(() => (
    typeof document === "undefined" ? true : document.visibilityState !== "hidden"
  ));
  const [isWindowForegroundLike, setIsWindowForegroundLike] = useState(true);
  const [historyDateRequest, setHistoryDateRequest] = useState<HistoryDateRequest | null>(null);
  const [toolsInitialTarget, setToolsInitialTarget] = useState<ToolsOpenTarget | null>(null);
  const [renderedView, setRenderedView] = useState<View>("dashboard");
  const prevViewIndexRef = useRef(0);
  const [viewTransitionStyle, setViewTransitionStyle] = useState<CSSProperties>({
    "--qp-view-transition-offset": "12px",
    "--qp-view-transition-duration": "220ms",
  } as CSSProperties);

  const changeRenderedView = useCallback((nextView: View) => {
    const prevIndex = prevViewIndexRef.current;
    const nextIndex = VIEW_ORDER.indexOf(nextView);

    if (prevIndex !== nextIndex && nextIndex !== -1) {
      const diff = nextIndex - prevIndex;
      const direction = diff > 0 ? 1 : -1;
      const absDiff = Math.abs(diff);
      const offsetVal = 6 + Math.min(3, absDiff) * 4;
      const durationVal = Math.max(170, 230 - absDiff * 15);

      setViewTransitionStyle({
        "--qp-view-transition-offset": `${direction * offsetVal}px`,
        "--qp-view-transition-duration": `${durationVal}ms`,
      } as CSSProperties);

      prevViewIndexRef.current = nextIndex;
    }

    setRenderedView(nextView);
  }, []);

  const backgroundEnteredAtMsRef = useRef<number | null>(null);
  const renderedViewRequestRef = useRef(0);
  const wasForegroundReadyRef = useRef<boolean | null>(null);
  const warmupRuntimeReadyResolveRef = useRef<(() => void) | null>(null);
  const warmupRuntimeReadyPromiseRef = useRef<Promise<void> | null>(null);
  const isForegroundReady = isDocumentVisible && isWindowForegroundLike;
  const {
    activeWindow,
    trackingStatus,
    appSettings,
    classificationReady,
    setAppSettings,
    syncTick,
    trackerHealth,
  } = useWindowTracking({ trackerHealthPollingEnabled: isForegroundReady });
  const [syncedUiTextLanguage, setSyncedUiTextLanguage] = useState<AppLanguage>(appSettings.language);
  const uiTextLanguage = settingsLanguagePreview ?? appSettings.language;
  const uiText = getUiText(uiTextLanguage);
  const dynamicEffects = appSettings.dynamicEffects;
  const quietMotionMode = useQuietMotionPreference(dynamicEffects);
  if (!warmupRuntimeReadyPromiseRef.current) {
    warmupRuntimeReadyPromiseRef.current = new Promise((resolve) => {
      warmupRuntimeReadyResolveRef.current = resolve;
    });
  }

  useEffect(() => {
    if (typeof document === "undefined") return undefined;

    document.documentElement.dataset.qpMotion = quietMotionMode;
    return () => {
      delete document.documentElement.dataset.qpMotion;
    };
  }, [quietMotionMode]);

  useEffect(() => {
    setUiTextLanguage(uiTextLanguage);
    setSyncedUiTextLanguage(uiTextLanguage);
  }, [uiTextLanguage]);

  useEffect(() => {
    const preloadableView = getPreloadableNavigationView(currentView);
    renderedViewRequestRef.current += 1;
    const requestId = renderedViewRequestRef.current;

    if (!preloadableView) {
      changeRenderedView(currentView);
      return undefined;
    }

    if (getPreloadableViewChunkStatus(preloadableView) === "resolved") {
      changeRenderedView(currentView);
      return undefined;
    }

    let cancelled = false;
    void preloadLazyViewChunk(preloadableView)
      .then(() => {
        if (!cancelled && renderedViewRequestRef.current === requestId) {
          changeRenderedView(currentView);
        }
      })
      .catch((error) => {
        console.warn(`Failed to preload ${preloadableView} view before navigation`, error);
        if (!cancelled && renderedViewRequestRef.current === requestId) {
          changeRenderedView(currentView);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [currentView, changeRenderedView]);

  useAppThemeMode(
    settingsThemeModePreview ?? appSettings.themeMode,
    settingsColorSchemePreview?.light ?? appSettings.colorSchemeLight,
    settingsColorSchemePreview?.dark ?? appSettings.colorSchemeDark,
  );
  const refreshSignal = resolveReadModelRefreshSignal(syncTick, readModelRefreshState);
  void syncedUiTextLanguage;
  const { mappingVersion } = readModelRefreshState;
  const isDashboardRefreshEnabled = currentView === "dashboard" && isForegroundReady;
  const isHistoryRefreshEnabled = currentView === "history" && isForegroundReady;
  const isDataRefreshEnabled = currentView === "data" && isForegroundReady;
  const { dashboard, icons } = useDashboardStats(
    appSettings.refreshIntervalSecs,
    refreshSignal,
    trackerHealth,
    loadDashboardRuntimeSnapshot,
    mappingVersion,
    classificationReady,
    isDashboardRefreshEnabled,
  );

  const activeExeName = activeWindow?.exeName ?? null;
  const mappedActiveApp = activeExeName && AppClassification.shouldTrackApp(activeExeName)
    ? AppClassification.mapApp(activeExeName)
    : null;
  const activeApp = trackerHealth.status === "healthy"
    && !appSettings.trackingPaused
    && mappedActiveApp
    && trackingStatus.isTrackingActive
    ? mappedActiveApp
    : null;
  const handleToolsStatusChipOpen = useCallback((target: ToolsOpenTarget) => {
    setHistoryDateRequest(null);
    setToolsInitialTarget(target);
    void handleNavigate("tools");
  }, [handleNavigate]);
  const handleToolsInitialTargetConsumed = useCallback(() => {
    setToolsInitialTarget(null);
  }, []);

  useEffect(() => {
    let active = true;
    let cancelWarmup: (() => void) | null = null;
    const startWarmup = (foregroundLike: boolean) => {
      if (!active) return;

      const controller = startStartupWarmup({
        mode: foregroundLike ? "visible-start" : "hidden-autostart",
        runtimeReady: warmupRuntimeReadyPromiseRef.current ?? Promise.resolve(),
      });
      cancelWarmup = controller.cancel;
      if (!active) {
        controller.cancel();
      }
    };

    void readCurrentWindowForegroundState()
      .then((state) => startWarmup(state.foregroundLike))
      .catch((error) => {
        console.warn("read foreground state for startup warmup failed", error);
        startWarmup(true);
      });

    return () => {
      active = false;
      cancelWarmup?.();
    };
  }, []);

  useEffect(() => {
    if (!classificationReady) return;

    warmupRuntimeReadyResolveRef.current?.();
    warmupRuntimeReadyResolveRef.current = null;
  }, [classificationReady]);

  useEffect(() => {
    if (!classificationReady || syncTick <= 0) return undefined;

    return scheduleStartupWarmupRefresh(undefined, {
      includeDashboard: isDashboardRefreshEnabled,
      includeHistory: isHistoryRefreshEnabled,
      includeData: isDataRefreshEnabled,
    });
  }, [classificationReady, isDashboardRefreshEnabled, isDataRefreshEnabled, isHistoryRefreshEnabled, syncTick]);

  useEffect(() => {
    if (typeof document === "undefined") return undefined;

    const syncDocumentVisibility = () => {
      setIsDocumentVisible(document.visibilityState !== "hidden");
    };

    syncDocumentVisibility();
    document.addEventListener("visibilitychange", syncDocumentVisibility);
    return () => {
      document.removeEventListener("visibilitychange", syncDocumentVisibility);
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;

    void watchCurrentWindowMaximized((maximized) => {
      if (!disposed) {
        setIsWindowMaximized(maximized);
      }
    })
      .then((nextUnlisten) => {
        if (disposed) {
          nextUnlisten();
          return;
        }

        unlisten = nextUnlisten;
      })
      .catch((error) => {
        console.warn("watch current window maximized state failed", error);
      });

    return () => {
      disposed = true;
      if (unlisten) {
        unlisten();
      }
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;

    void watchCurrentWindowForegroundState((state) => {
      if (!disposed) {
        setIsWindowForegroundLike(state.foregroundLike);
      }
    })
      .then((nextUnlisten) => {
        if (disposed) {
          nextUnlisten();
          return;
        }

        unlisten = nextUnlisten;
      })
      .catch((error) => {
        console.warn("watch current window foreground state failed", error);
      });

    return () => {
      disposed = true;
      if (unlisten) {
        unlisten();
      }
    };
  }, []);

  useEffect(() => {
    if (!classificationReady || !isForegroundReady) return undefined;

    const timer = window.setTimeout(() => {
      if (!classificationReady || !isForegroundReady) return;

      void prewarmDataFirstScreen({
        mappingVersion,
        reason: "foreground-opened",
        uiLanguage: uiTextLanguage,
      });
    }, DATA_FOREGROUND_PREWARM_DELAY_MS);

    return () => {
      window.clearTimeout(timer);
    };
  }, [classificationReady, isForegroundReady, mappingVersion, uiTextLanguage]);

  useEffect(() => {
    const wasForegroundReady = wasForegroundReadyRef.current;
    wasForegroundReadyRef.current = isForegroundReady;

    if (wasForegroundReady === null) {
      if (!isForegroundReady) {
        backgroundEnteredAtMsRef.current = Date.now();
      }
      return;
    }

    if (wasForegroundReady && !isForegroundReady) {
      backgroundEnteredAtMsRef.current = Date.now();
      return;
    }

    if (!wasForegroundReady && isForegroundReady) {
      const backgroundEnteredAtMs = backgroundEnteredAtMsRef.current;
      backgroundEnteredAtMsRef.current = null;
      if (backgroundEnteredAtMs === null) return;

      const backgroundDurationMs = Date.now() - backgroundEnteredAtMs;
      if (resetToDashboardAfterLongBackground(backgroundDurationMs)) {
        setHistoryDateRequest(null);
      }
    }
  }, [isForegroundReady, resetToDashboardAfterLongBackground]);

  useEffect(() => {
    if (isForegroundReady || !appSettings.backgroundOptimization) return undefined;

    const timer = window.setTimeout(() => {
      if (document.visibilityState !== "hidden" && isWindowForegroundLike) return;

      try {
        clearHistorySnapshotCache();
        clearDataHeavyCaches();
        clearToolsPageCaches();
      } catch (error) {
        console.warn("clear page heavy caches after background delay failed", error);
      }
    }, BACKGROUND_CACHE_RELEASE_DELAY_MS);

    return () => {
      window.clearTimeout(timer);
    };
  }, [appSettings.backgroundOptimization, isForegroundReady, isWindowForegroundLike]);

  const handleMinSessionSecsChange = useCallback((nextValue: number) => {
    setAppSettings((current) => ({
      ...current,
      minSessionSecs: nextValue,
    }));
    void saveMinSessionSecsSetting(nextValue).catch(console.warn);
  }, [setAppSettings]);

  const handleHourlyActivityChartModeChange = useCallback((nextValue: HourlyActivityChartMode) => {
    setAppSettings((current) => ({
      ...current,
      hourlyActivityChartMode: nextValue,
    }));
    void saveHourlyActivityChartModeSetting(nextValue).catch(console.warn);
  }, [setAppSettings]);

  const openHistoryForDate = useCallback(async (dateKey: string) => {
    const targetDate = parseLocalDateKey(dateKey);
    if (!targetDate || startOfLocalDay(targetDate) > startOfLocalDay(new Date())) {
      return;
    }

    const result = await handleNavigate("history");
    if (!result.navigated) {
      return;
    }

    setHistoryDateRequest((current) => ({
      dateKey,
      requestId: (current?.requestId ?? 0) + 1,
    }));
  }, [handleNavigate]);

  const handleSidebarNavigate = useCallback(async (nextView: View) => {
    setHistoryDateRequest(null);
    if (nextView === "tools") {
      setToolsInitialTarget(null);
    }
    const preloadableView = getPreloadableNavigationView(nextView);
    if (preloadableView) {
      void preloadLazyViewChunk(preloadableView).catch((error) => {
        console.warn(`Failed to preload ${preloadableView} view on navigation intent`, error);
      });
    }
    const result = await handleNavigate(nextView);
    return result.navigated;
  }, [handleNavigate]);

  const handleSidebarPreviewNavigate = useCallback((nextView: View) => {
    const preloadableView = getPreloadableNavigationView(nextView);
    if (!preloadableView) return;

    void preloadLazyViewChunk(preloadableView).catch((error) => {
      console.warn(`Failed to preload ${preloadableView} view on navigation preview`, error);
    });
  }, []);

  return (
    <div
      data-qp-motion={quietMotionMode}
      className={[
        "qp-app-frame",
        isWindowMaximized ? "qp-app-frame-maximized" : "",
      ].filter(Boolean).join(" ")}
    >
      <AppTitleBar isMaximized={isWindowMaximized} />

      <div className="qp-shell flex-1 min-h-0 p-4 md:p-5 lg:p-6 flex gap-4 md:gap-5 lg:gap-6 overflow-hidden">
        <QuietToastStack toasts={toasts} />
        <ToolAlertDialog />
        {dialogs}
        <AppSidebar
          currentView={currentView}
          onNavigate={handleSidebarNavigate}
          onPreviewNavigate={handleSidebarPreviewNavigate}
          footerContent={<ToolsSidebarStatusEntry onOpenSection={handleToolsStatusChipOpen} uiText={uiText} />}
          {...sidebarUpdateEntry}
        />

        <main className="qp-canvas flex-1 min-h-0 flex flex-col gap-4 md:gap-5 p-4 md:p-5 relative overflow-hidden">
          <Suspense
            fallback={
              <div className="flex-1 min-h-0 flex items-center justify-center text-[var(--qp-text-tertiary)] text-sm">
                {uiText.app.loadingView}
              </div>
            }
          >
            <div
              key={renderedView}
              style={viewTransitionStyle}
              className="qp-view-container qp-motion-view-enter flex-1 min-h-0 flex flex-col h-full overflow-hidden"
            >
              {renderedView === "dashboard" && (
                <Dashboard
                  key="dashboard"
                  dashboard={dashboard}
                  icons={icons}
                  isAfk={activeWindow?.isAfk ?? false}
                  isTrackingActive={activeApp !== null}
                  activeAppName={activeApp?.name ?? null}
                  trackingPaused={appSettings.trackingPaused}
                  hourlyActivityChartMode={appSettings.hourlyActivityChartMode}
                  onHourlyActivityChartModeChange={handleHourlyActivityChartModeChange}
                />
              )}
              {renderedView === "history" && (
                <History
                  key="history"
                  icons={icons}
                  refreshKey={refreshSignal}
                  refreshIntervalSecs={appSettings.refreshIntervalSecs}
                  mergeThresholdSecs={appSettings.timelineMergeGapSecs}
                  minSessionSecs={appSettings.minSessionSecs}
                  onMinSessionSecsChange={handleMinSessionSecsChange}
                  trackerHealth={trackerHealth}
                  loadHistorySnapshot={loadHistoryRuntimeSnapshot}
                  mappingVersion={mappingVersion}
                  selectedDateRequest={historyDateRequest}
                  hourlyActivityChartMode={appSettings.hourlyActivityChartMode}
                  onHourlyActivityChartModeChange={handleHourlyActivityChartModeChange}
                  refreshEnabled={isHistoryRefreshEnabled}
                  webActivityEnabled={appSettings.webActivityEnabled}
                />
              )}
              {renderedView === "data" && (
                <Data
                  key="data"
                  icons={icons}
                  refreshKey={refreshSignal}
                  trackerHealth={trackerHealth}
                  loadDataTrendSnapshot={loadDataTrendRuntimeSnapshot}
                  mappingVersion={mappingVersion}
                  onOpenHistoryDate={openHistoryForDate}
                  uiLanguage={uiTextLanguage}
                />
              )}
              {renderedView === "tools" && (
                <Tools
                  key="tools"
                  initialTarget={toolsInitialTarget}
                  onInitialTargetConsumed={handleToolsInitialTargetConsumed}
                  icons={icons}
                  onToast={pushToast}
                  uiText={uiText}
                />
              )}
              {renderedView === "settings" && (
                <Settings
                  key="settings"
                  onSettingsChanged={(nextSettings: AppSettings) => {
                    if (nextSettings.language !== appSettings.language) {
                      void clearDataBootstrapCache();
                    }
                    setAppSettings(nextSettings);
                    setSettingsThemeModePreview(null);
                    setSettingsColorSchemePreview(null);
                    setSettingsLanguagePreview(null);
                  }}
                  onColorSchemeSaved={(nextSettings: AppSettings) => {
                    setAppSettings(nextSettings);
                    setSettingsColorSchemePreview(null);
                  }}
                  onRegisterSaveHandler={registerSettingsSaveHandler}
                  onDirtyChange={setSettingsDirty}
                  onThemeModePreview={setSettingsThemeModePreview}
                  onColorSchemePreview={setSettingsColorSchemePreview}
                  onLanguagePreview={setSettingsLanguagePreview}
                  onToast={pushToast}
                />
              )}
              {renderedView === "about" && (
                <About
                  key="about"
                  {...settingsUpdateEntry}
                  onToast={pushToast}
                />
              )}
              {renderedView === "mapping" && (
                <AppMapping
                  key="mapping"
                  icons={icons}
                  onRegisterSaveHandler={registerMappingSaveHandler}
                  onDirtyChange={setMappingDirty}
                  onOverridesChanged={() => {
                    clearDashboardSnapshotCache();
                    clearHistorySnapshotCache();
                    clearToolsPageCaches();
                    void clearDataBootstrapCache();
                    setReadModelRefreshState(applyMappingOverridesReadModelRefresh);
                    pushToast(uiText.app.mappingUpdated, "success");
                  }}
                  onSessionsDeleted={() => {
                    clearDashboardSnapshotCache();
                    clearHistorySnapshotCache();
                    clearDataHeavyCaches();
                    void clearDataBootstrapCache();
                    setReadModelRefreshState(applySessionDeletionReadModelRefresh);
                    pushToast(uiText.app.historyDeleted, "success");
                  }}
                  webActivityEnabled={appSettings.webActivityEnabled}
                />
              )}
            </div>
          </Suspense>
        </main>
      </div>
    </div>
  );
}
