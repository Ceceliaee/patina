import { useEffect, useLayoutEffect, type RefObject } from "react";

const STACKED_LAYOUT_QUERY = "(min-width: 901px) and (max-width: 1899px)";
const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

export function useDataStackedLayout(dataRootRef: RefObject<HTMLDivElement | null>) {
  useIsomorphicLayoutEffect(() => {
    const root = dataRootRef.current;
    const overviewPanel = root?.querySelector<HTMLElement>(".data-overview");
    const destinationPanel = root?.querySelector<HTMLElement>(".data-app-panel");
    const scrollOwner = root?.querySelector<HTMLElement>(".data-page-scroll");
    if (!root || !overviewPanel || !destinationPanel || !scrollOwner) {
      return undefined;
    }

    let frameId: number | null = null;
    const syncStackedPanelHeight = () => {
      frameId = null;
      if (!window.matchMedia(STACKED_LAYOUT_QUERY).matches) {
        root.style.removeProperty("--data-stacked-panel-height");
        root.style.removeProperty("--data-stacked-scroll-end-space");
        return;
      }

      const overviewHeight = overviewPanel.getBoundingClientRect().height;
      if (overviewHeight > 0) {
        root.style.setProperty(
          "--data-stacked-panel-height",
          `${Math.round(overviewHeight)}px`,
        );
      }
      const destinationHeight = destinationPanel.getBoundingClientRect().height;
      const scrollEndSpace = Math.max(
        0,
        Math.round(scrollOwner.clientHeight - destinationHeight),
      );
      root.style.setProperty(
        "--data-stacked-scroll-end-space",
        `${scrollEndSpace}px`,
      );
    };
    const scheduleSync = () => {
      if (frameId === null) {
        frameId = requestAnimationFrame(syncStackedPanelHeight);
      }
    };

    syncStackedPanelHeight();
    window.addEventListener("resize", scheduleSync);
    const observer = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(scheduleSync);
    observer?.observe(overviewPanel);
    observer?.observe(destinationPanel);
    observer?.observe(scrollOwner);

    return () => {
      if (frameId !== null) {
        cancelAnimationFrame(frameId);
      }
      observer?.disconnect();
      window.removeEventListener("resize", scheduleSync);
      root.style.removeProperty("--data-stacked-panel-height");
      root.style.removeProperty("--data-stacked-scroll-end-space");
    };
  }, [dataRootRef]);
}
