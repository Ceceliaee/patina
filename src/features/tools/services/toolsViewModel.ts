import type {
  PomodoroPhase,
  ToolSoftwareReminderRule,
  ToolPomodoroRun,
  ToolReminder,
  ToolsRuntimeSnapshot,
  ToolTimer,
} from "../../../shared/types/tools.ts";
import { AppClassification } from "../../../shared/classification/appClassification.ts";
import type {
  PomodoroViewModel,
  ReminderRowViewModel,
  SoftwareReminderRuleRowViewModel,
  TimerViewModel,
  ToolStatusChipViewModel,
  ToolsViewModelLabels,
} from "../types.ts";

const MS_PER_SECOND = 1_000;
const MS_PER_MINUTE = 60 * MS_PER_SECOND;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;

function pad2(value: number) {
  return String(Math.max(0, Math.floor(value))).padStart(2, "0");
}

export function formatHms(ms: number): string {
  const safeMs = Math.max(0, ms);
  const hours = Math.floor(safeMs / MS_PER_HOUR);
  const minutes = Math.floor((safeMs % MS_PER_HOUR) / MS_PER_MINUTE);
  const seconds = Math.floor((safeMs % MS_PER_MINUTE) / MS_PER_SECOND);
  return `${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}`;
}

function formatCompactDuration(ms: number): string {
  const safeMs = Math.max(0, ms);
  if (safeMs >= MS_PER_HOUR) {
    return formatHms(safeMs);
  }
  const minutes = Math.floor(safeMs / MS_PER_MINUTE);
  const seconds = Math.floor((safeMs % MS_PER_MINUTE) / MS_PER_SECOND);
  return `${pad2(minutes)}:${pad2(seconds)}`;
}

function getTimerElapsedMs(timer: ToolTimer, nowMs: number): number {
  const runningDelta = timer.status === "running" && timer.startedAt !== null
    ? Math.max(0, nowMs - timer.startedAt)
    : 0;
  return Math.max(0, timer.accumulatedMs + runningDelta);
}

function getTimerRemainingMs(timer: ToolTimer, nowMs: number): number {
  const durationMs = timer.durationMs ?? 0;
  return Math.max(0, durationMs - getTimerElapsedMs(timer, nowMs));
}

function getPomodoroRemainingMs(run: ToolPomodoroRun, nowMs: number): number {
  const phaseDuration = getPomodoroPhaseDurationMs(run);
  const baseRemaining = run.phaseRemainingMs ?? phaseDuration;
  if (run.status !== "running" || run.phaseStartedAt === null) {
    return Math.max(0, baseRemaining);
  }
  return Math.max(0, baseRemaining - Math.max(0, nowMs - run.phaseStartedAt));
}

function getPomodoroPhaseDurationMs(run: ToolPomodoroRun): number {
  if (run.phase === "short_break") return run.shortBreakMs;
  if (run.phase === "long_break") return run.longBreakMs;
  return run.focusMs;
}

