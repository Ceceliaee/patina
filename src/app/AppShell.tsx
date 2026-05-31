import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { getUiText, setUiTextLanguage } from "../shared/copy/uiText.ts";
import AppSidebar from "./components/AppSidebar";
import AppTitleBar from "./components/AppTitleBar";
import type { View } from "./types/view";
import Dashboard from "../features/dashboard/components/Dashboard";
import { watchCurrentWindowMaximized } from "../platform/desktop/windowControlGateway";
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
  loadHistoryRuntimeSnapshot,
} from "./services/readModelRuntimeService";
import {
  scheduleStartupWarmupRefresh,
  startStartupWarmup,
} from "./services/startupWarmupService";
import { clearDataReadModelCache } from "../features/data/services/dataReadModel.ts";
import { clearHistorySnapshotCache } from "../features/history/services/historySnapshotCache.ts";
import { AppClassification } from "../shared/classification/appClassification.ts";
import { useQuietDialogs } from "../shared/hooks/useQuietDialogs";
import UpdateDialogProvider from "./providers/UpdateDialogProvider";
import { useAppShellNavigation } from "./hooks/useAppShellNavigation";
import { useAppShellToasts } from "./hooks/useAppShellToasts";
import { useAppShellUpdateEntry } from "./hooks/useAppShellUpdateEntry";
import { useAppThemeMode } from "./hooks/useAppThemeMode.ts";
import {
  saveHourlyActivityChartModeSetting,
  saveMinSessionSecsSetting,
} from "./services/appSettingsRuntimeService.ts";
import {
  createPreloadableViewComponent,
} from "./services/viewChunkPreloadService";

const History = createPreloadableViewComponent("history");
const Data = createPreloadableViewComponent("data");
const Settings = createPreloadableViewComponent("settings");
const About = createPreloadableViewComponent("about");
const AppMapping = createPreloadableViewComponent("mapping");

type HistoryDateRequest = {
  dateKey: string;
  requestId: number;
};

function parseLocalDateKey(dateKey: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);

  if (
    date.getFullYear() !== year
    || date.getMonth() !== month - 1
    || date.getDate() !== day
  ) {
    return null;
  }

  return date;
}

function startOfLocalDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

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
    setSettingsDirty,
    setMappingDirty,
  } = useAppShellNavigation({ confirm });
  const { toasts, pushToast } = useAppShellToasts();
  const [readModelRefreshState, setReadModelRefreshState] = useState(INITIAL_READ_MODEL_REFRESH_STATE);
  const [isWindowMaximized, setIsWindowMaximized] = useState(false);
  const [settingsThemeModePreview, setSettingsThemeModePreview] = useState<ThemeMode | null>(null);
  const [settingsColorSchemePreview, setSettingsColorSchemePreview] = useState<ColorSchemePreview | null>(null);
  const [settingsLanguagePreview, setSettingsLanguagePreview] = useState<AppLanguage | null>(null);
  const [historyDateRequest, setHistoryDateRequest] = useState<HistoryDateRequest | null>(null);
  const warmupRuntimeReadyResolveRef = useRef<(() => void) | null>(null);
  const warmupRuntimeReadyPromiseRef = useRef<Promise<void> | null>(null);
  const {
    activeWindow,
    trackingStatus,
    appSettings,
    classificationReady,
    setAppSettings,
    syncTick,
    trackerHealth,
  } = useWindowTracking();
  const [syncedUiTextLanguage, setSyncedUiTextLanguage] = useState<AppLanguage>(appSettings.language);
  const uiTextLanguage = settingsLanguagePreview ?? appSettings.language;
  const uiText = getUiText(uiTextLanguage);
  if (!warmupRuntimeReadyPromiseRef.current) {
    warmupRuntimeReadyPromiseRef.current = new Promise((resolve) => {
      warmupRuntimeReadyResolveRef.current = resolve;
    });
  }

  useEffect(() => {
    setUiTextLanguage(uiTextLanguage);
    setSyncedUiTextLanguage(uiTextLanguage);
  }, [uiTextLanguage]);

  useAppThemeMode(
    settingsThemeModePreview ?? appSettings.themeMode,
    settingsColorSchemePreview?.light ?? appSettings.colorSchemeLight,
    settingsColorSchemePreview?.dark ?? appSettings.colorSchemeDark,
  );
  const refreshSignal = resolveReadModelRefreshSignal(syncTick, readModelRefreshState);
  void syncedUiTextLanguage;
  const { mappingVersion } = readModelRefreshState;
  const { dashboard, icons } = useDashboardStats(
    appSettings.refreshIntervalSecs,
    refreshSignal,
    trackerHealth,
    loadDashboardRuntimeSnapshot,
    mappingVersion,
    classificationReady,
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

  useEffect(() => {
    const controller = startStartupWarmup({
      runtimeReady: warmupRuntimeReadyPromiseRef.current ?? Promise.resolve(),
    });
    return controller.cancel;
  }, []);

  useEffect(() => {
    if (!classificationReady) return;

    warmupRuntimeReadyResolveRef.current?.();
    warmupRuntimeReadyResolveRef.current = null;
  }, [classificationReady]);

  useEffect(() => {
    if (!classificationReady || syncTick <= 0) return undefined;

    return scheduleStartupWarmupRefresh();
  }, [classificationReady, syncTick]);

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

  const handleSidebarNavigate = useCallback((nextView: View) => {
    setHistoryDateRequest(null);
    void handleNavigate(nextView);
  }, [handleNavigate]);

  return (
    <div className={isWindowMaximized ? "qp-app-frame qp-app-frame-maximized" : "qp-app-frame"}>
      <AppTitleBar isMaximized={isWindowMaximized} />

      <div className="qp-shell flex-1 min-h-0 p-4 md:p-5 lg:p-6 flex gap-4 md:gap-5 lg:gap-6 overflow-hidden">
        <QuietToastStack toasts={toasts} />
        {dialogs}
        <AppSidebar
          currentView={currentView}
          onNavigate={handleSidebarNavigate}
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
              {currentView === "dashboard" && (
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
              {currentView === "history" && (
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
                />
              )}
              {currentView === "data" && (
                <Data
                  key="data"
                  icons={icons}
                  refreshKey={refreshSignal}
                  trackerHealth={trackerHealth}
                  loadHistorySnapshot={loadHistoryRuntimeSnapshot}
                  mappingVersion={mappingVersion}
                  onOpenHistoryDate={openHistoryForDate}
                />
              )}
              {currentView === "settings" && (
                <Settings
                  key="settings"
                  onSettingsChanged={(nextSettings: AppSettings) => {
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
              {currentView === "about" && (
                <About
                  key="about"
                  {...settingsUpdateEntry}
                  onToast={pushToast}
                />
              )}
              {currentView === "mapping" && (
                <AppMapping
                  key="mapping"
                  icons={icons}
                  onRegisterSaveHandler={registerMappingSaveHandler}
                  onDirtyChange={setMappingDirty}
                  onOverridesChanged={() => {
                    setReadModelRefreshState(applyMappingOverridesReadModelRefresh);
                    pushToast(uiText.app.mappingUpdated, "success");
                  }}
                  onSessionsDeleted={() => {
                    clearHistorySnapshotCache();
                    clearDataReadModelCache();
                    setReadModelRefreshState(applySessionDeletionReadModelRefresh);
                    pushToast(uiText.app.historyDeleted, "success");
                  }}
                />
              )}
          </Suspense>
        </main>
      </div>
    </div>
  );
}
