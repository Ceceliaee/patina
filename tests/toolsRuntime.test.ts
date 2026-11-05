import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import { mockIPC, clearMocks } from "@tauri-apps/api/mocks";
import { emit } from "@tauri-apps/api/event";
import { parseNotificationPreferences, parseToolPresentation } from "../src/platform/runtime/toolNotificationGateway.ts";
import { toolPresentationStore } from "../src/features/tools/services/toolPresentationStore.ts";
import { formatUsageDuration } from "../src/features/tools/services/toolsLabels.ts";
import { buildToolStatusEntries } from "../src/features/tools/services/toolStatusEntries.ts";
import {
  buildActivityReminderRuleRows,
  buildPomodoroViewModel,
  buildReminderRows,
  buildToolsStatusChipViewModels,
} from "../src/features/tools/services/toolsViewModel.ts";
import {
  readToolsReminderFormMode,
  readToolsReminderMode,
  readToolsSection,
  rememberToolsReminderFormMode,
  rememberToolsReminderMode,
  rememberToolsSection,
} from "../src/features/tools/services/toolsLayoutPreferenceStorage.ts";
import { createToolsRuntimeSnapshotStore } from "../src/features/tools/services/toolsRuntimeSnapshotStore.ts";
import { readFreeFocusRestSettings, rememberFreeFocusRestSettings } from "../src/features/tools/services/freeFocusPreferenceStorage.ts";
import { ToolsRuntimeService } from "../src/features/tools/services/toolsRuntimeService.ts";
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
  pomodoroFocus: "Focus",
  pomodoroShortBreak: "Short break",
  pomodoroLongBreak: "Long break",
  chipFocus: "Focus",
  chipBreak: "Break",
  chipReminder: "Reminder",
  completedToday: (count) => `${count} completed today`,
  cycle: (index, every) => `${index}/${every}`,
};

function rawSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    settings: {
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
    free_focus_tasks: [],
    pomodoro_tasks: [], current_pomodoro: null,
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
    enabled: true,
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
      pomodoroFocusMinutes: 25,
      pomodoroShortBreakMinutes: 5,
      pomodoroLongBreakMinutes: 15,
      pomodoroLongBreakEvery: 4,
    },
    reminders: [],
    activityReminderRules: [],
    freeFocusTasks: [],    pomodoroTasks: [],
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
  assert.equal(parsed.settings.pomodoroFocusMinutes, 25);
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
  const rows = buildActivityReminderRuleRows(parsed, "en-US");
  assert.equal(rows[0].kind, "web");
  assert.equal(rows[0].targetKey, "example.com");
  assert.equal(rows[0].targetLabel, "Example");
  assert.equal(rows[0].limitLabel, "30 minutes");
  assert.equal(rows[0].suspensionReason, "target_excluded");
});

await runTest("usage durations show exact hours and remaining minutes in each locale", () => {
  for (const [minutes, expected] of [[0, "0 分钟"], [30, "30 分钟"], [59, "59 分钟"], [60, "1 小时"], [90, "1 小时 30 分钟"], [120, "2 小时"], [1440, "24 小时"]] as const) {
    assert.equal(formatUsageDuration(minutes, "zh-CN"), expected);
  }
  assert.equal(formatUsageDuration(60, "en-US"), "1 hour");
  assert.equal(formatUsageDuration(120, "en-US"), "2 hours");
  assert.equal(formatUsageDuration(90, "es"), "1 hora 30 minutos");
  assert.equal(formatUsageDuration(120, "ru-RU"), "2 часа");
});

await runTest("raw tool alerts accept canonical activity kind", () => {
  const alert = parseToolAlert(rawAlert({ kind: "activity_reminder" }));
  const alerts = parseToolAlerts([rawAlert({ id: "activity-reminder:3" })]);
  assert.equal(alert.kind, "activity_reminder");
  assert.equal(alerts[0].id, "activity-reminder:3");
  assert.throws(() => parseToolAlert(rawAlert({ kind: "software_reminder" })), /invalid tool alert/);
});

