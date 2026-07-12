import { useCallback, useEffect, useMemo, useState } from "react";
import { UI_TEXT, type UiText } from "../../../shared/copy/index.ts";
import type {
  StartPomodoroInput,
  TimerMode,
  ToolSoftwareReminderAppCandidate,
  ToolsRuntimeSnapshot,
} from "../../../shared/types/tools.ts";
import type {
  PomodoroViewModel,
  ReminderRowViewModel,
  SoftwareReminderRuleRowViewModel,
  TimerViewModel,
  ToolsSection,
} from "../types.ts";
import { ToolsRuntimeService } from "../services/toolsRuntimeService.ts";
import { toolsRuntimeSnapshotStore } from "../services/toolsRuntimeSnapshotStore.ts";
import { loadSoftwareReminderAppCandidates } from "../services/softwareReminderAppCandidates.ts";
import { buildToolsViewModelLabels } from "../services/toolsLabels.ts";
import {
  buildPomodoroViewModel,
  buildReminderRows,
  buildSoftwareReminderRuleRows,
  buildTimerViewModel,
} from "../services/toolsViewModel.ts";

const DEFAULT_SNAPSHOT: ToolsRuntimeSnapshot = {
  settings: {
    defaultCountdownMinutes: 25,
    pomodoroFocusMinutes: 25,
    pomodoroShortBreakMinutes: 5,
    pomodoroLongBreakMinutes: 15,
    pomodoroLongBreakEvery: 4,
    reminderSnoozeMinutes: 10,
    pomodoroSnoozeMinutes: 10,
    countdownSnoozeMinutes: 5,
  },
  reminders: [],
  softwareReminderRules: [],
  currentTimer: null,
  timerLaps: [],
  currentPomodoro: null,
  todayCompletedPomodoros: 0,
  nextReminderAt: null,
  sampledAtMs: Date.now(),
};

const EMPTY_REMINDER_ROWS: ReminderRowViewModel[] = [];
const EMPTY_SOFTWARE_REMINDER_RULE_ROWS: SoftwareReminderRuleRowViewModel[] = [];

export interface UseToolsPageStateOptions {
  activeSection?: ToolsSection;
  onError?: (message: string) => void;
  uiText?: UiText;
}

