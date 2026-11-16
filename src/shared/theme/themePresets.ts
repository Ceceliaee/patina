import type { ColorScheme } from "../settings/appSettings.ts";

import presets from "./presets.json" with { type: "json" };

export type ThemeVariant = "light" | "dark";
interface ThemePreset {
  label?: string;
  surface: string;
  ink: string;
  accent: string;
  contrast: number;
  borderSubtle: string;
  borderStrong: string;
  semanticColors: { diffAdded: string; diffRemoved: string; skill: string };
}

// Codex 26.901.51231; default retains Patina's palette with mode contrast defaults.
export const PRESETS: Record<ThemeVariant, Partial<Record<ColorScheme, ThemePreset>>> = presets;

export function getThemePreset(variant: ThemeVariant, scheme: ColorScheme): ThemePreset {
  return PRESETS[variant][scheme] ?? PRESETS[variant].default!;
}

export function normalizeThemeContrast(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 100 ? value : null;
}

export function effectiveThemeContrast(variant: ThemeVariant, scheme: ColorScheme, override: unknown): number {
  return normalizeThemeContrast(override) ?? getThemePreset(variant, scheme).contrast;
}