await runTest("usage alert metadata validates duration and target before entering the extension flow", () => {
  const details = { rule_id: 7, date_key: "2026-10-30", target: { kind: "web", normalized_domain: "example.com" }, target_label: "Example", usage_ms: 9_780_000, limit_ms: 1_800_000, message: "Break" };
  const parse = (overrides: Record<string, unknown> = {}) => parseToolAlert(rawAlert({ kind: "activity_reminder", activity_reminder: { ...details, ...overrides } }));
  assert.deepEqual(parse().activityReminder, { ruleId: 7, dateKey: "2026-10-30", target: { kind: "web", normalizedDomain: "example.com" }, targetLabel: "Example", usageMs: 9_780_000, limitMs: 1_800_000, message: "Break" });
  for (const malformed of [{ usage_ms: -1 }, { limit_ms: 0 }, { date_key: "invalid" }, { target: { kind: "unknown" } }]) {
    assert.throws(() => parse(malformed));
  }
});

await runTest("reminder recurrence crosses the IPC boundary and malformed rules fail explicitly", () => {
  for (const recurrence of [null, {kind: "interval", minutes: 30}, {kind: "daily"}, {kind: "weekly", weekdays: [1, 5]}, {kind: "monthly"}, {kind: "yearly"}]) {
    const raw = rawSnapshot();
    const parsed = parseToolsRuntimeSnapshot({...raw, reminders: [{...raw.reminders[0], recurrence}]});
    assert.deepEqual(parsed.reminders[0].recurrence, recurrence);
    assert.deepEqual(buildReminderRows(parsed)[0].recurrence, recurrence);
  }
  for (const recurrence of [{kind: "unknown"}, {kind: "interval", minutes: 0}, {kind: "interval", minutes: 1.5},
    {kind: "weekly", weekdays: []}, {kind: "weekly", weekdays: [1,1]}, {kind: "weekly", weekdays: [8]}]) {
    const raw = rawSnapshot();
    assert.throws(() => parseToolsRuntimeSnapshot({...raw, reminders: [{...raw.reminders[0], recurrence}]}), /invalid/);
  }
});

await runTest("reminder rows retain paused, pending and completed reminders without a countdown", () => {
  const rows = buildReminderRows(snapshot({
    reminders: [
      { id: 1, label: "Keep", scheduledAt: 2_000_000, createdAt: 1_000_000, status: "scheduled", firedAt: null, cancelledAt: null, recurrence: null },
      { id: 3, label: "Paused", scheduledAt: 3_000_000, createdAt: 1_000_000, status: "paused", firedAt: null, cancelledAt: null, recurrence: null },
      { id: 2, label: "Done", scheduledAt: 1_000_000, createdAt: 900_000, status: "fired", firedAt: 1_000_000, cancelledAt: null, recurrence: null },
      { id: 4, label: "Confirm", scheduledAt: 1_000_000, createdAt: 900_000, status: "pending_confirmation", firedAt: 1_000_000, cancelledAt: null, recurrence: null },
      { id: 5, label: "Deleted", scheduledAt: 1_000_000, createdAt: 900_000, status: "cancelled", firedAt: null, cancelledAt: 1_000_000, recurrence: null },
    ],
  }));
  assert.equal(rows.length, 4);
  assert.equal(rows[0].label, "Keep");
  assert.equal(rows[0].scheduledAt, 2_000_000);
  assert.equal(rows[1].status, "paused");
  assert.equal(rows[2].status, "fired");
  assert.equal(rows[3].status, "pending_confirmation");
  assert.equal("remainingLabel" in rows[0], false);
});

await runTest("pomodoro view models format runtime state", () => {
  const pomodoro = buildPomodoroViewModel(snapshot({
    currentPomodoro: {
      id: 2, phase: "short_break", status: "paused", cycleIndex: 2,
      focusMs: 1_500_000, shortBreakMs: 300_000, longBreakMs: 900_000,
      longBreakEvery: 4, phaseStartedAt: null, phasePausedAt: 2_000,
      phaseRemainingMs: 240_000, completedFocusCount: 1, createdAt: 1_000, updatedAt: 2_000,
    },
    todayCompletedPomodoros: 3,
  }), 3_000, labels);
  assert.equal(pomodoro.phaseLabel, "Short break");
  assert.equal(pomodoro.remainingLabel, "04:00");
});

