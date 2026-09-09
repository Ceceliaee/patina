import type { ColorScheme } from "../settings/appSettings.ts";

export type ThemeVariant = "light" | "dark";
export interface ThemePreset {
  surface: string;
  ink: string;
  accent: string;
  contrast: number;
  borderSubtle: string;
  borderStrong: string;
  semanticColors: { diffAdded: string; diffRemoved: string; skill: string };
}

// Codex 26.901.51231; default retains Patina's palette with mode contrast defaults.
const PRESETS: Record<ThemeVariant, Partial<Record<ColorScheme, ThemePreset>>> = {
  light: {
    "default": {"surface": "#fbfbfb", "ink": "#171717", "accent": "#315f9f", "contrast": 45, "semanticColors": {"diffAdded": "#2f7d49", "diffRemoved": "#b53a3a", "skill": "#924ff7"}, "borderSubtle": "#dddddd", "borderStrong": "#c5c5c5"},
    "absolutely": {"surface": "#f9f9f7", "ink": "#2d2d2b", "accent": "#cc7d5e", "contrast": 45, "semanticColors": {"diffAdded": "#00c853", "diffRemoved": "#ff5f38", "skill": "#cc7d5e"}, "borderSubtle": "color-mix(in srgb, #f9f9f7 84%, #2d2d2b)", "borderStrong": "color-mix(in srgb, #f9f9f7 68%, #2d2d2b)"},
    "catppuccin": {"surface": "#eff1f5", "ink": "#4c4f69", "accent": "#8839ef", "contrast": 45, "semanticColors": {"diffAdded": "#40a02b", "diffRemoved": "#d20f39", "skill": "#8839ef"}, "borderSubtle": "color-mix(in srgb, #eff1f5 84%, #4c4f69)", "borderStrong": "color-mix(in srgb, #eff1f5 68%, #4c4f69)"},
    "everforest": {"surface": "#fdf6e3", "ink": "#5c6a72", "accent": "#93b259", "contrast": 45, "semanticColors": {"diffAdded": "#8da101", "diffRemoved": "#f85552", "skill": "#df69ba"}, "borderSubtle": "color-mix(in srgb, #fdf6e3 84%, #5c6a72)", "borderStrong": "color-mix(in srgb, #fdf6e3 68%, #5c6a72)"},
    "github": {"surface": "#ffffff", "ink": "#1f2328", "accent": "#0969da", "contrast": 45, "semanticColors": {"diffAdded": "#1a7f37", "diffRemoved": "#cf222e", "skill": "#8250df"}, "borderSubtle": "color-mix(in srgb, #ffffff 84%, #1f2328)", "borderStrong": "color-mix(in srgb, #ffffff 68%, #1f2328)"},
    "gruvbox": {"surface": "#fbf1c7", "ink": "#3c3836", "accent": "#458588", "contrast": 45, "semanticColors": {"diffAdded": "#3c3836", "diffRemoved": "#cc241d", "skill": "#b16286"}, "borderSubtle": "color-mix(in srgb, #fbf1c7 84%, #3c3836)", "borderStrong": "color-mix(in srgb, #fbf1c7 68%, #3c3836)"},
    "linear": {"surface": "#fcfcfd", "ink": "#1b1b1b", "accent": "#5e6ad2", "contrast": 45, "semanticColors": {"diffAdded": "#52a450", "diffRemoved": "#c94446", "skill": "#8160d8"}, "borderSubtle": "color-mix(in srgb, #fcfcfd 84%, #1b1b1b)", "borderStrong": "color-mix(in srgb, #fcfcfd 68%, #1b1b1b)"},
    "notion": {"surface": "#ffffff", "ink": "#37352f", "accent": "#3183d8", "contrast": 45, "semanticColors": {"diffAdded": "#008000", "diffRemoved": "#a31515", "skill": "#0000ff"}, "borderSubtle": "color-mix(in srgb, #ffffff 84%, #37352f)", "borderStrong": "color-mix(in srgb, #ffffff 68%, #37352f)"},
    "one": {"surface": "#fafafa", "ink": "#383a42", "accent": "#526fff", "contrast": 45, "semanticColors": {"diffAdded": "#3bba54", "diffRemoved": "#e45649", "skill": "#526fff"}, "borderSubtle": "color-mix(in srgb, #fafafa 84%, #383a42)", "borderStrong": "color-mix(in srgb, #fafafa 68%, #383a42)"},
    "proof": {"surface": "#f5f3ed", "ink": "#2f312d", "accent": "#3d755d", "contrast": 45, "semanticColors": {"diffAdded": "#3d755d", "diffRemoved": "#ba2623", "skill": "#5f6ac2"}, "borderSubtle": "color-mix(in srgb, #f5f3ed 84%, #2f312d)", "borderStrong": "color-mix(in srgb, #f5f3ed 68%, #2f312d)"},
    "raycast": {"surface": "#ffffff", "ink": "#030303", "accent": "#ff6363", "contrast": 45, "semanticColors": {"diffAdded": "#006b4f", "diffRemoved": "#b12424", "skill": "#9a1b6e"}, "borderSubtle": "color-mix(in srgb, #ffffff 84%, #030303)", "borderStrong": "color-mix(in srgb, #ffffff 68%, #030303)"},
    "rose-pine": {"surface": "#faf4ed", "ink": "#575279", "accent": "#d7827e", "contrast": 45, "semanticColors": {"diffAdded": "#56949f", "diffRemoved": "#797593", "skill": "#907aa9"}, "borderSubtle": "color-mix(in srgb, #faf4ed 84%, #575279)", "borderStrong": "color-mix(in srgb, #faf4ed 68%, #575279)"},
    "solarized": {"surface": "#fdf6e3", "ink": "#657b83", "accent": "#b58900", "contrast": 45, "semanticColors": {"diffAdded": "#859900", "diffRemoved": "#dc322f", "skill": "#d33682"}, "borderSubtle": "color-mix(in srgb, #fdf6e3 84%, #657b83)", "borderStrong": "color-mix(in srgb, #fdf6e3 68%, #657b83)"},
    "vercel": {"surface": "#ffffff", "ink": "#171717", "accent": "#006aff", "contrast": 40, "semanticColors": {"diffAdded": "#28a948", "diffRemoved": "#eb001d", "skill": "#a100f8"}, "borderSubtle": "color-mix(in srgb, #ffffff 84%, #171717)", "borderStrong": "color-mix(in srgb, #ffffff 68%, #171717)"},
    "vscode-plus": {"surface": "#ffffff", "ink": "#000000", "accent": "#007acc", "contrast": 45, "semanticColors": {"diffAdded": "#008000", "diffRemoved": "#ee0000", "skill": "#0000ff"}, "borderSubtle": "color-mix(in srgb, #ffffff 84%, #000000)", "borderStrong": "color-mix(in srgb, #ffffff 68%, #000000)"},
    "xcode": {"surface": "#ffffff", "ink": "#000000", "accent": "#0e0eff", "contrast": 45, "semanticColors": {"diffAdded": "#00a240", "diffRemoved": "#c41a16", "skill": "#0e0eff"}, "borderSubtle": "color-mix(in srgb, #ffffff 84%, #000000d9)", "borderStrong": "color-mix(in srgb, #ffffff 68%, #000000d9)"},
  },
  dark: {
    "default": {"surface": "#262626", "ink": "#d1d5dc", "accent": "#8ba1c0", "contrast": 60, "semanticColors": {"diffAdded": "#82ad8b", "diffRemoved": "#c98383", "skill": "#ad7bf9"}, "borderSubtle": "#404040", "borderStrong": "#5f5f5f"},
    "absolutely": {"surface": "#2d2d2b", "ink": "#f9f9f7", "accent": "#cc7d5e", "contrast": 60, "semanticColors": {"diffAdded": "#00c853", "diffRemoved": "#ff5f38", "skill": "#cc7d5e"}, "borderSubtle": "color-mix(in srgb, #2d2d2b 70%, #f9f9f7)", "borderStrong": "color-mix(in srgb, #2d2d2b 54%, #f9f9f7)"},
    "ayu": {"surface": "#10141c", "ink": "#bfbdb6", "accent": "#e6b450", "contrast": 60, "semanticColors": {"diffAdded": "#70bf56", "diffRemoved": "#f26d78", "skill": "#d0a1ff"}, "borderSubtle": "color-mix(in srgb, #0b0e14 70%, #bfbdb6)", "borderStrong": "color-mix(in srgb, #0b0e14 54%, #bfbdb6)"},
    "catppuccin": {"surface": "#1e1e2e", "ink": "#cdd6f4", "accent": "#cba6f7", "contrast": 60, "semanticColors": {"diffAdded": "#a6e3a1", "diffRemoved": "#f38ba8", "skill": "#cba6f7"}, "borderSubtle": "color-mix(in srgb, #1e1e2e 70%, #cdd6f4)", "borderStrong": "color-mix(in srgb, #1e1e2e 54%, #cdd6f4)"},
    "dracula": {"surface": "#282a36", "ink": "#f8f8f2", "accent": "#ff79c6", "contrast": 60, "semanticColors": {"diffAdded": "#50fa7b", "diffRemoved": "#ff5555", "skill": "#ff79c6"}, "borderSubtle": "color-mix(in srgb, #282a36 70%, #f8f8f2)", "borderStrong": "color-mix(in srgb, #282a36 54%, #f8f8f2)"},
    "everforest": {"surface": "#2d353b", "ink": "#d3c6aa", "accent": "#a7c080", "contrast": 60, "semanticColors": {"diffAdded": "#a7c080", "diffRemoved": "#e67e80", "skill": "#d699b6"}, "borderSubtle": "color-mix(in srgb, #2d353b 70%, #d3c6aa)", "borderStrong": "color-mix(in srgb, #2d353b 54%, #d3c6aa)"},
    "github": {"surface": "#0d1117", "ink": "#e6edf3", "accent": "#1f6feb", "contrast": 60, "semanticColors": {"diffAdded": "#3fb950", "diffRemoved": "#f85149", "skill": "#bc8cff"}, "borderSubtle": "color-mix(in srgb, #0d1117 70%, #e6edf3)", "borderStrong": "color-mix(in srgb, #0d1117 54%, #e6edf3)"},
    "gruvbox": {"surface": "#282828", "ink": "#ebdbb2", "accent": "#458588", "contrast": 60, "semanticColors": {"diffAdded": "#ebdbb2", "diffRemoved": "#cc241d", "skill": "#b16286"}, "borderSubtle": "color-mix(in srgb, #282828 70%, #ebdbb2)", "borderStrong": "color-mix(in srgb, #282828 54%, #ebdbb2)"},
    "linear": {"surface": "#0f0f11", "ink": "#e3e4e6", "accent": "#606acc", "contrast": 60, "semanticColors": {"diffAdded": "#69c967", "diffRemoved": "#ff7e78", "skill": "#c2a1ff"}, "borderSubtle": "color-mix(in srgb, #0f0f11 70%, #e3e4e6)", "borderStrong": "color-mix(in srgb, #0f0f11 54%, #e3e4e6)"},
    "lobster": {"surface": "#111827", "ink": "#e4e4e7", "accent": "#ff5c5c", "contrast": 60, "semanticColors": {"diffAdded": "#22c55e", "diffRemoved": "#ff5c5c", "skill": "#3b82f6"}, "borderSubtle": "color-mix(in srgb, #111827 70%, #e4e4e7)", "borderStrong": "color-mix(in srgb, #111827 54%, #e4e4e7)"},
    "material": {"surface": "#212121", "ink": "#eeffff", "accent": "#80cbc4", "contrast": 60, "semanticColors": {"diffAdded": "#c3e88d", "diffRemoved": "#f07178", "skill": "#c792ea"}, "borderSubtle": "color-mix(in srgb, #212121 70%, #eeffff)", "borderStrong": "color-mix(in srgb, #212121 54%, #eeffff)"},
    "matrix": {"surface": "#040805", "ink": "#b8ffca", "accent": "#1eff5a", "contrast": 60, "semanticColors": {"diffAdded": "#1eff5a", "diffRemoved": "#fa423e", "skill": "#1eff5a"}, "borderSubtle": "color-mix(in srgb, #040805 70%, #b8ffca)", "borderStrong": "color-mix(in srgb, #040805 54%, #b8ffca)"},
    "monokai": {"surface": "#272822", "ink": "#f8f8f2", "accent": "#99947c", "contrast": 60, "semanticColors": {"diffAdded": "#86b42b", "diffRemoved": "#c4265e", "skill": "#8c6bc8"}, "borderSubtle": "color-mix(in srgb, #272822 70%, #f8f8f2)", "borderStrong": "color-mix(in srgb, #272822 54%, #f8f8f2)"},
    "night-owl": {"surface": "#011627", "ink": "#d6deeb", "accent": "#44596b", "contrast": 60, "semanticColors": {"diffAdded": "#c5e478", "diffRemoved": "#ef5350", "skill": "#c792ea"}, "borderSubtle": "color-mix(in srgb, #011627 70%, #d6deeb)", "borderStrong": "color-mix(in srgb, #011627 54%, #d6deeb)"},
    "nord": {"surface": "#2e3440", "ink": "#d8dee9", "accent": "#88c0d0", "contrast": 60, "semanticColors": {"diffAdded": "#a3be8c", "diffRemoved": "#bf616a", "skill": "#b48ead"}, "borderSubtle": "color-mix(in srgb, #2e3440 70%, #d8dee9)", "borderStrong": "color-mix(in srgb, #2e3440 54%, #d8dee9)"},
    "notion": {"surface": "#191919", "ink": "#d9d9d8", "accent": "#3183d8", "contrast": 60, "semanticColors": {"diffAdded": "#4ec9b0", "diffRemoved": "#fa423e", "skill": "#3183d8"}, "borderSubtle": "color-mix(in srgb, #191919 70%, #d9d9d8)", "borderStrong": "color-mix(in srgb, #191919 54%, #d9d9d8)"},
    "one": {"surface": "#282c34", "ink": "#abb2bf", "accent": "#4d78cc", "contrast": 60, "semanticColors": {"diffAdded": "#8cc265", "diffRemoved": "#e05561", "skill": "#c162de"}, "borderSubtle": "color-mix(in srgb, #282c34 70%, #abb2bf)", "borderStrong": "color-mix(in srgb, #282c34 54%, #abb2bf)"},
    "oscurange": {"surface": "#0b0b0f", "ink": "#e6e6e6", "accent": "#f9b98c", "contrast": 60, "semanticColors": {"diffAdded": "#40c977", "diffRemoved": "#fa423e", "skill": "#479ffa"}, "borderSubtle": "color-mix(in srgb, #0b0b0f 70%, #e6e6e6)", "borderStrong": "color-mix(in srgb, #0b0b0f 54%, #e6e6e6)"},
    "raycast": {"surface": "#101010", "ink": "#fefefe", "accent": "#ff6363", "contrast": 60, "semanticColors": {"diffAdded": "#59d499", "diffRemoved": "#ff6363", "skill": "#cf2f98"}, "borderSubtle": "color-mix(in srgb, #101010 70%, #fefefe)", "borderStrong": "color-mix(in srgb, #101010 54%, #fefefe)"},
    "rose-pine": {"surface": "#232136", "ink": "#e0def4", "accent": "#ea9a97", "contrast": 60, "semanticColors": {"diffAdded": "#9ccfd8", "diffRemoved": "#908caa", "skill": "#c4a7e7"}, "borderSubtle": "color-mix(in srgb, #232136 70%, #e0def4)", "borderStrong": "color-mix(in srgb, #232136 54%, #e0def4)"},
    "sentry": {"surface": "#2d2935", "ink": "#e6dff9", "accent": "#7055f6", "contrast": 60, "semanticColors": {"diffAdded": "#8ee6d7", "diffRemoved": "#fa423e", "skill": "#7055f6"}, "borderSubtle": "color-mix(in srgb, #2d2935 70%, #e6dff9)", "borderStrong": "color-mix(in srgb, #2d2935 54%, #e6dff9)"},
    "solarized": {"surface": "#002b36", "ink": "#839496", "accent": "#d30102", "contrast": 60, "semanticColors": {"diffAdded": "#859900", "diffRemoved": "#dc322f", "skill": "#d33682"}, "borderSubtle": "color-mix(in srgb, #002b36 70%, #839496)", "borderStrong": "color-mix(in srgb, #002b36 54%, #839496)"},
    "temple": {"surface": "#02120c", "ink": "#c7e6da", "accent": "#e4f222", "contrast": 60, "semanticColors": {"diffAdded": "#40c977", "diffRemoved": "#fa423e", "skill": "#e4f222"}, "borderSubtle": "color-mix(in srgb, #02120c 70%, #c7e6da)", "borderStrong": "color-mix(in srgb, #02120c 54%, #c7e6da)"},
    "tokyo-night": {"surface": "#1a1b26", "ink": "#a9b1d6", "accent": "#3d59a1", "contrast": 60, "semanticColors": {"diffAdded": "#449dab", "diffRemoved": "#914c54", "skill": "#9d7cd8"}, "borderSubtle": "color-mix(in srgb, #1a1b26 70%, #a9b1d6)", "borderStrong": "color-mix(in srgb, #1a1b26 54%, #a9b1d6)"},
    "vercel": {"surface": "#000000", "ink": "#ededed", "accent": "#006efe", "contrast": 50, "semanticColors": {"diffAdded": "#00ad3a", "diffRemoved": "#f13342", "skill": "#9540d5"}, "borderSubtle": "color-mix(in srgb, #000000 70%, #ededed)", "borderStrong": "color-mix(in srgb, #000000 54%, #ededed)"},
    "vscode-plus": {"surface": "#1e1e1e", "ink": "#d4d4d4", "accent": "#007acc", "contrast": 60, "semanticColors": {"diffAdded": "#369432", "diffRemoved": "#f44747", "skill": "#000080"}, "borderSubtle": "color-mix(in srgb, #1e1e1e 70%, #d4d4d4)", "borderStrong": "color-mix(in srgb, #1e1e1e 54%, #d4d4d4)"},
    "xcode": {"surface": "#1f1f24", "ink": "#ffffff", "accent": "#5482ff", "contrast": 60, "semanticColors": {"diffAdded": "#67b7a4", "diffRemoved": "#fc6a5d", "skill": "#5482ff"}, "borderSubtle": "color-mix(in srgb, #1f1f24 70%, #ffffffd9)", "borderStrong": "color-mix(in srgb, #1f1f24 54%, #ffffffd9)"},
  },
};

export function getThemePreset(variant: ThemeVariant, scheme: ColorScheme): ThemePreset {
  return PRESETS[variant][scheme] ?? PRESETS[variant].default!;
}

export function themeSwatches(variant: ThemeVariant, scheme: ColorScheme): [string, string, string, string, string, string] {
  const p = getThemePreset(variant, scheme);
  return [p.surface, p.ink, p.accent, p.semanticColors.diffAdded, p.semanticColors.diffRemoved, p.semanticColors.skill];
}

export function normalizeThemeContrast(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 100 ? value : null;
}

export function effectiveThemeContrast(variant: ThemeVariant, scheme: ColorScheme, override: unknown): number {
  return normalizeThemeContrast(override) ?? getThemePreset(variant, scheme).contrast;
}
