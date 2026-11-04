import { actOnToolPresentation, getToolPresentation, markToolPresentationReady, onToolPresentationChanged, saveToolNotificationPreferences } from "../../../platform/runtime/toolNotificationGateway.ts";
import type { ToolNotificationPreferences, ToolPresentationAction, ToolPresentationSnapshot } from "../../../shared/types/toolNotifications.ts";

interface State { snapshot: ToolPresentationSnapshot | null; busy: boolean; failed: boolean }
let state: State = { snapshot: null, busy: false, failed: false };
const listeners = new Set<() => void>();
let generation = 0;
let request = 0;
let unlisten: (() => void) | null = null;
function publish(patch: Partial<State>) {
  state = { ...state, ...patch };
  listeners.forEach(listener => listener());
}
async function refresh(retry = false) {
  const next = ++request;
  try {
    const snapshot = await getToolPresentation(retry);
    if (next === request && (!state.snapshot || snapshot.revision >= state.snapshot.revision)) publish({ snapshot, failed: false });
  } catch { if (next === request) publish({ failed: true }); }
}
async function start(epoch: number) {
  try {
    const dispose = await onToolPresentationChanged(() => { void refresh(); });
    if (generation !== epoch) { dispose(); return; }
    unlisten = dispose;
    await refresh();
  } catch { if (generation === epoch) publish({ failed: true }); }
}
export const toolPresentationStore = {
  getSnapshot: () => state,
  subscribe(listener: () => void) {
    listeners.add(listener);
    if (listeners.size === 1) void start(++generation);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) { generation++; request++; unlisten?.(); unlisten = null; }
    };
  },
  refresh,
  async save(patch: Partial<ToolNotificationPreferences>) {
    if (state.busy) return;
    publish({ busy: true, failed: false });
    try {
      const preferences = await saveToolNotificationPreferences(patch);
      if (state.snapshot) publish({ snapshot: { ...state.snapshot, preferences } });
      await refresh();
    } catch { publish({ failed: true }); }
    finally { publish({ busy: false }); }
  },
  async act(alertId: string, action: ToolPresentationAction) {
    await actOnToolPresentation(alertId, action);
    await refresh();
  },
  ready: markToolPresentationReady,
};
