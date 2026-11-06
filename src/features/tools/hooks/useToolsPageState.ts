import type { ReminderRecurrence } from "../../../shared/types/tools.ts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocale, type UiText } from "../../../shared/i18n/index.ts";
import type {
  PomodoroTaskAction,
  FreeFocusAction,
  ActivityReminderTarget,
  ActivityReminderAppCandidate,
  ActivityReminderCategoryCandidate,
  ActivityReminderWebCandidate,
  ToolsRuntimeSnapshot,
} from "../../../shared/types/tools.ts";
import type {
  ReminderRowViewModel,
  ActivityReminderRuleRowViewModel,
  ToolsSection,
} from "../types.ts";
import { ToolsRuntimeService } from "../services/toolsRuntimeService.ts";
import { toolsRuntimeSnapshotStore } from "../services/toolsRuntimeSnapshotStore.ts";
import {
  loadActivityReminderAppCandidates,
  loadActivityReminderCategoryCandidates,
  loadActivityReminderWebCandidates,
  subscribeActivityReminderTargetCandidateInvalidation,
} from "../services/activityReminderTargetCandidates.ts";
import {
  buildReminderRows,
  buildActivityReminderRuleRows,
} from "../services/toolsViewModel.ts";

const DEFAULT_SNAPSHOT: ToolsRuntimeSnapshot = {
  pomodoroTasks: [],
  freeFocusTasks: [],
  settings: {
    pomodoroFocusMinutes: 25,
    pomodoroShortBreakMinutes: 5,
    pomodoroLongBreakMinutes: 15,
    pomodoroLongBreakEvery: 4,
  },
  reminders: [],
  activityReminderRules: [],
  currentPomodoro: null,
  todayCompletedPomodoros: 0,
  nextReminderAt: null,
  sampledAtMs: Date.now(),
};

const EMPTY_REMINDER_ROWS: ReminderRowViewModel[] = [];
const EMPTY_ACTIVITY_REMINDER_RULE_ROWS: ActivityReminderRuleRowViewModel[] = [];
type ActivityCandidateMode = "app" | "category" | "web";
type CandidateLoadState = "idle" | "loading" | "ready" | "error";

interface UseToolsPageStateOptions {
  activeSection?: ToolsSection;
  onError?: (message: string) => void;
  uiText: UiText;
}

