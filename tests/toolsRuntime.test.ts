import assert from "node:assert/strict";
import {
  buildActivityReminderRuleRows,
  buildPomodoroViewModel,
  buildReminderRows,
  buildTimerViewModel,
  buildToolsStatusChipViewModels,
} from "../src/features/tools/services/toolsViewModel.ts";
import {
  readToolsReminderFormMode,
  readToolsReminderMode,
  readToolsSection,
  readToolsTimerMode,
  rememberToolsReminderFormMode,
  rememberToolsReminderMode,
  rememberToolsSection,
  rememberToolsTimerMode,
} from "../src/features/tools/services/toolsLayoutPreferenceStorage.ts";
import { createToolsRuntimeSnapshotStore } from "../src/features/tools/services/toolsRuntimeSnapshotStore.ts";
import type { ToolsViewModelLabels } from "../src/features/tools/types.ts";
import {
  parseToolAlert,
  parseToolAlerts,
  parseToolsRuntimeSnapshot,
} from "../src/platform/runtime/toolsRawDtos.ts";
import { createToolsRuntimeGateway } from "../src/platform/runtime/toolsRuntimeGateway.ts";
import type { ToolsRuntimeSnapshot } from "../src/shared/types/tools.ts";
import { MemoryStorage, withWindowStorage } from "./helpers/browserTestGlobals.ts";

const labels: ToolsViewModelLabels = {
  timerIdle: "Not started",
  timerRunning: "Running",
  timerPaused: "Paused",
  timerCompleted: "Completed",
  pomodoroFocus: "Focus",
  pomodoroShortBreak: "Short break",
  pomodoroLongBreak: "Long break",
  chipFocus: "Focus",
  chipBreak: "Break",
  chipCountdown: "Countdown",
  chipStopwatch: "Timer",
  chipReminder: "Reminder",
  activityReminderActive: "Active",
  activityReminderDailyLimit: (minutes) => `${minutes} min daily`,
  dueNow: "Now",
  completedToday: (count) => `${count} completed today`,
  cycle: (index, every) => `${index}/${every}`,
};

function rawSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    settings: {
      default_countdown_minutes: 25,
      pomodoro_focus_minutes: 25,
      pomodoro_short_break_minutes: 5,
      pomodoro_long_break_minutes: 15,
      pomodoro_long_break_every: 4,
    },
    reminders: [{
      id: 1,
      label: "Stand up",
      scheduled_at: 2_000_000,
      created_at: 1_000_000,
      status: "scheduled",
      fired_at: null,
      cancelled_at: null,
    }],
    activity_reminder_rules: [],
    current_timer: null,
    timer_laps: [],
    current_pomodoro: null,
    today_completed_pomodoros: 0,
    next_reminder_at: 2_000_000,
    sampled_at_ms: 1_000_000,
    ...overrides,
  };
}

function rawActivityRule(target: Record<string, unknown>, overrides: Record<string, unknown> = {}) {
  return {
    id: 7,
    target,
    label_snapshot: "Target",
    limit_ms: 30 * 60_000,
    message: "Break",
    created_at: 1_000_000,
    updated_at: 1_000_000,
    disabled_at: null,
    last_fired_date_key: null,
    suspension_reason: null,
    ...overrides,
  };
}

function rawAlert(overrides: Record<string, unknown> = {}) {
  return {
    id: "reminder:1",
    kind: "reminder",
    title: "Reminder",
    body: "Stand up",
    occurred_at: 2_000_000,
    ...overrides,
  };
}

function snapshot(overrides: Partial<ToolsRuntimeSnapshot> = {}): ToolsRuntimeSnapshot {
  return {
    settings: {
      defaultCountdownMinutes: 25,
      pomodoroFocusMinutes: 25,
      pomodoroShortBreakMinutes: 5,
      pomodoroLongBreakMinutes: 15,
      pomodoroLongBreakEvery: 4,
    },
    reminders: [],
    activityReminderRules: [],
    currentTimer: null,
    timerLaps: [],
    currentPomodoro: null,
    todayCompletedPomodoros: 0,
    nextReminderAt: null,
    sampledAtMs: 1_000_000,
    ...overrides,
  };
}

let passed = 0;
async function runTest(name: string, fn: () => Promise<void> | void) {
  await fn();
  passed += 1;
  console.log(`PASS ${name}`);
}

