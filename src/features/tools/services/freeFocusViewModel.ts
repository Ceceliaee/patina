import type { FreeFocusTask } from "../../../shared/types/tools.ts";
import { formatCompactDuration } from "./toolsViewModel.ts";

export function freeFocusTime(task: FreeFocusTask, nowMs: number): string {
  const delta = task.status === "running" && task.startedAt !== null ? Math.max(0, nowMs - task.startedAt) : 0;
  return formatCompactDuration(task.phase === "focus" ? task.elapsedMs + delta : Math.max(0, task.restRemainingMs - delta));
}
