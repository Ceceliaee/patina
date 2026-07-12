import {
  getScreenshotSettings as getScreenshotSettingsGateway,
  setScreenshotSettings as setScreenshotSettingsGateway,
} from "../../../platform/persistence/screenshotGateway.ts";
import type { ScreenshotSettings } from "../../../platform/persistence/screenshotGateway.ts";

export type { ScreenshotSettings };

export async function getScreenshotSettings(): Promise<ScreenshotSettings> {
  return getScreenshotSettingsGateway();
}

export async function setScreenshotSettings(settings: ScreenshotSettings): Promise<void> {
  return setScreenshotSettingsGateway(settings);
}
