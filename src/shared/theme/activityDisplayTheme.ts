import { activityDisplayColor } from "../colors/displayColor.ts";
import { parseHex, toHex, type ColorVector } from "../colors/oklab.ts";

type Surface = "panel" | "elevated" | "canvas" | "timeline" | "panelTrack" | "elevatedTrack" | "canvasTrack";

export type DisplayActivityColor = (source: string, surface?: Surface) => string;

const listeners = new Set<() => void>();
let active: DisplayActivityColor = source => source;

function blend(base: string, top: ColorVector, opacity: number) {
  return toHex(parseHex(base).map((v, i) => v + (top[i] - v) * opacity) as ColorVector);
}

export function applyActivityDisplayTheme(mode: "light" | "dark", tokens: Record<string, string>) {
  const panel = tokens["--qp-bg-panel"];
  const elevated = tokens["--qp-bg-elevated"];
  const canvas = tokens["--qp-bg-canvas"];
  const track = tokens["--qp-chart-track"].match(/[\d.]+/g)!.map(Number);
  const trackOver = (base: string) => blend(base, track.slice(0, 3) as ColorVector, track[3]);
  const surfaces: Record<Surface, string> = {
    panel, elevated, canvas,
    timeline: blend(panel, parseHex(elevated), 0.72),
    panelTrack: trackOver(panel),
    elevatedTrack: trackOver(elevated),
    canvasTrack: trackOver(canvas),
  };
  const cache = new Map<string, string>();
  active = (source, surface = "panel") => {
    const key = surface + source;
    const found = cache.get(key);
    if (found !== undefined)
      return found;
    const color = activityDisplayColor(source, surfaces[surface], mode);
    if (cache.size >= 512)
      cache.delete(cache.keys().next().value!);
    cache.set(key, color);
    return color;
  };
  listeners.forEach(listener => listener());
}

export const getActivityDisplayTheme = () => active;

export function subscribeActivityDisplayTheme(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
