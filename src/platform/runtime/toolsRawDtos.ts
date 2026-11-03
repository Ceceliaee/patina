import type {
  PomodoroPhase,
  PomodoroStatus,
  ReminderStatus,
  ReminderRecurrence,
  ToolPomodoroRun,
  ToolAlert,
  ToolAlertKind,
  ActivityReminderTarget,
  ToolReminder,
  ToolRuntimeSettings,
  ToolActivityReminderRule,
  ToolsRuntimeSnapshot,
} from "../../shared/types/tools.ts";
import {
  isNullableString,
  isPlainRecord as isRecord,
} from "../../shared/lib/runtimeTypeGuards.ts";

import { isRawFreeFocusTask, mapFreeFocusTask, type RawFreeFocusTask } from "./freeFocusRawDto.ts";

interface RawToolRuntimeSettings {
  pomodoro_focus_minutes: number;
  pomodoro_short_break_minutes: number;
  pomodoro_long_break_minutes: number;
  pomodoro_long_break_every: number;
}

interface RawToolReminder {
  id: number;
  label: string;
  scheduled_at: number;
  created_at: number;
  status: ReminderStatus;
  fired_at: number | null;
  cancelled_at: number | null;
  recurrence?: ReminderRecurrence | null;
}

type RawActivityReminderTarget =
  | { kind: "app"; app_name: string; exe_name: string | null }
  | { kind: "category"; category_id: string }
  | { kind: "web"; normalized_domain: string };

interface RawToolActivityReminderRule {
  id: number;
  enabled: boolean;
  target: RawActivityReminderTarget;
  label_snapshot: string;
  limit_ms: number;
  message: string;
  created_at: number;
  updated_at: number;
  disabled_at: number | null;
  last_fired_date_key: string | null;
  suspension_reason: "source_disabled" | "target_excluded" | "target_deleted" | null;
}



interface RawToolPomodoroRun {
  id: number;
  phase: PomodoroPhase;
  status: PomodoroStatus;
  cycle_index: number;
  focus_ms: number;
  short_break_ms: number;
  long_break_ms: number;
  long_break_every: number;
  phase_started_at: number | null;
  phase_paused_at: number | null;
  phase_remaining_ms: number | null;
  completed_focus_count: number;
  created_at: number;
  updated_at: number;
}

interface RawToolPomodoroTask {
  label: string;
  completed_groups: number;
  run: RawToolPomodoroRun;
}

function isRawToolPomodoroTask(value: unknown): value is RawToolPomodoroTask {
  return isRecord(value) && typeof value.label === "string"
    && typeof value.completed_groups === "number" && Number.isSafeInteger(value.completed_groups) && value.completed_groups >= 0
    && isRawToolPomodoroRun(value.run);
}

function mapToolPomodoroTask(task: RawToolPomodoroTask) {
  return { label: task.label, completedGroups: task.completed_groups, run: mapToolPomodoroRun(task.run) };
}

interface RawToolAlert {
  free_focus?: RawFreeFocusTask | null;
  pomodoro?: RawToolPomodoroTask | null;
  id: string;
  kind: ToolAlertKind;
  title: string;
  body: string;
  occurred_at: number;
  activity_reminder?: {
    rule_id: number;
    date_key: string;
    target: RawActivityReminderTarget;
    target_label: string;
    usage_ms: number;
    limit_ms: number;
    message: string;
  } | null;
}

interface RawToolsRuntimeSnapshot {
  free_focus_tasks: RawFreeFocusTask[];
  pomodoro_tasks: RawToolPomodoroTask[];
  settings: RawToolRuntimeSettings;
  reminders: RawToolReminder[];
  activity_reminder_rules: RawToolActivityReminderRule[];
  current_pomodoro: RawToolPomodoroRun | null;
  today_completed_pomodoros: number;
  next_reminder_at: number | null;
  sampled_at_ms: number;
}

const REMINDER_STATUSES = new Set(["scheduled", "paused", "pending_confirmation", "fired", "cancelled"]);
const POMODORO_PHASES = new Set(["focus", "short_break", "long_break"]);
const POMODORO_STATUSES = new Set(["idle", "running", "paused", "completed"]);
const TOOL_ALERT_KINDS = new Set(["reminder", "pomodoro", "activity_reminder", "free_focus"]);
const ACTIVITY_REMINDER_SUSPENSION_REASONS = new Set([
  "source_disabled",
  "target_excluded",
  "target_deleted",
]);

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNullableNumber(value: unknown): value is number | null {
  return value === null || isNumber(value);
}

function isStringEnum<T extends string>(value: unknown, allowed: ReadonlySet<string>): value is T {
  return typeof value === "string" && allowed.has(value);
}

function isRawToolRuntimeSettings(value: unknown): value is RawToolRuntimeSettings {
  if (!isRecord(value)) return false;
  return isNumber(value.pomodoro_focus_minutes)
    && isNumber(value.pomodoro_short_break_minutes)
    && isNumber(value.pomodoro_long_break_minutes)
    && isNumber(value.pomodoro_long_break_every);
}