export function useToolsPageState({
  activeSection = "reminders",
  onError,
  uiText = UI_TEXT,
}: UseToolsPageStateOptions = {}) {
  const [initialSnapshot] = useState(() => toolsRuntimeSnapshotStore.getCurrentSnapshot());
  const [snapshot, setSnapshot] = useState<ToolsRuntimeSnapshot>(() => initialSnapshot ?? DEFAULT_SNAPSHOT);
  const [loading, setLoading] = useState(() => initialSnapshot === null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [softwareReminderAppCandidates, setSoftwareReminderAppCandidates] = useState<ToolSoftwareReminderAppCandidate[]>([]);
  const [softwareReminderAppCandidatesLoaded, setSoftwareReminderAppCandidatesLoaded] = useState(false);

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const unsubscribe = toolsRuntimeSnapshotStore.subscribe((nextSnapshot) => {
      if (!cancelled) {
        setSnapshot(nextSnapshot);
      }
    });

    void toolsRuntimeSnapshotStore.refreshSnapshot()
      .catch((error) => {
        console.warn("load tools snapshot failed", error);
        onError?.(UI_TEXT.tools.loadFailed);
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [onError]);

  useEffect(() => {
    if (activeSection !== "reminders" || softwareReminderAppCandidatesLoaded) {
      return undefined;
    }

    let cancelled = false;
    void loadSoftwareReminderAppCandidates()
      .then((candidates) => {
        if (!cancelled) {
          setSoftwareReminderAppCandidates(candidates);
          setSoftwareReminderAppCandidatesLoaded(true);
        }
      })
      .catch((error) => {
        console.warn("load software reminder app candidates failed", error);
      });

    return () => {
      cancelled = true;
    };
  }, [activeSection, softwareReminderAppCandidatesLoaded]);

  const labels = useMemo(() => buildToolsViewModelLabels(uiText), [uiText]);
  const inactiveTimerViewModel = useMemo<TimerViewModel>(
    () => buildTimerViewModel(DEFAULT_SNAPSHOT, DEFAULT_SNAPSHOT.sampledAtMs, labels),
    [labels],
  );
  const inactivePomodoroViewModel = useMemo<PomodoroViewModel>(
    () => buildPomodoroViewModel(DEFAULT_SNAPSHOT, DEFAULT_SNAPSHOT.sampledAtMs, labels),
    [labels],
  );
  const reminderRows = useMemo(
    () => activeSection === "reminders" ? buildReminderRows(snapshot, nowMs, labels) : EMPTY_REMINDER_ROWS,
    [activeSection, labels, nowMs, snapshot],
  );
  const softwareReminderRuleRows = useMemo(
    () => activeSection === "reminders"
      ? buildSoftwareReminderRuleRows(snapshot, labels)
      : EMPTY_SOFTWARE_REMINDER_RULE_ROWS,
    [activeSection, labels, snapshot],
  );
  const timerViewModel = useMemo(
    () => activeSection === "timer"
      ? buildTimerViewModel(snapshot, nowMs, labels)
      : inactiveTimerViewModel,
    [activeSection, inactiveTimerViewModel, labels, nowMs, snapshot],
  );
  const pomodoroViewModel = useMemo(
    () => activeSection === "pomodoro"
      ? buildPomodoroViewModel(snapshot, nowMs, labels)
      : inactivePomodoroViewModel,
    [activeSection, inactivePomodoroViewModel, labels, nowMs, snapshot],
  );

  const runAction = useCallback(async (
    actionKey: string,
    action: () => Promise<ToolsRuntimeSnapshot>,
  ) => {
    if (busyAction) return;
    setBusyAction(actionKey);
    try {
      const nextSnapshot = await action();
      toolsRuntimeSnapshotStore.publishSnapshot(nextSnapshot);
    } catch (error) {
      console.warn(`tools action failed: ${actionKey}`, error);
      onError?.(UI_TEXT.tools.actionFailed);
    } finally {
      setBusyAction(null);
    }
  }, [busyAction, onError]);

  const createReminder = useCallback((label: string, scheduledAt: number) => runAction(
    "create-reminder",
    () => ToolsRuntimeService.createReminder({ label, scheduledAt }),
  ), [runAction]);

  const cancelReminder = useCallback((id: number) => runAction(
    `cancel-reminder:${id}`,
    () => ToolsRuntimeService.cancelReminder(id),
  ), [runAction]);

  const createSoftwareReminderRule = useCallback((
    appName: string,
    exeName: string | null,
    limitMinutes: number,
    message: string,
  ) => runAction(
    "create-software-reminder",
    () => ToolsRuntimeService.createSoftwareReminderRule({
      appName,
      exeName,
      limitMs: Math.max(1, limitMinutes) * 60_000,
      message,
    }),
  ), [runAction]);

  const disableSoftwareReminderRule = useCallback((id: number) => runAction(
    `disable-software-reminder:${id}`,
    () => ToolsRuntimeService.disableSoftwareReminderRule(id),
  ), [runAction]);

  const startTimer = useCallback((mode: TimerMode, durationMinutes: number, label?: string) => runAction(
    "start-timer",
    () => ToolsRuntimeService.startTimer({
      mode,
      durationMs: mode === "countdown" ? Math.max(1, durationMinutes) * 60_000 : null,
      label: label ?? null,
    }),
  ), [runAction]);

  const pauseTimer = useCallback(() => runAction("pause-timer", ToolsRuntimeService.pauseTimer), [runAction]);
  const resumeTimer = useCallback(() => runAction("resume-timer", ToolsRuntimeService.resumeTimer), [runAction]);
  const resetTimer = useCallback(() => runAction("reset-timer", ToolsRuntimeService.resetTimer), [runAction]);
  const addTimerLap = useCallback(() => runAction("add-timer-lap", ToolsRuntimeService.addTimerLap), [runAction]);

  const startPomodoro = useCallback((input?: Partial<StartPomodoroInput>) => runAction(
    "start-pomodoro",
    () => ToolsRuntimeService.startPomodoro({
      focusMs: (input?.focusMs ?? snapshot.settings.pomodoroFocusMinutes * 60_000),
      shortBreakMs: (input?.shortBreakMs ?? snapshot.settings.pomodoroShortBreakMinutes * 60_000),
      longBreakMs: (input?.longBreakMs ?? snapshot.settings.pomodoroLongBreakMinutes * 60_000),
      longBreakEvery: input?.longBreakEvery ?? snapshot.settings.pomodoroLongBreakEvery,
    }),
  ), [runAction, snapshot.settings]);
  const pausePomodoro = useCallback(() => runAction("pause-pomodoro", ToolsRuntimeService.pausePomodoro), [runAction]);
  const resumePomodoro = useCallback(() => runAction("resume-pomodoro", ToolsRuntimeService.resumePomodoro), [runAction]);
  const skipPomodoroPhase = useCallback(
    () => runAction("skip-pomodoro-phase", ToolsRuntimeService.skipPomodoroPhase),
    [runAction],
  );
  const resetPomodoro = useCallback(() => runAction("reset-pomodoro", ToolsRuntimeService.resetPomodoro), [runAction]);

  return {
    loading,
    snapshot,
    nowMs,
    busyAction,
    softwareReminderAppCandidates,
    reminderRows,
    softwareReminderRuleRows,
    timerViewModel,
    pomodoroViewModel,
    createReminder,
    cancelReminder,
    createSoftwareReminderRule,
    disableSoftwareReminderRule,
    startTimer,
    pauseTimer,
    resumeTimer,
    resetTimer,
    addTimerLap,
    startPomodoro,
    pausePomodoro,
    resumePomodoro,
    skipPomodoroPhase,
    resetPomodoro,
  };
}
