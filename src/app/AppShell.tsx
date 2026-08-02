import { type ComponentProps, useCallback, useEffect, useState } from "react";
import { getUiText, setUiTextLanguage } from "../shared/copy/index.ts";
import AppSidebar from "./components/AppSidebar";
import AppTitleBar from "./components/AppTitleBar";
import AppViewOutlet from "./components/AppViewOutlet.tsx";
import type { View } from "./types/view";
import Dashboard from "../features/dashboard/components/Dashboard.tsx";
import type AboutView from "../features/about/components/About.tsx";
import type AppMappingView from "../features/classification/components/AppMapping.tsx";
import type DataView from "../features/data/components/Data.tsx";
import type HistoryView from "../features/history/components/History.tsx";
import type SettingsView from "../features/settings/components/Settings.tsx";
import type ToolsView from "../features/tools/components/Tools.tsx";
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
  getHistoryRuntimeSeedSnapshot,
  loadDataTrendRuntimeSnapshot,
  loadHistoryRuntimeSnapshot,
} from "./services/readModelRuntimeService";
import { clearDashboardSnapshotCache } from "../features/dashboard/services/dashboardSnapshotCache.ts";
import {
  clearDataBootstrapCache,
  clearDataHeavyCaches,
} from "../features/data/services/dataCacheLifecycle.ts";
import { clearHistoryCachesAfterDataChange } from "../features/history/services/historyCacheLifecycle.ts";
import { clearToolsPageCaches } from "../features/tools/services/toolsCacheLifecycle.ts";
import { useQuietDialogs } from "../shared/hooks/useQuietDialogs";
import UpdateDialogProvider from "./providers/UpdateDialogProvider";
import { useAppShellNavigation } from "./hooks/useAppShellNavigation";
import { useAppShellToasts } from "./hooks/useAppShellToasts";
import { useAppShellUpdateEntry } from "./hooks/useAppShellUpdateEntry";
import { useMainWindowReady } from "./hooks/useMainWindowReady.ts";
import { useQuietMotionPreference } from "../shared/motion/useQuietMotionPreference.ts";
import { useImportClassificationCoordinator } from "./hooks/useImportClassificationCoordinator.ts";
import {
  saveHourlyActivityChartModeSetting,
  saveMinSessionSecsSetting,
} from "./services/appSettingsRuntimeService.ts";
import {
  preloadNavigationView,
  useAppShellRenderedView,
} from "./hooks/useAppShellRenderedView.ts";
import { createPreloadableViewComponent } from "./services/viewChunkPreloadService.ts";
import { useAppWindowState } from "./hooks/useAppWindowState.ts";
import { useAppShellRuntimeLifecycle } from "./hooks/useAppShellRuntimeLifecycle.ts";
import ToolsSidebarStatusEntry from "../features/tools/components/ToolsSidebarStatusEntry.tsx";
import ToolAlertDialog from "../features/tools/components/ToolAlertDialog.tsx";
import type { ToolsOpenTarget } from "../features/tools/types.ts";
import {
  parseLocalDateKey,
  startOfLocalDay,
} from "../shared/lib/localDate.ts";

type HistoryDateRequest = { dateKey: string; requestId: number };

const History = createPreloadableViewComponent<ComponentProps<typeof HistoryView>>("history");
const Data = createPreloadableViewComponent<ComponentProps<typeof DataView>>("data");
const Settings = createPreloadableViewComponent<ComponentProps<typeof SettingsView>>("settings");
const About = createPreloadableViewComponent<ComponentProps<typeof AboutView>>("about");
const AppMapping =
  createPreloadableViewComponent<ComponentProps<typeof AppMappingView>>("mapping");
