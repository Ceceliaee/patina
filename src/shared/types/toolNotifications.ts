import type { ActivityReminderExtension, ReminderDelayMinutes, ToolAlert } from "./tools.ts";

export interface ToolNotificationPreferences {
  delivery: "notification" | "dialog";
  sound: "default" | "bell" | "clear" | "none";
}
export interface ToolPresentationSnapshot {
  revision: number;
  alert: ToolAlert | null;
  preferences: ToolNotificationPreferences;
  appearance: Record<string, string>;
  error: string | null;
  targetIcon: string | null;
}
export type ToolPresentationAction =
  | { kind: "dismiss" | "start_next" | "desktop" }
  | { kind: "resolve"; delay: ReminderDelayMinutes | null }
  | { kind: "extend"; extension: ActivityReminderExtension };
export interface ToolAlertActions {
  onAction: (action: ToolPresentationAction) => Promise<void>;
  notification?: boolean;
}
