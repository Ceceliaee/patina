import { getAppIconRuntimeCacheSnapshot } from "../platform/persistence/appIconRuntimeCache.ts";
import { useMainToolsNavigation } from "./hooks/useMainToolsNavigation.ts";
import { type ComponentProps, useCallback, useState } from "react";
import { useLocaleText } from "../shared/i18n/index.ts";
import AppSidebar from "./components/AppSidebar";
import AppTitleBar from "./components/AppTitleBar";
import AppViewOutlet from "./components/AppViewOutlet.tsx";
import type { View } from "./types/view";
import type ToolsView from "../features/tools/components/Tools.tsx";
import QuietToastStack from "../shared/components/QuietToastStack";
import { useWindowTracking } from "./hooks/useWindowTracking";
import { useQuietDialogs } from "../shared/hooks/useQuietDialogs";
import { useAppShellNavigation } from "./hooks/useAppShellNavigation";
import { useAppShellToasts } from "./hooks/useAppShellToasts";
import { useMainWindowReady } from "./hooks/useMainWindowReady.ts";
import { useQuietMotionPreference } from "../shared/motion/useQuietMotionPreference.ts";
import {
  preloadNavigationView,
  useAppShellRenderedView,
} from "./hooks/useAppShellRenderedView.ts";
import { createPreloadableViewComponent } from "./services/viewChunkPreloadService.ts";
import { useAppWindowState } from "./hooks/useAppWindowState.ts";
import { useAppShellRuntimeLifecycle } from "./hooks/useAppShellRuntimeLifecycle.ts";
import ToolsStatusEntry from "../features/tools/components/ToolsStatusEntry.tsx";
import ToolAlertDialog from "../features/tools/components/ToolAlertDialog.tsx";
import type { ToolsOpenTarget } from "../features/tools/types.ts";
import { useAppSidebarState } from "./hooks/useAppSidebarState.ts";


const Tools = createPreloadableViewComponent<ComponentProps<typeof ToolsView>>("tools");

type WindowTrackingState = ReturnType<typeof useWindowTracking>;
type AppWindowState = ReturnType<typeof useAppWindowState>;

export default function AppShellContent({
  appWindowState,
  windowTracking,
}: {
  appWindowState: AppWindowState;
  windowTracking: WindowTrackingState;
}) {
  const { dialogs } = useQuietDialogs();
  const {
    currentView,
    prepareNavigate,
    handleNavigate,
  } = useAppShellNavigation();
  const { toasts, pushToast } = useAppShellToasts();
  const [toolsInitialTarget, setToolsInitialTarget] = useState<ToolsOpenTarget | null>(null);
  const viewPresentation = useAppShellRenderedView(currentView, appWindowState.isForegroundReady);
  const { presentedView } = viewPresentation;
  const {
    isForegroundReady,
    isWindowForegroundLike,
    isWindowMaximized,
  } = appWindowState;
  const {
    appSettings,
    appearanceResolved,
    classificationReady,
  } = windowTracking;
  const uiText = useLocaleText();
  const quietMotionMode = useQuietMotionPreference();

  const appFrameRef = useMainWindowReady({
    appSettings,
    contentReady: appearanceResolved && presentedView === currentView,
  });
  const icons = getAppIconRuntimeCacheSnapshot();
  useAppShellRuntimeLifecycle({
    classificationReady,
    isForegroundReady,
    isWindowForegroundLike,
    quietMotionMode,
  });

  const handleToolsStatusChipOpen = useCallback(async (target: ToolsOpenTarget) => {
    if (!(await handleNavigate("tools")).navigated) return;
    setToolsInitialTarget(target);
  }, [handleNavigate]);
  useMainToolsNavigation(handleToolsStatusChipOpen);

  const handleToolsInitialTargetConsumed = useCallback(() => {
    setToolsInitialTarget(null);
  }, []);



  const handleSidebarNavigate = useCallback(async (nextView: View) => {
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
  const { navigationMode, sidebarProps } = useAppSidebarState({
    currentView: presentedView ?? currentView,
    onPrepareNavigate: prepareNavigate,
    onNavigate: handleSidebarNavigate,
    onPreviewNavigate: handleSidebarPreviewNavigate,
  });

  return (
    <div
      ref={appFrameRef}
      data-qp-motion={quietMotionMode}
      className={[
        "qp-app-frame",
        isWindowMaximized ? "qp-app-frame-maximized" : "",
      ].filter(Boolean).join(" ")}
    >
      <AppTitleBar
        isMaximized={isWindowMaximized}
        toolsStatusEntry={<ToolsStatusEntry onOpenSection={target => { void handleToolsStatusChipOpen(target); }} />}
      />

      <div className="qp-shell flex-1 min-h-0 p-4 md:p-5 lg:p-6 flex gap-4 md:gap-5 lg:gap-6 overflow-hidden">
        <QuietToastStack toasts={toasts} />
        <ToolAlertDialog />
        {dialogs}
        <AppSidebar {...sidebarProps} />

        <AppViewOutlet
          {...viewPresentation.outletProps}
          uiText={uiText}
          views={{
            tools: (
              <Tools
                key="tools"
                initialTarget={toolsInitialTarget}
                onInitialTargetConsumed={handleToolsInitialTargetConsumed}
                icons={icons}
                showNavigationLabels={navigationMode === "labeled"}
                onToast={pushToast}
              />
            ),
          }}
        />
      </div>
    </div>
  );
}
