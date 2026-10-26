import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export type MiniEdge = "top" | "left" | "right";
export interface MiniSnapshot {
  epoch: number;
  revision: number;
  expanded: boolean;
  suppressed: boolean;
  edge: MiniEdge | null;
  held: boolean;
  failed: boolean;
  focusRequest: number;
  transitionId: number;
  transitioning: boolean;
  visual: { width: number; height: number; anchor: number };
}
export type MiniAction =
  | { kind: "reveal" | "collapse" | "dock" | "begin_drag" | "close" }
  | { kind: "hold"; held: boolean }
  | { kind: "place"; edge: MiniEdge | null }
  | { kind: "transition_complete"; transition_id: number }
  | { kind: "protect"; keyboard: boolean; menu: boolean; touch: boolean };

export function parseMiniSnapshot(value: unknown): MiniSnapshot {
  if (!value || typeof value !== "object") throw new Error("Invalid mini window state");
  const raw = value as Omit<MiniSnapshot, "focusRequest" | "transitionId"> & { focus_request: number; transition_id: number };
  if (![raw.epoch, raw.revision, raw.focus_request, raw.transition_id].every((n) => Number.isSafeInteger(n) && n >= 0)
      || typeof raw.expanded !== "boolean" || typeof raw.suppressed !== "boolean" || typeof raw.held !== "boolean"
      || typeof raw.failed !== "boolean"
      || typeof raw.transitioning !== "boolean"
      || !raw.visual || ![raw.visual.width, raw.visual.height].every(n => Number.isFinite(n) && n > 0)
      || !Number.isFinite(raw.visual.anchor) || raw.visual.anchor < 0 || raw.visual.anchor > 1
      || ![null, "top", "left", "right"].includes(raw.edge)) throw new Error("Invalid mini window state");
  return { epoch: raw.epoch, revision: raw.revision, expanded: raw.expanded, suppressed: raw.suppressed,
    edge: raw.edge, held: raw.held, failed: raw.failed, focusRequest: raw.focus_request,
    transitionId: raw.transition_id, transitioning: raw.transitioning, visual: raw.visual };
}

export function openMiniWindow(): Promise<void> { return invoke("cmd_open_mini_window"); }
export async function getMiniSnapshot(): Promise<MiniSnapshot> {
  return parseMiniSnapshot(await invoke("cmd_get_mini_window_snapshot"));
}
export async function sendMiniAction(epoch: number, action: MiniAction): Promise<MiniSnapshot> {
  return parseMiniSnapshot(await invoke("cmd_mini_window_action", { epoch, action }));
}
export function onMiniSnapshot(accept: (snapshot: MiniSnapshot) => void): Promise<() => void> {
  return listen<unknown>("mini-window-state", ({ payload }) => {
    try { accept(parseMiniSnapshot(payload)); } catch (error) { console.warn("mini:state", error); }
  });
}
