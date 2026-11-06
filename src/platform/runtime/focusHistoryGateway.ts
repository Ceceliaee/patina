import { invoke } from "@tauri-apps/api/core";

import type { FocusGroup, FocusKind, FocusSpan } from "../../shared/types/focusHistory.ts";

function isSpan(value: Partial<FocusSpan> | null): value is FocusSpan {
  return Boolean(value && ["focus", "short_break", "long_break", "break"].includes(value.phase ?? "")
    && [value.startedAt, value.cycle, value.rounds].every(Number.isSafeInteger)
    && [value.endedAt, value.phaseFinishedAt].every(t => t === null || Number.isSafeInteger(t)));
}

export async function readFocusHistory(kind: FocusKind, id: number): Promise<FocusGroup[]> {
  const groups = await invoke<unknown>("cmd_get_focus_history", { kind, id });
  if (!Array.isArray(groups) || !groups.every(g => g && typeof g.key === "string"
    && Number.isSafeInteger(g.startedAt) && ["open", "completed", "interrupted"].includes(g.outcome)
    && Array.isArray(g.spans) && g.spans.every(isSpan))) throw new Error("Invalid focus history");
  return groups;
}
