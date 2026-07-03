import { RELEASE_DEFAULT_SETTINGS } from "./releaseDefaultProfile.ts";

export type CloseBehavior = "exit" | "tray";
export type MinimizeBehavior = "taskbar" | "widget";
export type ThemeMode = "light" | "dark" | "system";
export type AppLanguage = "zh-CN" | "en-US";
export type HourlyActivityChartMode = "total" | "category";
export type ColorScheme =
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
  | "notion"
  | "nord"
  | "one"
  | "oscurange"
  | "proof"
  | "raycast"
  | "rose-pine"
  | "sentry"
  | "solarized"
  | "temple"
  | "tokyo-night"
  | "vercel"
  | "vscode-plus"
  | "xcode";

export interface AppSettings {
  idleTimeoutSecs: number;
  timelineMergeGapSecs: number;
  refreshIntervalSecs: number;
  minSessionSecs: number;
  trackingPaused: boolean;
  closeBehavior: CloseBehavior;
  minimizeBehavior: MinimizeBehavior;
  themeMode: ThemeMode;
  language: AppLanguage;
  hourlyActivityChartMode: HourlyActivityChartMode;
  dynamicEffects: boolean;
  colorSchemeLight: ColorScheme;
  colorSchemeDark: ColorScheme;
  launchAtLogin: boolean;
  startMinimized: boolean;
  backgroundOptimization: boolean;
  onboardingCompleted: boolean;
  webActivityEnabled: boolean;
  webActivityPort: number;
  webActivityToken: string;
  remoteStatusBridgeEnabled: boolean;
  remoteStatusBridgeUrl: string;
  remoteStatusBridgeToken: string;
  remoteStatusBridgeMachineId: string;
}

export const DEFAULT_SETTINGS: AppSettings = {
  ...RELEASE_DEFAULT_SETTINGS,
};
