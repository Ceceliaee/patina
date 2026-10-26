import type { MiniAction, MiniSnapshot } from "../../src/platform/desktop/miniWindowRuntimeGateway.ts";

const edge = new URLSearchParams(location.search).get("miniEdge");
let snapshot: Omit<MiniSnapshot, "focusRequest" | "transitionId"> & { focus_request: number; transition_id: number } = { epoch: 1, revision: 1, expanded: true, suppressed: false,
  edge: edge === "floating" ? null : edge === "left" || edge === "right" ? edge : "top", held: false, failed: false, focus_request: 1,
  transition_id: 1, transitioning: false, visual: { width: 304, height: 240, anchor: 0.5 } };
export function miniCommand(command: string, payload: { action?: MiniAction; epoch?: number }) {
  if (command === "cmd_get_mini_window_snapshot") return { ...snapshot };
  if (command === "cmd_open_mini_window") return;
  const action = payload.action;
  if (payload.epoch !== snapshot.epoch) throw new Error("Session expired");
  const expanded = snapshot.expanded;
  if (action?.kind === "collapse" && snapshot.edge && !snapshot.held) snapshot.expanded = false;
  if (action?.kind === "reveal") { snapshot.expanded = true; snapshot.focus_request += 1; }
  if (action?.kind === "hold") { snapshot.held = action.held; snapshot.expanded = true; }
  if (snapshot.expanded !== expanded) { snapshot.transition_id += 1; snapshot.transitioning = true; }
  if (action?.kind === "transition_complete" && action.transition_id === snapshot.transition_id) snapshot.transitioning = false;
  snapshot = { ...snapshot, revision: snapshot.revision + 1 };
  return { ...snapshot };
}
