import { useMemo } from "react";

interface ChartColors {
  total: string;
  app: string;
  web: string;
}

function parseRGBA(rgbString: string): { r: number; g: number; b: number } | null {
  const trimmed = rgbString.trim();
  const match = trimmed.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (!match) return null;
  return {
    r: Math.min(255, Math.max(0, parseInt(match[1], 10))),
    g: Math.min(255, Math.max(0, parseInt(match[2], 10))),
    b: Math.min(255, Math.max(0, parseInt(match[3], 10))),
  };
}

function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l: Math.round(l * 100) };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
  else if (max === gn) h = ((bn - rn) / d + 2) / 6;
  else h = ((rn - gn) / d + 4) / 6;
  return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
}

function useDistinctChartColors(): ChartColors {
  return useMemo(() => {
    let baseH = 215;
    let baseS = 45;
    let baseL = 40;

    try {
      const el = document.createElement("div");
      el.style.color = "var(--qp-accent-default)";
      document.body.appendChild(el);
      const computed = getComputedStyle(el).color;
      document.body.removeChild(el);
      const rgb = parseRGBA(computed);
      if (rgb) {
        const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);
        baseH = hsl.h;
        baseS = hsl.s;
        baseL = hsl.l;
      }
    } catch {
    }

    const isDark = baseL > 55;
    const hueJitter = Math.floor(Math.random() * 13) - 6;

    const appH = ((baseH + 120) % 360) + hueJitter;
    const webH = ((baseH + 240) % 360) - hueJitter;

    const sat = Math.max(32, Math.min(58, baseS));
    const l1 = Math.max(36, Math.min(55, isDark ? baseL - 6 : baseL + 2));
    const l2 = Math.max(36, Math.min(55, isDark ? baseL - 2 : baseL + 6));

    return {
      total: "var(--qp-accent-default)",
      app: `hsl(${(appH + 360) % 360}, ${sat}%, ${l1}%)`,
      web: `hsl(${(webH + 360) % 360}, ${sat + 4}%, ${l2}%)`,
    };
  }, []);
}

export { useDistinctChartColors, type ChartColors };
