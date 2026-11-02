import type { ReminderRecurrence, ActivityReminderTarget, PomodoroPhase, ReminderStatus } from "../../shared/types/tools.ts";

export type ToolsSection = "reminders" | "pomodoro";
export type ReminderMode = "event" | "usage";
export type ReminderFormMode = "relative" | "absolute";

export interface ToolsOpenTarget {
  section: ToolsSection;
}

export interface ToolStatusChipViewModel {
  label: string;
  targetSection: ToolsSection;
}

export interface ReminderRowViewModel {
  id: number;
  label: string;
  dueLabel: string;
  scheduledAt: number;
  status: ReminderStatus;
  recurrence: ReminderRecurrence | null;
}

export interface ActivityReminderRuleRowViewModel {
  id: number;
  enabled: boolean;
  limitMinutes: number;
  kind: ActivityReminderTarget["kind"];
  targetKey: string;
  targetLabel: string;
  exeName: string | null;
  limitLabel: string;
  message: string;
  suspensionReason: "source_disabled" | "target_excluded" | "target_deleted" | null;
}


export interface PomodoroViewModel {
  phase: PomodoroPhase;
  phaseLabel: string;
  remainingLabel: string;
  cycleLabel: string;
  todayCompletedLabel: string;
}

export interface ToolsViewModelLabels {
  pomodoroFocus: string;
  pomodoroShortBreak: string;
  pomodoroLongBreak: string;
  chipFocus: string;
  chipBreak: string;
  chipReminder: string;
  completedToday: (count: number) => string;
  cycle: (index: number, every: number) => string;
}
