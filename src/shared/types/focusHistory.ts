export type FocusKind = "pomodoro" | "free";
export interface FocusSpan {
  phase: "focus" | "short_break" | "long_break" | "break";
  cycle: number;
  rounds: number;
  startedAt: number;
  endedAt: number | null;
  phaseFinishedAt: number | null;
}
export interface FocusGroup {
  key: string;
  outcome: "open" | "completed" | "interrupted";
  startedAt: number;
  spans: FocusSpan[];
}
