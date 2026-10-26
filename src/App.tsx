import { lazy, Suspense, useEffect } from "react";
import "./App.css";
import AppShell from "./app/AppShellLocaleRoot";
import { installAppIconEvents } from "./platform/runtime/appIconEventGateway.ts";
import { resolveCurrentAppWindowLabel } from "./platform/desktop/windowControlGateway";

const CURRENT_WINDOW_LABEL = resolveCurrentAppWindowLabel();
const MiniShell = lazy(() => import("./app/mini/MiniShell"));

if (import.meta.env.DEV && CURRENT_WINDOW_LABEL === "main") {
  void import("./app/services/resourceDiagnosticsService.ts")
    .then(({ installAppDevelopmentResourceDiagnostics }) => {
      installAppDevelopmentResourceDiagnostics();
    })
    .catch((error: unknown) => {
      console.warn("install development resource diagnostics failed", error);
    });
}

if (typeof document !== "undefined") {
  document.documentElement.dataset.windowLabel = CURRENT_WINDOW_LABEL;
  document.body?.setAttribute("data-window-label", CURRENT_WINDOW_LABEL);
  document.getElementById("root")?.setAttribute("data-window-label", CURRENT_WINDOW_LABEL);
}

export default function App() {
  useEffect(installAppIconEvents, []);
  return <Suspense fallback={null}>
    {CURRENT_WINDOW_LABEL === "mini" ? <MiniShell /> : <AppShell />}
  </Suspense>;
}