const Tools = createPreloadableViewComponent<ComponentProps<typeof ToolsView>>("tools");

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
    prepareNavigate,
    handleNavigate,
    registerSettingsSaveHandler,
    registerMappingSaveHandler,
    setSettingsDirty,
    setMappingDirty,
  } = useAppShellNavigation({ confirm });
  const { toasts, pushToast } = useAppShellToasts();
  const [readModelRefreshState, setReadModelRefreshState] = useState(
    INITIAL_READ_MODEL_REFRESH_STATE,
  );
  const {
    prepareImportCategories,
    onImportedDataChanged: handleImportedDataChanged,
  } = useImportClassificationCoordinator(setReadModelRefreshState);
  const [settingsThemeModePreview, setSettingsThemeModePreview] = useState<ThemeMode | null>(null);
  const [settingsColorSchemePreview, setSettingsColorSchemePreview] =
    useState<ColorSchemePreview | null>(null);
  const [settingsLanguagePreview, setSettingsLanguagePreview] =
    useState<AppLanguage | null>(null);
  const [historyDateRequest, setHistoryDateRequest] = useState<HistoryDateRequest | null>(null);
  const [toolsInitialTarget, setToolsInitialTarget] = useState<ToolsOpenTarget | null>(null);
  const viewPresentation = useAppShellRenderedView(currentView);
  const { presentedView } = viewPresentation;
  const {
    isForegroundReady,
    isWindowForegroundLike,
    isWindowMaximized,
  } = useAppWindowState();
  const {
    appSettings,
    appearanceResolved,
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

  useEffect(() => {
    setUiTextLanguage(uiTextLanguage);
    setSyncedUiTextLanguage(uiTextLanguage);
  }, [uiTextLanguage]);

  const appFrameRef = useMainWindowReady({
    appSettings,
    contentReady: appearanceResolved && presentedView === currentView,
    themeModePreview: settingsThemeModePreview,
    colorSchemePreview: settingsColorSchemePreview,
  });
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
  useAppShellRuntimeLifecycle({
    backgroundOptimization: appSettings.backgroundOptimization,
    classificationReady,
    isDataRefreshEnabled,
    isDashboardRefreshEnabled,
    isForegroundReady,
    isHistoryRefreshEnabled,
    isWindowForegroundLike,
    mappingVersion,
    quietMotionMode,
    syncTick,
    uiTextLanguage,
  });

  const handleToolsStatusChipOpen = useCallback((target: ToolsOpenTarget) => {
    setHistoryDateRequest(null);
    setToolsInitialTarget(target);
    void handleNavigate("tools");
  }, [handleNavigate]);
  const handleToolsInitialTargetConsumed = useCallback(() => {
    setToolsInitialTarget(null);
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
    if (!result.navigated) return;

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
    preloadNavigationView(nextView, "intent");
    const result = await handleNavigate(nextView);
    return result.navigated;
  }, [handleNavigate]);

  const handleSidebarPreviewNavigate = useCallback((nextView: View) => {
    preloadNavigationView(nextView, "preview");
  }, []);

  return (
    <div
      ref={appFrameRef}
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
          currentView={viewPresentation.presentedView}
          onPrepareNavigate={prepareNavigate}
          onNavigate={handleSidebarNavigate}
          onPreviewNavigate={handleSidebarPreviewNavigate}
          footerContent={<ToolsSidebarStatusEntry onOpenSection={handleToolsStatusChipOpen} uiText={uiText} />}
          {...sidebarUpdateEntry}
        />

        <AppViewOutlet
          {...viewPresentation.outletProps}
          uiText={uiText}
          views={{
            dashboard: (
              <Dashboard
                key="dashboard"
                dashboard={dashboard}
                icons={icons}
                hourlyActivityChartMode={appSettings.hourlyActivityChartMode}
                onHourlyActivityChartModeChange={handleHourlyActivityChartModeChange}
                refreshKey={refreshSignal}
                mappingVersion={mappingVersion}
                mergeThresholdSecs={appSettings.timelineMergeGapSecs}
              />
            ),
            history: (
              <History
                key="history"
                icons={icons}
                refreshKey={refreshSignal}
                refreshIntervalSecs={appSettings.refreshIntervalSecs}
                mergeThresholdSecs={appSettings.timelineMergeGapSecs}
                minSessionSecs={appSettings.minSessionSecs}
                onMinSessionSecsChange={handleMinSessionSecsChange}
                trackerHealth={trackerHealth}
                getHistorySeedSnapshot={getHistoryRuntimeSeedSnapshot}
                loadHistorySnapshot={loadHistoryRuntimeSnapshot}
                mappingVersion={mappingVersion}
                selectedDateRequest={historyDateRequest}
                hourlyActivityChartMode={appSettings.hourlyActivityChartMode}
                onHourlyActivityChartModeChange={handleHourlyActivityChartModeChange}
                refreshEnabled={isHistoryRefreshEnabled}
                webActivityEnabled={appSettings.webActivityEnabled}
                titleRecordingEnabled={appSettings.titleRecordingEnabled}
              />
            ),
            data: (
              <Data
                icons={icons}
                refreshKey={refreshSignal}
                trackerHealth={trackerHealth}
                loadDataTrendSnapshot={loadDataTrendRuntimeSnapshot}
                mappingVersion={mappingVersion}
                mergeThresholdSecs={appSettings.timelineMergeGapSecs}
                onOpenHistoryDate={(dateKey) => {
                  void openHistoryForDate(dateKey);
                }}
                onToast={pushToast}
                uiLanguage={uiTextLanguage}
                webActivityEnabled={appSettings.webActivityEnabled}
              />
            ),
            tools: (
              <Tools
                key="tools"
                initialTarget={toolsInitialTarget}
                onInitialTargetConsumed={handleToolsInitialTargetConsumed}
                icons={icons}
                onToast={pushToast}
                uiText={uiText}
              />
            ),
            settings: (
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
                onPrepareImportCategories={prepareImportCategories}
                onImportedDataChanged={handleImportedDataChanged}
              />
            ),
            about: (
              <About
                key="about"
                {...settingsUpdateEntry}
                onToast={pushToast}
              />
            ),
            mapping: (
              <AppMapping
                key="mapping"
                icons={icons}
                onRegisterSaveHandler={registerMappingSaveHandler}
                onDirtyChange={setMappingDirty}
                onOverridesChanged={() => {
                  clearDashboardSnapshotCache();
                  void clearHistoryCachesAfterDataChange();
                  clearToolsPageCaches();
                  clearDataHeavyCaches();
                  void clearDataBootstrapCache();
                  setReadModelRefreshState(applyMappingOverridesReadModelRefresh);
                  pushToast(uiText.app.mappingUpdated, "success");
                }}
                onSessionsDeleted={() => {
                  clearDashboardSnapshotCache();
                  void clearHistoryCachesAfterDataChange();
                  clearDataHeavyCaches();
                  void clearDataBootstrapCache();
                  setReadModelRefreshState(applySessionDeletionReadModelRefresh);
                  pushToast(uiText.app.historyDeleted, "success");
                }}
                webActivityEnabled={appSettings.webActivityEnabled}
              />
            ),
          }}
        />
      </div>
    </div>
  );
}