await runTest("tools status chips keep timer before reminder regardless of arrival", () => {
  const chips = buildToolsStatusChipViewModels(snapshot({
    reminders: [{ id: 9, label: "Check", scheduledAt: 2_000_000, createdAt: 900_000, status: "scheduled", firedAt: null, cancelledAt: null, recurrence: null }],
    currentPomodoro: {
      id: 2, phase: "focus", status: "running", cycleIndex: 1,
      focusMs: 1_500_000, shortBreakMs: 300_000, longBreakMs: 900_000,
      longBreakEvery: 4, phaseStartedAt: 1_200_000, phasePausedAt: null,
      phaseRemainingMs: 1_500_000, completedFocusCount: 0, createdAt: 1_200_000, updatedAt: 1_200_000,
    },
    nextReminderAt: 2_000_000,
  }), 1_010_000, labels);
  assert.deepEqual(chips.map((chip) => chip.targetSection), ["pomodoro", "reminders"]);
});

await runTest("tool entries deduplicate running timers and ignore paused tasks and stale reminder metadata", () => {
  const free = { id: 1, label: "Reading", restMode: "fixed" as const, restMinutes: 5, restRatio: 5,
    phase: "focus" as const, status: "running" as const, elapsedMs: 30_000, restRemainingMs: 0,
    startedAt: 1_000_000, createdAt: 0, updatedAt: 1_000_000, deletedAt: null };
  const reminders = [
    { id: 5, label: "Later", scheduledAt: 3_000_000, createdAt: 0, status: "scheduled" as const, firedAt: null, cancelledAt: null, recurrence: null },
    { id: 3, label: "First", scheduledAt: 2_000_000, createdAt: 0, status: "scheduled" as const, firedAt: null, cancelledAt: null, recurrence: null },
  ];
  const data = snapshot({ freeFocusTasks: [free, {...free,id:2,label:"Latest",updatedAt:1_000_001}], reminders, nextReminderAt: 1 });
  const entries = buildToolsStatusChipViewModels(data, 1_010_000, labels);
  assert.deepEqual(entries.map(entry => entry.targetSection), ["pomodoro", "reminders"]);
  assert.match(entries[0].label, /Latest.*00:40/);
  assert.match(entries[1].label, /First/);
  data.freeFocusTasks = data.freeFocusTasks.map(task => ({...task,status:"paused"}));
  assert.equal(buildToolsStatusChipViewModels(data, 1_010_000, labels).length, 1);
  data.reminders = data.reminders.map(reminder => ({...reminder,status:"fired"}));
  assert.deepEqual(buildToolsStatusChipViewModels(data, 1_010_000, labels), []);
});

await runTest("shared reminder entry appears only from 24 hours before its scheduled time", () => {
  const now = 1_000_000;
  const day = 24 * 60 * 60 * 1000;
  const data = { timer: null, reminder: { label: "Tomorrow", scheduledAt: now + day + 1 } };
  assert.deepEqual(buildToolStatusEntries(data, 0, now, labels), []);
  assert.equal(buildToolStatusEntries(data, 0, now + 1, labels).length, 1);
  assert.equal(buildToolStatusEntries(data, 0, data.reminder.scheduledAt, labels).length, 1);
  assert.deepEqual(buildToolStatusEntries(data, 0, data.reminder.scheduledAt + 1, labels), []);
  const reminders = [{ id: 1, ...data.reminder, createdAt: now, status: "scheduled" as const,
    firedAt: null, cancelledAt: null, recurrence: null }];
  assert.deepEqual(buildToolsStatusChipViewModels(snapshot({ reminders }), now, labels), []);
  assert.equal(buildToolsStatusChipViewModels(snapshot({ reminders }), now + 1, labels).length, 1);
});