function formatReminderDueLabel(timestampMs: number) {
  return new Date(timestampMs).toLocaleString(undefined, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatReminderClock(timestampMs: number) {
  return new Date(timestampMs).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function buildReminderRows(
  snapshot: ToolsRuntimeSnapshot,
  nowMs: number,
  labels: Pick<ToolsViewModelLabels, "dueNow">,
): ReminderRowViewModel[] {
  return snapshot.reminders.filter((reminder) => reminder.status === "scheduled").map((reminder) => {
    const remainingMs = reminder.scheduledAt - nowMs;
    return {
      id: reminder.id,
      label: reminder.label,
      dueLabel: formatReminderDueLabel(reminder.scheduledAt),
      remainingLabel: remainingMs <= 0 ? labels.dueNow : formatCompactDuration(remainingMs),
      status: reminder.status,
      canCancel: reminder.status === "scheduled",
    };
  });
}

function formatSoftwareReminderAppLabel(rule: ToolSoftwareReminderRule): string {
  if (!rule.exeName) {
    return rule.appName;
  }

  const mapped = AppClassification.mapApp(rule.exeName, { appName: rule.appName });
  const appName = mapped.name.trim() || rule.appName;
  return appName;
}

export function buildSoftwareReminderRuleRows(
  snapshot: ToolsRuntimeSnapshot,
  labels: Pick<ToolsViewModelLabels, "softwareReminderActive" | "softwareReminderDailyLimit">,
): SoftwareReminderRuleRowViewModel[] {
  return snapshot.softwareReminderRules.map((rule) => ({
    id: rule.id,
    appLabel: formatSoftwareReminderAppLabel(rule),
    exeName: rule.exeName,
    limitLabel: labels.softwareReminderDailyLimit(Math.max(1, Math.round(rule.limitMs / MS_PER_MINUTE))),
    message: rule.message,
    statusLabel: labels.softwareReminderActive,
  }));
}

export function buildTimerViewModel(
  snapshot: ToolsRuntimeSnapshot,
  nowMs: number,
  labels: Pick<ToolsViewModelLabels, "timerIdle" | "timerRunning" | "timerPaused" | "timerCompleted">,
): TimerViewModel {
  const timer = snapshot.currentTimer;
  const mode = timer?.mode ?? "stopwatch";
  const status = timer?.status ?? "idle";
  const displayTime = !timer
    ? formatHms(0)
    : timer.mode === "countdown"
      ? formatHms(getTimerRemainingMs(timer, nowMs))
      : formatHms(getTimerElapsedMs(timer, nowMs));
  const helperLabel = status === "running"
    ? labels.timerRunning
    : status === "paused"
      ? labels.timerPaused
      : status === "completed"
        ? labels.timerCompleted
        : labels.timerIdle;

  return {
    mode,
    status,
    displayTime,
    helperLabel,
  };
}

function pomodoroPhaseLabel(phase: PomodoroPhase, labels: ToolsViewModelLabels): string {
  if (phase === "short_break") return labels.pomodoroShortBreak;
  if (phase === "long_break") return labels.pomodoroLongBreak;
  return labels.pomodoroFocus;
}

export function buildPomodoroViewModel(
  snapshot: ToolsRuntimeSnapshot,
  nowMs: number,
  labels: ToolsViewModelLabels,
): PomodoroViewModel {
  const run = snapshot.currentPomodoro;
  const phase = run?.phase ?? "focus";

  return {
    phase,
    phaseLabel: pomodoroPhaseLabel(phase, labels),
    remainingLabel: formatHms(run ? getPomodoroRemainingMs(run, nowMs) : snapshot.settings.pomodoroFocusMinutes * MS_PER_MINUTE),
    cycleLabel: labels.cycle(run?.cycleIndex ?? 1, run?.longBreakEvery ?? snapshot.settings.pomodoroLongBreakEvery),
    todayCompletedLabel: labels.completedToday(snapshot.todayCompletedPomodoros),
  };
}

export function buildToolsStatusChipViewModel(
  snapshot: ToolsRuntimeSnapshot,
  nowMs: number,
  labels: ToolsViewModelLabels,
): ToolStatusChipViewModel | null {
  return buildToolsStatusChipViewModels(snapshot, nowMs, labels)[0] ?? null;
}

type SortableToolStatusChipViewModel = ToolStatusChipViewModel & {
  sortIndex: number;
  sortStartedAtMs: number;
};

function resolveNextReminderSortStartedAt(
  reminders: readonly ToolReminder[],
  nextReminderAt: number,
): number {
  let matchingReminder: ToolReminder | null = null;

  for (const reminder of reminders) {
    if (reminder.status !== "scheduled" || reminder.scheduledAt !== nextReminderAt) {
      continue;
    }

    if (
      !matchingReminder
      || reminder.createdAt < matchingReminder.createdAt
      || (reminder.createdAt === matchingReminder.createdAt && reminder.id < matchingReminder.id)
    ) {
      matchingReminder = reminder;
    }
  }

  return matchingReminder?.createdAt ?? nextReminderAt;
}

function sortStatusChipsByArrival(
  chips: SortableToolStatusChipViewModel[],
): ToolStatusChipViewModel[] {
  return chips
    .sort((left, right) => (
      left.sortStartedAtMs - right.sortStartedAtMs
      || left.sortIndex - right.sortIndex
    ))
    .map(({ sortStartedAtMs: _sortStartedAtMs, sortIndex: _sortIndex, ...chip }) => chip);
}

export function buildToolsStatusChipViewModels(
  snapshot: ToolsRuntimeSnapshot,
  nowMs: number,
  labels: ToolsViewModelLabels,
): ToolStatusChipViewModel[] {
  const chips: SortableToolStatusChipViewModel[] = [];
  let sortIndex = 0;
  const pomodoro = snapshot.currentPomodoro;
  if (pomodoro?.status === "running") {
    const phaseLabel = pomodoro.phase === "focus" ? labels.chipFocus : labels.chipBreak;
    chips.push({
      label: `${phaseLabel} ${formatCompactDuration(getPomodoroRemainingMs(pomodoro, nowMs))}`,
      targetSection: "pomodoro",
      sortIndex: sortIndex++,
      sortStartedAtMs: pomodoro.phaseStartedAt ?? pomodoro.createdAt,
    });
  }

  const timer = snapshot.currentTimer;
  if (timer?.status === "running") {
    if (timer.mode === "countdown") {
      chips.push({
        label: `${labels.chipCountdown} ${formatCompactDuration(getTimerRemainingMs(timer, nowMs))}`,
        targetSection: "timer",
        targetTimerMode: "countdown",
        sortIndex: sortIndex++,
        sortStartedAtMs: timer.startedAt ?? timer.createdAt,
      });
    } else {
      chips.push({
        label: `${labels.chipStopwatch} ${formatCompactDuration(getTimerElapsedMs(timer, nowMs))}`,
        targetSection: "timer",
        targetTimerMode: "stopwatch",
        sortIndex: sortIndex++,
        sortStartedAtMs: timer.startedAt ?? timer.createdAt,
      });
    }
  }

  if (snapshot.nextReminderAt !== null) {
    chips.push({
      label: `${labels.chipReminder} ${formatReminderClock(snapshot.nextReminderAt)}`,
      targetSection: "reminders",
      sortIndex: sortIndex++,
      sortStartedAtMs: resolveNextReminderSortStartedAt(snapshot.reminders, snapshot.nextReminderAt),
    });
  }

  return sortStatusChipsByArrival(chips);
}
