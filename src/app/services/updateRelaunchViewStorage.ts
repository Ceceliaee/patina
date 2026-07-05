import type { View } from "../types/view";

const LAST_ACTIVE_VIEW_KEY = "patina:last-active-view";
const PENDING_UPDATE_RELAUNCH_VIEW_KEY = "patina:pending-update-relaunch-view";

function getStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  return window.localStorage;
}

function isView(value: string | null): value is View {
  return value === "dashboard"
    || value === "history"
    || value === "data"
    || value === "mapping"
    || value === "services"
    || value === "tools"
    || value === "export"
    || value === "settings"
    || value === "about";
}

export function rememberLastActiveView(view: View) {
  const storage = getStorage();
  if (!storage) return;
  storage.setItem(LAST_ACTIVE_VIEW_KEY, view);
}

export function readLastActiveView(): View | null {
  const storage = getStorage();
  if (!storage) return null;

  const storedView = storage.getItem(LAST_ACTIVE_VIEW_KEY);
  return isView(storedView) ? storedView : null;
}

export function markPendingUpdateRelaunchViewRestore() {
  const storage = getStorage();
  if (!storage) return;
  storage.setItem(PENDING_UPDATE_RELAUNCH_VIEW_KEY, "1");
}

export function clearPendingUpdateRelaunchViewRestore() {
  const storage = getStorage();
  if (!storage) return;
  storage.removeItem(PENDING_UPDATE_RELAUNCH_VIEW_KEY);
}

export function consumePendingUpdateRelaunchView(): View | null {
  const storage = getStorage();
  if (!storage) return null;

  const pendingValue = storage.getItem(PENDING_UPDATE_RELAUNCH_VIEW_KEY);

  if (pendingValue !== "1") {
    return null;
  }

  storage.removeItem(PENDING_UPDATE_RELAUNCH_VIEW_KEY);
  return readLastActiveView();
}
