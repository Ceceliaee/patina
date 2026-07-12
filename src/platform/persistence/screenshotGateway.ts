import { invoke } from "@tauri-apps/api/core";

export interface ScreenshotSettings {
  enabled: boolean;
  intervalSecs: number;
  retentionDays: number;
}

export interface ScreenshotEntry {
  id: number;
  capturedAt: number;
  width: number;
  height: number;
  thumbnailBase64: string;
  sessionId: number | null;
}

export async function getScreenshotSettings(): Promise<ScreenshotSettings> {
  return invoke<ScreenshotSettings>("cmd_get_screenshot_settings");
}

export async function setScreenshotSettings(settings: ScreenshotSettings): Promise<void> {
  return invoke<void>("cmd_set_screenshot_settings", { settings });
}

export async function queryScreenshots(
  startTime: number,
  endTime: number,
): Promise<ScreenshotEntry[]> {
  return invoke<ScreenshotEntry[]>("cmd_query_screenshots", { startTime, endTime });
}

export async function getScreenshotData(id: number): Promise<string> {
  return invoke<string>("cmd_get_screenshot_data", { id });
}

export async function getScreenshotFilePath(id: number): Promise<string> {
  return invoke<string>("cmd_get_screenshot_file_path", { id });
}

export async function revealScreenshotInFolder(id: number): Promise<void> {
  return invoke<void>("cmd_reveal_screenshot_in_folder", { id });
}
