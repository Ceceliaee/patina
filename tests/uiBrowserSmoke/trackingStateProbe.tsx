import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { useWindowTracking } from "../../src/app/hooks/useWindowTracking";
import { useClassificationAppCatalog } from "../../src/features/classification/hooks/useClassificationAppCatalog";

export function mountCatalogStateProbe(host: HTMLElement) {
  function Probe() {
    const state = useClassificationAppCatalog({ enabled: true });
    return createElement("output", { "data-catalog-probe": true }, JSON.stringify({
      loading: state.loading, apps: state.candidates.map(candidate => candidate.exeName),
    }));
  }
  const root = createRoot(host);
  root.render(createElement(Probe));
  return () => root.unmount();
}

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
