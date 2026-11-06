import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { ToolNotificationPreferences, ToolPresentationAction, ToolPresentationSnapshot } from "../../shared/types/toolNotifications.ts";
import { parseToolAlert } from "./toolsRawDtos.ts";

export function parseNotificationPreferences(value: unknown): ToolNotificationPreferences {
  const v = value as Partial<ToolNotificationPreferences> | null;
  if (!v || !["notification", "dialog"].includes(v.delivery ?? "") || !["default", "bell", "clear", "none"].includes(v.sound ?? "")) {
    throw new Error("Invalid tool notification preferences");
  }
  return { delivery: v.delivery!, sound: v.sound! };
}
export function parseToolPresentation(value: unknown): ToolPresentationSnapshot {
  const v = value as Partial<ToolPresentationSnapshot> | null;
  if (!v || !Number.isSafeInteger(v.revision) || v.revision! < 0 || !v.appearance || typeof v.appearance !== "object"
    || Object.values(v.appearance).some(value => typeof value !== "string") || (v.error !== null && typeof v.error !== "string")) {
    throw new Error("Invalid tool presentation snapshot");
  }
  return { revision: v.revision!, alert: v.alert === null ? null : parseToolAlert(v.alert),
    preferences: parseNotificationPreferences(v.preferences), appearance: v.appearance, error: v.error,
    targetIcon: typeof v.targetIcon === "string" ? v.targetIcon : null };
}
export async function getToolPresentation(retry = false): Promise<ToolPresentationSnapshot> {
  return parseToolPresentation(await invoke<unknown>("cmd_get_tool_presentation", { retry }));
}
export async function saveToolNotificationPreferences(patch: Partial<ToolNotificationPreferences>) {
  return parseNotificationPreferences(await invoke<unknown>("cmd_save_tool_notification_preferences", { patch }));
}
export function onToolPresentationChanged(handler: () => void) {
  return listen("tool-presentation-changed", handler);
}
export function actOnToolPresentation(alertId: string, action: ToolPresentationAction): Promise<void> {
  return invoke("cmd_tool_presentation_action", { alertId, action });
}
export function markToolPresentationReady(alertId: string, width: number, height: number, canvasHeight?: number): Promise<void> {
  return invoke("cmd_tool_presentation_ready", { alertId, width, height, canvasHeight });
}
