import type {
  PomodoroPhase,
  PomodoroStatus,
  ReminderStatus,
  TimerMode,
  TimerStatus,
  ToolPomodoroRun,
  ToolAlert,
  ToolAlertKind,
  ToolReminder,
  ToolRuntimeSettings,
  ToolSoftwareReminderRule,
  ToolsRuntimeSnapshot,
  ToolTimer,
  ToolTimerLap,
} from "../../shared/types/tools.ts";

type RawRecord = Record<string, unknown>;

interface RawToolRuntimeSettings {
  default_countdown_minutes: number;
  pomodoro_focus_minutes: number;
  pomodoro_short_break_minutes: number;
  pomodoro_long_break_minutes: number;
  pomodoro_long_break_every: number;
  reminder_snooze_minutes: number;
  pomodoro_snooze_minutes: number;
  countdown_snooze_minutes: number;
}

interface RawToolReminder {
  id: number;
  label: string;
  scheduled_at: number;
  created_at: number;
  status: ReminderStatus;
  fired_at: number | null;
  cancelled_at: number | null;
}

interface RawToolSoftwareReminderRule {
  id: number;
  app_name: string;
  exe_name: string | null;
  limit_ms: number;
  message: string;
  created_at: number;
  updated_at: number;
  disabled_at: number | null;
  last_fired_date_key: string | null;
}

interface RawToolTimer {
  id: number;
  mode: TimerMode;
  label: string | null;
  duration_ms: number | null;
  accumulated_ms: number;
  started_at: number | null;
  paused_at: number | null;
  completed_at: number | null;
  status: TimerStatus;
  created_at: number;
  updated_at: number;
}

