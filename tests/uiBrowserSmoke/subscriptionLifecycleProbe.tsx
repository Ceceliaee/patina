import { createElement, StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { useWindowTracking } from "../../src/app/hooks/useWindowTracking";
import { useMiniTracking } from "../../src/app/mini/useMiniTracking";
import { installAppIconEvents } from "../../src/platform/runtime/appIconEventGateway";

export function mountSubscriptionProbe(host: HTMLElement, kind: "main" | "mini" | "icons") {
  function Main() {
    useWindowTracking({ syncDesktopLaunchBehavior: false, trackerHealthPollingEnabled: false });
    return null;
  }
  function Mini() {
    useMiniTracking();
    return null;
  }
  function Icons() {
    useEffect(installAppIconEvents, []);
    return null;
  }
  const root = createRoot(host);
  root.render(createElement(StrictMode, null, createElement({ main: Main, mini: Mini, icons: Icons }[kind])));
  return () => root.unmount();
}