await runTest("tools preferences merge previous activity tabs into usage mode", () => {
  withWindowStorage(new MemoryStorage(), () => {
    assert.equal(readToolsSection(), "reminders");
    assert.equal(readToolsReminderMode(), "event");
    rememberToolsSection("pomodoro");
    rememberToolsReminderMode("usage");
    rememberToolsReminderFormMode("absolute");
    assert.equal(readToolsSection(), "pomodoro");
    assert.equal(readToolsReminderMode(), "usage");
    assert.equal(readToolsReminderFormMode(), "absolute");
    for (const mode of ["software", "app", "category", "web"]) {
      window.localStorage.setItem("patina:tools-reminder-mode", mode);
      assert.equal(readToolsReminderMode(), "usage");
      assert.equal(window.localStorage.getItem("patina:tools-reminder-mode"), "usage");
    }
  });
});

await runTest("free focus creation preferences retain both values and reject corrupt storage", () => {
  const defaults = { restMode: "fixed", restMinutes: 5, restRatio: 5 };
  const settings = { restMode: "ratio" as const, restMinutes: 12, restRatio: 7 };
  const storage = new MemoryStorage();
  withWindowStorage(storage, () => {
    assert.deepEqual(readFreeFocusRestSettings(), defaults);
    rememberFreeFocusRestSettings(settings);
    assert.deepEqual(readFreeFocusRestSettings(), settings);
    rememberFreeFocusRestSettings({ ...settings, restMode: "fixed" });
    assert.deepEqual(readFreeFocusRestSettings(), { ...settings, restMode: "fixed" });
    for (const raw of ['{', 'null', '[]', JSON.stringify({ ...settings, restMode: 'unknown' }),
      JSON.stringify({ ...settings, restMinutes: 0 }), JSON.stringify({ ...settings, restRatio: 21 }),
      JSON.stringify({ ...settings, restMinutes: 1.5 }), JSON.stringify({ ...settings, restRatio: '7' })]) {
      storage.setItem('patina:free-focus-rest-settings', raw);
      assert.deepEqual(readFreeFocusRestSettings(), defaults);
    }
  });
  const blocked = new MemoryStorage();
  blocked.getItem = () => { throw new Error('storage unavailable'); };
  blocked.setItem = () => { throw new Error('storage unavailable'); };
  withWindowStorage(blocked, () => {
    assert.deepEqual(readFreeFocusRestSettings(), defaults);
    assert.doesNotThrow(() => rememberFreeFocusRestSettings(settings));
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
  for (const extension of ["fifteen_minutes", "one_hour", "today"] as const) {
    assert.equal((await gateway.extendActivityReminder("activity:7:100", extension)).sampledAtMs, 1_000_000);
  }
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
  assert.deepEqual(calls.slice(2), ["fifteen_minutes", "one_hour", "today"].map(extension => ({ command: "cmd_extend_activity_reminder", payload: { alertId: "activity:7:100", extension } })));
  await gateway.updateReminder(3, "Revised", 2_000_000, false);
  assert.deepEqual(calls.at(-1), { command: "cmd_update_reminder", payload: { reminderId: 3, label: "Revised", scheduledAt: 2_000_000, enabled: false, recurrence: null } });
  for (const delayMinutes of [null, 5, 15, 30] as const) {
    await gateway.resolveReminderAlert("reminder:3:100", delayMinutes);
    assert.deepEqual(calls.at(-1), { command: "cmd_resolve_reminder_alert", payload: { alertId: "reminder:3:100", delayMinutes } });
  }
  await gateway.setActivityReminderEnabled(7, false);
  await gateway.updateActivityReminderLimit(7, 2_700_000);
  assert.deepEqual(calls.slice(-2), [
    { command: "cmd_set_activity_reminder_enabled", payload: { ruleId: 7, enabled: false } },
    { command: "cmd_update_activity_reminder_limit", payload: { ruleId: 7, limitMs: 2_700_000 } },
  ]);
});

await runTest("gateway identifies only the exact Tools refresh-pending marker as a non-retryable command error", async () => {
  let rejection: unknown = "TOOLS_STATE_REFRESH_PENDING: committed state requires reconciliation";
  const gateway = createToolsRuntimeGateway({
    async invoke() { throw rejection; },
    async listen() { return () => {}; },
  });
  await assert.rejects(gateway.pausePomodoro(), (error) => {
    assert.deepEqual(error, {
      code: "TOOLS_STATE_REFRESH_PENDING",
      message: rejection,
      retryable: false,
    });
    assert.equal(ToolsRuntimeService.isStateRefreshPendingError(error), true);
    return true;
  });
  for (const ordinaryError of [
    "TOOLS_STATE_REFRESH_PENDING_OTHER: ordinary error",
    "TOOLS_STATE_REFRESH_PENDING",
    "TOOLS_STATE_REFRESH_PENDING:missing delimiter space",
    "database write failed",
    new Error("TOOLS_STATE_REFRESH_PENDING: non-wire error"),
    { code: "WRITE_FAILED", message: "Ordinary failure", retryable: true },
  ]) {
    rejection = ordinaryError;
    await assert.rejects(gateway.pausePomodoro(), (error) => {
      assert.equal(error, ordinaryError);
      assert.equal(ToolsRuntimeService.isStateRefreshPendingError(error), false);
      return true;
    });
  }
});

await runTest("notification wire values reject invalid preferences and malformed presentation", () => {
  const snapshot = { revision: 1, alert: rawAlert(), preferences: { delivery: "notification", sound: "default" }, appearance: { language: "zh-CN" }, error: null };
  assert.equal(parseToolPresentation(snapshot).alert?.id, rawAlert().id);
  for (const value of [null, {}, { delivery: "system", sound: "default" }, { delivery: "dialog", sound: "path.wav" }]) {
    assert.throws(() => parseNotificationPreferences(value));
  }
  for (const patch of [{revision:-1}, {revision:1.5}, {appearance:{language:1}}, {error:12}, {alert:{id:"forged"}}]) {
    assert.throws(() => parseToolPresentation({ ...snapshot, ...patch }));
  }
});

await runTest("presentation store rejects stale reads and keeps committed preferences when resync fails", async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: { crypto: globalThis.crypto } });
  const reads: Array<(value: unknown) => void> = [];
  let failRead = false;
  let failSave = false;
  const snapshot = (revision: number) => ({ revision, alert: null, preferences: { delivery: "notification", sound: "default" }, appearance: {}, error: null });
  let unsubscribe: (() => void) | undefined;
  try {
    mockIPC((command) => {
      if (command === "cmd_get_tool_presentation") {
        if (failRead) throw new Error("injected resync failure");
        return new Promise(resolve => reads.push(resolve));
      }
      if (command === "cmd_save_tool_notification_preferences") {
        if (failSave) throw new Error("injected write failure");
        return { delivery: "dialog", sound: "bell" };
      }
      throw new Error(`Unexpected command ${command}`);
    }, { shouldMockEvents: true });
    unsubscribe = toolPresentationStore.subscribe(() => {});
    await setImmediate();
    assert.equal(reads.length, 1);
    await emit("tool-presentation-changed");
    assert.equal(reads.length, 2);
    reads[1](snapshot(2)); await setImmediate();
    reads[0](snapshot(1)); await setImmediate();
    assert.equal(toolPresentationStore.getSnapshot().snapshot?.revision, 2);
    failSave = true;
    await toolPresentationStore.save({ delivery: "dialog" });
    assert.deepEqual(toolPresentationStore.getSnapshot().snapshot?.preferences, snapshot(2).preferences);
    assert.equal(toolPresentationStore.getSnapshot().failed, true);
    failSave = false; failRead = true;
    await toolPresentationStore.save({ delivery: "dialog", sound: "bell" });
    assert.deepEqual(toolPresentationStore.getSnapshot().snapshot?.preferences, { delivery: "dialog", sound: "bell" });
    assert.equal(toolPresentationStore.getSnapshot().failed, true);
    assert.equal(toolPresentationStore.getSnapshot().busy, false);
  } finally {
    unsubscribe?.(); clearMocks();
    if (descriptor) Object.defineProperty(globalThis, "window", descriptor);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

console.log(`Passed ${passed} tools runtime tests`);