interface RawToolTimerLap {
  id: number;
  timer_id: number;
  lap_index: number;
  started_at: number;
  ended_at: number;
  duration_ms: number;
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

interface RawToolAlert {
  id: string;
  kind: ToolAlertKind;
  title: string;
  body: string;
  occurred_at: number;
}

interface RawToolsRuntimeSnapshot {
  settings: RawToolRuntimeSettings;
  reminders: RawToolReminder[];
  software_reminder_rules: RawToolSoftwareReminderRule[];
  current_timer: RawToolTimer | null;
  timer_laps: RawToolTimerLap[];
  current_pomodoro: RawToolPomodoroRun | null;
  today_completed_pomodoros: number;
  next_reminder_at: number | null;
  sampled_at_ms: number;
}

const REMINDER_STATUSES = new Set(["scheduled", "fired", "cancelled"]);
const TIMER_MODES = new Set(["stopwatch", "countdown"]);
const TIMER_STATUSES = new Set(["idle", "running", "paused", "completed"]);
const POMODORO_PHASES = new Set(["focus", "short_break", "long_break"]);
const POMODORO_STATUSES = new Set(["idle", "running", "paused", "completed"]);
const TOOL_ALERT_KINDS = new Set(["reminder", "countdown", "pomodoro", "software_reminder"]);

function isRecord(value: unknown): value is RawRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNullableNumber(value: unknown): value is number | null {
  return value === null || isNumber(value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isStringEnum<T extends string>(value: unknown, allowed: ReadonlySet<string>): value is T {
  return typeof value === "string" && allowed.has(value);
}

function isRawToolRuntimeSettings(value: unknown): value is RawToolRuntimeSettings {
  if (!isRecord(value)) return false;
  return isNumber(value.default_countdown_minutes)
    && isNumber(value.pomodoro_focus_minutes)
    && isNumber(value.pomodoro_short_break_minutes)
    && isNumber(value.pomodoro_long_break_minutes)
    && isNumber(value.pomodoro_long_break_every)
    && isNumber(value.reminder_snooze_minutes)
    && isNumber(value.pomodoro_snooze_minutes)
    && isNumber(value.countdown_snooze_minutes);
}

function isRawToolReminder(value: unknown): value is RawToolReminder {
  if (!isRecord(value)) return false;
  return isNumber(value.id)
    && typeof value.label === "string"
    && isNumber(value.scheduled_at)
    && isNumber(value.created_at)
    && isStringEnum<ReminderStatus>(value.status, REMINDER_STATUSES)
    && isNullableNumber(value.fired_at)
    && isNullableNumber(value.cancelled_at);
}

function isRawToolSoftwareReminderRule(value: unknown): value is RawToolSoftwareReminderRule {
  if (!isRecord(value)) return false;
  return isNumber(value.id)
    && typeof value.app_name === "string"
    && isNullableString(value.exe_name)
    && isNumber(value.limit_ms)
    && typeof value.message === "string"
    && isNumber(value.created_at)
    && isNumber(value.updated_at)
    && isNullableNumber(value.disabled_at)
    && isNullableString(value.last_fired_date_key);
}

function isRawToolTimer(value: unknown): value is RawToolTimer {
  if (!isRecord(value)) return false;
  return isNumber(value.id)
    && isStringEnum<TimerMode>(value.mode, TIMER_MODES)
    && isNullableString(value.label)
    && isNullableNumber(value.duration_ms)
    && isNumber(value.accumulated_ms)
    && isNullableNumber(value.started_at)
    && isNullableNumber(value.paused_at)
    && isNullableNumber(value.completed_at)
    && isStringEnum<TimerStatus>(value.status, TIMER_STATUSES)
    && isNumber(value.created_at)
    && isNumber(value.updated_at);
}

function isRawToolTimerLap(value: unknown): value is RawToolTimerLap {
  if (!isRecord(value)) return false;
  return isNumber(value.id)
    && isNumber(value.timer_id)
    && isNumber(value.lap_index)
    && isNumber(value.started_at)
    && isNumber(value.ended_at)
    && isNumber(value.duration_ms);
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
  return isRawToolRuntimeSettings(value.settings)
    && Array.isArray(value.reminders)
    && value.reminders.every(isRawToolReminder)
    && Array.isArray(value.software_reminder_rules)
    && value.software_reminder_rules.every(isRawToolSoftwareReminderRule)
    && (value.current_timer === null || isRawToolTimer(value.current_timer))
    && Array.isArray(value.timer_laps)
    && value.timer_laps.every(isRawToolTimerLap)
    && (value.current_pomodoro === null || isRawToolPomodoroRun(value.current_pomodoro))
    && isNumber(value.today_completed_pomodoros)
    && isNullableNumber(value.next_reminder_at)
    && isNumber(value.sampled_at_ms);
}

function isRawToolAlert(value: unknown): value is RawToolAlert {
  if (!isRecord(value)) return false;
  return typeof value.id === "string"
    && isStringEnum<ToolAlertKind>(value.kind, TOOL_ALERT_KINDS)
    && typeof value.title === "string"
    && typeof value.body === "string"
    && isNumber(value.occurred_at);
}

function mapToolRuntimeSettings(raw: RawToolRuntimeSettings): ToolRuntimeSettings {
  return {
    defaultCountdownMinutes: raw.default_countdown_minutes,
    pomodoroFocusMinutes: raw.pomodoro_focus_minutes,
    pomodoroShortBreakMinutes: raw.pomodoro_short_break_minutes,
    pomodoroLongBreakMinutes: raw.pomodoro_long_break_minutes,
    pomodoroLongBreakEvery: raw.pomodoro_long_break_every,
    reminderSnoozeMinutes: raw.reminder_snooze_minutes,
    pomodoroSnoozeMinutes: raw.pomodoro_snooze_minutes,
    countdownSnoozeMinutes: raw.countdown_snooze_minutes,
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
  };
}

function mapToolSoftwareReminderRule(raw: RawToolSoftwareReminderRule): ToolSoftwareReminderRule {
  return {
    id: raw.id,
    appName: raw.app_name,
    exeName: raw.exe_name,
    limitMs: raw.limit_ms,
    message: raw.message,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
    disabledAt: raw.disabled_at,
    lastFiredDateKey: raw.last_fired_date_key,
  };
}

function mapToolTimer(raw: RawToolTimer): ToolTimer {
  return {
    id: raw.id,
    mode: raw.mode,
    label: raw.label,
    durationMs: raw.duration_ms,
    accumulatedMs: raw.accumulated_ms,
    startedAt: raw.started_at,
    pausedAt: raw.paused_at,
    completedAt: raw.completed_at,
    status: raw.status,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
  };
}

function mapToolTimerLap(raw: RawToolTimerLap): ToolTimerLap {
  return {
    id: raw.id,
    timerId: raw.timer_id,
    lapIndex: raw.lap_index,
    startedAt: raw.started_at,
    endedAt: raw.ended_at,
    durationMs: raw.duration_ms,
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
  return {
    id: raw.id,
    kind: raw.kind,
    title: raw.title,
    body: raw.body,
    occurredAt: raw.occurred_at,
  };
}

export function parseToolsRuntimeSnapshot(value: unknown): ToolsRuntimeSnapshot {
  if (!isRawToolsRuntimeSnapshot(value)) {
    throw new Error("Received invalid tools runtime snapshot payload");
  }

  return {
    settings: mapToolRuntimeSettings(value.settings),
    reminders: value.reminders.map(mapToolReminder),
    softwareReminderRules: value.software_reminder_rules.map(mapToolSoftwareReminderRule),
    currentTimer: value.current_timer ? mapToolTimer(value.current_timer) : null,
    timerLaps: value.timer_laps.map(mapToolTimerLap),
    currentPomodoro: value.current_pomodoro ? mapToolPomodoroRun(value.current_pomodoro) : null,
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
