import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { listen as tauriListen, type Event } from "@tauri-apps/api/event";
import type {
  CreateReminderInput,
  CreateActivityReminderRuleInput,
  ActivityReminderExtension,
  ReminderDelayMinutes,
  ReminderRecurrence,
  StartPomodoroInput,
  PomodoroTaskAction,
  FreeFocusAction,
  ToolAlert,
  ToolsRuntimeSnapshot,
} from "../../shared/types/tools.ts";
import {
  parseToolAlert,
  parseToolAlerts,
  parseToolsRuntimeSnapshot,
} from "./toolsRawDtos.ts";

const TOOLS_RUNTIME_CHANGED_EVENT = "tools-runtime-changed";
const TOOLS_ALERT_EVENT = "tools-alert";

type ToolsInvoke = <T>(command: string, payload?: Record<string, unknown>) => Promise<T>;
type ToolsListen = <T>(
  eventName: string,
  handler: (event: Event<T>) => void,
) => Promise<() => void>;

interface ToolsRuntimeGatewayDeps {
  invoke: ToolsInvoke;
  listen: ToolsListen;
}

export function createToolsRuntimeGateway(deps: ToolsRuntimeGatewayDeps) {
  async function invokeToolsSnapshot(
    command: string,
    payload?: Record<string, unknown>,
  ): Promise<ToolsRuntimeSnapshot> {
    try {
      const response = await deps.invoke<unknown>(command, payload);
      return parseToolsRuntimeSnapshot(response);
    } catch (error) {
      if (typeof error === "string" && error.startsWith("TOOLS_STATE_REFRESH_PENDING: ")) {
        throw { code: "TOOLS_STATE_REFRESH_PENDING", message: error, retryable: false };
      }
      throw error;
    }
  }

  return {
    freeFocus(action: FreeFocusAction): Promise<ToolsRuntimeSnapshot> { return invokeToolsSnapshot("cmd_free_focus", { action }); },
    pomodoroTask(action: PomodoroTaskAction): Promise<ToolsRuntimeSnapshot> {
      return invokeToolsSnapshot("cmd_pomodoro_task", { action });
    },
    getToolsSnapshot(): Promise<ToolsRuntimeSnapshot> {
      return invokeToolsSnapshot("cmd_get_tools_snapshot");
    },

    async getToolAlerts(): Promise<ToolAlert[]> {
      const response = await deps.invoke<unknown>("cmd_get_tool_alerts");
      return parseToolAlerts(response);
    },

    dismissToolAlert(alertId: string): Promise<void> {
      return deps.invoke<void>("cmd_dismiss_tool_alert", { alertId });
    },

    resolveReminderAlert(alertId: string, delayMinutes: ReminderDelayMinutes | null): Promise<ToolsRuntimeSnapshot> {
      return invokeToolsSnapshot("cmd_resolve_reminder_alert", { alertId, delayMinutes });
    },

    extendActivityReminder(alertId: string, extension: ActivityReminderExtension): Promise<ToolsRuntimeSnapshot> {
      return invokeToolsSnapshot("cmd_extend_activity_reminder", { alertId, extension });
    },

    onToolAlert(
      handler: (alert: ToolAlert) => void,
    ): Promise<() => void> {
      return deps.listen<unknown>(TOOLS_ALERT_EVENT, (event) => {
        handler(parseToolAlert(event.payload));
      });
    },

    onToolsRuntimeChanged(
      handler: (snapshot: ToolsRuntimeSnapshot) => void,
    ): Promise<() => void> {
      return deps.listen<unknown>(TOOLS_RUNTIME_CHANGED_EVENT, (event) => {
        handler(parseToolsRuntimeSnapshot(event.payload));
      });
    },

    createReminder(input: CreateReminderInput): Promise<ToolsRuntimeSnapshot> {
      return invokeToolsSnapshot("cmd_create_reminder", {
        input: {
          label: input.label,
          scheduledAt: input.scheduledAt,
          recurrence: input.recurrence ?? null,
        },
      });
    },

    updateReminder(reminderId: number, label: string, scheduledAt: number, enabled: boolean, recurrence: ReminderRecurrence | null = null): Promise<ToolsRuntimeSnapshot> {
      return invokeToolsSnapshot("cmd_update_reminder", { reminderId, label, scheduledAt, enabled, recurrence });
    },

    cancelReminder(reminderId: number): Promise<ToolsRuntimeSnapshot> {
      return invokeToolsSnapshot("cmd_cancel_reminder", { reminderId });
    },

    createActivityReminderRule(input: CreateActivityReminderRuleInput): Promise<ToolsRuntimeSnapshot> {
      return invokeToolsSnapshot("cmd_create_activity_reminder_rule", {
        input: {
          target: input.target,
          labelSnapshot: input.labelSnapshot,
          limitMs: input.limitMs,
          message: input.message,
        },
      });
    },

    disableActivityReminderRule(ruleId: number): Promise<ToolsRuntimeSnapshot> {
      return invokeToolsSnapshot("cmd_disable_activity_reminder_rule", { ruleId });
    },

    setActivityReminderEnabled(ruleId: number, enabled: boolean): Promise<ToolsRuntimeSnapshot> {
      return invokeToolsSnapshot("cmd_set_activity_reminder_enabled", { ruleId, enabled });
    },

    updateActivityReminderLimit(ruleId: number, limitMs: number): Promise<ToolsRuntimeSnapshot> {
      return invokeToolsSnapshot("cmd_update_activity_reminder_limit", { ruleId, limitMs });
    },

    startPomodoro(input: StartPomodoroInput): Promise<ToolsRuntimeSnapshot> {
      return invokeToolsSnapshot("cmd_start_pomodoro", {
        input: {
          focusMs: input.focusMs,
          shortBreakMs: input.shortBreakMs,
          longBreakMs: input.longBreakMs,
          longBreakEvery: input.longBreakEvery,
        },
      });
    },

    pausePomodoro(): Promise<ToolsRuntimeSnapshot> {
      return invokeToolsSnapshot("cmd_pause_pomodoro");
    },

    resumePomodoro(): Promise<ToolsRuntimeSnapshot> {
      return invokeToolsSnapshot("cmd_resume_pomodoro");
    },

    skipPomodoroPhase(): Promise<ToolsRuntimeSnapshot> {
      return invokeToolsSnapshot("cmd_skip_pomodoro_phase");
    },

    resetPomodoro(): Promise<ToolsRuntimeSnapshot> {
      return invokeToolsSnapshot("cmd_reset_pomodoro");
    },
  };
}

