import type { Locale } from "../../../shared/i18n/index.ts";
import { formatUsageDuration } from "./toolsLabels.ts";
import type {
  PomodoroPhase,
  ToolPomodoroRun,
  ToolReminder,
  ToolsRuntimeSnapshot,
} from "../../../shared/types/tools.ts";
import type {
  PomodoroViewModel,
  ReminderRowViewModel,
  ActivityReminderRuleRowViewModel,
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

export function buildReminderRows(snapshot: ToolsRuntimeSnapshot): ReminderRowViewModel[] {
  return snapshot.reminders.filter((reminder) => reminder.status !== "cancelled").map((reminder) => ({
    id: reminder.id,
    label: reminder.label,
    scheduledAt: reminder.scheduledAt,
    dueLabel: formatReminderDueLabel(reminder.scheduledAt),
    recurrence: reminder.recurrence,
    status: reminder.status,
  }));
}

export function buildActivityReminderRuleRows(
  snapshot: ToolsRuntimeSnapshot,
  locale: Locale,
): ActivityReminderRuleRowViewModel[] {
  return snapshot.activityReminderRules.map((rule) => {
    const limitMinutes = Math.max(1, Math.round(rule.limitMs / MS_PER_MINUTE));
    const targetLabel = rule.labelSnapshot
      || (rule.target.kind === "app"
        ? rule.target.appName
        : rule.target.kind === "category"
          ? rule.target.categoryId
          : rule.target.normalizedDomain);
    return {
      id: rule.id,
      enabled: rule.enabled,
      limitMinutes,
      kind: rule.target.kind,
      targetKey: rule.target.kind === "app"
        ? (rule.target.exeName ?? rule.target.appName)
        : rule.target.kind === "category"
          ? rule.target.categoryId
          : rule.target.normalizedDomain,
      targetLabel,
      exeName: rule.target.kind === "app" ? rule.target.exeName : null,
      limitLabel: formatUsageDuration(limitMinutes, locale),
      message: rule.message,
      suspensionReason: rule.suspensionReason,
    };
  });
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