function isReminderRecurrence(value: unknown): value is ReminderRecurrence | null | undefined {
  if (value === null || value === undefined) return true;
  if (!isRecord(value)) return false;
  if (value.kind === "daily" || value.kind === "monthly" || value.kind === "yearly") return true;
  if (value.kind === "interval") return typeof value.minutes === "number"
    && Number.isInteger(value.minutes) && value.minutes >= 1 && value.minutes <= 86_400;
  if (value.kind === "weekly") return Array.isArray(value.weekdays) && value.weekdays.length > 0
    && value.weekdays.every((day) => Number.isInteger(day) && day >= 1 && day <= 7)
    && new Set(value.weekdays).size === value.weekdays.length;
  return false;
}

function isRawToolReminder(value: unknown): value is RawToolReminder {
  if (!isRecord(value)) return false;
  return isNumber(value.id)
    && typeof value.label === "string"
    && isReminderRecurrence(value.recurrence)
    && isNumber(value.scheduled_at)
    && isNumber(value.created_at)
    && isStringEnum<ReminderStatus>(value.status, REMINDER_STATUSES)
    && isNullableNumber(value.fired_at)
    && isNullableNumber(value.cancelled_at);
}

function isRawActivityReminderTarget(value: unknown): value is RawActivityReminderTarget {
  if (!isRecord(value) || typeof value.kind !== "string") return false;
  if (value.kind === "app") {
    return typeof value.app_name === "string" && isNullableString(value.exe_name);
  }
  if (value.kind === "category") {
    return typeof value.category_id === "string";
  }
  if (value.kind === "web") {
    return typeof value.normalized_domain === "string";
  }
  return false;
}

function isRawToolActivityReminderRule(value: unknown): value is RawToolActivityReminderRule {
  if (!isRecord(value)) return false;
  return isNumber(value.id)
    && typeof value.enabled === "boolean"
    && isRawActivityReminderTarget(value.target)
    && typeof value.label_snapshot === "string"
    && isNumber(value.limit_ms)
    && typeof value.message === "string"
    && isNumber(value.created_at)
    && isNumber(value.updated_at)
    && isNullableNumber(value.disabled_at)
    && isNullableString(value.last_fired_date_key)
    && (value.suspension_reason === null
      || isStringEnum(value.suspension_reason, ACTIVITY_REMINDER_SUSPENSION_REASONS));
}



function isRawToolPomodoroRun(value: unknown): value is RawToolPomodoroRun {
  if (!isRecord(value)) return false;
  return isNumber(value.id)
    && isStringEnum<PomodoroPhase>(value.phase, POMODORO_PHASES)
    && isStringEnum<PomodoroStatus>(value.status, POMODORO_STATUSES)
    && isNumber(value.cycle_index)
    && isNumber(value.focus_ms)
    && isNumber(value.short_break_ms)
    && isNumber(value.long_break_ms)
    && isNumber(value.long_break_every)
    && isNullableNumber(value.phase_started_at)
    && isNullableNumber(value.phase_paused_at)
    && isNullableNumber(value.phase_remaining_ms)
    && isNumber(value.completed_focus_count)
    && isNumber(value.created_at)
    && isNumber(value.updated_at);
}

function isRawToolsRuntimeSnapshot(value: unknown): value is RawToolsRuntimeSnapshot {
  if (!isRecord(value)) return false;
  return Array.isArray(value.free_focus_tasks) && value.free_focus_tasks.every(isRawFreeFocusTask)
    && isRawToolRuntimeSettings(value.settings)
    && Array.isArray(value.pomodoro_tasks)
    && value.pomodoro_tasks.every(isRawToolPomodoroTask)
    && Array.isArray(value.reminders)
    && value.reminders.every(isRawToolReminder)
    && Array.isArray(value.activity_reminder_rules)
    && value.activity_reminder_rules.every(isRawToolActivityReminderRule)
    && (value.current_pomodoro === null || isRawToolPomodoroRun(value.current_pomodoro))
    && isNumber(value.today_completed_pomodoros)
    && isNullableNumber(value.next_reminder_at)
    && isNumber(value.sampled_at_ms);
}

function isRawToolAlert(value: unknown): value is RawToolAlert {
  if (!isRecord(value)) return false;
  if (value.free_focus != null && (!isRawFreeFocusTask(value.free_focus) || value.kind !== "free_focus")) return false;
  if (value.pomodoro != null && (!isRawToolPomodoroTask(value.pomodoro) || value.kind !== "pomodoro")) return false;
  const details = value.activity_reminder;
  if (details != null && (!isRecord(details)
    || !isNumber(details.rule_id) || !Number.isSafeInteger(details.rule_id) || details.rule_id <= 0
    || typeof details.date_key !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(details.date_key)
    || !isRawActivityReminderTarget(details.target)
    || typeof details.target_label !== "string" || typeof details.message !== "string"
    || !isNumber(details.usage_ms) || details.usage_ms < 0
    || !isNumber(details.limit_ms) || details.limit_ms <= 0)) return false;
  return typeof value.id === "string"
    && isStringEnum<ToolAlertKind>(value.kind, TOOL_ALERT_KINDS)
    && typeof value.title === "string"
    && typeof value.body === "string"
    && isNumber(value.occurred_at);
}

