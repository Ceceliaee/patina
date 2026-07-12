export type ReminderStatus = "scheduled" | "fired" | "cancelled";
export type TimerMode = "stopwatch" | "countdown";
export type TimerStatus = "idle" | "running" | "paused" | "completed";
export type PomodoroPhase = "focus" | "short_break" | "long_break";
export type PomodoroStatus = "idle" | "running" | "paused" | "completed";
export type ToolAlertKind = "reminder" | "countdown" | "pomodoro" | "software_reminder";

export interface ToolRuntimeSettings {
  defaultCountdownMinutes: number;
  pomodoroFocusMinutes: number;
  pomodoroShortBreakMinutes: number;
  pomodoroLongBreakMinutes: number;
  pomodoroLongBreakEvery: number;
  reminderSnoozeMinutes: number;
  pomodoroSnoozeMinutes: number;
  countdownSnoozeMinutes: number;
}

export interface ToolReminder {
  id: number;
  label: string;
  scheduledAt: number;
  createdAt: number;
  status: ReminderStatus;
  firedAt: number | null;
  cancelledAt: number | null;
}

export interface ToolSoftwareReminderRule {
  id: number;
  appName: string;
  exeName: string | null;
  limitMs: number;
  message: string;
  createdAt: number;
  updatedAt: number;
  disabledAt: number | null;
  lastFiredDateKey: string | null;
}

export interface ToolSoftwareReminderAppCandidate {
  appName: string;
  exeName: string;
  lastSeenAt: number;
}

export interface ToolTimer {
  id: number;
  mode: TimerMode;
  label: string | null;
  durationMs: number | null;
  accumulatedMs: number;
  startedAt: number | null;
  pausedAt: number | null;
  completedAt: number | null;
  status: TimerStatus;
  createdAt: number;
  updatedAt: number;
}

export interface ToolTimerLap {
  id: number;
  timerId: number;
  lapIndex: number;
  startedAt: number;
  endedAt: number;
  durationMs: number;
}

export interface ToolPomodoroRun {
  id: number;
  phase: PomodoroPhase;
  status: PomodoroStatus;
  cycleIndex: number;
  focusMs: number;
  shortBreakMs: number;
  longBreakMs: number;
  longBreakEvery: number;
  phaseStartedAt: number | null;
  phasePausedAt: number | null;
  phaseRemainingMs: number | null;
  completedFocusCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface ToolsRuntimeSnapshot {
  settings: ToolRuntimeSettings;
  reminders: ToolReminder[];
  softwareReminderRules: ToolSoftwareReminderRule[];
  currentTimer: ToolTimer | null;
  timerLaps: ToolTimerLap[];
  currentPomodoro: ToolPomodoroRun | null;
  todayCompletedPomodoros: number;
  nextReminderAt: number | null;
  sampledAtMs: number;
}

export interface ToolAlert {
  id: string;
  kind: ToolAlertKind;
  title: string;
  body: string;
  occurredAt: number;
}

export interface CreateReminderInput {
  label: string;
  scheduledAt: number;
}

export interface CreateSoftwareReminderRuleInput {
  appName: string;
  exeName?: string | null;
  limitMs: number;
  message: string;
}

export interface StartTimerInput {
  mode: TimerMode;
  durationMs?: number | null;
  label?: string | null;
}

export interface StartPomodoroInput {
  focusMs: number;
  shortBreakMs: number;
  longBreakMs: number;
  longBreakEvery: number;
}
