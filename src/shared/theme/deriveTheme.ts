import type { ColorScheme } from "../settings/appSettings.ts";
import { effectiveThemeContrast, getThemePreset, type ThemeVariant } from "./themePresets.ts";

type RGB = [number, number, number];
const WHITE: RGB = [255, 255, 255];
const BLACK: RGB = [0, 0, 0];
const clamp = (value: number) => Math.min(1, Math.max(0, value));
const parse = (hex: string): RGB => [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16)) as RGB;
const mix = (from: RGB, to: RGB, amount: number): RGB => from.map((channel, index) => Math.round(channel + (to[index] - channel) * clamp(amount))) as RGB;
const hex = (rgb: RGB) => `#${rgb.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
const solid = (rgb: RGB) => `rgb(${rgb.join(", ")})`;

// Contrast shaping is intentionally unclamped; clamp only channel blends and alpha.
function shapeContrast(value: number, dark: boolean): number {
  const baseline = dark ? 60 : 45;
  const shaped = value / 100 + (value - baseline) / 60 * 0.7;
  return value <= baseline ? shaped : baseline / 100 + (shaped - baseline / 100) * 2;
}

const DEFAULT_CONTROLS: Record<ThemeVariant, Record<string, string>> = {
  "light": {
    "--qp-bg-app": "#f4f4f4",
    "--qp-bg-canvas": "#fbfbfb",
    "--qp-bg-panel": "#ffffff",
    "--qp-bg-elevated": "#f5f5f5",
    "--qp-text-primary": "#171717",
    "--qp-text-secondary": "#434343",
    "--qp-text-tertiary": "#707070",
    "--qp-accent-default": "#315f9f",
    "--qp-accent-muted": "#e8eef6",
    "--qp-success": "#2f7d49",
    "--qp-participation": "#3f74c2",
    "--qp-warning": "#9a6700",
    "--qp-danger": "#b53a3a",
    "--qp-control-off": "#d2d2d2",
    "--qp-track-muted": "#e6e6e6",
    "--qp-badge-subtle": "#f1f1f1",
    "--qp-text-disabled": "#adadad",
    "--qp-scrollbar-default": "#cccccc",
    "--qp-scrollbar-hover": "#b8b8b8",
    "--qp-control-thumb": "#ffffff",
    "--qp-chart-cursor": "rgba(101, 114, 135, 0.12)",
    "--qp-chart-grid": "rgba(156, 168, 186, 0.25)"
  },
  "dark": {
    "--qp-bg-app": "#212121",
    "--qp-bg-canvas": "#262626",
    "--qp-bg-panel": "#2d2d2d",
    "--qp-bg-elevated": "#282828",
    "--qp-text-primary": "#d1d5dc",
    "--qp-text-secondary": "#adb3bd",
    "--qp-text-tertiary": "#7f8791",
    "--qp-accent-default": "#8ba1c0",
    "--qp-accent-muted": "#333b46",
    "--qp-success": "#82ad8b",
    "--qp-participation": "#93a9c8",
    "--qp-warning": "#c19b5c",
    "--qp-danger": "#c98383",
    "--qp-control-off": "#555555",
    "--qp-track-muted": "#484848",
    "--qp-badge-subtle": "#3a3a3a",
    "--qp-text-disabled": "#6f7680",
    "--qp-scrollbar-default": "#545454",
    "--qp-scrollbar-hover": "#686868",
    "--qp-control-thumb": "#bdc6d1",
    "--qp-chart-cursor": "rgba(127, 135, 145, 0.12)",
    "--qp-chart-grid": "rgba(127, 135, 145, 0.1)"
  }
};

function controlColors(variant: ThemeVariant, scheme: ColorScheme): Record<string, string> {
  if (scheme === "default") return DEFAULT_CONTROLS[variant];
  const p = getThemePreset(variant, scheme);
  return variant === "dark" ? {
    "--qp-text-primary": `${p.ink}`,
    "--qp-text-secondary": `color-mix(in srgb, ${p.ink} 78%, ${p.surface})`,
    "--qp-text-tertiary": `color-mix(in srgb, ${p.ink} 56%, ${p.surface})`,
    "--qp-accent-default": `${p.accent}`,
    "--qp-accent-muted": `color-mix(in srgb, ${p.accent} 20%, ${p.surface})`,
    "--qp-success": `${p.semanticColors.diffAdded}`,
    "--qp-participation": `${p.semanticColors.skill}`,
    "--qp-warning": `color-mix(in srgb, ${p.accent} 52%, #d29922)`,
    "--qp-danger": `${p.semanticColors.diffRemoved}`,
    "--qp-control-off": `color-mix(in srgb, ${p.surface} 62%, ${p.ink})`,
    "--qp-track-muted": `color-mix(in srgb, ${p.surface} 72%, ${p.ink})`,
    "--qp-badge-subtle": `color-mix(in srgb, ${p.surface} 86%, ${p.ink})`,
    "--qp-text-disabled": `color-mix(in srgb, ${p.ink} 34%, ${p.surface})`,
    "--qp-scrollbar-default": `color-mix(in srgb, ${p.surface} 60%, ${p.ink})`,
    "--qp-scrollbar-hover": `color-mix(in srgb, ${p.surface} 46%, ${p.ink})`,
    "--qp-control-thumb": `${p.ink}`,
    "--qp-chart-cursor": `color-mix(in srgb, ${p.accent} 14%, transparent)`,
    "--qp-chart-grid": `color-mix(in srgb, ${p.ink} 12%, transparent)`,
  } : {
    "--qp-text-primary": `${p.ink}`,
    "--qp-text-secondary": `color-mix(in srgb, ${p.ink} 76%, ${p.surface})`,
    "--qp-text-tertiary": `color-mix(in srgb, ${p.ink} 56%, ${p.surface})`,
    "--qp-accent-default": `${p.accent}`,
    "--qp-accent-muted": `color-mix(in srgb, ${p.accent} 12%, ${p.surface})`,
    "--qp-success": `${p.semanticColors.diffAdded}`,
    "--qp-participation": `${p.semanticColors.skill}`,
    "--qp-warning": `color-mix(in srgb, ${p.accent} 64%, #b58900)`,
    "--qp-danger": `${p.semanticColors.diffRemoved}`,
    "--qp-control-off": `color-mix(in srgb, ${p.surface} 88%, ${p.ink})`,
    "--qp-track-muted": `color-mix(in srgb, ${p.surface} 95%, ${p.ink})`,
    "--qp-badge-subtle": `color-mix(in srgb, ${p.surface} 96%, ${p.accent})`,
    "--qp-text-disabled": `color-mix(in srgb, ${p.ink} 38%, ${p.surface})`,
    "--qp-scrollbar-default": `color-mix(in srgb, ${p.surface} 86%, ${p.ink})`,
    "--qp-scrollbar-hover": `color-mix(in srgb, ${p.surface} 76%, ${p.ink})`,
    "--qp-control-thumb": "#ffffff",
    "--qp-chart-cursor": `color-mix(in srgb, ${p.accent} 12%, transparent)`,
    "--qp-chart-grid": `color-mix(in srgb, ${p.ink} 18%, transparent)`,
  };
}