const defaultToolsRuntimeGateway = createToolsRuntimeGateway({
  invoke: tauriInvoke,
  listen: tauriListen,
});

export const getToolsSnapshot = defaultToolsRuntimeGateway.getToolsSnapshot;
export const getToolAlerts = defaultToolsRuntimeGateway.getToolAlerts;
export const dismissToolAlert = defaultToolsRuntimeGateway.dismissToolAlert;
export const resolveReminderAlert = defaultToolsRuntimeGateway.resolveReminderAlert;
export const extendActivityReminder = defaultToolsRuntimeGateway.extendActivityReminder;
export const onToolAlert = defaultToolsRuntimeGateway.onToolAlert;
export const onToolsRuntimeChanged = defaultToolsRuntimeGateway.onToolsRuntimeChanged;
export const createReminder = defaultToolsRuntimeGateway.createReminder;
export const updateReminder = defaultToolsRuntimeGateway.updateReminder;
export const cancelReminder = defaultToolsRuntimeGateway.cancelReminder;
export const createActivityReminderRule = defaultToolsRuntimeGateway.createActivityReminderRule;
export const disableActivityReminderRule = defaultToolsRuntimeGateway.disableActivityReminderRule;
export const setActivityReminderEnabled = defaultToolsRuntimeGateway.setActivityReminderEnabled;
export const updateActivityReminderLimit = defaultToolsRuntimeGateway.updateActivityReminderLimit;
export const startPomodoro = defaultToolsRuntimeGateway.startPomodoro;
export const freeFocus = defaultToolsRuntimeGateway.freeFocus;
export const pomodoroTask = defaultToolsRuntimeGateway.pomodoroTask;
export const pausePomodoro = defaultToolsRuntimeGateway.pausePomodoro;
export const resumePomodoro = defaultToolsRuntimeGateway.resumePomodoro;
export const skipPomodoroPhase = defaultToolsRuntimeGateway.skipPomodoroPhase;
export const resetPomodoro = defaultToolsRuntimeGateway.resetPomodoro;
