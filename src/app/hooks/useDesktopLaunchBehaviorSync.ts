import { useEffect } from "react";
import type { AppSettings } from "../../shared/settings/appSettings";
import {
  setBackgroundOptimization,
  setDesktopBehavior,
  setLaunchBehavior,
} from "../../platform/desktop/desktopBehaviorRuntimeGateway";

export function useDesktopLaunchBehaviorSync(appSettings: AppSettings, enabled: boolean = true) {
  useEffect(() => {
    if (!enabled) return;
    void setDesktopBehavior().catch(console.warn);
  }, [appSettings.closeBehavior, appSettings.minimizeBehavior, appSettings.showTrayIcon, enabled]);

  useEffect(() => {
    if (!enabled) return;
    void setLaunchBehavior(
      appSettings.launchAtLogin,
      appSettings.startMinimized,
    ).catch(console.warn);
  }, [appSettings.launchAtLogin, appSettings.startMinimized, enabled]);

  useEffect(() => {
    if (!enabled) return;
    void setBackgroundOptimization(appSettings.backgroundOptimization).catch(console.warn);
  }, [appSettings.backgroundOptimization, enabled]);
}
