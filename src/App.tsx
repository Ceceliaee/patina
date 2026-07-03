import { useEffect } from "react";
import "./App.css";
import AppShell from "./app/AppShell";
import WidgetShell from "./app/widget/WidgetShell";
import {
  hideWidgetWindow,
  isCurrentWindowVisibleAndFocused,
  resolveCurrentAppWindowLabel,
} from "./platform/desktop/widgetRuntimeGateway";
import { installAppDevelopmentResourceDiagnostics } from "./app/services/resourceDiagnosticsService.ts";

const CURRENT_WINDOW_LABEL = resolveCurrentAppWindowLabel();

installAppDevelopmentResourceDiagnostics();

if (typeof document !== "undefined") {
  document.documentElement.dataset.windowLabel = CURRENT_WINDOW_LABEL;
  document.body?.setAttribute("data-window-label", CURRENT_WINDOW_LABEL);
  document.getElementById("root")?.setAttribute("data-window-label", CURRENT_WINDOW_LABEL);
}

export default function App() {
  useEffect(() => {
    if (CURRENT_WINDOW_LABEL !== "main") {
      return;
    }

    let active = true;

    const requestHideWidget = () => {
      void hideWidgetWindow().catch((error) => {
        if (active) {
          console.warn("hide widget window failed", error);
        }
      });
    };

    const syncWidgetVisibility = () => {
      void isCurrentWindowVisibleAndFocused()
        .then((focused) => {
          if (active && focused) {
            requestHideWidget();
          }
        })
        .catch((error) => {
          if (active) {
            console.warn("sync widget visibility failed", error);
          }
        });
    };

    const handleFocus = () => {
      syncWidgetVisibility();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        syncWidgetVisibility();
      }
    };

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    syncWidgetVisibility();

    return () => {
      active = false;
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  return CURRENT_WINDOW_LABEL === "widget" ? <WidgetShell /> : <AppShell />;
}
