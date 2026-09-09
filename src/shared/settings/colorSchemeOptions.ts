import { themeSwatches } from "../theme/themePresets.ts";
import type { ColorScheme } from "./appSettings.ts";

export type ThemeLibrary = "light" | "dark";
type ColorSchemeSwatches = [string, string, string, string, string, string];

interface ColorSchemeOption {
  value: ColorScheme;
  label?: string;
  swatches: ColorSchemeSwatches;
}

export const COLOR_SCHEME_OPTIONS: Record<ThemeLibrary, ColorSchemeOption[]> = {
  light: [
    { value: "default", swatches: themeSwatches("light", "default") },
    { value: "absolutely", label: "Absolutely", swatches: themeSwatches("light", "absolutely") },
    { value: "catppuccin", label: "Catppuccin", swatches: themeSwatches("light", "catppuccin") },
    { value: "everforest", label: "Everforest", swatches: themeSwatches("light", "everforest") },
    { value: "github", label: "GitHub", swatches: themeSwatches("light", "github") },
    { value: "gruvbox", label: "Gruvbox", swatches: themeSwatches("light", "gruvbox") },
    { value: "linear", label: "Linear", swatches: themeSwatches("light", "linear") },
    { value: "notion", label: "Notion", swatches: themeSwatches("light", "notion") },
    { value: "one", label: "One", swatches: themeSwatches("light", "one") },
    { value: "proof", label: "Proof", swatches: themeSwatches("light", "proof") },
    { value: "raycast", label: "Raycast", swatches: themeSwatches("light", "raycast") },
    { value: "rose-pine", label: "Rose Pine", swatches: themeSwatches("light", "rose-pine") },
    { value: "solarized", label: "Solarized", swatches: themeSwatches("light", "solarized") },
    { value: "vercel", label: "Vercel", swatches: themeSwatches("light", "vercel") },
    { value: "vscode-plus", label: "VS Code Plus", swatches: themeSwatches("light", "vscode-plus") },
    { value: "xcode", label: "Xcode", swatches: themeSwatches("light", "xcode") },
  ],
  dark: [
    { value: "default", swatches: themeSwatches("dark", "default") },
    { value: "absolutely", label: "Absolutely", swatches: themeSwatches("dark", "absolutely") },
    { value: "ayu", label: "Ayu", swatches: themeSwatches("dark", "ayu") },
    { value: "catppuccin", label: "Catppuccin", swatches: themeSwatches("dark", "catppuccin") },
    { value: "dracula", label: "Dracula", swatches: themeSwatches("dark", "dracula") },
    { value: "everforest", label: "Everforest", swatches: themeSwatches("dark", "everforest") },
    { value: "github", label: "GitHub", swatches: themeSwatches("dark", "github") },
    { value: "gruvbox", label: "Gruvbox", swatches: themeSwatches("dark", "gruvbox") },
    { value: "linear", label: "Linear", swatches: themeSwatches("dark", "linear") },
    { value: "lobster", label: "Lobster", swatches: themeSwatches("dark", "lobster") },
    { value: "material", label: "Material", swatches: themeSwatches("dark", "material") },
    { value: "matrix", label: "Matrix", swatches: themeSwatches("dark", "matrix") },
    { value: "monokai", label: "Monokai", swatches: themeSwatches("dark", "monokai") },
    { value: "night-owl", label: "Night Owl", swatches: themeSwatches("dark", "night-owl") },
    { value: "nord", label: "Nord", swatches: themeSwatches("dark", "nord") },
    { value: "notion", label: "Notion", swatches: themeSwatches("dark", "notion") },
    { value: "one", label: "One", swatches: themeSwatches("dark", "one") },
    { value: "oscurange", label: "Oscurange", swatches: themeSwatches("dark", "oscurange") },
    { value: "raycast", label: "Raycast", swatches: themeSwatches("dark", "raycast") },
    { value: "rose-pine", label: "Rose Pine", swatches: themeSwatches("dark", "rose-pine") },
    { value: "sentry", label: "Sentry", swatches: themeSwatches("dark", "sentry") },
    { value: "solarized", label: "Solarized", swatches: themeSwatches("dark", "solarized") },
    { value: "temple", label: "Temple", swatches: themeSwatches("dark", "temple") },
    { value: "tokyo-night", label: "Tokyo Night", swatches: themeSwatches("dark", "tokyo-night") },
    { value: "vercel", label: "Vercel", swatches: themeSwatches("dark", "vercel") },
    { value: "vscode-plus", label: "VS Code Plus", swatches: themeSwatches("dark", "vscode-plus") },
    { value: "xcode", label: "Xcode", swatches: themeSwatches("dark", "xcode") },
  ],
};