function mapToolRuntimeSettings(raw: RawToolRuntimeSettings): ToolRuntimeSettings {
  return {
    pomodoroFocusMinutes: raw.pomodoro_focus_minutes,
    pomodoroShortBreakMinutes: raw.pomodoro_short_break_minutes,
    pomodoroLongBreakMinutes: raw.pomodoro_long_break_minutes,
    pomodoroLongBreakEvery: raw.pomodoro_long_break_every,
  };
}

function mapToolReminder(raw: RawToolReminder): ToolReminder {
  return {
    id: raw.id,
    label: raw.label,
    scheduledAt: raw.scheduled_at,
    createdAt: raw.created_at,
    status: raw.status,
    firedAt: raw.fired_at,
    cancelledAt: raw.cancelled_at,
    recurrence: raw.recurrence ?? null,
  };
}

function mapActivityReminderTarget(raw: RawActivityReminderTarget): ActivityReminderTarget {
  if (raw.kind === "app") {
    return { kind: "app", appName: raw.app_name, exeName: raw.exe_name };
  }
  if (raw.kind === "category") {
    return { kind: "category", categoryId: raw.category_id };
  }
  return { kind: "web", normalizedDomain: raw.normalized_domain };
}

function mapToolActivityReminderRule(raw: RawToolActivityReminderRule): ToolActivityReminderRule {
  return {
    id: raw.id,
    enabled: raw.enabled,
    target: mapActivityReminderTarget(raw.target),
    labelSnapshot: raw.label_snapshot,
    limitMs: raw.limit_ms,
    message: raw.message,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
    disabledAt: raw.disabled_at,
    lastFiredDateKey: raw.last_fired_date_key,
    suspensionReason: raw.suspension_reason,
  };
}



function mapToolPomodoroRun(raw: RawToolPomodoroRun): ToolPomodoroRun {
  return {
    id: raw.id,
    phase: raw.phase,
    status: raw.status,
    cycleIndex: raw.cycle_index,
    focusMs: raw.focus_ms,
    shortBreakMs: raw.short_break_ms,
    longBreakMs: raw.long_break_ms,
    longBreakEvery: raw.long_break_every,
    phaseStartedAt: raw.phase_started_at,
    phasePausedAt: raw.phase_paused_at,
    phaseRemainingMs: raw.phase_remaining_ms,
    completedFocusCount: raw.completed_focus_count,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
  };
}

function mapToolAlert(raw: RawToolAlert): ToolAlert {
  const details = raw.activity_reminder;
  return {
    freeFocus: raw.free_focus ? mapFreeFocusTask(raw.free_focus) : null,
    id: raw.id,
    kind: raw.kind,
    title: raw.title,
    body: raw.body,
    occurredAt: raw.occurred_at,
    ...(raw.pomodoro ? { pomodoro: mapToolPomodoroTask(raw.pomodoro) } : {}),
    ...(details ? { activityReminder: {
      ruleId: details.rule_id,
      dateKey: details.date_key,
      target: mapActivityReminderTarget(details.target),
      targetLabel: details.target_label,
      usageMs: details.usage_ms,
      limitMs: details.limit_ms,
      message: details.message,
    } } : {}),
  };
}

export function parseToolsRuntimeSnapshot(value: unknown): ToolsRuntimeSnapshot {
  if (!isRawToolsRuntimeSnapshot(value)) {
    throw new Error("Received invalid tools runtime snapshot payload");
  }

  return {
    freeFocusTasks: value.free_focus_tasks.map(mapFreeFocusTask),
    settings: mapToolRuntimeSettings(value.settings),
    reminders: value.reminders.map(mapToolReminder),
    activityReminderRules: value.activity_reminder_rules.map(mapToolActivityReminderRule),
    currentPomodoro: value.current_pomodoro ? mapToolPomodoroRun(value.current_pomodoro) : null,
    pomodoroTasks: value.pomodoro_tasks.map(mapToolPomodoroTask),
    todayCompletedPomodoros: value.today_completed_pomodoros,
    nextReminderAt: value.next_reminder_at,
    sampledAtMs: value.sampled_at_ms,
  };
}

export function parseToolAlert(value: unknown): ToolAlert {
  if (!isRawToolAlert(value)) {
    throw new Error("Received invalid tool alert payload");
  }

  return mapToolAlert(value);
}

export function parseToolAlerts(value: unknown): ToolAlert[] {
  if (!Array.isArray(value) || !value.every(isRawToolAlert)) {
    throw new Error("Received invalid tool alerts payload");
  }

  return value.map(mapToolAlert);
}
