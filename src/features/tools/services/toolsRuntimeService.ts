import { parseCommandError } from "../../../platform/persistence/commandError.ts";
import { showDesktop } from "../../../platform/desktop/windowControlGateway.ts";
import {
  cancelReminder,
  updateReminder,
  createActivityReminderRule,
  createReminder,
  disableActivityReminderRule,
  setActivityReminderEnabled,
  updateActivityReminderLimit,
  dismissToolAlert,
  resolveReminderAlert,
  extendActivityReminder,
  getToolAlerts,
  getToolsSnapshot,
  onToolAlert,
  onToolsRuntimeChanged,
  pausePomodoro,
  resetPomodoro,
  resumePomodoro,
  skipPomodoroPhase,
  startPomodoro,
} from "../../../platform/runtime/toolsRuntimeGateway.ts";

export const ToolsRuntimeService = {
  showDesktop,
  isStateRefreshPendingError(error: unknown): boolean {
    return parseCommandError(error).code === "TOOLS_STATE_REFRESH_PENDING";
  },
  cancelReminder,
  updateReminder,
  createActivityReminderRule,
  createReminder,
  disableActivityReminderRule,
  setActivityReminderEnabled,
  updateActivityReminderLimit,
  dismissToolAlert,
  resolveReminderAlert,
  extendActivityReminder,
  getToolAlerts,
  getToolsSnapshot,
  onToolAlert,
  onToolsRuntimeChanged,
  pausePomodoro,
  resetPomodoro,
  resumePomodoro,
  skipPomodoroPhase,
  startPomodoro,
};
