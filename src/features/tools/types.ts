import type { PomodoroPhase, ReminderStatus, TimerMode, TimerStatus } from "../../shared/types/tools.ts";

export type ToolsSection = "reminders" | "timer" | "pomodoro";
type LegacyToolsSection = "timing";
type TimingMode = "reminder" | "timer";
type ToolsOpenTimingMode = TimingMode | TimerMode;
export type ReminderMode = "event" | "software";
export type ReminderFormMode = "relative" | "absolute";

export interface ToolsOpenTarget {
  section: ToolsSection | LegacyToolsSection;
  timingMode?: ToolsOpenTimingMode;
  timerMode?: TimerMode;
}

export interface ToolStatusChipViewModel {
  label: string;
  targetSection: ToolsSection;
  targetTimerMode?: TimerMode;
}

export interface ReminderRowViewModel {
  id: number;
  label: string;
  dueLabel: string;
  remainingLabel: string;
  status: ReminderStatus;
  canCancel: boolean;
}

export interface SoftwareReminderRuleRowViewModel {
  id: number;
  appLabel: string;
  exeName: string | null;
  limitLabel: string;
  message: string;
  statusLabel: string;
}

export interface TimerViewModel {
  mode: TimerMode;
  status: TimerStatus;
  displayTime: string;
  helperLabel: string;
}

export interface PomodoroViewModel {
  phase: PomodoroPhase;
  phaseLabel: string;
  remainingLabel: string;
  cycleLabel: string;
  todayCompletedLabel: string;
}

export interface ToolsViewModelLabels {
  timerIdle: string;
  timerRunning: string;
  timerPaused: string;
  timerCompleted: string;
  pomodoroFocus: string;
  pomodoroShortBreak: string;
  pomodoroLongBreak: string;
  chipFocus: string;
  chipBreak: string;
  chipCountdown: string;
  chipStopwatch: string;
  chipReminder: string;
  softwareReminderActive: string;
  softwareReminderDailyLimit: (minutes: number) => string;
  dueNow: string;
  completedToday: (count: number) => string;
  cycle: (index: number, every: number) => string;
}