await runTest("raw tools snapshot maps snake_case fields", () => {
  const parsed = parseToolsRuntimeSnapshot(rawSnapshot());
  assert.equal(parsed.settings.defaultCountdownMinutes, 25);
  assert.equal(parsed.reminders[0].scheduledAt, 2_000_000);
  assert.equal(parsed.nextReminderAt, 2_000_000);
});

await runTest("activity reminder snapshot preserves every tagged target", () => {
  const parsed = parseToolsRuntimeSnapshot(rawSnapshot({
    activity_reminder_rules: [
      rawActivityRule({ kind: "app", app_name: "Editor", exe_name: "editor.exe" }),
      rawActivityRule({ kind: "category", category_id: "development" }, { id: 8 }),
      rawActivityRule({ kind: "web", normalized_domain: "example.com" }, {
        id: 9,
        suspension_reason: "source_disabled",
      }),
    ],
  }));
  assert.deepEqual(parsed.activityReminderRules.map((rule) => rule.target.kind), ["app", "category", "web"]);
  assert.equal(parsed.activityReminderRules[1].target.kind === "category"
    ? parsed.activityReminderRules[1].target.categoryId
    : "", "development");
  assert.equal(parsed.activityReminderRules[2].suspensionReason, "source_disabled");
});

await runTest("activity reminder parser rejects mixed or incomplete target shapes", () => {
  assert.throws(() => parseToolsRuntimeSnapshot(rawSnapshot({
    activity_reminder_rules: [rawActivityRule({ kind: "category", category_id: 42 })],
  })), /invalid tools runtime snapshot/);
  assert.throws(() => parseToolsRuntimeSnapshot(rawSnapshot({
    activity_reminder_rules: [rawActivityRule({ kind: "unknown", value: "x" })],
  })), /invalid tools runtime snapshot/);
});

await runTest("activity reminder rows retain target kind, key, limit, and suspension", () => {
  const parsed = parseToolsRuntimeSnapshot(rawSnapshot({
    activity_reminder_rules: [rawActivityRule(
      { kind: "web", normalized_domain: "example.com" },
      { label_snapshot: "Example", suspension_reason: "target_excluded" },
    )],
  }));
  const rows = buildActivityReminderRuleRows(parsed, labels);
  assert.equal(rows[0].kind, "web");
  assert.equal(rows[0].targetKey, "example.com");
  assert.equal(rows[0].targetLabel, "Example");
  assert.equal(rows[0].limitLabel, "30 min daily");
  assert.equal(rows[0].suspensionReason, "target_excluded");
});

await runTest("raw tool alerts accept canonical activity kind", () => {
  const alert = parseToolAlert(rawAlert({ kind: "activity_reminder" }));
  const alerts = parseToolAlerts([rawAlert({ id: "activity-reminder:3" })]);
  assert.equal(alert.kind, "activity_reminder");
  assert.equal(alerts[0].id, "activity-reminder:3");
  assert.throws(() => parseToolAlert(rawAlert({ kind: "software_reminder" })), /invalid tool alert/);
});

await runTest("reminder rows include only scheduled reminders", () => {
  const rows = buildReminderRows(snapshot({
    reminders: [
      { id: 1, label: "Keep", scheduledAt: 2_000_000, createdAt: 1_000_000, status: "scheduled", firedAt: null, cancelledAt: null },
      { id: 2, label: "Done", scheduledAt: 1_000_000, createdAt: 900_000, status: "fired", firedAt: 1_000_000, cancelledAt: null },
    ],
  }), 1_940_000, labels);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].label, "Keep");
  assert.equal(rows[0].remainingLabel, "01:00");
});

await runTest("timer and pomodoro view models format runtime state", () => {
  const timer = buildTimerViewModel(snapshot({
    currentTimer: {
      id: 1, mode: "stopwatch", label: null, durationMs: null, accumulatedMs: 5_000,
      startedAt: 10_000, pausedAt: null, completedAt: null, status: "running",
      createdAt: 9_000, updatedAt: 10_000,
    },
  }), 18_000, labels);
  const pomodoro = buildPomodoroViewModel(snapshot({
    currentPomodoro: {
      id: 2, phase: "short_break", status: "paused", cycleIndex: 2,
      focusMs: 1_500_000, shortBreakMs: 300_000, longBreakMs: 900_000,
      longBreakEvery: 4, phaseStartedAt: null, phasePausedAt: 2_000,
      phaseRemainingMs: 240_000, completedFocusCount: 1, createdAt: 1_000, updatedAt: 2_000,
    },
    todayCompletedPomodoros: 3,
  }), 3_000, labels);
  assert.equal(timer.displayTime, "00:00:13");
  assert.equal(pomodoro.phaseLabel, "Short break");
  assert.equal(pomodoro.remainingLabel, "00:04:00");
});

