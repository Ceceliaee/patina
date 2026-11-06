import { buildToolStatusEntries } from "./toolStatusEntries.ts";
import type { Locale } from "../../../shared/i18n/index.ts";
import { formatUsageDuration } from "./toolsLabels.ts";
import type {
  PomodoroPhase,
  ToolPomodoroRun,
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

export function formatCompactDuration(ms: number): string {
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
    remainingLabel: formatCompactDuration(run ? getPomodoroRemainingMs(run, nowMs) : snapshot.settings.pomodoroFocusMinutes * MS_PER_MINUTE),
    cycleLabel: labels.cycle(run?.cycleIndex ?? 1, run?.longBreakEvery ?? snapshot.settings.pomodoroLongBreakEvery),
    todayCompletedLabel: labels.completedToday(snapshot.todayCompletedPomodoros),
  };
}

export function earliestScheduledReminder(snapshot: ToolsRuntimeSnapshot) {
  let earliest: ToolsRuntimeSnapshot["reminders"][number] | null = null;
  for (const item of snapshot.reminders) {
    if (item.status === "scheduled" && (!earliest || item.scheduledAt < earliest.scheduledAt
      || (item.scheduledAt === earliest.scheduledAt && item.id < earliest.id))) earliest = item;
  }
  return earliest;
}

export function buildToolsStatusChipViewModels(
  snapshot: ToolsRuntimeSnapshot, nowMs: number, labels: ToolsViewModelLabels,
  reminder = earliestScheduledReminder(snapshot),
): ToolStatusChipViewModel[] {
  const run = snapshot.currentPomodoro;
  let updatedAt = run?.status === "running" ? run.updatedAt : -Infinity;
  let timer = run?.status === "running" ? {
    state: run.status, label: snapshot.pomodoroTasks.find(task => task.run.id === run.id)?.label ?? "",
    phase: run.phase, valueMs: getPomodoroRemainingMs(run, nowMs), countingUp: false,
  } : null;
  for (const free of snapshot.freeFocusTasks) {
    if (free.status !== "running" || free.updatedAt <= updatedAt) continue;
    updatedAt = free.updatedAt;
    const delta = Math.max(0, nowMs - (free.startedAt ?? nowMs));
    timer = { state: "running", label: free.label, phase: free.phase === "focus" ? "focus" : "short_break",
      valueMs: free.phase === "focus" ? free.elapsedMs + delta : Math.max(0, free.restRemainingMs - delta),
      countingUp: free.phase === "focus" };
  }
  return buildToolStatusEntries({ timer, reminder }, 0, nowMs, labels);
}
