import { deriveTheme } from "../../shared/theme/deriveTheme.ts";
import { getThemePreset } from "../../shared/theme/themePresets.ts";
import { useLayoutEffect } from "react";
import type { ColorScheme, ThemeMode } from "../../shared/settings/appSettings.ts";

type EffectiveTheme = "light" | "dark";

const COLOR_SCHEME_QUERY = "(prefers-color-scheme: dark)";

function resolveEffectiveTheme(themeMode: ThemeMode, prefersDark: boolean): EffectiveTheme {
  if (themeMode === "dark") return "dark";
  if (themeMode === "system" && prefersDark) return "dark";
  return "light";
}

function applyDocumentTheme(themeMode: ThemeMode, effectiveTheme: EffectiveTheme, colorScheme: ColorScheme) {
  const root = document.documentElement;
  root.dataset.themeMode = themeMode;
  root.dataset.theme = effectiveTheme;
  root.dataset.colorScheme = colorScheme;
  for (const [key, value] of Object.entries(deriveTheme(effectiveTheme, colorScheme, null))) {
    root.style.setProperty(key, value);
  }
  root.dataset.themeContrast = String(getThemePreset(effectiveTheme, colorScheme).contrast);
  root.style.colorScheme = effectiveTheme;
}

export function isDocumentThemeApplied(
  themeMode: ThemeMode,
  colorSchemeLight: ColorScheme,
  colorSchemeDark: ColorScheme,
): boolean {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return false;
  }

  const prefersDark = typeof window.matchMedia === "function"
    && window.matchMedia(COLOR_SCHEME_QUERY).matches;
  const effectiveTheme = resolveEffectiveTheme(themeMode, prefersDark);
  const colorScheme = effectiveTheme === "dark" ? colorSchemeDark : colorSchemeLight;
  const root = document.documentElement;

  return root.dataset.themeMode === themeMode
    && root.dataset.theme === effectiveTheme
    && root.dataset.colorScheme === colorScheme
    && root.dataset.themeContrast === String(getThemePreset(effectiveTheme, colorScheme).contrast)
    && root.style.colorScheme === effectiveTheme;
}

export function useAppThemeMode(
  themeMode: ThemeMode,
  colorSchemeLight: ColorScheme,
  colorSchemeDark: ColorScheme,
) {
  useLayoutEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      const dark = themeMode === "dark";
      applyDocumentTheme(themeMode, dark ? "dark" : "light", dark ? colorSchemeDark : colorSchemeLight);
      return undefined;
    }

    const mediaQuery = window.matchMedia(COLOR_SCHEME_QUERY);
    const syncTheme = () => {
      const effectiveTheme = resolveEffectiveTheme(themeMode, mediaQuery.matches);
      applyDocumentTheme(
        themeMode,
        effectiveTheme,
        effectiveTheme === "dark" ? colorSchemeDark : colorSchemeLight,
      );
    };

    syncTheme();

    if (themeMode !== "system") {
      return undefined;
    }

    mediaQuery.addEventListener("change", syncTheme);
    return () => {
      mediaQuery.removeEventListener("change", syncTheme);
    };
  }, [ colorSchemeDark, colorSchemeLight, themeMode]);
}
