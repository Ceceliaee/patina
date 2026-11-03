export type ReminderRecurrence =
  | { kind: "interval"; minutes: number }
  | { kind: "daily" }
  | { kind: "monthly" }
  | { kind: "yearly" }
  | { kind: "weekly"; weekdays: number[] };
export type ReminderStatus = "scheduled" | "paused" | "pending_confirmation" | "fired" | "cancelled";
export type ReminderDelayMinutes = 5 | 15 | 30;
export type PomodoroPhase = "focus" | "short_break" | "long_break";
export type PomodoroStatus = "idle" | "running" | "paused" | "completed";
export type ToolAlertKind = "reminder" | "pomodoro" | "activity_reminder" | "free_focus";
export interface ToolRuntimeSettings {
  pomodoroFocusMinutes: number;
  pomodoroShortBreakMinutes: number;
  pomodoroLongBreakMinutes: number;
  pomodoroLongBreakEvery: number;
}

export interface ToolReminder {
  id: number;
  label: string;
  scheduledAt: number;
  createdAt: number;
  status: ReminderStatus;
  firedAt: number | null;
  cancelledAt: number | null;
  recurrence: ReminderRecurrence | null;
}

export type ActivityReminderTarget =
  | { kind: "app"; appName: string; exeName: string | null }
  | { kind: "category"; categoryId: string }
  | { kind: "web"; normalizedDomain: string };

type ActivityReminderSuspensionReason =
  | "source_disabled"
  | "target_excluded"
  | "target_deleted";

export interface ToolActivityReminderRule {
  id: number;
  enabled: boolean;
  target: ActivityReminderTarget;
  labelSnapshot: string;
  limitMs: number;
  message: string;
  createdAt: number;
  updatedAt: number;
  disabledAt: number | null;
  lastFiredDateKey: string | null;
  suspensionReason: ActivityReminderSuspensionReason | null;
}

export interface ActivityReminderAppCandidate {
  appName: string;
  exeName: string;
  lastSeenAt: number;
}

export interface ActivityReminderCategoryCandidate {
  categoryId: string;
  label: string;
  color: string;
}

export interface ActivityReminderWebCandidate {
  normalizedDomain: string;
  label: string;
  faviconUrl: string | null;
  lastSeenAt: number;
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
  freeFocusTasks: FreeFocusTask[];
  pomodoroTasks: ToolPomodoroTask[];
  settings: ToolRuntimeSettings;
  reminders: ToolReminder[];
  activityReminderRules: ToolActivityReminderRule[];
  currentPomodoro: ToolPomodoroRun | null;
  todayCompletedPomodoros: number;
  nextReminderAt: number | null;
  sampledAtMs: number;
}

export interface ToolAlert {
  freeFocus?: FreeFocusTask | null;
  id: string;
  kind: ToolAlertKind;
  title: string;
  body: string;
  occurredAt: number;
  activityReminder?: ActivityReminderAlert | null;
  pomodoro?: ToolPomodoroTask | null;
}

export type ActivityReminderExtension = "fifteen_minutes" | "one_hour" | "today";

export interface ActivityReminderAlert {
  ruleId: number;
  dateKey: string;
  target: ActivityReminderTarget;
  targetLabel: string;
  usageMs: number;
  limitMs: number;
  message: string;
}

export interface CreateReminderInput {
  recurrence?: ReminderRecurrence | null;
  label: string;
  scheduledAt: number;
}

export interface CreateActivityReminderRuleInput {
  target: ActivityReminderTarget;
  labelSnapshot: string;
  limitMs: number;
  message: string;
}


export interface StartPomodoroInput {
  focusMs: number;
  shortBreakMs: number;
  longBreakMs: number;
  longBreakEvery: number;
}

export interface ToolPomodoroTask {
  label: string;
  completedGroups: number;
  run: ToolPomodoroRun;
}

export type PomodoroTaskAction =
  | ({ kind: "save"; id: number | null; label: string } & StartPomodoroInput)
  | { kind: "start_next"; id: number; expectedUpdatedAt: number }
  | { kind: "resume" | "pause" | "skip" | "reset" | "delete"; id: number };

export interface FreeFocusSettings {
  restMode: "fixed" | "ratio";
  restMinutes: number;
  restRatio: number;
}
export interface FreeFocusTask extends FreeFocusSettings {
  id: number;
  label: string;
  phase: "focus" | "break";
  status: PomodoroStatus;
  elapsedMs: number;
  restRemainingMs: number;
  startedAt: number | null;
  createdAt: number;
  updatedAt: number;
}
export type FreeFocusAction =
  | ({ kind: "save"; id: number | null; label: string } & FreeFocusSettings)
  | { kind: "start_next"; id: number; expectedUpdatedAt: number }
  | { kind: "resume" | "pause" | "finish" | "reset" | "delete"; id: number };