/** Corrected theme surfaces with Patina control colors and interaction hierarchy. */
export function deriveTheme(variant: ThemeVariant, scheme: ColorScheme, override: number | null): Record<string, string> {
  const p = getThemePreset(variant, scheme);
  const dark = variant === "dark";
  const value = effectiveThemeContrast(variant, scheme, override);
  const c = shapeContrast(value, dark);
  const surface = parse(p.surface), ink = parse(p.ink);
  const under = hex(mix(surface, dark ? BLACK : ink, dark ? 0.16 + (value - 60) * 0.0015 : 0.04 + (value - 45) * 0.0012));
  const panel = hex(mix(surface, dark ? ink : WHITE, dark ? 0.03 + c * 0.03 : 0.18 + c * 0.008));
  return {
    "--qp-bg-app": under,
    "--qp-bg-canvas": p.surface,
    "--qp-bg-panel": panel,
    // Nested cards sit below their panel; a small blend softens the separation.
    "--qp-bg-elevated": hex(mix(dark ? surface : parse(under), parse(panel), dark ? 0.25 : 0.3)),
    "--qp-border-subtle": p.borderSubtle,
    "--qp-border-strong": p.borderStrong,
    "--qp-text-on-accent": solid(WHITE),
    ...controlColors(variant, scheme),
    "--qp-chart-track": `rgba(${ink.join(", ")}, ${(0.04 + c * 0.02).toFixed(3)})`,
  };
}