await runTest("tools status chips preserve arrival order", () => {
  const chips = buildToolsStatusChipViewModels(snapshot({
    reminders: [{ id: 9, label: "Check", scheduledAt: 2_000_000, createdAt: 900_000, status: "scheduled", firedAt: null, cancelledAt: null }],
    currentTimer: {
      id: 1, mode: "stopwatch", label: null, durationMs: null, accumulatedMs: 0,
      startedAt: 1_000_000, pausedAt: null, completedAt: null, status: "running",
      createdAt: 1_000_000, updatedAt: 1_000_000,
    },
    currentPomodoro: {
      id: 2, phase: "focus", status: "running", cycleIndex: 1,
      focusMs: 1_500_000, shortBreakMs: 300_000, longBreakMs: 900_000,
      longBreakEvery: 4, phaseStartedAt: 1_200_000, phasePausedAt: null,
      phaseRemainingMs: 1_500_000, completedFocusCount: 0, createdAt: 1_200_000, updatedAt: 1_200_000,
    },
    nextReminderAt: 2_000_000,
  }), 1_010_000, labels);
  assert.deepEqual(chips.map((chip) => chip.targetSection), ["reminders", "timer", "pomodoro"]);
});

await runTest("tools preferences migrate legacy software mode once", () => {
  withWindowStorage(new MemoryStorage(), () => {
    assert.equal(readToolsSection(), "reminders");
    assert.equal(readToolsReminderMode(), "event");
    rememberToolsSection("pomodoro");
    rememberToolsReminderMode("category");
    rememberToolsTimerMode("countdown");
    rememberToolsReminderFormMode("absolute");
    assert.equal(readToolsSection(), "pomodoro");
    assert.equal(readToolsReminderMode(), "category");
    assert.equal(readToolsTimerMode(), "countdown");
    assert.equal(readToolsReminderFormMode(), "absolute");
    window.localStorage.setItem("patina:tools-reminder-mode", "software");
    assert.equal(readToolsReminderMode(), "app");
    assert.equal(window.localStorage.getItem("patina:tools-reminder-mode"), "app");
  });
});

await runTest("tools runtime snapshot store shares one listener", async () => {
  let listenCount = 0;
  let disposeCount = 0;
  let emitSnapshot: ((next: ToolsRuntimeSnapshot) => void) | null = null;
  const notifications: number[] = [];
  const store = createToolsRuntimeSnapshotStore({
    getSnapshot: async () => snapshot({ sampledAtMs: 1_000 }),
    onChanged: async (listener) => {
      listenCount += 1;
      emitSnapshot = listener;
      return () => { disposeCount += 1; };
    },
    warn: () => {},
  });
  const unsubscribeA = store.subscribe((next) => notifications.push(next.sampledAtMs));
  const unsubscribeB = store.subscribe(() => {});
  await Promise.resolve();
  emitSnapshot?.(snapshot({ sampledAtMs: 2_000 }));
  assert.equal(listenCount, 1);
  assert.deepEqual(notifications, [2_000]);
  unsubscribeA();
  unsubscribeB();
  assert.equal(disposeCount, 1);
});

await runTest("gateway uses canonical activity reminder commands and payload", async () => {
  const calls: Array<{ command: string; payload?: Record<string, unknown> }> = [];
  const gateway = createToolsRuntimeGateway({
    async invoke<T>(command, payload): Promise<T> {
      calls.push({ command, payload });
      if (command === "cmd_get_tool_alerts") return [] as T;
      if (command === "cmd_dismiss_tool_alert") return undefined as T;
      return rawSnapshot() as T;
    },
    async listen() { return () => {}; },
  });
  await gateway.createActivityReminderRule({
    target: { kind: "category", categoryId: "development" },
    labelSnapshot: "Development",
    limitMs: 1_800_000,
    message: "Break",
  });
  await gateway.disableActivityReminderRule(7);
  assert.deepEqual(calls[0], {
    command: "cmd_create_activity_reminder_rule",
    payload: {
      input: {
        target: { kind: "category", categoryId: "development" },
        labelSnapshot: "Development",
        limitMs: 1_800_000,
        message: "Break",
      },
    },
  });
  assert.deepEqual(calls[1], {
    command: "cmd_disable_activity_reminder_rule",
    payload: { ruleId: 7 },
  });
});

console.log(`Passed ${passed} tools runtime tests`);
