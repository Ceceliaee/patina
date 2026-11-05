import type { ToolStatusChipViewModel, ToolsViewModelLabels } from "../types.ts";

export interface ToolStatusEntrySnapshot {
  timer: { state: string; label: string; phase: string | null; valueMs: number; countingUp: boolean } | null;
  reminder: { label: string; scheduledAt: number } | null;
}

export function buildToolStatusEntries(snapshot: ToolStatusEntrySnapshot, elapsedMs: number, nowMs: number,
  labels: Pick<ToolsViewModelLabels, "chipFocus" | "chipBreak" | "chipReminder">): ToolStatusChipViewModel[] {
  const entries: ToolStatusChipViewModel[] = [];
  const timer = snapshot.timer;
  if (timer?.state === "running") {
    const seconds = Math.floor(Math.max(0, timer.valueMs + Math.max(0, elapsedMs) * (timer.countingUp ? 1 : -1)) / 1000);
    const pad = (n: number) => String(n).padStart(2, "0");
    const time = `${seconds >= 3600 ? `${pad(Math.floor(seconds / 3600))}:` : ""}${pad(Math.floor(seconds / 60) % 60)}:${pad(seconds % 60)}`;
    const phase = timer.phase === "focus" ? labels.chipFocus : labels.chipBreak;
    entries.push({ targetSection: "pomodoro", label: [timer.label, phase, time].filter(Boolean).join(" · ") });
  }
  if (snapshot.reminder && snapshot.reminder.scheduledAt >= nowMs
    && snapshot.reminder.scheduledAt - nowMs <= 24 * 60 * 60 * 1000) {
    const due = new Date(snapshot.reminder.scheduledAt);
    const time = `${String(due.getHours()).padStart(2, "0")}:${String(due.getMinutes()).padStart(2, "0")}`;
    entries.push({ targetSection: "reminders", label: `${snapshot.reminder.label || labels.chipReminder} · ${time}` });
  }
  return entries;
}
