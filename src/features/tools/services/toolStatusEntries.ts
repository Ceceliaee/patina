import type { ToolStatusChipViewModel, ToolsViewModelLabels } from "../types.ts";

export interface ToolStatusEntrySnapshot {
  timer: { state: string; label: string; phase: string | null; valueMs: number; countingUp: boolean } | null;
  reminder: { label: string; scheduledAt: number } | null;
}

const REMINDER_WINDOW_MS = 24 * 60 * 60 * 1000;
const pad = (n: number) => String(n).padStart(2, "0");

function reminderVisible(due: number | null, now: number) {
  return due !== null && due >= now && due - now <= REMINDER_WINDOW_MS;
}

export function nextStatusClockDelay(running: boolean, due: number | null, now: number) {
  if (due === null) return running ? 1000 : null;
  // Recheck wall-clock jumps while focused, including after a reminder expires.
  const cadence = running ? 1000 : 60_000;
  const remaining = due - now;
  if (remaining < 0) return cadence;
  return Math.min(cadence, remaining > REMINDER_WINDOW_MS ? remaining - REMINDER_WINDOW_MS : remaining + 1);
}

export function startStatusClock(running: boolean, due: number | null, tick: (now: number) => void) {
  let timer: number | undefined;
  let visible: boolean | undefined;
  let offset: number | undefined;
  const schedule = () => {
    window.clearTimeout(timer);
    const now = Date.now();
    const nextVisible = reminderVisible(due, now);
    const nextOffset = new Date(now).getTimezoneOffset();
    if (running || nextVisible !== visible || nextOffset !== offset) tick(now);
    visible = nextVisible;
    offset = nextOffset;
    const delay = nextStatusClockDelay(running, due, now);
    if (delay !== null) timer = window.setTimeout(schedule, delay);
  };
  schedule();
  const events = new AbortController();
  window.addEventListener("focus", schedule, events);
  window.addEventListener("pageshow", schedule, events);
  document.addEventListener("visibilitychange", schedule, events);
  return () => {
    window.clearTimeout(timer);
    events.abort();
  };
}

export function buildToolStatusEntries(snapshot: ToolStatusEntrySnapshot, elapsedMs: number, nowMs: number,
  labels: Pick<ToolsViewModelLabels, "chipFocus" | "chipBreak" | "chipReminder">): ToolStatusChipViewModel[] {
  const entries: ToolStatusChipViewModel[] = [];
  const timer = snapshot.timer;
  if (timer?.state === "running") {
    const seconds = Math.floor(Math.max(0, timer.valueMs + Math.max(0, elapsedMs) * (timer.countingUp ? 1 : -1)) / 1000);
    const time = `${seconds >= 3600 ? `${pad(Math.floor(seconds / 3600))}:` : ""}${pad(Math.floor(seconds / 60) % 60)}:${pad(seconds % 60)}`;
    const phase = timer.phase === "focus" ? labels.chipFocus : labels.chipBreak;
    entries.push({ targetSection: "pomodoro", label: [timer.label, phase, time].filter(Boolean).join(" · ") });
  }
  if (snapshot.reminder && reminderVisible(snapshot.reminder.scheduledAt, nowMs)) {
    const due = new Date(snapshot.reminder.scheduledAt);
    const time = `${pad(due.getHours())}:${pad(due.getMinutes())}`;
    entries.push({ targetSection: "reminders", label: `${snapshot.reminder.label || labels.chipReminder} · ${time}` });
  }
  return entries;
}
