import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { listen as tauriListen, type Event } from "@tauri-apps/api/event";
import type {
  CreateReminderInput,
  CreateSoftwareReminderRuleInput,
  StartPomodoroInput,
  StartTimerInput,
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
    const response = await deps.invoke<unknown>(command, payload);
    return parseToolsRuntimeSnapshot(response);
  }

  return {
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
        },
      });
    },

    cancelReminder(reminderId: number): Promise<ToolsRuntimeSnapshot> {
      return invokeToolsSnapshot("cmd_cancel_reminder", { reminderId });
    },

    createSoftwareReminderRule(input: CreateSoftwareReminderRuleInput): Promise<ToolsRuntimeSnapshot> {
      return invokeToolsSnapshot("cmd_create_software_reminder_rule", {
        input: {
          appName: input.appName,
          exeName: input.exeName ?? null,
          limitMs: input.limitMs,
          message: input.message,
        },
      });
    },

    disableSoftwareReminderRule(ruleId: number): Promise<ToolsRuntimeSnapshot> {
      return invokeToolsSnapshot("cmd_disable_software_reminder_rule", { ruleId });
    },

    startTimer(input: StartTimerInput): Promise<ToolsRuntimeSnapshot> {
      return invokeToolsSnapshot("cmd_start_timer", {
        input: {
          mode: input.mode,
          durationMs: input.durationMs ?? null,
          label: input.label ?? null,
        },
      });
    },

    pauseTimer(): Promise<ToolsRuntimeSnapshot> {
      return invokeToolsSnapshot("cmd_pause_timer");
    },

    resumeTimer(): Promise<ToolsRuntimeSnapshot> {
      return invokeToolsSnapshot("cmd_resume_timer");
    },

    resetTimer(): Promise<ToolsRuntimeSnapshot> {
      return invokeToolsSnapshot("cmd_reset_timer");
    },

    addTimerLap(): Promise<ToolsRuntimeSnapshot> {
      return invokeToolsSnapshot("cmd_add_timer_lap");
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

    setReminderSnoozeMinutes(minutes: number): Promise<ToolsRuntimeSnapshot> {
      return invokeToolsSnapshot("cmd_set_reminder_snooze_minutes", { minutes });
    },

    setPomodoroSnoozeMinutes(minutes: number): Promise<ToolsRuntimeSnapshot> {
      return invokeToolsSnapshot("cmd_set_pomodoro_snooze_minutes", { minutes });
    },

    setCountdownSnoozeMinutes(minutes: number): Promise<ToolsRuntimeSnapshot> {
      return invokeToolsSnapshot("cmd_set_countdown_snooze_minutes", { minutes });
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
export const onToolAlert = defaultToolsRuntimeGateway.onToolAlert;
export const onToolsRuntimeChanged = defaultToolsRuntimeGateway.onToolsRuntimeChanged;
export const createReminder = defaultToolsRuntimeGateway.createReminder;
export const cancelReminder = defaultToolsRuntimeGateway.cancelReminder;
export const createSoftwareReminderRule = defaultToolsRuntimeGateway.createSoftwareReminderRule;
export const disableSoftwareReminderRule = defaultToolsRuntimeGateway.disableSoftwareReminderRule;
export const startTimer = defaultToolsRuntimeGateway.startTimer;
export const pauseTimer = defaultToolsRuntimeGateway.pauseTimer;
export const resumeTimer = defaultToolsRuntimeGateway.resumeTimer;
export const resetTimer = defaultToolsRuntimeGateway.resetTimer;
export const addTimerLap = defaultToolsRuntimeGateway.addTimerLap;
export const startPomodoro = defaultToolsRuntimeGateway.startPomodoro;
export const pausePomodoro = defaultToolsRuntimeGateway.pausePomodoro;
export const resumePomodoro = defaultToolsRuntimeGateway.resumePomodoro;
export const skipPomodoroPhase = defaultToolsRuntimeGateway.skipPomodoroPhase;
export const resetPomodoro = defaultToolsRuntimeGateway.resetPomodoro;
export const setReminderSnoozeMinutes = defaultToolsRuntimeGateway.setReminderSnoozeMinutes;
export const setPomodoroSnoozeMinutes = defaultToolsRuntimeGateway.setPomodoroSnoozeMinutes;
export const setCountdownSnoozeMinutes = defaultToolsRuntimeGateway.setCountdownSnoozeMinutes;
