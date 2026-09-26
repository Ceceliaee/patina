import { useLayoutEffect, type RefObject } from "react";

export function useDataStackedLayout(dataRootRef: RefObject<HTMLDivElement | null>) {
  useLayoutEffect(() => {
    const root = dataRootRef.current!;
    const overview = root.querySelector<HTMLElement>(".data-overview")!;

    // CSS consumes this measurement only in the stacked layout.
    const syncHeight = () => root.style.setProperty(
      "--data-stacked-panel-height", `${overview.offsetHeight}px`,
    );
    const observer = new ResizeObserver(syncHeight);
    observer.observe(overview);
    return () => observer.disconnect();
  }, [dataRootRef]);
}
