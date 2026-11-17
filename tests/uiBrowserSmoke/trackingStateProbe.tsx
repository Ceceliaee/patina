import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { useWindowTracking } from "../../src/app/hooks/useWindowTracking";

export function mountTrackingStateProbe(host: HTMLElement) {
  function Probe() {
    const state = useWindowTracking({ syncDesktopLaunchBehavior: false, trackerHealthPollingEnabled: false });
    return createElement("output", { "data-tracking-probe": true }, JSON.stringify({
      paused: state.appSettings.trackingPaused, exe: state.activeWindow?.exeName ?? null,
      active: state.trackingStatus.isTrackingActive, ready: state.classificationReady,
    }));
  }
  const root = createRoot(host);
  root.render(createElement(Probe));
  return () => root.unmount();
}
