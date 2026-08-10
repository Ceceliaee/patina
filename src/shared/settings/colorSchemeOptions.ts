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
    { value: "default", swatches: ["#fbfbfb", "#ffffff", "#f5f5f5", "#315f9f", "#3f74c2", "#2f7d49"] },
    { value: "absolutely", label: "Absolutely", swatches: ["#f9f9f7", "#2d2d2b", "#cc7d5e", "#00c853", "#ff5f38", "#cc7d5e"] },
    { value: "catppuccin", label: "Catppuccin", swatches: ["#eff1f5", "#4c4f69", "#8839ef", "#40a02b", "#d20f39", "#8839ef"] },
    { value: "everforest", label: "Everforest", swatches: ["#fdf6e3", "#5c6a72", "#93b259", "#8da101", "#f85552", "#df69ba"] },
    { value: "github", label: "GitHub", swatches: ["#ffffff", "#1f2328", "#0969da", "#1a7f37", "#cf222e", "#8250df"] },
    { value: "gruvbox", label: "Gruvbox", swatches: ["#fbf1c7", "#3c3836", "#458588", "#3c3836", "#cc241d", "#b16286"] },
    { value: "linear", label: "Linear", swatches: ["#fcfcfd", "#1b1b1b", "#5e6ad2", "#52a450", "#c94446", "#8160d8"] },
    { value: "notion", label: "Notion", swatches: ["#ffffff", "#37352f", "#3183d8", "#008000", "#a31515", "#0000ff"] },
    { value: "one", label: "One", swatches: ["#fafafa", "#383a42", "#526fff", "#3bba54", "#e45649", "#526fff"] },
    { value: "proof", label: "Proof", swatches: ["#f5f3ed", "#2f312d", "#3d755d", "#3d755d", "#ba2623", "#5f6ac2"] },
    { value: "raycast", label: "Raycast", swatches: ["#ffffff", "#030303", "#ff6363", "#006b4f", "#b12424", "#9a1b6e"] },
    { value: "rose-pine", label: "Rose Pine", swatches: ["#faf4ed", "#575279", "#d7827e", "#56949f", "#797593", "#907aa9"] },
    { value: "solarized", label: "Solarized", swatches: ["#fdf6e3", "#657b83", "#b58900", "#859900", "#dc322f", "#d33682"] },
    { value: "vercel", label: "Vercel", swatches: ["#ffffff", "#171717", "#006aff", "#28a948", "#eb001d", "#a100f8"] },
    { value: "vscode-plus", label: "VS Code Plus", swatches: ["#ffffff", "#000000", "#007acc", "#008000", "#ee0000", "#0000ff"] },
    { value: "xcode", label: "Xcode", swatches: ["#ffffff", "#000000d9", "#0e0eff", "#00a240", "#c41a16", "#0e0eff"] },
  ],
  dark: [
    { value: "default", swatches: ["#212121", "#2d2d2d", "#404040", "#8ba1c0", "#93a9c8", "#82ad8b"] },
    { value: "absolutely", label: "Absolutely", swatches: ["#2d2d2b", "#f9f9f7", "#cc7d5e", "#00c853", "#ff5f38", "#cc7d5e"] },
    { value: "ayu", label: "Ayu", swatches: ["#0b0e14", "#bfbdb6", "#e6b450", "#7fd962", "#ea6c73", "#cda1fa"] },
    { value: "catppuccin", label: "Catppuccin", swatches: ["#1e1e2e", "#cdd6f4", "#cba6f7", "#a6e3a1", "#f38ba8", "#cba6f7"] },
    { value: "dracula", label: "Dracula", swatches: ["#282a36", "#f8f8f2", "#ff79c6", "#50fa7b", "#ff5555", "#ff79c6"] },
    { value: "everforest", label: "Everforest", swatches: ["#2d353b", "#d3c6aa", "#a7c080", "#a7c080", "#e67e80", "#d699b6"] },
    { value: "github", label: "GitHub", swatches: ["#0d1117", "#e6edf3", "#1f6feb", "#3fb950", "#f85149", "#bc8cff"] },
    { value: "gruvbox", label: "Gruvbox", swatches: ["#282828", "#ebdbb2", "#458588", "#ebdbb2", "#cc241d", "#b16286"] },
    { value: "linear", label: "Linear", swatches: ["#0f0f11", "#e3e4e6", "#606acc", "#69c967", "#ff7e78", "#c2a1ff"] },
    { value: "lobster", label: "Lobster", swatches: ["#111827", "#e4e4e7", "#ff5c5c", "#22c55e", "#ff5c5c", "#3b82f6"] },
    { value: "material", label: "Material", swatches: ["#212121", "#eeffff", "#80cbc4", "#c3e88d", "#f07178", "#c792ea"] },
    { value: "matrix", label: "Matrix", swatches: ["#040805", "#b8ffca", "#1eff5a", "#1eff5a", "#fa423e", "#1eff5a"] },
    { value: "monokai", label: "Monokai", swatches: ["#272822", "#f8f8f2", "#99947c", "#86b42b", "#c4265e", "#8c6bc8"] },
    { value: "night-owl", label: "Night Owl", swatches: ["#011627", "#d6deeb", "#44596b", "#c5e478", "#ef5350", "#c792ea"] },
    { value: "nord", label: "Nord", swatches: ["#2e3440", "#d8dee9", "#88c0d0", "#a3be8c", "#bf616a", "#b48ead"] },
    { value: "notion", label: "Notion", swatches: ["#191919", "#d9d9d8", "#3183d8", "#4ec9b0", "#fa423e", "#3183d8"] },
    { value: "one", label: "One", swatches: ["#282c34", "#abb2bf", "#4d78cc", "#8cc265", "#e05561", "#c162de"] },
    { value: "oscurange", label: "Oscurange", swatches: ["#0b0b0f", "#e6e6e6", "#f9b98c", "#40c977", "#fa423e", "#479ffa"] },
    { value: "raycast", label: "Raycast", swatches: ["#101010", "#fefefe", "#ff6363", "#59d499", "#ff6363", "#cf2f98"] },
    { value: "rose-pine", label: "Rose Pine", swatches: ["#232136", "#e0def4", "#ea9a97", "#9ccfd8", "#908caa", "#c4a7e7"] },
    { value: "sentry", label: "Sentry", swatches: ["#2d2935", "#e6dff9", "#7055f6", "#8ee6d7", "#fa423e", "#7055f6"] },
    { value: "solarized", label: "Solarized", swatches: ["#002b36", "#839496", "#d30102", "#859900", "#dc322f", "#d33682"] },
    { value: "temple", label: "Temple", swatches: ["#02120c", "#c7e6da", "#e4f222", "#40c977", "#fa423e", "#e4f222"] },
    { value: "tokyo-night", label: "Tokyo Night", swatches: ["#1a1b26", "#a9b1d6", "#3d59a1", "#449dab", "#914c54", "#9d7cd8"] },
    { value: "vercel", label: "Vercel", swatches: ["#000000", "#ededed", "#006efe", "#00ad3a", "#f13342", "#9540d5"] },
    { value: "vscode-plus", label: "VS Code Plus", swatches: ["#1e1e1e", "#d4d4d4", "#007acc", "#369432", "#f44747", "#000080"] },
    { value: "xcode", label: "Xcode", swatches: ["#1f1f24", "#ffffffd9", "#5482ff", "#67b7a4", "#fc6a5d", "#5482ff"] },
  ],
};
