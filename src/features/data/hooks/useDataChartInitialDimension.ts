import { useCallback, useState } from "react";

type ChartDimension = { width: number; height: number };
type ChartKey = "overviewTrend" | "appTrend";
const dimensionCache: Partial<Record<ChartKey, ChartDimension>> = {};

function initialDimension(key: ChartKey): ChartDimension {
  const viewport = typeof window === "undefined"
    ? { width: 1366, height: 768 }
    : { width: window.innerWidth, height: window.innerHeight };
  if (key === "overviewTrend") {
    return {
      width: viewport.width >= 1900 ? 852 : Math.min(1280, Math.max(560, viewport.width - 296)),
      height: viewport.width >= 1536 && viewport.height >= 900 ? 214 : viewport.width <= 900 ? 140 : 168,
    };
  }
  return {
    width: viewport.width >= 1900 ? 852 : Math.min(860, Math.max(420, viewport.width - 520)),
    height: viewport.width >= 1900 ? 200 : viewport.width <= 900 ? 172 : 210,
  };
}

export function useDataChartInitialDimension(key: ChartKey) {
  const [dimension, setDimension] = useState(() => dimensionCache[key] ?? initialDimension(key));
  const chartRef = useCallback((element: HTMLDivElement | null) => {
    if (!element) return;
    const syncDimension = () => {
      const rect = element.getBoundingClientRect();
      const width = Math.round(rect.width);
      const height = Math.round(rect.height);
      if (width <= 0 || height <= 0) return;
      const next = { width, height };
      dimensionCache[key] = next;
      setDimension((previous) => previous.width === width && previous.height === height ? previous : next);
    };
    syncDimension();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", syncDimension);
      return () => window.removeEventListener("resize", syncDimension);
    }
    const observer = new ResizeObserver(syncDimension);
    observer.observe(element);
    return () => observer.disconnect();
  }, [key]);
  return { chartRef, initialDimension: dimension };
}