export function useToolsPageState({
  activeSection = "reminders",
  onError,
  uiText,
}: UseToolsPageStateOptions) {
  const locale = useLocale();
  const [initialSnapshot] = useState(() => toolsRuntimeSnapshotStore.getCurrentSnapshot());
  const [snapshot, setSnapshot] = useState<ToolsRuntimeSnapshot>(() => initialSnapshot ?? DEFAULT_SNAPSHOT);
  const [hasSnapshot, setHasSnapshot] = useState(() => initialSnapshot !== null);
  const [loadError, setLoadError] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const actionInFlightRef = useRef(false);
  const [activityReminderAppCandidates, setActivityReminderAppCandidates] = useState<ActivityReminderAppCandidate[]>([]);
  const [activityReminderCategoryCandidates, setActivityReminderCategoryCandidates] = useState<ActivityReminderCategoryCandidate[]>([]);
  const [activityReminderWebCandidates, setActivityReminderWebCandidates] = useState<ActivityReminderWebCandidate[]>([]);
  const [candidateRevision, setCandidateRevision] = useState(0);
  const [activityReminderCandidateLoadState, setActivityReminderCandidateLoadState] = useState<
    Record<ActivityCandidateMode, CandidateLoadState>
  >({ app: "idle", category: "idle", web: "idle" });
  const loadedCandidateModesRef = useRef(new Map<ActivityCandidateMode, UiText>());
  const candidateRequestIdsRef = useRef({ app: 0, category: 0, web: 0 });
  const mountedRef = useRef(true);
  const refreshRequestRef = useRef(0);

  useEffect(() => {
    if (activeSection !== "pomodoro" || (snapshot.currentPomodoro?.status !== "running" && !snapshot.freeFocusTasks.some(task => task.status === "running"))) return;
    setNowMs(Date.now());
    const timer = window.setInterval(() => setNowMs(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [activeSection, snapshot.currentPomodoro, snapshot.freeFocusTasks]);

  const refreshSnapshot = useCallback(async () => {
    const requestId = ++refreshRequestRef.current;
    const isCold = toolsRuntimeSnapshotStore.getCurrentSnapshot() === null;
    if (isCold && mountedRef.current) {
      setLoadError(false);
    }

    try {
      await toolsRuntimeSnapshotStore.refreshSnapshot();
    } catch (error) {
      console.warn("load tools snapshot failed", error);
      if (!mountedRef.current || refreshRequestRef.current !== requestId) return;
      if (toolsRuntimeSnapshotStore.getCurrentSnapshot() === null) {
        setLoadError(true);
      } else {
        onError?.(uiText.tools.loadFailed);
      }
    }
  }, [onError, uiText]);

  useEffect(() => {
    mountedRef.current = true;
    let cancelled = false;
    const unsubscribe = toolsRuntimeSnapshotStore.subscribe((nextSnapshot) => {
      if (!cancelled) {
        setSnapshot(nextSnapshot);
        setHasSnapshot(true);
        setLoadError(false);
      }
    });

    void refreshSnapshot();

    return () => {
      mountedRef.current = false;
      refreshRequestRef.current += 1;
      cancelled = true;
      unsubscribe();
    };
  }, [refreshSnapshot]);

  useEffect(() => subscribeActivityReminderTargetCandidateInvalidation(() => {
    loadedCandidateModesRef.current.clear();
    candidateRequestIdsRef.current.app += 1;
    candidateRequestIdsRef.current.category += 1;
    candidateRequestIdsRef.current.web += 1;
    setActivityReminderCandidateLoadState({ app: "idle", category: "idle", web: "idle" });
    setCandidateRevision((current) => current + 1);
  }), []);

  const activateActivityReminderMode = useCallback(async (mode: ActivityCandidateMode) => {
    if (loadedCandidateModesRef.current.has(mode)
      && (mode !== "category" || loadedCandidateModesRef.current.get(mode) === uiText)) return;
    const requestId = candidateRequestIdsRef.current[mode] + 1;
    candidateRequestIdsRef.current[mode] = requestId;
    setActivityReminderCandidateLoadState((current) => ({ ...current, [mode]: "loading" }));
    try {
      if (mode === "app") {
        const candidates = await loadActivityReminderAppCandidates();
        if (candidateRequestIdsRef.current.app !== requestId || !mountedRef.current) return;
        setActivityReminderAppCandidates(candidates);
      } else if (mode === "category") {
        const candidates = await loadActivityReminderCategoryCandidates(uiText);
        if (candidateRequestIdsRef.current.category !== requestId || !mountedRef.current) return;
        setActivityReminderCategoryCandidates(candidates);
      } else {
        const candidates = await loadActivityReminderWebCandidates();
        if (candidateRequestIdsRef.current.web !== requestId || !mountedRef.current) return;
        setActivityReminderWebCandidates(candidates);
      }
      loadedCandidateModesRef.current.set(mode, uiText);
      setActivityReminderCandidateLoadState((current) => ({ ...current, [mode]: "ready" }));
    } catch (error) {
      console.warn(`load ${mode} activity reminder candidates failed`, error);
      if (candidateRequestIdsRef.current[mode] === requestId && mountedRef.current) {
        setActivityReminderCandidateLoadState((current) => ({ ...current, [mode]: "error" }));
      }
    }
  }, [uiText]);

  const retryActivityReminderCandidates = useCallback((mode: ActivityCandidateMode) => {
    loadedCandidateModesRef.current.delete(mode);
    void activateActivityReminderMode(mode);
  }, [activateActivityReminderMode]);


  const reminderRows = useMemo(
    () => activeSection === "reminders" ? buildReminderRows(snapshot) : EMPTY_REMINDER_ROWS,
    [activeSection, snapshot],
  );
  const activityReminderRuleRows = useMemo(
    () => activeSection === "reminders"
      ? buildActivityReminderRuleRows(snapshot, locale)
      : EMPTY_ACTIVITY_REMINDER_RULE_ROWS,
    [activeSection, locale, snapshot],
  );


  const executeAction = useCallback(async (
    actionKey: string,
    action: () => Promise<ToolsRuntimeSnapshot>,
  ) => {
    if (actionInFlightRef.current) return false;
    actionInFlightRef.current = true;
    setBusyAction(actionKey);
    try {
      const nextSnapshot = await action();
      toolsRuntimeSnapshotStore.publishSnapshot(nextSnapshot);
      return true;
    } catch (error) {
      console.warn(`tools action failed: ${actionKey}`, error);
      onError?.(ToolsRuntimeService.isStateRefreshPendingError(error)
        ? uiText.tools.stateRefreshPending
        : uiText.tools.actionFailed);
      return false;
    } finally {
      actionInFlightRef.current = false;
      setBusyAction(null);
    }
  }, [onError, uiText]);

  const runAction = useCallback(async (
    actionKey: string,
    action: () => Promise<ToolsRuntimeSnapshot>,
  ) => {
    await executeAction(actionKey, action);
  }, [executeAction]);

  const createReminder = useCallback((label: string, scheduledAt: number, recurrence: ReminderRecurrence | null) => executeAction(
    "create-reminder",
    () => ToolsRuntimeService.createReminder({ label, scheduledAt, recurrence }),
  ), [executeAction]);

  const updateReminder = useCallback((id: number, label: string, scheduledAt: number, enabled: boolean, recurrence: ReminderRecurrence | null) => executeAction(
    `update-reminder:${id}`,
    () => ToolsRuntimeService.updateReminder(id, label, scheduledAt, enabled, recurrence),
  ), [executeAction]);

  const cancelReminder = useCallback((id: number) => runAction(
    `cancel-reminder:${id}`,
    () => ToolsRuntimeService.cancelReminder(id),
  ), [runAction]);

  const createActivityReminderRule = useCallback((
    target: ActivityReminderTarget,
    labelSnapshot: string,
    limitMinutes: number,
    message: string,
  ) => executeAction(
    "create-activity-reminder",
    () => ToolsRuntimeService.createActivityReminderRule({
      target,
      labelSnapshot,
      limitMs: Math.max(1, limitMinutes) * 60_000,
      message,
    }),
  ), [executeAction]);

  const setActivityReminderEnabled = useCallback((id: number, enabled: boolean) => runAction(
    `toggle-activity-reminder:${id}`,
    () => ToolsRuntimeService.setActivityReminderEnabled(id, enabled),
  ), [runAction]);

  const updateActivityReminderLimit = useCallback((id: number, limitMinutes: number) => executeAction(
    `update-activity-reminder:${id}`,
    () => ToolsRuntimeService.updateActivityReminderLimit(id, limitMinutes * 60_000),
  ), [executeAction]);

  const disableActivityReminderRule = useCallback((id: number) => runAction(
    `disable-activity-reminder:${id}`,
    () => ToolsRuntimeService.disableActivityReminderRule(id),
  ), [runAction]);



  return {
    freeFocus: (action: FreeFocusAction) => executeAction(`free-focus:${action.kind}:${action.id ?? "new"}`, () => ToolsRuntimeService.freeFocus(action)),
    pomodoroTask: (action: PomodoroTaskAction) => executeAction(`pomodoro-task:${action.kind}:${action.id ?? "new"}`, () => ToolsRuntimeService.pomodoroTask(action)),
    hasSnapshot,
    loadError,
    snapshot,
    nowMs,
    busyAction,
    activityReminderAppCandidates,
    activityReminderCategoryCandidates,
    activityReminderWebCandidates,
    activityReminderCandidateRevision: candidateRevision,
    activityReminderCandidateLoadState,
    activateActivityReminderMode,
    retryActivityReminderCandidates,
    reminderRows,
    activityReminderRuleRows,

    createReminder,
    cancelReminder,
    updateReminder,
    createActivityReminderRule,
    disableActivityReminderRule,
    setActivityReminderEnabled,
    updateActivityReminderLimit,

    retryLoad: refreshSnapshot,
  };
}
