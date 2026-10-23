import { createElement, StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { useWindowTracking } from "../../src/app/hooks/useWindowTracking";
import { useWidgetTracking } from "../../src/app/widget/useWidgetTracking";
import { installAppIconEvents } from "../../src/platform/runtime/appIconEventGateway";

export function mountSubscriptionProbe(host: HTMLElement, kind: "main" | "widget" | "icons") {
  function Main() {
    useWindowTracking({ syncDesktopLaunchBehavior: false, trackerHealthPollingEnabled: false });
    return null;
  }
  function Widget() {
    useWidgetTracking();
    return null;
  }
  function Icons() {
    useEffect(installAppIconEvents, []);
    return null;
  }
  const root = createRoot(host);
  root.render(createElement(StrictMode, null, createElement({ main: Main, widget: Widget, icons: Icons }[kind])));
  return () => root.unmount();
}
