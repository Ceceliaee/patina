export interface ReleaseDefaultSettingsProfile {
  idleTimeoutSecs: number;
  timelineMergeGapSecs: number;
  refreshIntervalSecs: number;
  minSessionSecs: number;
  trackingPaused: boolean;
  closeBehavior: "exit" | "tray";
  minimizeBehavior: "taskbar" | "widget";
  themeMode: "light" | "dark" | "system";
  language: "zh-CN" | "en-US";
  hourlyActivityChartMode: "total" | "category";
  colorSchemeLight:
    | "default"
    | "absolutely"
    | "catppuccin"
    | "everforest"
    | "github"
    | "gruvbox"
    | "linear"
    | "notion"
    | "one"
    | "proof"
    | "raycast"
    | "rose-pine"
    | "solarized"
    | "vercel"
    | "vscode-plus"
    | "xcode";
  colorSchemeDark:
    | "default"
    | "absolutely"
    | "ayu"
    | "catppuccin"
    | "dracula"
    | "everforest"
    | "github"
    | "gruvbox"
    | "linear"
    | "lobster"
    | "material"
    | "matrix"
    | "monokai"
    | "night-owl"
    | "nord"
    | "notion"
    | "one"
    | "oscurange"
    | "raycast"
    | "rose-pine"
    | "sentry"
    | "solarized"
    | "temple"
    | "tokyo-night"
    | "vercel"
    | "vscode-plus"
    | "xcode";
  launchAtLogin: boolean;
  startMinimized: boolean;
  backgroundOptimization: boolean;
  onboardingCompleted: boolean;
  localApiEnabled: boolean;
  localApiPort: number;
  localApiToken: string;
  webActivityEnabled: boolean;
  webActivityToken: string;
  remoteStatusBridgeEnabled: boolean;
  remoteStatusBridgeUrl: string;
  remoteStatusBridgeToken: string;
  remoteStatusBridgeMachineId: string;
}

export const RELEASE_DEFAULT_SETTINGS: ReleaseDefaultSettingsProfile = {
  idleTimeoutSecs: 900,
  timelineMergeGapSecs: 180,
  refreshIntervalSecs: 2,
  minSessionSecs: 300,
  trackingPaused: false,
  closeBehavior: "tray",
  minimizeBehavior: "widget",
  themeMode: "light",
  language: "zh-CN",
  hourlyActivityChartMode: "total",
  colorSchemeLight: "default",
  colorSchemeDark: "default",
  launchAtLogin: true,
  startMinimized: true,
  backgroundOptimization: false,
  onboardingCompleted: true,
  localApiEnabled: false,
  localApiPort: 12345,
  localApiToken: "",
  webActivityEnabled: false,
  webActivityToken: "",
  remoteStatusBridgeEnabled: false,
  remoteStatusBridgeUrl: "",
  remoteStatusBridgeToken: "",
  remoteStatusBridgeMachineId: "",
};
